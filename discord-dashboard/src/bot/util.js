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

/** Envoie sans jamais lever d'exception ; renvoie le message ou null. */
async function safeSend(channel, payload) {
  if (!channel) return null;
  try {
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

module.exports = { EPHEMERAL, getSendable, deleteLater, safeSend, parseEmoji, formatMinutes, wait };
