'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { SettingsStore } = require('../src/settings');
const { MODULE_BY_ID } = require('../src/schema');
const { PermissionFlagsBits } = require('discord.js');
const appeals = require('../src/bot/modules/appeals');

const G = '555555555555555555';
const U = '666666666666666666';

function setup(cfg = {}) {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db);
  settings.saveModule(G, 'appeals', { enabled: true, ...cfg }, {});
  const sent = [];
  const guild = {
    id: G, name: 'Test', ownerId: '1', memberCount: 3, iconURL: () => null,
    roles: { cache: new Map(), everyone: { id: G } },
    bans: { fetch: async () => ({}) },
  };
  const client = {
    user: { id: '999999999999999999' },
    guilds: { cache: new Map([[G, guild]]) },
    ctx: { db, settings, license: { status: () => ({ allowed: true }) } },
  };
  const user = { id: U, username: 'membre', displayAvatarURL: () => null, send: async (p) => { sent.push(p); } };
  return { db, client, guild, user, sent };
}

const addCase = (db, type = 'ban', createdAt = Date.now()) => Number(db.prepare(
  'INSERT INTO cases (guild_id, user_id, mod_id, type, reason, duration, created_at) VALUES (?,?,?,?,?,?,?)',
).run(G, U, '1', type, 'spam', null, createdAt).lastInsertRowid);
const addAppeal = (db, caseId, status, extra = {}) => db.prepare(
  'INSERT INTO appeals (guild_id, user_id, case_id, type, status, final, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?)',
).run(G, U, caseId, 'ban', status, extra.final ? 1 : 0, Date.now(), extra.decidedAt ?? Date.now());

test('contestations : module déclaré avec des valeurs par défaut sûres', () => {
  const mod = MODULE_BY_ID.get('appeals');
  assert.ok(mod);
  assert.equal(mod.category, 'support');
  const store = new SettingsStore(openDatabase(':memory:'));
  const cfg = store.module(G, 'appeals');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.types.ban, true);
  assert.equal(cfg.types.warn, false);
  assert.equal(cfg.maxAppeals, 1);
  assert.equal(cfg.questions.length, 0);
});

test('contestations : une sanction non activée n’est pas contestable', async () => {
  const { client, guild, user } = setup({ types: { ban: false } });
  const res = await appeals.eligibility(client, guild, user, 'ban');
  assert.equal(res.ok, false);
});

test('contestations : éligibilité (dossier, doublon, refus définitif, délai)', async () => {
  const { db, client, guild, user } = setup({ maxAppeals: 2, cooldownHours: 0, expireDays: 10 });
  assert.equal((await appeals.eligibility(client, guild, user, 'ban')).ok, false, 'sans dossier');

  const caseId = addCase(db);
  assert.equal((await appeals.eligibility(client, guild, user, 'ban')).ok, true);

  addAppeal(db, caseId, 'open');
  assert.match((await appeals.eligibility(client, guild, user, 'ban')).text, /en cours/);

  db.prepare("UPDATE appeals SET status = 'refused'").run();
  assert.equal((await appeals.eligibility(client, guild, user, 'ban')).ok, true, 'une 2e demande est permise');

  addAppeal(db, caseId, 'refused');
  assert.match((await appeals.eligibility(client, guild, user, 'ban')).text, /maximum/);

  db.prepare('DELETE FROM appeals').run();
  addAppeal(db, caseId, 'refused', { final: true });
  assert.match((await appeals.eligibility(client, guild, user, 'ban')).text, /définitive/);

  db.prepare('DELETE FROM appeals').run();
  addAppeal(db, caseId, 'accepted');
  assert.match((await appeals.eligibility(client, guild, user, 'ban')).text, /acceptée/);
});

