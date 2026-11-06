'use strict';
/**
 * Suivi des invitations : qui a fait venir chaque membre, classement des inviteurs, récompenses en rôles.
 *
 * Le bot garde en mémoire le nombre d'utilisations de chaque invitation. À chaque arrivée, il compare avec
 * l'état actuel : l'invitation dont le compteur a augmenté est celle qui a été utilisée.
 * Il lui faut la permission « Gérer le serveur » pour lire les invitations.
 */
const { buildMessage, memberVars } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'invites');

/** guildId → Map(code → { uses, maxUses, inviterId }) */
const cache = new Map();
const VANITY = '__vanity';

/* ------------------------------------------------------------------ */
/* Détection (fonction pure, testée)                                    */
/* ------------------------------------------------------------------ */

/**
 * Compare l'état avant / après une arrivée. Renvoie { code, inviterId } ou null si indéterminé.
 * Une invitation qui a disparu a pu être utilisée une dernière fois (limite d'utilisations atteinte).
 */
function detectInvite(before, after) {
  const used = [];
  for (const [code, now] of after) {
    const prev = before.get(code);
    if ((prev ? prev.uses : 0) < now.uses) used.push({ code, inviterId: now.inviterId || null });
  }
  if (used.length === 1) return used[0];
  if (used.length > 1) return null; // plusieurs arrivées en même temps : impossible de trancher
  const vanished = [...before].filter(([code, prev]) => !after.has(code) && prev.maxUses > 0 && prev.uses + 1 >= prev.maxUses);
  if (vanished.length === 1) return { code: vanished[0][0], inviterId: vanished[0][1].inviterId || null };
  return null;
}

/* ------------------------------------------------------------------ */
/* Cache                                                                */
/* ------------------------------------------------------------------ */
async function snapshot(guild) {
  const map = new Map();
  const invites = await guild.invites.fetch();
  for (const inv of invites.values()) map.set(inv.code, { uses: inv.uses || 0, maxUses: inv.maxUses || 0, inviterId: inv.inviterId || inv.inviter?.id || null });
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity) map.set(VANITY, { uses: vanity.uses || 0, maxUses: 0, inviterId: null });
  }
  return map;
}

async function refresh(client, guild) {
  try {
    const map = await snapshot(guild);
    cache.set(guild.id, map);
    return map;
  } catch {
    cache.delete(guild.id); // permission manquante : on réessaiera à la prochaine arrivée
    return null;
  }
}

/** Au démarrage : mémorise les invitations des serveurs où le module est actif. */
async function warm(client) {
  for (const guild of client.guilds.cache.values()) {
    if (cfgOf(client, guild.id).enabled) await refresh(client, guild);
  }
}

function onInviteCreate(client, invite) {
  const map = invite.guild && cache.get(invite.guild.id);
  if (map) map.set(invite.code, { uses: invite.uses || 0, maxUses: invite.maxUses || 0, inviterId: invite.inviterId || invite.inviter?.id || null });
}
function onInviteDelete(client, invite) {
  // On ne supprime pas tout de suite : l'arrivée qui l'a épuisée a besoin de l'ancien état.
  const map = invite.guild && cache.get(invite.guild.id);
  if (map?.has(invite.code)) setTimeout(() => map.delete(invite.code), 15000).unref?.();
}

/* ------------------------------------------------------------------ */
/* Statistiques                                                         */
/* ------------------------------------------------------------------ */
function statsFor(client, guildId, userId) {
  const row = db(client).prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(left_at IS NOT NULL), 0) AS gone FROM invite_joins WHERE guild_id = ? AND inviter_id = ?',
  ).get(guildId, userId);
  return { total: row.total, left: row.gone, active: row.total - row.gone };
}

function leaderboard(client, guildId, limit = 10) {
  return db(client).prepare(
    `SELECT inviter_id AS userId, COUNT(*) AS total, COALESCE(SUM(left_at IS NOT NULL), 0) AS gone
       FROM invite_joins WHERE guild_id = ? AND inviter_id IS NOT NULL
      GROUP BY inviter_id ORDER BY (COUNT(*) - COALESCE(SUM(left_at IS NOT NULL), 0)) DESC, COUNT(*) DESC LIMIT ?`,
  ).all(guildId, limit).map(({ gone, ...r }) => ({ ...r, left: gone, active: r.total - gone }));
}

/** Qui a invité ce membre ? → { inviterId, code } ou null. */
function inviterOf(client, guildId, userId) {
  const r = db(client).prepare('SELECT inviter_id, code FROM invite_joins WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(guildId, userId);
  return r ? { inviterId: r.inviter_id, code: r.code } : null;
}

/** Variables {inviter}, {inviter.name}, {invites} pour les messages de bienvenue et de départ. */
async function inviterVars(client, guild, userId) {
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled) return {};
  const found = inviterOf(client, guild.id, userId);
  if (!found?.inviterId) return { inviter: 'un lien inconnu', 'inviter.name': 'un lien inconnu', invites: '0' };
  const user = client.users.cache.get(found.inviterId) || await client.users.fetch(found.inviterId).catch(() => null);
  return {
    inviter: `<@${found.inviterId}>`, 'inviter.name': user?.username || 'un ancien membre',
    invites: String(statsFor(client, guild.id, found.inviterId).active),
  };
}

/* ------------------------------------------------------------------ */
/* Arrivées et départs                                                  */
/* ------------------------------------------------------------------ */
async function giveRewards(client, guild, inviterId, active) {
  const cfg = cfgOf(client, guild.id);
  const due = (cfg.rewards || []).filter((r) => r.roleId && active >= r.count && guild.roles.cache.get(r.roleId)?.editable);
  if (!due.length) return;
  const member = guild.members.cache.get(inviterId) || await guild.members.fetch(inviterId).catch(() => null);
  if (!member) return;
  const missing = due.map((r) => r.roleId).filter((id) => !member.roles.cache.has(id));
  if (missing.length) await member.roles.add(missing, `Récompense d’invitations (${active})`).catch(() => {});
}

async function onMemberAdd(client, member) {
  const { guild } = member;
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled) return;

  const before = cache.get(guild.id);
  const after = await refresh(client, guild);
  let found = null;
  if (member.user.bot) found = { code: 'BOT', inviterId: null };
  else if (before && after) found = detectInvite(before, after);
  const code = found?.code === VANITY ? 'vanity' : (found?.code || '');
  const inviterId = found?.inviterId && found.inviterId !== member.id ? found.inviterId : null;

  db(client).prepare('INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at) VALUES (?,?,?,?,?)')
    .run(guild.id, member.id, inviterId, code, Date.now());
  if (member.user.bot) return;

  const vars = { ...memberVars(member), ...(await inviterVars(client, guild, member.id)) };
  if (inviterId) await giveRewards(client, guild, inviterId, statsFor(client, guild.id, inviterId).active);

  if (cfg.channelId) {
    const payload = buildMessage(cfg.message, vars, client.ctx.settings.module(guild.id, 'general'));
    if (payload) await safeSend(getSendable(guild, cfg.channelId), { ...payload, allowedMentions: { parse: [] } });
  }
}

function onMemberRemove(client, member) {
  if (!cfgOf(client, member.guild.id).enabled) return;
  db(client).prepare('UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL')
    .run(Date.now(), member.guild.id, member.id);
}

module.exports = {
  detectInvite, snapshot, refresh, warm, onInviteCreate, onInviteDelete,
  statsFor, leaderboard, inviterOf, inviterVars, onMemberAdd, onMemberRemove,
};
