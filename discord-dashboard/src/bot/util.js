'use strict';
const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const EPHEMERAL = MessageFlags.Ephemeral;

/** Renvoie le salon textuel si le bot peut y écrire, sinon null. */
function getSendable(guild, channelId) {
  if (!channelId) return null;
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased() || ch.isDMBased()) return null;
  const me = guild.members.me;
  if (me) {
    const perms = ch.permissionsFor(me);
    if (!perms || !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;
  }
  return ch;
}

/** Supprime un message après `seconds` secondes, en silence. */
function deleteLater(message, seconds) {
  if (!message || !seconds) return;
  setTimeout(() => message.delete().catch(() => {}), seconds * 1000).unref?.();
}

/**
 * Remplace `:nom:` par l'émoji du serveur du même nom (`<:nom:id>`) dans un message.
 * Discord ne le fait que pour les messages tapés à la main ; un bot (embed, webhook, annonce) doit écrire la forme complète.
 * Modifie le message en place (texte, titres, descriptions et champs des embeds) et le renvoie.
 */
function expandEmojis(guild, payload) {
  const list = [...(guild?.emojis?.cache?.values?.() || [])];
  if (!list.length || !payload) return payload;
  const exact = new Map(); const lower = new Map();
  for (const e of list) {
    const code = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
    exact.set(e.name, code);
    if (!lower.has(String(e.name).toLowerCase())) lower.set(String(e.name).toLowerCase(), code);
  }
  const fix = (text) => (typeof text === 'string' && text.includes(':')
    ? text.replace(/:(\w{2,32}):(?!\d)/g, (m, name) => exact.get(name) || lower.get(name.toLowerCase()) || m)
    : text);
  if (typeof payload.content === 'string') payload.content = fix(payload.content);
  for (const e of payload.embeds || []) {
    const d = typeof e.toJSON === 'function' && e.data ? e.data : e;
    if (d.title) d.title = fix(d.title);
    if (d.description) d.description = fix(d.description);
    for (const f of d.fields || []) { f.name = fix(f.name); f.value = fix(f.value); }
  }
  return payload;
}

/** Envoie sans jamais lever d'exception ; renvoie le message ou null. */
async function safeSend(channel, payload) {
  if (!channel) return null;
  try {
    if (channel.guild) expandEmojis(channel.guild, payload);
    return await channel.send(payload);
  } catch (err) {
    if (process.env.DEBUG) console.warn('[safeSend]', err.message);
    return null;
  }
}

/** Convertit un texte d'émoji (unicode ou <:nom:id>) en objet accepté par les composants, ou null. */
function parseEmoji(text) {
  if (!text || typeof text !== 'string') return null;
  const custom = text.trim().match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
  const trimmed = text.trim();
  return trimmed ? { name: trimmed } : null;
}

/** Durée lisible : 90 → « 1 h 30 min » */
function formatMinutes(min) {
  if (!min) return '—';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} j`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { EPHEMERAL, getSendable, deleteLater, safeSend, expandEmojis, parseEmoji, formatMinutes, wait };
