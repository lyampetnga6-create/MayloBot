'use strict';
const { AuditLogEvent, PermissionFlagsBits: P, EmbedBuilder, ChannelType } = require('discord.js');
const { getSendable, safeSend, wait } = require('../util');
const { safeText } = require('../../lib/template');
const mod = require('./moderation');

const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.BanMembers, P.KickMembers, P.ManageWebhooks];
const MAX_TIMEOUT_MS = 28 * 86400000 - 60000;

const joins = new Map();      // guildId -> [{ id, at }]
const actions = new Map();    // guildId:userId:type -> [timestamps]
const punished = new Map();   // guildId:userId -> timestamp (évite de punir deux fois de suite)

setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [k, list] of actions) {
    const fresh = list.filter((t) => t > cutoff);
    if (fresh.length) actions.set(k, fresh); else actions.delete(k);
  }
  for (const [k, t] of punished) if (t < cutoff) punished.delete(k);
}, 600000).unref();

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'protection');

function isTrusted(client, guild, userId, member) {
  const cfg = cfgOf(client, guild.id);
  if (userId === guild.ownerId || userId === client.user.id) return true;
  if (cfg.trustedUsers.includes(userId)) return true;
  const m = member || guild.members.cache.get(userId);
  return Boolean(m && m.roles.cache.some((r) => cfg.trustedRoles.includes(r.id)));
}

async function alert(client, guild, embed) {
  const s = client.ctx.settings.get(guild.id);
  const channelId = s.protection.alertChannelId || (s.logs.enabled && s.logs.channelId) || s.moderation.modLogChannelId || '';
  await safeSend(getSendable(guild, channelId), { embeds: [embed], allowedMentions: { parse: [] } });
}

const alertEmbed = (title, color = 0xef4444) => new EmbedBuilder().setColor(color).setTitle(`🏰 ${title}`).setTimestamp();

/* ------------------------------------------------------------------ */
/* Mode raid (état conservé en base pour survivre aux redémarrages)    */
/* ------------------------------------------------------------------ */
const raidKey = (guildId) => `raidmode:${guildId}`;

function raidModeUntil(client, guildId) {
  const row = client.ctx.db.prepare('SELECT value FROM kv WHERE key = ?').get(raidKey(guildId));
  return row ? Number(row.value) || 0 : 0;
}

const raidModeActive = (client, guildId) => raidModeUntil(client, guildId) > Date.now();

function setRaidMode(client, guildId, minutes) {
  const { db } = client.ctx;
  if (!minutes) return db.prepare('DELETE FROM kv WHERE key = ?').run(raidKey(guildId));
  return db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(raidKey(guildId), String(Date.now() + minutes * 60000));
}

/* ------------------------------------------------------------------ */
/* Quarantaine                                                         */
/* ------------------------------------------------------------------ */
const quarantineKey = (guildId, userId) => `quarantine:${guildId}:${userId}`;

async function quarantine(client, guild, member, reason) {
  const cfg = cfgOf(client, guild.id);
  const roles = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.editable).map((r) => r.id);
  client.ctx.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(quarantineKey(guild.id, member.id), JSON.stringify(roles));
  if (roles.length) await member.roles.remove(roles, reason).catch(() => {});
  if (cfg.quarantineRoleId && guild.roles.cache.has(cfg.quarantineRoleId)) await member.roles.add(cfg.quarantineRoleId, reason).catch(() => {});
  await member.timeout(MAX_TIMEOUT_MS, reason).catch(() => {});
  return roles.length;
}

async function unquarantine(client, guild, member, reason = 'Fin de quarantaine') {
  const cfg = cfgOf(client, guild.id);
  const { db } = client.ctx;
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(quarantineKey(guild.id, member.id));
  if (!row) throw new Error('Ce membre n’est pas en quarantaine.');
  let roles = [];
  try { roles = JSON.parse(row.value); } catch { /* données illisibles : on rend seulement la parole */ }
  if (cfg.quarantineRoleId) await member.roles.remove(cfg.quarantineRoleId, reason).catch(() => {});
  const restorable = roles.filter((id) => guild.roles.cache.get(id)?.editable);
  if (restorable.length) await member.roles.add(restorable, reason).catch(() => {});
  await member.timeout(null, reason).catch(() => {});
  db.prepare('DELETE FROM kv WHERE key = ?').run(quarantineKey(guild.id, member.id));
  return restorable.length;
}

