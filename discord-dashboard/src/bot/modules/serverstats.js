'use strict';
/**
 * Statistiques du serveur : arrivées, départs et messages par jour (et par salon).
 * Les compteurs restent en mémoire et sont écrits toutes les 30 secondes. Aucun contenu de message n'est conservé.
 */
const RETENTION_DAYS = 400;

/** guildId → { day → { joins, leaves, messages, channels: Map } } */
const buffer = new Map();

const dayOf = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'serverstats');

function bucket(guildId, day = dayOf()) {
  let g = buffer.get(guildId);
  if (!g) buffer.set(guildId, (g = new Map()));
  let b = g.get(day);
  if (!b) g.set(day, (b = { joins: 0, leaves: 0, messages: 0, channels: new Map() }));
  return b;
}

function onMessage(client, message) {
  if (!message.guild || message.author?.bot || message.system) return;
  const cfg = cfgOf(client, message.guild.id);
  if (!cfg.enabled) return;
  const parent = message.channel?.parentId;
  if (cfg.ignoredChannels.includes(message.channelId) || (parent && cfg.ignoredChannels.includes(parent))) return;
  const b = bucket(message.guild.id);
  b.messages += 1;
  b.channels.set(message.channelId, (b.channels.get(message.channelId) || 0) + 1);
}

function onMemberAdd(client, member) {
  if (member.user?.bot || !cfgOf(client, member.guild.id).enabled) return;
  bucket(member.guild.id).joins += 1;
}

function onMemberRemove(client, member) {
  if (member.user?.bot || !cfgOf(client, member.guild.id).enabled) return;
  bucket(member.guild.id).leaves += 1;
}

/** Écrit les compteurs en base (appelé par le scheduler, et à la demande avant une lecture). */
function flush(client) {
  const db = client.ctx.db;
  const day = db.prepare('INSERT INTO daily_stats (guild_id, day, joins, leaves, messages) VALUES (?,?,?,?,?) ON CONFLICT(guild_id, day) DO UPDATE SET joins = joins + excluded.joins, leaves = leaves + excluded.leaves, messages = messages + excluded.messages');
  const chan = db.prepare('INSERT INTO channel_stats (guild_id, day, channel_id, messages) VALUES (?,?,?,?) ON CONFLICT(guild_id, day, channel_id) DO UPDATE SET messages = messages + excluded.messages');
  for (const [guildId, days] of buffer) {
    for (const [d, b] of days) {
      if (b.joins || b.leaves || b.messages) day.run(guildId, d, b.joins, b.leaves, b.messages);
      for (const [channelId, n] of b.channels) chan.run(guildId, d, channelId, n);
    }
  }
  buffer.clear();
}

let lastCleanup = 0;
async function tick(client) {
  flush(client);
  if (Date.now() - lastCleanup < 6 * 3600 * 1000) return;
  lastCleanup = Date.now();
  const limit = dayOf(Date.now() - RETENTION_DAYS * 86400000);
  client.ctx.db.prepare('DELETE FROM daily_stats WHERE day < ?').run(limit);
  client.ctx.db.prepare('DELETE FROM channel_stats WHERE day < ?').run(limit);
}

/** Série continue sur N jours (les jours sans activité valent 0) + totaux + salons les plus actifs. */
function report(client, guildId, days = 30) {
  flush(client);
  const n = Math.min(Math.max(Math.floor(Number(days)) || 30, 1), 365);
  const from = dayOf(Date.now() - (n - 1) * 86400000);
  const rows = new Map(client.ctx.db.prepare('SELECT day, joins, leaves, messages FROM daily_stats WHERE guild_id = ? AND day >= ?').all(guildId, from).map((r) => [r.day, r]));
  const series = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = dayOf(Date.now() - i * 86400000);
    const r = rows.get(day);
    series.push({ day, joins: r?.joins || 0, leaves: r?.leaves || 0, messages: r?.messages || 0 });
  }
  const sum = (k) => series.reduce((a, r) => a + r[k], 0);
  const channels = client.ctx.db.prepare(
    'SELECT channel_id AS channelId, SUM(messages) AS messages FROM channel_stats WHERE guild_id = ? AND day >= ? GROUP BY channel_id ORDER BY messages DESC LIMIT 10',
  ).all(guildId, from);
  return {
    days: n, series, channels,
    totals: { joins: sum('joins'), leaves: sum('leaves'), messages: sum('messages'), net: sum('joins') - sum('leaves') },
  };
}

module.exports = { dayOf, onMessage, onMemberAdd, onMemberRemove, flush, tick, report };
