'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { xpToNext, totalXpForLevel, levelFromXp, progress, bar } = require('../src/lib/levels');

test('formule de niveau cohérente dans les deux sens', () => {
  assert.equal(totalXpForLevel(0), 0);
  assert.equal(totalXpForLevel(1), 100);
  assert.equal(totalXpForLevel(2), 100 + 155);
  for (let l = 0; l <= 60; l++) {
    const t = totalXpForLevel(l);
    assert.equal(levelFromXp(t), l, `niveau ${l} à ${t} XP`);
    if (t > 0) assert.equal(levelFromXp(t - 1), l - 1);
  }
});

test('totalXpForLevel = somme des paliers', () => {
  let sum = 0;
  for (let l = 0; l < 40; l++) {
    assert.equal(totalXpForLevel(l), sum);
    sum += xpToNext(l);
  }
});

test('progression et barre', () => {
  const p = progress(totalXpForLevel(3) + 50);
  assert.equal(p.level, 3);
  assert.equal(p.current, 50);
  assert.equal(p.needed, xpToNext(3));
  assert.equal(bar(0.5, 10), '█████░░░░░');
  assert.equal(bar(2, 4), '████');
  assert.equal(bar(-1, 4), '░░░░');
});
