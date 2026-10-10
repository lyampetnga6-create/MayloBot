'use strict';
/**
 * Webhooks gérés par le bot + bibliothèque de messages enregistrés (sans limite de nombre).
 *
 * - Un webhook peut être créé par le bot dans un salon, ou importé depuis son URL
 *   (uniquement s'il appartient bien à CE serveur).
 * - Le jeton du webhook est chiffré en base et ne quitte jamais le serveur.
 * - Un message enregistré = { content, embed, username, avatarUrl } réutilisable à volonté.
 */
const { normalizeValue } = require('../../schema');
const { buildMessage, isHttpUrl } = require('../../lib/template');
const { encrypt, decrypt } = require('../../lib/secrets');

const API = 'https://discord.com/api/v10';
const URL_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/([\w-]{20,120})\/?(?:\?.*)?$/;

class WebhookError extends Error {}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/* ------------------------------ Messages ------------------------------ */

/** Nettoie un message enregistré venant du navigateur. */
function normalizeSaved(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const message = normalizeValue({ type: 'message' }, raw.message, {});
  const avatarUrl = clean(raw.avatarUrl, 500);
  return {
    message,
    username: clean(raw.username, 80),
    avatarUrl: isHttpUrl(avatarUrl) ? avatarUrl : '',
  };
}

function rowToSaved(r, full = true) {
  let data = {};
  try { data = JSON.parse(r.data); } catch { /* ligne corrompue */ }
  const out = { id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by };
  if (full) Object.assign(out, { message: data.message, username: data.username || '', avatarUrl: data.avatarUrl || '' });
  else {
    out.preview = (data.message?.content || data.message?.embed?.title || data.message?.embed?.description || '').slice(0, 120);
    out.hasEmbed = Boolean(data.message?.embed?.enabled);
  }
  return out;
}

function listSaved(db, guildId, { search = '', page = 1, pageSize = 24 } = {}) {
  const like = `%${String(search).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = "guild_id = ? AND (name LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\')";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM saved_messages WHERE ${where}`).get(guildId, like, like).n;
  const rows = db.prepare(`SELECT * FROM saved_messages WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(guildId, like, like, pageSize, (Math.max(1, page) - 1) * pageSize);
  return { total, page, pageSize, rows: rows.map((r) => rowToSaved(r, false)) };
}

function getSaved(db, guildId, id) {
  const r = db.prepare('SELECT * FROM saved_messages WHERE id = ? AND guild_id = ?').get(Number(id) || 0, guildId);
  return r ? rowToSaved(r, true) : null;
}

function createSaved(db, guildId, userId, name, input) {
  const now = Date.now();
  const data = normalizeSaved(input);
  const res = db.prepare('INSERT INTO saved_messages (guild_id, name, data, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(guildId, clean(name, 80) || 'Sans titre', JSON.stringify(data), userId, now, now);
  return getSaved(db, guildId, res.lastInsertRowid);
}

function updateSaved(db, guildId, id, name, input) {
  const data = normalizeSaved(input);
  const r = db.prepare('UPDATE saved_messages SET name = ?, data = ?, updated_at = ? WHERE id = ? AND guild_id = ?')
    .run(clean(name, 80) || 'Sans titre', JSON.stringify(data), Date.now(), Number(id) || 0, guildId);
  return r.changes ? getSaved(db, guildId, id) : null;
}

function deleteSaved(db, guildId, id) {
  return db.prepare('DELETE FROM saved_messages WHERE id = ? AND guild_id = ?').run(Number(id) || 0, guildId).changes > 0;
}

function duplicateSaved(db, guildId, userId, id) {
  const src = getSaved(db, guildId, id);
  if (!src) return null;
  return createSaved(db, guildId, userId, `${src.name} (copie)`, src);
}

/* ------------------------------- Webhooks ----------------------------- */

const secretOf = (client) => client.ctx.config.sessionSecret;

function listWebhooks(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  return client.ctx.db.prepare('SELECT id, channel_id, name, created_by, created_at FROM webhooks WHERE guild_id = ? ORDER BY created_at DESC').all(guildId)
    .map((r) => ({
      id: r.id, name: r.name, channelId: r.channel_id, createdBy: r.created_by, createdAt: r.created_at,
      channelName: guild?.channels.cache.get(r.channel_id)?.name || null,
    }));
}

function storeWebhook(client, guildId, userId, wh) {
  client.ctx.db.prepare(`INSERT INTO webhooks (id, guild_id, channel_id, name, token, created_by, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, name = excluded.name, token = excluded.token`)
    .run(wh.id, guildId, wh.channelId, wh.name, encrypt(wh.token, secretOf(client)), userId, Date.now());
}

/** Crée un webhook dans un salon textuel. */
async function createWebhook(client, guild, userId, channelId, name) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || typeof channel.createWebhook !== 'function') throw new WebhookError('Choisis un salon textuel.');
  let wh;
  try {
    wh = await channel.createWebhook({ name: clean(name, 80) || 'Webhook', reason: `Créé depuis le dashboard par ${userId}` });
  } catch (err) {
    throw new WebhookError(`Discord a refusé : ${err.message}. Il faut la permission « Gérer les webhooks » pour le bot.`);
  }
  storeWebhook(client, guild.id, userId, { id: wh.id, token: wh.token, channelId, name: wh.name });
  return { id: wh.id, name: wh.name, channelId };
}

/** Importe un webhook existant à partir de son URL ; il doit appartenir à ce serveur. */
async function importWebhook(client, guild, userId, url) {
  const m = URL_RE.exec(String(url || '').trim());
  if (!m) throw new WebhookError('URL de webhook invalide.');
  const [, id, token] = m;
  const res = await (client.ctx.fetchImpl || fetch)(`${API}/webhooks/${id}/${token}`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res || !res.ok) throw new WebhookError('Ce webhook est introuvable ou a été supprimé.');
  const info = await res.json().catch(() => ({}));
  if (info.guild_id !== guild.id) throw new WebhookError('Ce webhook n’appartient pas à ce serveur.');
  storeWebhook(client, guild.id, userId, { id, token, channelId: info.channel_id, name: info.name || 'Webhook' });
  return { id, name: info.name || 'Webhook', channelId: info.channel_id };
}

async function deleteWebhook(client, guildId, id) {
  const row = client.ctx.db.prepare('SELECT * FROM webhooks WHERE id = ? AND guild_id = ?').get(String(id), guildId);
  if (!row) return false;
  const token = decrypt(row.token, secretOf(client));
  if (token) {
    await (client.ctx.fetchImpl || fetch)(`${API}/webhooks/${row.id}/${token}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => null);
  }
  client.ctx.db.prepare('DELETE FROM webhooks WHERE id = ?').run(row.id);
  return true;
}

