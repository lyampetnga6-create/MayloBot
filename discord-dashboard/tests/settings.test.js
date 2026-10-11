'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { SettingsStore } = require('../src/settings');

const GUILD = '444444444444444444';

test('réglages par défaut, puis enregistrement et relecture', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  assert.equal(store.module(GUILD, 'welcome').enabled, false);

  store.saveModule(GUILD, 'welcome', { enabled: true, deleteAfter: 20 });
  assert.equal(store.module(GUILD, 'welcome').enabled, true);

  // un nouveau store sur la même base relit les données persistées
  const db = openDatabase(':memory:');
  const a = new SettingsStore(db);
  a.saveModule(GUILD, 'levels', { enabled: true, xpMin: 7 });
  const b = new SettingsStore(db);
  assert.equal(b.module(GUILD, 'levels').xpMin, 7);
  assert.equal(b.module(GUILD, 'levels').enabled, true);
});

test('une sauvegarde partielle ne touche pas aux autres champs ni aux autres modules', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  store.saveModule(GUILD, 'tickets', { enabled: true, maxPerUser: 3 });
  store.saveModule(GUILD, 'tickets', { maxPerUser: 5 });
  const t = store.module(GUILD, 'tickets');
  assert.equal(t.enabled, true);
  assert.equal(t.maxPerUser, 5);
  assert.equal(store.module(GUILD, 'welcome').enabled, false);
});

test('import : seuls les modules fournis sont remplacés', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  store.saveModule(GUILD, 'autorole', { enabled: true });
  store.saveMany(GUILD, { logs: { enabled: true }, nimporte: { x: 1 } });
  assert.equal(store.module(GUILD, 'logs').enabled, true);
  assert.equal(store.module(GUILD, 'autorole').enabled, true);
  assert.ok(!('nimporte' in store.get(GUILD)));
});

test('un module inconnu est refusé', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  assert.throws(() => store.saveModule(GUILD, 'inexistant', {}), /Module inconnu/);
});

test('patchModule modifie une valeur interne', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  store.saveModule(GUILD, 'rolepanels', { panels: [{ id: 'abcdef12', name: 'P', roles: [] }] });
  store.patchModule(GUILD, 'rolepanels', (m) => { m.panels[0].messageId = '555555555555555555'; });
  assert.equal(store.module(GUILD, 'rolepanels').panels[0].messageId, '555555555555555555');
});
