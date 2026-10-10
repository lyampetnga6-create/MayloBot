'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDuration, formatDuration } = require('../src/lib/duration');
const { encrypt, decrypt } = require('../src/lib/secrets');
const ai = require('../src/lib/ai');
const fun = require('../src/lib/fun');
const templates = require('../src/lib/server-templates');
const { URL_RE } = require('../src/bot/modules/webhooks');
const verification = require('../src/bot/modules/verification');
const ticketAi = require('../src/bot/modules/ticket-ai');
const protection = require('../src/bot/modules/protection');
const { dehoist } = require('../src/bot/modules/automation');
const { MODULES, CATEGORIES } = require('../src/schema');

test('durées : unités, combinaisons et entrées invalides', () => {
  assert.equal(parseDuration('90m'), 90 * 60000);
  assert.equal(parseDuration('1h30m'), 90 * 60000);
  assert.equal(parseDuration('2j'), 2 * 86400000);
  assert.equal(parseDuration('1w'), 604800000);
  assert.equal(parseDuration('12'), null, 'un nombre seul est ambigu');
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('1h bonjour'), null);
  assert.equal(formatDuration(90 * 60000), '1 h 30 min');
});

test('secrets : chiffrement aller-retour, mauvaise clé et données altérées', () => {
  const blob = encrypt('sk-secret-123', 'a'.repeat(40));
  assert.ok(!blob.includes('sk-secret'));
  assert.equal(decrypt(blob, 'a'.repeat(40)), 'sk-secret-123');
  assert.equal(decrypt(blob, 'b'.repeat(40)), null);
  assert.equal(decrypt(blob.slice(0, -3) + 'AAA', 'a'.repeat(40)), null);
  assert.equal(decrypt('n’importe quoi', 'a'.repeat(40)), null);
  assert.notEqual(encrypt('x', 'a'.repeat(40)), encrypt('x', 'a'.repeat(40)), 'IV aléatoire');
});

test('IA : extraction du JSON dans une réponse bavarde', () => {
  assert.deepEqual(ai.extractJson('Voici : ```json\n{"a":1,"b":{"c":"}"}}\n``` voilà'), { a: 1, b: { c: '}' } });
  assert.throws(() => ai.extractJson('aucun plan ici'), (e) => e instanceof ai.AiError);
});

test('IA : choix du fournisseur (clé de serveur, clé globale, rien)', () => {
  const config = { ai: { provider: 'groq', apiKey: 'g-key', baseUrl: '', model: '' } };
  assert.equal(ai.resolveProvider({ ai: {} }, {}, null), null);
  const global = ai.resolveProvider(config, { provider: 'default' }, null);
  assert.equal(global.source, 'global');
  assert.equal(global.baseUrl, 'https://api.groq.com/openai/v1');
  const guild = ai.resolveProvider(config, { provider: 'anthropic' }, 'ant-key');
  assert.equal(guild.source, 'guild');
  assert.equal(guild.kind, 'anthropic');
  assert.equal(ai.resolveProvider(config, { provider: 'anthropic' }, null), null, 'sans clé de serveur, pas de repli sur la clé du bot');
  const bad = ai.resolveProvider(config, { provider: 'openai', model: 'x y; DROP' }, 'k');
  assert.equal(bad.model, ai.PRESETS.openai.model, 'nom de modèle invalide ignoré');
  assert.equal(ai.resolveProvider(config, { provider: 'https://evil.example' }, 'k'), null, 'pas d’adresse libre pour un serveur');
});

test('jeux : calculatrice sûre, dés, morpion', () => {
  assert.equal(fun.calculate('2+2*3'), 8);
  assert.equal(fun.calculate('(1+2)*3'), 9);
  assert.equal(fun.calculate('2^10'), 1024);
  assert.equal(fun.calculate('process.exit()'), null);
  assert.equal(fun.calculate('1/0') === null || !Number.isFinite(fun.calculate('1/0')), true);
  assert.equal(fun.rollDice('abc'), null);
  assert.equal(fun.rollDice('99d6'), null);
  const r = fun.rollDice('3d6+2');
  assert.equal(r.rolls.length, 3);
  assert.ok(r.rolls.every((n) => n >= 1 && n <= 6));
  assert.equal(r.total, r.rolls.reduce((a, b) => a + b, 0) + 2);
  assert.equal(fun.tttWinner(['X', 'X', 'X', '', '', '', '', '', '']), 'X');
  assert.equal(fun.tttWinner(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), 'draw');
  assert.equal(fun.tttWinner(Array(9).fill('')), null);
});

test('vérification : calcul et normalisation des réponses', () => {
  for (let i = 0; i < 50; i++) {
    const c = verification.mathChallenge();
    assert.match(c.answer, /^\d+$/);
    assert.ok(Number(c.answer) >= 0);
  }
  assert.equal(verification.norm('  RéPonse  '), verification.norm('réponse'));
});

test('IA des tickets : mots qui appellent un humain (mots entiers)', () => {
  assert.equal(ticketAi.matchesKeyword('je veux parler à un humain', ['humain']), true);
  assert.equal(ticketAi.matchesKeyword('les humains sont étranges', ['humain']), false);
  assert.equal(ticketAi.matchesKeyword('appelle le STAFF', ['staff']), true);
  assert.equal(ticketAi.matchesKeyword('rien', []), false);
});