test('contestations : délai de contestation dépassé et déjà débanni', async () => {
  const a = setup({ expireDays: 5 });
  addCase(a.db, 'ban', Date.now() - 6 * 86400000);
  assert.match((await appeals.eligibility(a.client, a.guild, a.user, 'ban')).text, /dépassé/);

  const b = setup();
  addCase(b.db);
  b.guild.bans.fetch = async () => { const e = new Error('unknown'); e.code = 10026; throw e; };
  assert.match((await appeals.eligibility(b.client, b.guild, b.user, 'ban')).text, /plus banni/);
});

test('contestations : délai avant de recontester', async () => {
  const { db, client, guild, user } = setup({ maxAppeals: 3, cooldownHours: 24 });
  const caseId = addCase(db);
  addAppeal(db, caseId, 'refused');
  assert.match((await appeals.eligibility(client, guild, user, 'ban')).text, /recontester/);
  db.prepare('UPDATE appeals SET decided_at = ?').run(Date.now() - 25 * 3600000);
  assert.equal((await appeals.eligibility(client, guild, user, 'ban')).ok, true);
});

test('contestations : le MP contient le bouton « Contester » seulement si activé', async () => {
  const on = setup();
  assert.equal(await appeals.notify(on.client, on.guild, on.user, { type: 'ban', reason: 'spam' }), true);
  assert.equal(on.sent.length, 1);
  const row = on.sent[0].components[0];
  const button = row.data?.components?.[0] || row.components?.[0];
  assert.equal((button.data || button).customId, `ap:new:${G}:ban`);

  const off = setup({ enabled: false });
  assert.equal(await appeals.notify(off.client, off.guild, off.user, { type: 'ban', reason: 'x' }), false);
  assert.equal(off.sent.length, 0);

  const kickOff = setup({ types: { kick: false } });
  assert.equal(await appeals.notify(kickOff.client, kickOff.guild, kickOff.user, { type: 'kick', reason: 'x' }), false);
});

test('contestations : MP fermés → notify renvoie false sans planter', async () => {
  const t = setup();
  t.user.send = async () => { throw new Error('Cannot send messages to this user'); };
  assert.equal(await appeals.notify(t.client, t.guild, t.user, { type: 'timeout', reason: 'x', duration: 10 }), false);
});

test('contestations : sanctions du bot reconnues pour ignorer le journal d’audit', () => {
  assert.equal(appeals.wasBotAction(G, U, 'ban'), false);
  appeals.markBotAction(G, U, 'ban');
  assert.equal(appeals.wasBotAction(G, U, 'ban'), true);
  assert.equal(appeals.wasBotAction(G, U, 'kick'), false);
});

test('contestations : le routage ignore les autres boutons et refuse un serveur inconnu', async () => {
  const { client } = setup();
  const other = { customId: 'tk:open', isButton: () => true, isModalSubmit: () => false };
  assert.equal(await appeals.handleInteraction(client, other), false);

  const replies = [];
  const unknown = {
    customId: 'ap:new:123456789012345678:ban', guild: null, user: { id: U },
    isButton: () => true, isModalSubmit: () => false,
    reply: async (p) => { replies.push(p); },
  };
  assert.equal(await appeals.handleInteraction(client, unknown), true);
  assert.match(replies[0].content, /n’accepte plus/);
});

test('contestations : rôles du staff = rôles choisis, sinon rôles qui peuvent modérer', () => {
  const { guild } = setup();
  guild.roles.cache = new Map([
    ['10', { id: '10', managed: false, permissions: { has: (p) => p === PermissionFlagsBits.BanMembers } }],
    ['11', { id: '11', managed: false, permissions: { has: () => false } }],
    ['12', { id: '12', managed: true, permissions: { has: () => true } }],
  ]);
  guild.roles.cache.values = Map.prototype.values.bind(guild.roles.cache);
  assert.deepEqual(appeals.staffRoleIds(guild, { staffRoles: [] }), ['10']);
  assert.deepEqual(appeals.staffRoleIds(guild, { staffRoles: ['11'] }), ['11']);
});
