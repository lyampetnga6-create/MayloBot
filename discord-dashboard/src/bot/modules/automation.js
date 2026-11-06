'use strict';
/** Automatisations : vocaux temporaires, compteurs, règles de salon, messages programmés, messages collants, pseudos. */
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildMessage, render } = require('../../lib/template');
const { getSendable, safeSend, parseEmoji, deleteLater } = require('../util');
const voicecontrol = require('./voicecontrol');

const cfgOf = (client, gid, id) => client.ctx.settings.module(gid, id);
const db = (client) => client.ctx.db;
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const hasRole = (member, ids) => Boolean(member) && ids.some((id) => member.roles.cache.has(id));

/* ============================ Vocaux temporaires ========================= */

const creating = new Set();          // `${guildId}:${userId}` : création en cours (évite les doublons si on clique vite)
const emptyTimers = new Map();       // channelId -> minuteur de suppression différée

/** Les salons « Rejoindre pour créer » : le principal, plus ceux de la liste (chacun avec son nom et sa limite). */
function triggersOf(cfg) {
  const list = [{ channelId: cfg.triggerChannelId, nameFormat: cfg.nameFormat, limit: cfg.defaultLimit, categoryId: cfg.categoryId, custom: false }];
  for (const t of cfg.triggers || []) {
    if (t.channelId) list.push({ channelId: t.channelId, nameFormat: t.nameFormat || cfg.nameFormat, limit: t.limit || cfg.defaultLimit, categoryId: t.categoryId || cfg.categoryId, custom: Boolean(t.nameFormat || t.limit) });
  }
  return list.filter((t) => t.channelId);
}

/** Reprend les règles d'accès de la catégorie : le vocal créé reste réservé aux mêmes membres. */
function inheritedOverwrites(parent, skipIds) {
  if (!parent?.permissionOverwrites?.cache) return [];
  return [...parent.permissionOverwrites.cache.values()]
    .filter((o) => !skipIds.includes(o.id))
    .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }));
}

async function createTempVoice(client, guild, member, trigger, cfg) {
  const me = guild.members.me;
  const count = db(client).prepare('SELECT COUNT(*) AS n FROM temp_voice WHERE guild_id = ?').get(guild.id).n + 1;
  const prefs = cfg.rememberSettings ? voicecontrol.readPrefs(client, guild.id, member.id) : null;
  let name = render(trigger.nameFormat, { 'user.name': member.displayName, count: String(count) }).slice(0, 100) || 'Salon vocal';
  if (prefs?.name && !trigger.custom) name = voicecontrol.cleanName(prefs.name) || name;
  const limit = trigger.custom && trigger.limit ? trigger.limit : (prefs ? prefs.limit : trigger.limit) || 0;
  const parentId = trigger.categoryId || guild.channels.cache.get(trigger.channelId)?.parentId || null;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;

  // Réglages de départ : verrouillage, chat, etc. (souhaités par le serveur ou gardés par le membre)
  const wants = { Connect: prefs ? prefs.locked : cfg.startLocked, ViewChannel: prefs ? prefs.hidden : false, SendMessages: prefs ? prefs.chatLocked : cfg.startChatLocked, Speak: prefs ? prefs.quiet : false };
  const startDeny = Object.entries(wants).filter(([flag, on]) => on && me.permissions.has(flag)).map(([flag]) => flag);

  // Le vocal reprend les règles d'accès de sa catégorie, puis on ajoute le bot, le propriétaire et les verrous de départ
  const parentEveryone = parent?.permissionOverwrites?.cache?.get(guild.id);
  const overwrites = inheritedOverwrites(parent, [member.id, me.id, guild.id]);
  if (parentEveryone || startDeny.length) {
    const deny = [...new Set([...(parentEveryone ? parentEveryone.deny.toArray() : []), ...startDeny])];
    overwrites.push({ id: guild.id, allow: (parentEveryone ? parentEveryone.allow.toArray() : []).filter((f) => !deny.includes(f)), deny });
  }
  overwrites.push({ id: me.id, allow: voicecontrol.botAllow(me) });
  overwrites.push({ id: member.id, allow: voicecontrol.ownerAllow(me, cfg) });

  const options = {
    name,
    type: ChannelType.GuildVoice,
    parent: parentId || undefined,
    userLimit: limit || undefined,
    permissionOverwrites: overwrites,
    reason: 'Vocal temporaire',
  };
  if (prefs?.bitrate && prefs.bitrate <= (guild.maximumBitrate || 96000)) options.bitrate = prefs.bitrate;
  if (prefs?.region) options.rtcRegion = prefs.region;
  const channel = await guild.channels.create(options);
  db(client).prepare('INSERT OR REPLACE INTO temp_voice (channel_id, guild_id, owner_id, panel_id) VALUES (?,?,?,?)').run(channel.id, guild.id, member.id, '');
  return channel;
}

