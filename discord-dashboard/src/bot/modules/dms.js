'use strict';
/**
 * Messagerie privée : les MP reçus par le bot apparaissent dans le dashboard, et le staff répond depuis la page.
 *
 * - Un message reçu est copié dans chaque serveur où le membre est présent ET où le module est activé :
 *   chaque serveur ne voit donc que « ses » conversations.
 * - Le bot prévient le membre (message automatique) que l'équipe lit ses messages.
 * - Seuls les messages écrits au bot et les réponses envoyées depuis le dashboard sont conservés.
 */
const { brandedEmbed } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const NOTICE_EVERY_MS = 12 * 3600 * 1000;
const NOTIFY_EVERY_MS = 10 * 60 * 1000;
const MEMBER_TTL_MS = 10 * 60 * 1000;
const MAX_CONTENT = 2000;
const MAX_ATTACHMENTS = 10;
const SPAM_LIMIT = 20; // messages par minute et par membre

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'dms');

class DmError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* ------------------------------------------------------------------ */
/* Présence du membre sur un serveur (mise en cache)                    */
/* ------------------------------------------------------------------ */
const memberCache = new Map();
async function isMember(guild, userId) {
  const key = `${guild.id}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && Date.now() - hit.at < MEMBER_TTL_MS) return hit.ok;
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  const ok = Boolean(member);
  memberCache.set(key, { ok, at: Date.now() });
  if (memberCache.size > 5000) memberCache.clear();
  return ok;
}

const licensed = (client, guild) => client.ctx.license?.status?.(guild.id, guild.ownerId)?.allowed !== false;

/** Serveurs dont le staff doit voir ce membre : module activé, licence valide, membre présent. */
async function visibleGuilds(client, userId) {
  const out = [];
  for (const guild of client.guilds.cache.values()) {
    if (!cfgOf(client, guild.id).enabled || !licensed(client, guild)) continue;
    if (await isMember(guild, userId)) out.push(guild);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                       */
/* ------------------------------------------------------------------ */
const preview = (content, attachments) => (content || (attachments.length ? '[Pièce jointe]' : '')).replace(/\s+/g, ' ').slice(0, 140);

/** Ajoute un message à un fil (le crée si besoin). Renvoie { inserted, id } ; `inserted` est faux pour un doublon. */
function record(client, { guildId, userId, direction, content, attachments = [], authorId = null, discordId, at = Date.now() }) {
  const d = db(client);
  const run = d.transaction?.bind(d) || ((fn) => fn);
  return run(() => {
    d.prepare('INSERT OR IGNORE INTO dm_threads (guild_id, user_id, last_at, last_dir, preview, created_at) VALUES (?,?,?,?,?,?)')
      .run(guildId, userId, at, direction, '', at);
    const r = d.prepare('INSERT OR IGNORE INTO dm_messages (guild_id, user_id, direction, content, attachments, author_id, discord_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(guildId, userId, direction, content, JSON.stringify(attachments), authorId, String(discordId), at);
    if (!r.changes) return { inserted: false, id: 0 };
    const id = Number(r.lastInsertRowid);
    d.prepare('UPDATE dm_threads SET last_at = ?, last_dir = ?, preview = ? WHERE guild_id = ? AND user_id = ?')
      .run(at, direction, preview(content, attachments), guildId, userId);
    return { inserted: true, id };
  })();
}

const threadRow = (client, guildId, userId) => db(client).prepare('SELECT * FROM dm_threads WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

const spam = new Map();
function tooFast(userId) {
  const now = Date.now();
  const list = (spam.get(userId) || []).filter((t) => now - t < 60000);
  list.push(now);
  spam.set(userId, list);
  if (spam.size > 5000) spam.clear();
  return list.length > SPAM_LIMIT;
}

/* ------------------------------------------------------------------ */
/* Réception                                                            */
/* ------------------------------------------------------------------ */
function attachmentsOf(message) {
  return [...(message.attachments?.values?.() || [])].slice(0, MAX_ATTACHMENTS)
    .map((a) => ({ name: String(a.name || 'fichier').slice(0, 100), url: String(a.url || ''), type: String(a.contentType || ''), size: Number(a.size) || 0 }))
    .filter((a) => /^https:\/\//.test(a.url));
}

/** Un MP reçu par le bot. */
async function onDirectMessage(client, message) {
  if (message.author.bot || message.system) return;
  const content = String(message.content || '').trim().slice(0, 4000);
  const attachments = attachmentsOf(message);
  if (!content && !attachments.length) return;
  if (tooFast(message.author.id)) return;

  const guilds = await visibleGuilds(client, message.author.id);
  if (!guilds.length) return;

  const at = message.createdTimestamp || Date.now();
  const fresh = [];
  for (const guild of guilds) {
    const r = record(client, { guildId: guild.id, userId: message.author.id, direction: 'in', content, attachments, discordId: message.id, at });
    if (r.inserted) fresh.push(guild);
  }
  if (!fresh.length) return;

  await sendNotice(client, message, fresh);
  for (const guild of fresh) await notifyStaff(client, guild, message.author, content, attachments);
}

/** Message automatique « ton message a été transmis » (au plus un toutes les 12 h par membre). */
async function sendNotice(client, message, guilds) {
  const due = guilds.filter((g) => {
    const cfg = cfgOf(client, g.id);
    const t = threadRow(client, g.id, message.author.id);
    return cfg.notice && cfg.noticeText && Date.now() - (t?.last_notice_at || 0) >= NOTICE_EVERY_MS;
  });
  if (!due.length) return;
  const names = due.map((g) => g.name).join(' et ');
  const text = cfgOf(client, due[0].id).noticeText.replaceAll('{server}', names).slice(0, MAX_CONTENT);
  const sent = await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  for (const g of due) {
    db(client).prepare('UPDATE dm_threads SET last_notice_at = ? WHERE guild_id = ? AND user_id = ?').run(Date.now(), g.id, message.author.id);
    if (sent) record(client, { guildId: g.id, userId: message.author.id, direction: 'out', content: text, authorId: null, discordId: sent.id });
  }
}

/** Alerte dans un salon du serveur (au plus une toutes les 10 minutes par membre). */
async function notifyStaff(client, guild, user, content, attachments) {
  const cfg = cfgOf(client, guild.id);
  if (!cfg.notifyChannelId) return;
  const t = threadRow(client, guild.id, user.id);
  if (Date.now() - (t?.last_notify_at || 0) < NOTIFY_EVERY_MS) return;
  db(client).prepare('UPDATE dm_threads SET last_notify_at = ? WHERE guild_id = ? AND user_id = ?').run(Date.now(), guild.id, user.id);
  const general = client.ctx.settings.module(guild.id, 'general');
  const embed = brandedEmbed(general)
    .setTitle('Nouveau message privé')
    .setDescription(`**${(user.globalName || user.username).slice(0, 80)}**\n${preview(content, attachments).slice(0, 300)}\n\nRéponds depuis le dashboard : ${client.ctx.config.baseUrl}/dashboard#/g/${guild.id}/inbox`);
  await safeSend(getSendable(guild, cfg.notifyChannelId), { embeds: [embed], allowedMentions: { parse: [] } });
}