test('protection : liens d’arnaque et fenêtre glissante', () => {
  assert.ok(protection.scanLinks('gratuit https://discorrd-nitro.com/gift'));
  assert.equal(protection.scanLinks('https://discord.com/channels/1/2'), null);
  assert.ok(protection.scanLinks('https://mauvais.example/x', ['mauvais.example']));
  const store = new Map();
  assert.equal(protection.countAction(store, 'k', 1000, 5000, 2), false);
  assert.equal(protection.countAction(store, 'k', 1100, 5000, 2), false);
  assert.equal(protection.countAction(store, 'k', 1200, 5000, 2), true, 'troisième action dans la fenêtre');
  assert.equal(protection.countAction(store, 'k', 9000, 5000, 2), false, 'les anciennes actions sortent de la fenêtre');
});

test('pseudos : suppression des symboles de tête', () => {
  assert.equal(dehoist('!!! Alice', 'x'), 'Alice');
  assert.equal(dehoist('!!!', 'Membre'), 'Membre');
  assert.equal(dehoist('Bob', 'x'), 'Bob');
});

test('webhooks : seules les URL de webhook Discord en https sont acceptées', () => {
  const id = '123456789012345678';
  const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
  assert.ok(URL_RE.test(`https://discord.com/api/webhooks/${id}/${token}`));
  assert.ok(URL_RE.test(`https://discordapp.com/api/v10/webhooks/${id}/${token}`));
  assert.ok(!URL_RE.test(`http://discord.com/api/webhooks/${id}/${token}`));
  assert.ok(!URL_RE.test(`https://evil.example/api/webhooks/${id}/${token}`));
  assert.ok(!URL_RE.test(`https://discord.com.evil.example/api/webhooks/${id}/${token}`));
});

test('créateur de serveur : validation stricte des plans', () => {
  const { plan, warnings } = templates.validatePlan({
    roles: [
      { name: 'Boss', preset: 'administrator', kind: 'staff' },
      { name: 'Déco', preset: 'moderator', kind: 'cosmetic' },
      { name: 'boss' },
    ],
    categories: [{ name: 'Général', channels: [{ name: 'Mon Salon @everyone', type: 'text' }, { name: 'Mon Salon @everyone', type: 'text' }, { name: 'Vocal', type: 'voice', userLimit: 500 }] }],
  });
  assert.equal(plan.roles.length, 2, 'doublon ignoré');
  assert.equal(plan.roles[0].preset, 'none', 'jamais d’Administrateur');
  assert.equal(plan.roles[1].preset, 'none', 'rôle décoratif sans permissions');
  assert.ok(warnings.length >= 2);
  const names = plan.categories[0].channels.map((c) => c.name);
  assert.deepEqual(names, ['mon-salon-everyone', 'Vocal']);
  assert.equal(plan.categories[0].channels[1].userLimit, 99);

  const big = templates.validatePlan({ categories: Array.from({ length: 50 }, (_, i) => ({ name: `C${i}`, channels: [] })) });
  assert.equal(big.plan.categories.length, templates.LIMITS.categories);
  assert.deepEqual(templates.validatePlan(null).plan, { roles: [], categories: [] });
  assert.ok(!Object.values(templates.PRESETS).some((p) => p.includes('Administrator')));
});

test('créateur de serveur : les 6 modèles sont valides et sans correction', () => {
  const list = templates.listTemplates();
  assert.equal(list.length, 6);
  for (const t of list) {
    const { plan, warnings } = templates.getTemplate(t.id);
    assert.deepEqual(warnings, [], `${t.id} : aucune correction automatique`);
    assert.ok(plan.categories.length > 0 && plan.roles.length > 0);
    assert.ok(t.summary.channels <= templates.LIMITS.channels);
  }
});

test('schéma : tous les modules ont une catégorie connue et un identifiant unique', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  const ids = new Set();
  for (const m of MODULES) {
    assert.ok(cats.has(m.category), `${m.id} : catégorie « ${m.category} » inconnue`);
    assert.ok(!ids.has(m.id), `${m.id} en double`);
    ids.add(m.id);
  }
  assert.equal(MODULES.length, 31);
});

test('patchModule : ajouter un salon piège conserve les autres réglages', () => {
  const { openDatabase } = require('../src/db');
  const { SettingsStore } = require('../src/settings');
  const store = new SettingsStore(openDatabase(':memory:'));
  const G = '555555555555555555';
  store.saveModule(G, 'honeypot', { enabled: true, channelIds: ['111111111111111111'], logChannelId: '222222222222222222' }, {});
  store.patchModule(G, 'honeypot', (c) => { c.channelIds.push('333333333333333333'); });
  const cfg = store.module(G, 'honeypot');
  assert.deepEqual(cfg.channelIds, ['111111111111111111', '333333333333333333']);
  assert.equal(cfg.logChannelId, '222222222222222222');
  assert.equal(cfg.enabled, true);
});
