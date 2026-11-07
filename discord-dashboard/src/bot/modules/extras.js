'use strict';
/** Fonctions transverses : rappels, bans temporaires, AFK, « snipe », sauvegarde/restauration des rôles. */
const { safeSend, getSendable } = require('../util');
const { safeText, trunc } = require('../../lib/template');

const db = (client) => client.ctx.db;

/* ------------------------------- Rappels ------------------------------- */

const MAX_REMINDERS = 25;

function addReminder(client, { userId, guildId, channelId, text, dueAt }) {
  const n = db(client).prepare("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND kind = 'user'").get(userId).n;
  if (n >= MAX_REMINDERS) return null;
  return db(client).prepare('INSERT INTO reminders (user_id, guild_id, channel_id, text, due_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, guildId, channelId, text.slice(0, 500), dueAt, Date.now()).lastInsertRowid;
}

const listReminders = (client, userId) => db(client).prepare("SELECT * FROM reminders WHERE user_id = ? AND kind = 'user' ORDER BY due_at").all(userId);
const deleteReminder = (client, userId, id) => db(client).prepare("DELETE FROM reminders WHERE id = ? AND user_id = ? AND kind = 'user'").run(id, userId).changes > 0;

async function tickReminders(client) {
  const due = db(client).prepare('SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at LIMIT 50').all(Date.now());
  for (const r of due) {
    db(client).prepare('DELETE FROM reminders WHERE id = ?').run(r.id);
    const content = `⏰ <@${r.user_id}> rappel : ${safeText(r.text)}`;
    const guild = r.guild_id ? client.guilds.cache.get(r.guild_id) : null;
    const channel = guild ? getSendable(guild, r.channel_id) : null;
    const sent = channel ? await safeSend(channel, { content, allowedMentions: { users: [r.user_id] } }) : null;
    if (!sent) {
      const user = await client.users.fetch(r.user_id).catch(() => null);
      await user?.send(`⏰ Rappel : ${safeText(r.text)}`).catch(() => {});
    }
  }
}

/* ------------------------------ Bans temporaires ------------------------ */

function scheduleUnban(client, guildId, userId, unbanAt) {
  db(client).prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  db(client).prepare('INSERT INTO temp_bans (guild_id, user_id, unban_at) VALUES (?,?,?)').run(guildId, userId, unbanAt);
}

async function tickTempBans(client) {
  const due = db(client).prepare('SELECT * FROM temp_bans WHERE unban_at <= ?').all(Date.now());
  for (const b of due) {
    const guild = client.guilds.cache.get(b.guild_id);
    if (!guild) continue; // le bot est revenu plus tard : on réessaiera
    await guild.members.unban(b.user_id, 'Fin du bannissement temporaire').catch(() => {});
    db(client).prepare('DELETE FROM temp_bans WHERE id = ?').run(b.id);
  }
}

/* ---------------------------------- AFK -------------------------------- */

const setAfk = (client, gid, uid, reason) => db(client).prepare('INSERT INTO afk (guild_id, user_id, reason, since) VALUES (?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since')
  .run(gid, uid, reason.slice(0, 200), Date.now());

/** Retire l'AFK de l'auteur et signale les membres AFK mentionnés. */
async function onAfkMessage(client, message) {
  const { guild, author } = message;
  const mine = db(client).prepare('SELECT * FROM afk WHERE guild_id = ? AND user_id = ?').get(guild.id, author.id);
  if (mine && Date.now() - mine.since > 10000) {
    db(client).prepare('DELETE FROM afk WHERE guild_id = ? AND user_id = ?').run(guild.id, author.id);
    const m = await safeSend(message.channel, { content: `👋 Bon retour <@${author.id}> ! Ton statut AFK a été retiré.`, allowedMentions: { users: [author.id] } });
    if (m) setTimeout(() => m.delete().catch(() => {}), 8000).unref?.();
  }
  const ids = [...message.mentions.users.keys()].filter((id) => id !== author.id).slice(0, 5);
  if (!ids.length) return;
  const rows = db(client).prepare(`SELECT * FROM afk WHERE guild_id = ? AND user_id IN (${ids.map(() => '?').join(',')})`).all(guild.id, ...ids);
  if (!rows.length) return;
  await safeSend(message.channel, {
    content: rows.map((r) => `💤 <@${r.user_id}> est AFK depuis <t:${Math.floor(r.since / 1000)}:R>${r.reason ? ` : ${safeText(r.reason)}` : ''}`).join('\n'),
    allowedMentions: { parse: [] },
  });
}

/* --------------------------------- Snipe ------------------------------- */

const sniped = new Map(); // channelId -> { deleted, edited }
function recordDeleted(message) {
  if (!message.guild || message.author?.bot || message.partial) return;
  const slot = sniped.get(message.channelId) || {};
  slot.deleted = { content: trunc(message.content || '', 1500), author: message.author?.id, name: message.member?.displayName || message.author?.username, at: Date.now(), image: message.attachments.first()?.url || null };
  sniped.set(message.channelId, slot);
  if (sniped.size > 500) sniped.delete(sniped.keys().next().value);
}
function recordEdited(before, after) {
  if (!before.guild || before.author?.bot || before.partial || before.content === after.content) return;
  const slot = sniped.get(before.channelId) || {};
  slot.edited = { content: trunc(before.content || '', 1500), author: before.author?.id, name: before.member?.displayName || before.author?.username, at: Date.now() };
  sniped.set(before.channelId, slot);
}
const getSniped = (channelId) => sniped.get(channelId) || {};

/* -------------------------- Sauvegarde des rôles ------------------------ */

/** À appeler quand un membre part : mémorise ses rôles pour les lui rendre s'il revient. */
function saveRoles(client, member) {
  const cfg = client.ctx.settings.module(member.guild.id, 'autorole');
  if (!cfg.restoreRoles) return;
  const ids = member.roles?.cache.filter((r) => r.id !== member.guild.id && !r.managed && !cfg.restoreExclude.includes(r.id)).map((r) => r.id) || [];
  if (!ids.length) return;
  db(client).prepare('INSERT INTO member_roles (guild_id, user_id, roles) VALUES (?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET roles = excluded.roles')
    .run(member.guild.id, member.id, JSON.stringify(ids));
}

/** À l'arrivée : rend les rôles mémorisés (uniquement ceux que le bot peut gérer). */
async function restoreRoles(client, member) {
  const cfg = client.ctx.settings.module(member.guild.id, 'autorole');
  if (!cfg.restoreRoles) return 0;
  const row = db(client).prepare('SELECT roles FROM member_roles WHERE guild_id = ? AND user_id = ?').get(member.guild.id, member.id);
  if (!row) return 0;
  db(client).prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?').run(member.guild.id, member.id);
  const me = member.guild.members.me;
  let ids = [];
  try { ids = JSON.parse(row.roles); } catch { return 0; }
  const ok = ids.filter((id) => {
    const r = member.guild.roles.cache.get(id);
    return r && !r.managed && me && r.position < me.roles.highest.position && !cfg.restoreExclude.includes(id);
  });
  if (ok.length) await member.roles.add(ok, 'Rôles restaurés au retour').catch(() => {});
  return ok.length;
}

module.exports = {
  addReminder, listReminders, deleteReminder, tickReminders, scheduleUnban, tickTempBans, setAfk, onAfkMessage,
  recordDeleted, recordEdited, getSniped, saveRoles, restoreRoles, MAX_REMINDERS,
};
