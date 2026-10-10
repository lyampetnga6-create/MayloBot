'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULES, normalizeModule } = require('../src/schema');
const { inspect, isSpam, _recent } = require('../src/bot/modules/automod');

const automod = MODULES.find((m) => m.id === 'automod');
const cfg = (patch = {}) => {
  const base = normalizeModule(automod, { enabled: true });
  for (const [k, v] of Object.entries(patch)) base[k] = { ...base[k], ...v };
  return base;
};

test('invitations : bloquées sauf celles du serveur', async () => {
  const c = cfg();
  assert.equal((await inspect('rejoins discord.gg/abcdef', 0, c))?.rule, 'invites');
  assert.equal(await inspect('rejoins discord.gg/abcdef', 0, c, { isOwnInvite: async () => true }), null);
  assert.equal(await inspect('une phrase normale', 0, c), null);
  assert.equal(await inspect('discord.gg/abcdef', 0, cfg({ invites: { enabled: false } })), null);
});

test('liens : domaines autorisés et sous-domaines', async () => {
  const c = cfg({ links: { enabled: true, allowedDomains: ['youtube.com'] } });
  assert.equal(await inspect('regarde https://youtube.com/watch?v=1', 0, c), null);
  assert.equal(await inspect('regarde https://music.youtube.com/x', 0, c), null);
  assert.equal((await inspect('clique https://evil.example/x', 0, c))?.rule, 'links');
  assert.equal((await inspect('clique www.evil.example', 0, c))?.rule, 'links');
  assert.equal((await inspect('https://notyoutube.com', 0, c))?.rule, 'links', 'pas de faux positif sur le suffixe');
});

test('majuscules : seuil et longueur minimale', async () => {
  const c = cfg({ caps: { enabled: true, minLength: 10, percent: 70 } });
  assert.equal((await inspect('ARRÊTEZ DE CRIER ICI SVP', 0, c))?.rule, 'caps');
  assert.equal(await inspect('OK BIEN', 0, c), null, 'trop court');
  assert.equal(await inspect('Un message Normal avec quelques Majuscules', 0, c), null);
});

test('mentions de masse', async () => {
  const c = cfg();
  assert.equal((await inspect('salut', 9, c))?.rule, 'mentions');
  assert.equal(await inspect('salut', 3, c), null);
});

test('mots interdits : mot entier, insensible à la casse, caractères spéciaux échappés', async () => {
  const c = cfg({ words: { enabled: true, list: ['merde', 'c++'] } });
  assert.equal((await inspect('Oh MERDE alors', 0, c))?.rule, 'words');
  assert.equal(await inspect('une emmerdeuse', 0, c), null, 'ne bloque pas à l’intérieur d’un autre mot');
  assert.equal((await inspect('je code en c++ !', 0, c))?.rule, 'words');
});

test('anti-spam : dépassement dans la fenêtre', () => {
  _recent.clear();
  const c = cfg({ spam: { enabled: true, messages: 3, seconds: 5 } });
  const t0 = 1_000_000;
  assert.equal(isSpam('g:u', c, t0), false);
  assert.equal(isSpam('g:u', c, t0 + 100), false);
  assert.equal(isSpam('g:u', c, t0 + 200), false);
  assert.equal(isSpam('g:u', c, t0 + 300), true);
  assert.equal(isSpam('g:u', c, t0 + 60_000), false, 'la fenêtre a expiré');
});