/* ------------------------------------------------------------------ */
/* Lecture (dashboard)                                                  */
/* ------------------------------------------------------------------ */
function listThreads(client, guildId, limit = 200) {
  return db(client).prepare(
    `SELECT t.user_id AS userId, t.last_at AS lastAt, t.last_dir AS lastDir, t.preview,
            (SELECT COUNT(*) FROM dm_messages m WHERE m.guild_id = t.guild_id AND m.user_id = t.user_id AND m.direction = 'in' AND m.id > t.last_read_id) AS unread
       FROM dm_threads t WHERE t.guild_id = ? ORDER BY t.last_at DESC LIMIT ?`,
  ).all(guildId, limit);
}

function unreadTotal(client, guildId) {
  return db(client).prepare(
    `SELECT COUNT(*) AS n FROM dm_messages m JOIN dm_threads t ON t.guild_id = m.guild_id AND t.user_id = m.user_id
      WHERE m.guild_id = ? AND m.direction = 'in' AND m.id > t.last_read_id`,
  ).get(guildId).n;
}

const publicMessage = (r) => {
  let attachments = [];
  try { attachments = JSON.parse(r.attachments || '[]'); } catch { /* ligne abîmée */ }
  return { id: r.id, direction: r.direction, content: r.content, attachments, authorId: r.author_id || null, createdAt: r.created_at };
};