function scheduleDelete(client, channel, delaySeconds) {
  const kill = async () => {
    emptyTimers.delete(channel.id);
    const fresh = channel.guild.channels.cache.get(channel.id);
    if (!fresh || voicecontrol.humansIn(fresh).length) return;
    db(client).prepare('DELETE FROM temp_voice WHERE channel_id = ?').run(channel.id);
    voicecontrol.forgetChannel(channel.id);
    await fresh.delete('Vocal temporaire vide').catch(() => {});
  };
  if (!delaySeconds) return kill();
  clearTimeout(emptyTimers.get(channel.id));
  const timer = setTimeout(kill, delaySeconds * 1000);
  timer.unref?.();
  emptyTimers.set(channel.id, timer);
  return undefined;
}

async function onVoiceState(client, before, after) {
  const guild = after.guild || before.guild;
  const cfg = cfgOf(client, guild.id, 'tempvoice');
  if (!cfg.enabled) return;
  const member = after.member || before.member;

  // Rôle « en vocal »
  if (cfg.voiceRole.enabled && cfg.voiceRole.roleId && member && !member.user.bot) {
    if (!before.channelId && after.channelId) await member.roles.add(cfg.voiceRole.roleId, 'En vocal').catch(() => {});
    if (before.channelId && !after.channelId) await member.roles.remove(cfg.voiceRole.roleId, 'Plus en vocal').catch(() => {});
  }

  // Quelqu'un revient dans un vocal en attente de suppression : on annule
  if (after.channelId && emptyTimers.has(after.channelId) && !member?.user?.bot) {
    clearTimeout(emptyTimers.get(after.channelId));
    emptyTimers.delete(after.channelId);
  }

  // Création du salon personnel
  const trigger = after.channelId && member && !member.user.bot ? triggersOf(cfg).find((t) => t.channelId === after.channelId) : null;
  if (trigger) {
    const me = guild.members.me;
    const key = `${guild.id}:${member.id}`;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.MoveMembers) || creating.has(key)) return;
    creating.add(key);
    try {
      // Un seul vocal par membre : s'il en a déjà un, on l'y ramène
      const mine = db(client).prepare('SELECT channel_id FROM temp_voice WHERE guild_id = ? AND owner_id = ?').all(guild.id, member.id)
        .map((r) => guild.channels.cache.get(r.channel_id)).find(Boolean);
      if (mine) {
        await member.voice.setChannel(mine).catch(() => {});
      } else {
        const channel = await createTempVoice(client, guild, member, trigger, cfg);
        const moved = await member.voice.setChannel(channel).then(() => true).catch(() => false);
        if (!moved) {
          db(client).prepare('DELETE FROM temp_voice WHERE channel_id = ?').run(channel.id);
          await channel.delete().catch(() => {});
        } else if (cfg.panelEnabled) {
          await voicecontrol.postPanel(client, channel, voicecontrol.getRow(client, channel.id));
        }
      }
    } catch { /* permissions manquantes */ } finally {
      creating.delete(key);
    }
  }

  // Départ d'un vocal temporaire : transfert de propriété ou suppression
  if (before.channelId && before.channelId !== after.channelId) {
    const row = voicecontrol.getRow(client, before.channelId);
    const channel = before.channel || guild.channels.cache.get(before.channelId);
    if (row && channel) {
      const humans = voicecontrol.humansIn(channel);
      if (!humans.length) await scheduleDelete(client, channel, cfg.emptyDelay);
      else if (member && member.id === row.owner_id && cfg.autoTransfer) await voicecontrol.transferOwner(client, channel, humans[0]);
      else if (cfg.panelEnabled) await voicecontrol.refreshPanel(client, channel);
    }
  }
  if (after.channelId && before.channelId !== after.channelId && cfg.panelEnabled) {
    const channel = after.channel;
    if (channel && voicecontrol.getRow(client, channel.id)) await voicecontrol.refreshPanel(client, channel);
  }
}