/**
 * Envoie un message via un webhook enregistré.
 * @param {object} what  { saved?: id, message?: valeur de champ message, username?, avatarUrl? }
 */
async function sendViaWebhook(client, guild, webhookId, what) {
  const { db, settings } = client.ctx;
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND guild_id = ?').get(String(webhookId), guild.id);
  if (!row) throw new WebhookError('Webhook introuvable.');
  const token = decrypt(row.token, secretOf(client));
  if (!token) throw new WebhookError('Jeton du webhook illisible : réimporte ce webhook.');

  let data;
  if (what.saved) {
    data = getSaved(db, guild.id, what.saved);
    if (!data) throw new WebhookError('Message enregistré introuvable.');
  } else {
    data = normalizeSaved({ message: what.message, username: what.username, avatarUrl: what.avatarUrl });
  }
  const vars = { server: guild.name, 'server.icon': guild.iconURL?.() || '', memberCount: String(guild.memberCount) };
  const payload = buildMessage(data.message, vars, settings.get(guild.id).general);
  if (!payload) throw new WebhookError('Le message est vide.');

  const body = {
    content: payload.content,
    embeds: payload.embeds?.map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e)),
    username: clean(what.username || data.username, 80) || undefined,
    avatar_url: (isHttpUrl(what.avatarUrl) ? what.avatarUrl : data.avatarUrl) || undefined,
    allowed_mentions: { parse: [] },
  };
  // Discord interdit « clyde »/« discord » dans le nom d'un webhook.
  if (body.username && /clyde|discord/i.test(body.username)) body.username = body.username.replace(/clyde|discord/gi, '•••');

  const res = await (client.ctx.fetchImpl || fetch)(`${API}/webhooks/${row.id}/${token}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res) throw new WebhookError('Discord ne répond pas.');
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) {
      db.prepare('DELETE FROM webhooks WHERE id = ?').run(row.id);
      throw new WebhookError('Ce webhook n’existe plus sur Discord : je l’ai retiré de la liste.');
    }
    throw new WebhookError(`Discord a refusé le message : ${j.message || res.status}`);
  }
  const sent = await res.json().catch(() => ({}));
  return { messageId: sent.id || null, channelId: row.channel_id };
}

module.exports = {
  WebhookError, URL_RE, normalizeSaved,
  listSaved, getSaved, createSaved, updateSaved, deleteSaved, duplicateSaved,
  listWebhooks, createWebhook, importWebhook, deleteWebhook, sendViaWebhook,
};
