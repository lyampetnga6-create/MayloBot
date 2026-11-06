'use strict';

/** XP nécessaire pour passer du niveau n au niveau n+1 (formule type MEE6). */
const xpToNext = (n) => 5 * n * n + 50 * n + 100;

/** XP total cumulé nécessaire pour ATTEINDRE le niveau L. */
function totalXpForLevel(L) {
  if (L <= 0) return 0;
  // Σ_{i=0}^{L-1} (5i² + 50i + 100)
  return (5 * (L - 1) * L * (2 * L - 1)) / 6 + (50 * L * (L - 1)) / 2 + 100 * L;
}

function levelFromXp(xp) {
  let level = 0;
  let remaining = Math.max(0, xp);
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level++;
    if (level > 1000) break;
  }
  return level;
}

/** { level, current, needed, ratio } pour une barre de progression. */
function progress(xp) {
  const level = levelFromXp(xp);
  const current = xp - totalXpForLevel(level);
  const needed = xpToNext(level);
  return { level, current, needed, ratio: needed ? current / needed : 0 };
}

function bar(ratio, size = 14) {
  const filled = Math.max(0, Math.min(size, Math.round(ratio * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

module.exports = { xpToNext, totalXpForLevel, levelFromXp, progress, bar };