/** Au démarrage : supprime les vocaux temporaires vides ou disparus. */
async function cleanupTempVoice(client) {
  for (const row of db(client).prepare('SELECT * FROM temp_voice').all()) {
    const guild = client.guilds.cache.get(row.guild_id);
    const ch = guild?.channels.cache.get(row.channel_id);
    if (!ch) { db(client).prepare('DELETE FROM temp_voice WHERE channel_id = ?').run(row.channel_id); continue; }
    if (!voicecontrol.humansIn(ch).length) {
      db(client).prepare('DELETE FROM temp_voice WHERE channel_id = ?').run(row.channel_id);
      voicecontrol.forgetChannel(row.channel_id);
      await ch.delete('Vocal temporaire vide').catch(() => {});
    }
  }
}

/* ================================ Compteurs ============================== */

function counterValue(client, guild, type) {
  switch (type) {
    case 'members': return guild.memberCount;
    case 'humans': return guild.members.cache.filter((m) => !m.user.bot).size;
    case 'bots': return guild.members.cache.filter((m) => m.user.bot).size;
    case 'boosts': return guild.premiumSubscriptionCount || 0;
    case 'channels': return guild.channels.cache.size;
    case 'roles': return guild.roles.cache.size - 1;
    case 'tickets': return db(client).prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'").get(guild.id).n;
    case 'date': {
      const off = cfgOf(client, guild.id, 'general').utcOffset;
      return new Date(Date.now() + off * 3600000).toISOString().slice(0, 10).split('-').reverse().join('/');
    }
    default: return 0;
  }
}

async function tickCounters(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = cfgOf(client, guild.id, 'counters');
    if (!cfg.enabled) continue;
    for (const c of cfg.counters) {
      const ch = guild.channels.cache.get(c.channelId);
      if (!ch) continue;
      const name = render(c.template, { count: String(counterValue(client, guild, c.type)) }).slice(0, 100);
      if (name && ch.name !== name) await ch.setName(name, 'Compteur').catch(() => {});
    }
  }
}

/* ============================= Règles de salon =========================== */

/** Renvoie true si le message a été supprimé (non conforme). */
async function onChannelRule(client, message) {
  const cfg = cfgOf(client, message.guild.id, 'channelrules');
  if (!cfg.enabled) return false;
  const rules = cfg.rules.filter((r) => r.channelId === message.channelId || r.channelId === message.channel.parentId);
  if (!rules.length) return false;

  for (const rule of rules) {
    if (hasRole(message.member, rule.exemptRoles)) continue;
    const media = message.attachments.size > 0 || /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|mp4|mov|webm)(?:\?\S*)?/i.test(message.content);
    const link = /https?:\/\/\S+/i.test(message.content);
    const bad = (rule.contentRule === 'media' && !media) || (rule.contentRule === 'text' && message.attachments.size > 0) || (rule.contentRule === 'links' && !link);
    if (bad && rule.deleteBlocked) {
      await message.delete().catch(() => {});
      return true;
    }
  }
  for (const rule of rules) {
    if (hasRole(message.member, rule.exemptRoles)) continue;
    for (const emoji of rule.reactions) {
      const e = parseEmoji(emoji);
      if (e) await message.react(e.id ? `${e.name}:${e.id}` : e.name).catch(() => {});
    }
    if (rule.autoThread && message.channel.type !== ChannelType.GuildForum) {
      await message.startThread({ name: render(rule.threadName, { 'user.name': message.member?.displayName || message.author.username }).slice(0, 100) || 'discussion' }).catch(() => {});
    }
    if (rule.autoPublish && message.crosspostable) await message.crosspost().catch(() => {});
    if (rule.deleteAfter) deleteLater(message, rule.deleteAfter);
  }
  return false;
}

/* ============================ Messages programmés ======================== */

