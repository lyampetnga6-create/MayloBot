'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULES, defaultModule, normalizeModule, normalizeValue, defaultSettings } = require('../src/schema');

const mod = (id) => MODULES.find((m) => m.id === id);
const CH = '111111111111111111';
const CH2 = '222222222222222222';
const ROLE = '333333333333333333';

const ctx = {
  channels: new Map([[CH, { kind: 'text' }], [CH2, { kind: 'category' }]]),
  roles: new Map([[ROLE, {}]]),
};

test('les valeurs par défaut de chaque module sont stables après normalisation', () => {
  for (const m of MODULES) {
    const defaults = defaultModule(m);
    assert.deepEqual(normalizeModule(m, defaults), defaults, `module « ${m.id} » instable`);
  }
});

test('defaultSettings contient tous les modules', () => {
  assert.deepEqual(Object.keys(defaultSettings()).sort(), MODULES.map((m) => m.id).sort());
});

test('les clés inconnues sont supprimées et les types forcés', () => {
  const out = normalizeModule(mod('welcome'), { enabled: 'oui', hack: '<script>', deleteAfter: '12.7', channelId: 42 });
  assert.equal(out.enabled, false, 'seul le booléen true active un interrupteur');
  assert.equal(out.deleteAfter, 13);
  assert.equal(out.channelId, '');
  assert.ok(!('hack' in out));
});

test('les nombres sont bornés', () => {
  const out = normalizeModule(mod('levels'), { xpMin: -50, xpMax: 99999, multiplier: 50 });
  assert.equal(out.xpMin, 0);
  assert.equal(out.xpMax, 500);
  assert.equal(out.multiplier, 10);
  assert.equal(normalizeModule(mod('levels'), { multiplier: 1.456 }).multiplier, 1.46);
});

test('un select invalide retombe sur la valeur par défaut', () => {
  assert.equal(normalizeModule(mod('automod'), { action: 'nuke' }).action, 'none');
  assert.equal(normalizeModule(mod('automod'), { action: 'timeout' }).action, 'timeout');
});

test('salons : seuls les salons existants du bon type sont acceptés', () => {
  const field = { type: 'channel', kinds: ['text'] };
  assert.equal(normalizeValue(field, CH, ctx), CH);
  assert.equal(normalizeValue(field, CH2, ctx), '', 'une catégorie n’est pas un salon textuel');
  assert.equal(normalizeValue(field, '999999999999999999', ctx), '', 'salon inexistant');
  assert.equal(normalizeValue(field, 'abc', ctx), '');
  assert.equal(normalizeValue({ type: 'channel', kinds: ['category'] }, CH2, ctx), CH2);
});

test('rôles : seuls les rôles existants sont acceptés, sans doublons', () => {
  const field = { type: 'roles', max: 25 };
  assert.deepEqual(normalizeValue(field, [ROLE, ROLE, '999999999999999999', 5], ctx), [ROLE]);
});

test('listes : éléments incomplets ignorés, maximum respecté', () => {
  const out = normalizeModule(mod('levels'), {
    rewards: [{ level: 5, role: ROLE }, { level: 10, role: '' }, { level: 3, role: ROLE }, 'x', null],
  }, ctx);
  assert.deepEqual(out.rewards, [{ level: 5, role: ROLE }, { level: 3, role: ROLE }]);

  const many = Array.from({ length: 40 }, (_, i) => ({ name: `cmd${i}`, response: 'ok' }));
  assert.equal(normalizeModule(mod('commands'), { commands: many }).commands.length, 40);
  const tooMany = Array.from({ length: 80 }, (_, i) => ({ name: `cmd${i}`, response: 'ok' }));
  assert.equal(normalizeModule(mod('commands'), { commands: tooMany }).commands.length, 50);
});

test('commandes perso : le nom est nettoyé (slug)', () => {
  const out = normalizeModule(mod('commands'), { commands: [{ name: '  Mon Super Cmd !! ', response: 'salut' }] });
  assert.equal(out.commands[0].name, 'mon-super-cmd');
});

test('chaînes : minuscules, doublons retirés, caractères de contrôle supprimés', () => {
  const out = normalizeModule(mod('automod'), { words: { enabled: true, list: ['Foo', 'foo', ' BAR ', '', 'ba\u0000z'] } });
  assert.deepEqual(out.words.list, ['foo', 'bar', 'baz']);
});

test('messages : valeurs manquantes complétées, couleur invalide ignorée', () => {
  const out = normalizeModule(mod('welcome'), { message: { content: 'Salut {user}', embed: { enabled: true, color: 'rouge', title: 'T' } } });
  assert.equal(out.message.content, 'Salut {user}');
  assert.equal(out.message.embed.enabled, true);
  assert.equal(out.message.embed.color, '');
  assert.equal(out.message.embed.title, 'T');
  assert.equal(typeof out.message.embed.description, 'string');
});

test('une sauvegarde partielle conserve les valeurs existantes (base)', () => {
  const m = mod('welcome');
  const base = normalizeModule(m, { enabled: true, channelId: CH, deleteAfter: 30 }, ctx);
  const next = normalizeModule(m, { deleteAfter: 5 }, ctx, base);
  assert.equal(next.enabled, true);
  assert.equal(next.channelId, CH);
  assert.equal(next.deleteAfter, 5);
});

test('rôles à boutons : un identifiant est généré, messageId invalide vidé', () => {
  const out = normalizeModule(mod('rolepanels'), {
    panels: [{ name: 'Couleurs', messageId: 'pas-un-id', roles: [{ roleId: ROLE, style: 'Rouge' }, { roleId: '' }] }],
  }, ctx);
  const p = out.panels[0];
  assert.match(p.id, /^[a-z0-9]{6,24}$/i);
  assert.equal(p.messageId, '');
  assert.equal(p.roles.length, 1);
  assert.equal(p.roles[0].style, 'Secondary');
});

test('les textes sont tronqués à leur longueur maximale', () => {
  const out = normalizeModule(mod('general'), { footerText: 'y'.repeat(500), utcOffset: 99 });
  assert.equal(out.footerText.length, 100);
  assert.equal(out.utcOffset, 14, 'le décalage horaire est borné');
});
