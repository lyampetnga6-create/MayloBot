'use strict';
const { ActivityType } = require('discord.js');

const TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const DEFAULT = { status: 'online', type: 'watching', text: '{servers} serveurs' };

function normalize(input = {}) {
  return {
    status: STATUSES.includes(input.status) ? input.status : DEFAULT.status,
    type: Object.prototype.hasOwnProperty.call(TYPES, input.type) ? input.type : DEFAULT.type,
    text: typeof input.text === 'string' ? input.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 128) : DEFAULT.text,
  };
}

function getPresence(db) {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'presence'").get();
  if (!row) return { ...DEFAULT };
  try { return normalize(JSON.parse(row.value)); } catch { return { ...DEFAULT }; }
}

function savePresence(db, input) {
  const value = normalize(input);
  db.prepare("INSERT INTO kv (key, value) VALUES ('presence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(value));
  return value;
}

/** Applique la présence enregistrée ({servers} et {members} sont remplacés). */
function applyPresence(client) {
  if (!client.user) return;
  const p = getPresence(client.ctx.db);
  const members = client.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
  const text = p.text.replace(/\{servers\}/g, String(client.guilds.cache.size)).replace(/\{members\}/g, String(members));

  const activities = [];
  if (text) {
    activities.push(p.type === 'custom'
      ? { name: 'custom', type: ActivityType.Custom, state: text }
      : { name: text, type: TYPES[p.type] });
  }
  client.user.setPresence({ status: p.status, activities });
}

module.exports = { getPresence, savePresence, applyPresence, STATUSES, TYPES: Object.keys(TYPES) };