/** Messages d'un fil : les derniers (par défaut), ceux d'avant `before`, ou les nouveaux depuis `after`. */
function getMessages(client, guildId, userId, { after = 0, before = 0, limit = 50 } = {}) {
  const d = db(client);
  const n = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100);
  let rows;
  if (after > 0) rows = d.prepare('SELECT * FROM dm_messages WHERE guild_id = ? AND user_id = ? AND id > ? ORDER BY id ASC LIMIT 200').all(guildId, userId, after);
  else if (before > 0) rows = d.prepare('SELECT * FROM dm_messages WHERE guild_id = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(guildId, userId, before, n).reverse();
  else rows = d.prepare('SELECT * FROM dm_messages WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(guildId, userId, n).reverse();
  return rows.map(publicMessage);
}

function markRead(client, guildId, userId) {
  db(client).prepare(
    'UPDATE dm_threads SET last_read_id = COALESCE((SELECT MAX(id) FROM dm_messages WHERE guild_id = ? AND user_id = ?), 0) WHERE guild_id = ? AND user_id = ?',
  ).run(guildId, userId, guildId, userId);
}

function deleteThread(client, guildId, userId) {
  const d = db(client);
  d.prepare('DELETE FROM dm_messages WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  d.prepare('DELETE FROM dm_threads WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

/* ------------------------------------------------------------------ */
/* Envoi depuis le dashboard                                            */
/* ------------------------------------------------------------------ */
async function sendFromDashboard(client, guild, staffId, userId, rawContent) {
  const cfg = cfgOf(client, guild.id);
  if (!cfg.enabled) throw new DmError('La messagerie est désactivée : active le module « Messagerie privée ».');
  const content = String(rawContent ?? '').trim();
  if (!content) throw new DmError('Écris un message.');
  if (content.length > MAX_CONTENT) throw new DmError(`Message trop long (${MAX_CONTENT} caractères maximum).`);

  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new DmError('Ce membre n’est pas (ou plus) sur ce serveur.');
  if (member.user.bot) throw new DmError('Impossible d’écrire à un bot.');

  let sent;
  try {
    sent = await member.user.send({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    if (err?.code === 50007) throw new DmError('Ce membre n’accepte pas les messages privés (paramètres de confidentialité du serveur ou du compte).');
    throw new DmError(`Discord a refusé l’envoi : ${err.message}`);
  }
  const r = record(client, { guildId: guild.id, userId, direction: 'out', content, authorId: staffId, discordId: sent.id });
  markRead(client, guild.id, userId);
  return { id: r.id, message: getMessages(client, guild.id, userId, { after: Math.max(0, r.id - 1), limit: 1 })[0] || null };
}

/** Recherche de membres du serveur pour démarrer une conversation. */
async function searchMembers(guild, query) {
  const q = String(query || '').trim().slice(0, 32);
  if (q.length < 2) return [];
  const found = await guild.members.search({ query: q, limit: 8 }).catch(() => null);
  return [...(found?.values?.() || [])].filter((m) => !m.user.bot).map((m) => ({
    id: m.id, name: m.displayName || m.user.globalName || m.user.username, username: m.user.username,
    avatar: m.displayAvatarURL({ size: 64, extension: 'png' }),
  }));
}

/* ------------------------------------------------------------------ */
/* Nettoyage                                                            */
/* ------------------------------------------------------------------ */
let lastCleanup = 0;
async function tick(client) {
  if (Date.now() - lastCleanup < 6 * 3600 * 1000) return;
  lastCleanup = Date.now();
  const d = db(client);
  for (const guild of client.guilds.cache.values()) {
    const days = cfgOf(client, guild.id).retentionDays;
    if (!days) continue;
    d.prepare('DELETE FROM dm_messages WHERE guild_id = ? AND created_at < ?').run(guild.id, Date.now() - days * 86400000);
    d.prepare('DELETE FROM dm_threads WHERE guild_id = ? AND NOT EXISTS (SELECT 1 FROM dm_messages m WHERE m.guild_id = dm_threads.guild_id AND m.user_id = dm_threads.user_id)').run(guild.id);
  }
}

module.exports = {
  DmError, onDirectMessage, record, listThreads, unreadTotal, getMessages, markRead, deleteThread,
  sendFromDashboard, searchMembers, visibleGuilds, tick,
};