async function tickAutoMessages(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = cfgOf(client, guild.id, 'automessages');
    if (!cfg.enabled) continue;
    const local = new Date(Date.now() + cfgOf(client, guild.id, 'general').utcOffset * 3600000);
    for (const m of cfg.messages) {
      const key = `am:${guild.id}:${m.id}`;
      let due = false;
      if (m.mode === 'interval') {
        const last = Number(kvGet(client, key) || 0);
        due = Date.now() - last >= m.everyMinutes * 60000;
        if (due && !last) { kvSet(client, key, Date.now()); due = false; } // premier passage : on démarre le compte à rebours
      } else {
        const [hh, mm] = (m.at || '09:00').split(':').map(Number);
        const today = local.toISOString().slice(0, 10);
        const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
        due = nowMin >= hh * 60 + mm && nowMin < hh * 60 + mm + 30 && kvGet(client, key) !== today;
        if (due) kvSet(client, key, today);
      }
      if (!due) continue;
      if (m.mode === 'interval') kvSet(client, key, Date.now());
      const payload = buildMessage(m.message, { server: guild.name, memberCount: String(guild.memberCount) }, cfgOf(client, guild.id, 'general'));
      if (!payload) continue;
      await safeSend(getSendable(guild, m.channelId), {
        ...payload,
        content: [m.pingRoleId ? `<@&${m.pingRoleId}>` : '', payload.content].filter(Boolean).join(' ') || undefined,
        allowedMentions: m.pingRoleId ? { roles: [m.pingRoleId] } : { parse: [] },
      });
    }
  }
}

/* =============================== Messages collants ======================= */

const stickyBusy = new Set();
async function onSticky(client, message) {
  const cfg = cfgOf(client, message.guild.id, 'sticky');
  if (!cfg.enabled) return;
  const s = cfg.stickies.find((x) => x.channelId === message.channelId);
  if (!s || stickyBusy.has(message.channelId)) return;

  db(client).prepare('INSERT OR IGNORE INTO sticky (guild_id, channel_id) VALUES (?,?)').run(message.guild.id, message.channelId);
  db(client).prepare('UPDATE sticky SET counter = counter + 1 WHERE guild_id = ? AND channel_id = ?').run(message.guild.id, message.channelId);
  const row = db(client).prepare('SELECT * FROM sticky WHERE guild_id = ? AND channel_id = ?').get(message.guild.id, message.channelId);
  if (row.counter < s.every || Date.now() - row.last_at < s.minSeconds * 1000) return;

  stickyBusy.add(message.channelId);
  try {
    const payload = buildMessage(s.message, { server: message.guild.name }, cfgOf(client, message.guild.id, 'general'));
    if (!payload) return;
    if (row.message_id) {
      const old = await message.channel.messages.fetch(row.message_id).catch(() => null);
      await old?.delete().catch(() => {});
    }
    const sent = await safeSend(getSendable(message.guild, message.channelId), { ...payload, allowedMentions: { parse: [] } });
    db(client).prepare('UPDATE sticky SET counter = 0, last_at = ?, message_id = ? WHERE guild_id = ? AND channel_id = ?').run(Date.now(), sent?.id || null, message.guild.id, message.channelId);
  } finally {
    stickyBusy.delete(message.channelId);
  }
}

/* ================================== Pseudos ============================== */

/** Retire les caractères qui font remonter un pseudo en haut de la liste. */
function dehoist(name, fallback) {
  const cleaned = String(name).replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return cleaned || fallback;
}

/** Calcule le pseudo corrigé, ou null si rien à changer. */
function wantedNickname(cfg, member, { isJoin = false } = {}) {
  const current = member.nickname || member.user.username;
  let next = current;
  if (isJoin && cfg.template.enabled && !member.nickname) next = render(cfg.template.format, { 'user.name': member.user.username });
  if (cfg.banned.enabled && cfg.banned.words.some((w) => next.toLowerCase().includes(w))) next = cfg.banned.replacement;
  // Le préfixe voulu par l'administrateur (ex. « [Membre] ») n'est pas considéré comme du hoisting.
  const prefix = cfg.template.enabled ? cfg.template.format.split('{')[0].trim() : '';
  if (cfg.dehoist.enabled && !(prefix && next.startsWith(prefix))) next = dehoist(next, cfg.dehoist.fallback);
  next = next.slice(0, 32);
  return next !== current ? next : null;
}

async function applyNickname(client, member, opts) {
  if (member.user.bot || !member.manageable) return;
  const cfg = cfgOf(client, member.guild.id, 'nickname');
  if (!cfg.enabled) return;
  const next = wantedNickname(cfg, member, opts);
  if (next) await member.setNickname(next, 'Nettoyage des pseudos').catch(() => {});
}

module.exports = { onVoiceState, cleanupTempVoice, tickCounters, onChannelRule, tickAutoMessages, onSticky, applyNickname, wantedNickname, dehoist, counterValue };