/* ------------------------------------------------------------------ */
/* Sanction d'un membre par les protections                            */
/* ------------------------------------------------------------------ */
async function applyAction(client, guild, member, action, { reason, timeoutMinutes = 60 }) {
  switch (action) {
    case 'kick':
    case 'ban':
      await mod.sanction(client, { guild, user: member.user, moderator: client.user, type: action, reason, auto: true });
      return true;
    case 'timeout':
      await mod.sanction(client, { guild, user: member.user, moderator: client.user, type: 'timeout', reason, duration: timeoutMinutes, auto: true });
      return true;
    case 'quarantine':
      await quarantine(client, guild, member, reason);
      mod.createCase(client.ctx.db, { guildId: guild.id, userId: member.id, modId: client.user.id, type: 'timeout', reason: `Quarantaine : ${reason}`, duration: null });
      return true;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Arrivées : filtre + anti-raid                                       */
/* ------------------------------------------------------------------ */
async function dmReason(client, guild, user, text) {
  await user.send({ content: `Tu as été retiré de **${guild.name}** : ${text}` }).catch(() => {});
}

/** Renvoie true si le membre a été sanctionné (les autres modules peuvent alors l'ignorer). */
async function onMemberJoin(client, member) {
  const { guild } = member;
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled || member.user.bot) return false;
  if (isTrusted(client, guild, member.id, member)) return false;

  /* --- Filtre d'arrivée --- */
  const gate = cfg.joinGate;
  if (gate.enabled) {
    const problems = [];
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    if (gate.minAccountDays > 0 && ageDays < gate.minAccountDays) problems.push(`compte trop récent (${Math.floor(ageDays)} j)`);
    if (gate.requireAvatar && !member.user.avatar) problems.push('pas de photo de profil');
    const names = `${member.user.username} ${member.displayName || ''}`.toLowerCase();
    if (gate.nameFilter.some((w) => w && names.includes(w))) problems.push('pseudo interdit');
    if (problems.length) {
      const reason = `Filtre d’arrivée : ${problems.join(', ')}`;
      if (gate.dmReason && ['kick', 'ban'].includes(gate.action)) await dmReason(client, guild, member.user, problems.join(', '));
      try {
        await applyAction(client, guild, member, gate.action, { reason, timeoutMinutes: gate.timeoutMinutes });
      } catch (err) {
        console.warn(`[protection] ${guild.id}: ${err.message}`);
      }
      await alert(client, guild, alertEmbed('Filtre d’arrivée', 0xf97316).addFields(
        { name: 'Membre', value: `${member.user} (\`${member.id}\`)`, inline: true },
        { name: 'Raison', value: problems.join(', '), inline: true },
        { name: 'Sanction', value: gate.action, inline: true },
      ));
      return true;
    }
  }

  /* --- Anti-raid --- */
  const raid = cfg.antiRaid;
  if (!raid.enabled) return false;
  const now = Date.now();
  const list = (joins.get(guild.id) || []).filter((j) => now - j.at < raid.seconds * 1000);
  list.push({ id: member.id, at: now });
  joins.set(guild.id, list);

  const active = raidModeActive(client, guild.id);
  const triggered = !active && list.length >= raid.joins;
  if (!active && !triggered) return false;

  if (triggered) {
    if (raid.raidModeMinutes > 0) setRaidMode(client, guild.id, raid.raidModeMinutes);
    await alert(client, guild, alertEmbed('RAID DÉTECTÉ').setDescription(
      `**${list.length}** arrivées en ${raid.seconds} s. Action : **${raid.action}**.${raid.raidModeMinutes ? ` Mode raid actif ${raid.raidModeMinutes} min (\`/raidmode off\` pour l’arrêter).` : ''}`,
    ));
  }

  const targets = triggered ? list.map((j) => j.id) : [member.id];
  let done = 0;
  for (const id of targets) {
    const m = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (!m || isTrusted(client, guild, id, m)) continue;
    try {
      if (await applyAction(client, guild, m, raid.action, { reason: 'Anti-raid : arrivées en masse', timeoutMinutes: raid.timeoutMinutes })) done++;
    } catch (err) {
      console.warn(`[protection/raid] ${guild.id}: ${err.message}`);
    }
  }
  if (triggered && raid.action !== 'alert') {
    await alert(client, guild, alertEmbed('Anti-raid : sanctions appliquées', 0xf97316).setDescription(`${done} / ${targets.length} membre(s) traité(s).`));
  }
  return raid.action !== 'alert';
}

/* ------------------------------------------------------------------ */
/* Liens d'arnaque                                                     */
/* ------------------------------------------------------------------ */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/[a-z0-9-]{2,32}/i;
const OFFICIAL = ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discordstatus.com', 'discord.gift', 'discord.new', 'dis.gd', 'discord.dev'];
const STEAM_OFFICIAL = ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steam-chat.com', 'steamgames.com', 'steam.com'];
const BAIT = /(nitro|gift|free|airdrop|promo|giveaway|verify|claim|login|auth|trade|reward|drop|event|partner)/i;
const SCAM_PHRASES = /(free\s+nitro|nitro\s+(?:gratuit|gift|for\s+free)|steam\s+gift\s+card|airdrop\s+discord|claim\s+your\s+(?:nitro|gift))/i;

const hostOf = (raw) => {
  try { return new URL(raw.startsWith('www.') ? `https://${raw}` : raw).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};
const matchesDomain = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Analyse les liens d'un message. Renvoie { reason } ou null (fonction pure). */
function scanLinks(content, extraDomains = []) {
  const urls = content.match(URL_RE) || [];
  for (const url of urls) {
    const host = hostOf(url);
    if (!host) continue;
    if (extraDomains.length && matchesDomain(host, extraDomains)) return { reason: `domaine bloqué (${host})` };
    if (matchesDomain(host, OFFICIAL) || matchesDomain(host, STEAM_OFFICIAL)) continue;

    const label = host.split('.').slice(0, -1).join('.').replace(/[^a-z0-9]/g, '');
    const nearDiscord = ['discord', 'discordapp'].some((d) => label.length >= 6 && editDistance(label, d) <= 2);
    if ((host.includes('discord') || host.includes('discrod') || nearDiscord) && (BAIT.test(host) || nearDiscord)) {
      return { reason: `faux site Discord (${host})` };
    }
    if (/st[e3]a?m/.test(label) && (BAIT.test(host) || /communit|comunit|commun/.test(host))) return { reason: `faux site Steam (${host})` };
    if (host.includes('nitro') && BAIT.test(host)) return { reason: `faux Nitro (${host})` };
  }
  if (urls.length && SCAM_PHRASES.test(content)) return { reason: 'formule typique d’arnaque (faux Nitro / cadeau)' };
  return null;
}

async function punishMessage(client, message, kind, cfg, reason) {
  const { guild } = message;
  if (message.deletable) await message.delete().catch(() => {});
  const action = cfg.action;
  try {
    if (action === 'timeout') await mod.autoTimeout(client, guild, message.author, cfg.timeoutMinutes, reason);
    else if (action === 'ban') await mod.sanction(client, { guild, user: message.author, moderator: client.user, type: 'ban', reason, auto: true, deleteDays: 1 });
  } catch (err) {
    console.warn(`[protection] ${guild.id}: ${err.message}`);
  }
  await alert(client, guild, alertEmbed(kind, 0xf97316).addFields(
    { name: 'Membre', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
    { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
    { name: 'Raison', value: reason },
    { name: 'Message', value: safeText(message.content || '—').slice(0, 900) },
  ));
}

/** Renvoie true si le message a été traité (supprimé). */
async function onMessage(client, message) {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot) return false;
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled || !message.content) return false;
  if (isTrusted(client, guild, member.id, member)) return false;
  if (member.permissions.has(P.ManageMessages) || member.permissions.has(P.Administrator)) return false;

  if (cfg.scamLinks.enabled) {
    const hit = scanLinks(message.content, cfg.scamLinks.blockedDomains);
    if (hit) {
      await punishMessage(client, message, 'Lien d’arnaque bloqué', cfg.scamLinks, `Protection : ${hit.reason}`);
      return true;
    }
  }

  const nm = cfg.newMemberLinks;
  if (nm.enabled && member.joinedTimestamp && Date.now() - member.joinedTimestamp < nm.minutes * 60000
    && (URL_RE.test(message.content) || INVITE_RE.test(message.content))) {
    URL_RE.lastIndex = 0;
    await punishMessage(client, message, 'Lien d’un membre récent bloqué', nm, `Protection : lien envoyé ${nm.minutes} min après l’arrivée`);
    return true;
  }
  URL_RE.lastIndex = 0;
  return false;
}

/* ------------------------------------------------------------------ */
/* Anti-nuke (journal d'audit)                                         */
/* ------------------------------------------------------------------ */
const COUNTED = {
  [AuditLogEvent.ChannelDelete]: 'channelDelete',
  [AuditLogEvent.ChannelCreate]: 'channelCreate',
  [AuditLogEvent.RoleDelete]: 'roleDelete',
  [AuditLogEvent.RoleCreate]: 'roleCreate',
  [AuditLogEvent.MemberBanAdd]: 'ban',
  [AuditLogEvent.MemberKick]: 'kick',
  [AuditLogEvent.WebhookCreate]: 'webhookCreate',
};
const NUKE_LABELS = {
  channelDelete: 'suppressions de salons', channelCreate: 'créations de salons', roleDelete: 'suppressions de rôles',
  roleCreate: 'créations de rôles', ban: 'bannissements', kick: 'expulsions', webhookCreate: 'créations de webhooks',
};

/** Compte une action ; renvoie true si la limite est dépassée (fonction pure, testable). */
function countAction(store, key, now, windowMs, limit) {
  const list = (store.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  store.set(key, list);
  return list.length > limit;
}

async function punishExecutor(client, guild, executorId, reason) {
  const cfg = cfgOf(client, guild.id).antiNuke;
  const key = `${guild.id}:${executorId}`;
  if (Date.now() - (punished.get(key) || 0) < 60000) return 'déjà traité';
  punished.set(key, Date.now());

  const member = guild.members.cache.get(executorId) || await guild.members.fetch(executorId).catch(() => null);
  if (!member) return 'membre introuvable';
  try {
    if (cfg.punishment === 'quarantine') {
      const n = await quarantine(client, guild, member, reason);
      return `quarantaine (${n} rôle(s) retiré(s))`;
    }
    if (cfg.punishment === 'kick') { await member.kick(reason); return 'expulsé'; }
    if (cfg.punishment === 'ban') { await guild.members.ban(executorId, { reason }); return 'banni'; }
    return 'alerte seulement';
  } catch (err) {
    return `échec (${err.message})`;
  }
}

async function onAuditEntry(client, entry, guild) {
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled) return;
  const executorId = entry.executorId;
  if (!executorId) return;

  /* Bot ajouté par quelqu'un qui n'est pas de confiance */
  if (entry.action === AuditLogEvent.BotAdd && cfg.joinGate.enabled && cfg.joinGate.blockBots && !isTrusted(client, guild, executorId)) {
    const bot = guild.members.cache.get(entry.targetId) || await guild.members.fetch(entry.targetId).catch(() => null);
    if (bot) await bot.kick('Protection : bot ajouté par un membre non approuvé').catch(() => {});
    await alert(client, guild, alertEmbed('Bot refusé', 0xf97316).setDescription(`<@${executorId}> a ajouté <@${entry.targetId}> : le bot a été expulsé.`));
    return;
  }

  if (!cfg.antiNuke.enabled || isTrusted(client, guild, executorId)) return;
  const nuke = cfg.antiNuke;

  /* Permissions dangereuses ajoutées à un rôle ou à un membre */
  if (nuke.guardPermissions) {
    if (entry.action === AuditLogEvent.RoleUpdate) {
      const change = (entry.changes || []).find((c) => c.key === 'permissions');
      if (change) {
        const oldBits = BigInt(change.old ?? 0);
        const newBits = BigInt(change.new ?? 0);
        const added = DANGEROUS.filter((bit) => (newBits & bit) && !(oldBits & bit));
        const role = guild.roles.cache.get(entry.targetId);
        if (added.length && role?.editable) {
          await role.setPermissions(oldBits, 'Protection : permissions dangereuses annulées').catch(() => {});
          const result = await punishExecutor(client, guild, executorId, 'Protection : ajout de permissions dangereuses');
          await alert(client, guild, alertEmbed('Permissions dangereuses annulées').setDescription(`<@${executorId}> a ajouté des permissions sensibles au rôle **${safeText(role.name)}**. Annulé. Responsable : ${result}.`));
        }
      }
      return;
    }
    if (entry.action === AuditLogEvent.MemberRoleUpdate) {
      const added = ((entry.changes || []).find((c) => c.key === '$add')?.new) || [];
      const risky = added.map((r) => guild.roles.cache.get(r.id)).filter((r) => r && DANGEROUS.some((bit) => r.permissions.has(bit)));
      if (risky.length) {
        const target = guild.members.cache.get(entry.targetId) || await guild.members.fetch(entry.targetId).catch(() => null);
        if (target) await target.roles.remove(risky.filter((r) => r.editable), 'Protection : rôle dangereux retiré').catch(() => {});
        const result = await punishExecutor(client, guild, executorId, 'Protection : rôle à permissions dangereuses donné');
        await alert(client, guild, alertEmbed('Rôle dangereux retiré').setDescription(`<@${executorId}> a donné ${risky.map((r) => `**${safeText(r.name)}**`).join(', ')} à <@${entry.targetId}>. Retiré. Responsable : ${result}.`));
      }
      return;
    }
  }

  /* Actions en rafale */
  const type = COUNTED[entry.action];
  if (!type) return;
  const exceeded = countAction(actions, `${guild.id}:${executorId}:${type}`, Date.now(), nuke.seconds * 1000, nuke[type]);
  if (!exceeded) return;
  const result = await punishExecutor(client, guild, executorId, `Anti-nuke : trop de ${NUKE_LABELS[type]}`);
  await alert(client, guild, alertEmbed('ANTI-NUKE').setDescription(
    `<@${executorId}> a dépassé la limite de **${nuke[type]} ${NUKE_LABELS[type]}** en ${nuke.seconds} s. Responsable : ${result}.`,
  ));
}

/* ------------------------------------------------------------------ */
/* Verrouillage d'urgence                                              */
/* ------------------------------------------------------------------ */
const lockKey = (guildId) => `lockdown:${guildId}`;

function lockTargets(guild, cfg) {
  const wanted = cfg.lockdownChannels.length ? cfg.lockdownChannels.map((id) => guild.channels.cache.get(id)).filter(Boolean) : [...guild.channels.cache.values()];
  return wanted.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(c.type));
}

/** Verrouille (on = true) ou déverrouille tous les salons concernés. Renvoie le nombre de salons modifiés. */
async function lockdown(client, guild, on, reason) {
  const { db } = client.ctx;
  const cfg = cfgOf(client, guild.id);
  const everyone = guild.roles.everyone;
  let changed = 0;

  if (on) {
    const saved = {};
    for (const ch of lockTargets(guild, cfg)) {
      const ow = ch.permissionOverwrites.cache.get(everyone.id);
      saved[ch.id] = ow?.allow.has(P.SendMessages) ? 'allow' : ow?.deny.has(P.SendMessages) ? 'deny' : 'neutral';
      if (saved[ch.id] === 'deny') continue;
      try {
        await ch.permissionOverwrites.edit(everyone, { SendMessages: false, AddReactions: false, CreatePublicThreads: false }, { reason });
        changed++;
        if (changed <= 25 && cfg.lockdownMessage) await safeSend(ch, { content: cfg.lockdownMessage, allowedMentions: { parse: [] } });
        await wait(120);
      } catch { /* salon inaccessible */ }
    }
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(lockKey(guild.id), JSON.stringify(saved));
    return changed;
  }

  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(lockKey(guild.id));
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { /* rien à restaurer */ }
  for (const [channelId, previous] of Object.entries(saved)) {
    const ch = guild.channels.cache.get(channelId);
    if (!ch || previous === 'deny') continue;
    try {
      const value = previous === 'allow' ? true : null;
      await ch.permissionOverwrites.edit(everyone, { SendMessages: value, AddReactions: value, CreatePublicThreads: value }, { reason });
      changed++;
      await wait(120);
    } catch { /* salon inaccessible */ }
  }
  db.prepare('DELETE FROM kv WHERE key = ?').run(lockKey(guild.id));
  return changed;
}

const isLockedDown = (client, guildId) => Boolean(client.ctx.db.prepare('SELECT 1 FROM kv WHERE key = ?').get(lockKey(guildId)));

module.exports = {
  onMemberJoin, onMessage, onAuditEntry, scanLinks, countAction, isTrusted, quarantine, unquarantine,
  lockdown, isLockedDown, setRaidMode, raidModeActive, raidModeUntil, alert, alertEmbed, applyAction, DANGEROUS,
  _joins: joins, _actions: actions,
};
