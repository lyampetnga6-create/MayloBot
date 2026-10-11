'use strict';
/** Durées lisibles : « 90m », « 1h30 », « 2j », « 1w »… */
const UNITS = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, j: 86400000, d: 86400000, w: 604800000, sem: 604800000 };

/** « 1h30m » → millisecondes, ou null si le texte n'est pas une durée. */
function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  if (/^\d+$/.test(text)) return null; // un nombre seul est ambigu : on exige une unité
  const re = /(\d+)(sem|min|sec|s|m|h|j|d|w)/g;
  let total = 0;
  let consumed = 0;
  for (const m of text.matchAll(re)) {
    total += Number(m[1]) * UNITS[m[2]];
    consumed += m[0].length;
  }
  if (!total || consumed !== text.length) return null;
  return total;
}

/** Millisecondes → « 1 j 2 h 3 min ». */
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return [d && `${d} j`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ');
}

module.exports = { parseDuration, formatDuration };
