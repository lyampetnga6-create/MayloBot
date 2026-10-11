'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { SettingsStore } = require('../src/settings');
const invites = require('../src/bot/modules/invites');
const stats = require('../src/bot/modules/serverstats');

const G = '555555555555555555';
const m = (obj) => new Map(Object.entries(obj));

test('invitations : détection de l’invitation utilisée', () => {
  const before = m({ aaa: { uses: 1, maxUses: 0, inviterId: '1' }, bbb: { uses: 4, maxUses: 0, inviterId: '2' } });
  const after = m({ aaa: { uses: 1, maxUses: 0, inviterId: '1' }, bbb: { uses: 5, maxUses: 0, inviterId: '2' } });
  assert.deepEqual(invites.detectInvite(before, after), { code: 'bbb', inviterId: '2' });
  assert.equal(invites.detectInvite(before, before), null, 'aucune différence');
});

test('invitations : nouvelle invitation utilisée aussitôt, ou épuisée', () => {
  const fresh = m({ ccc: { uses: 1, maxUses: 0, inviterId: '3' } });
  assert.deepEqual(invites.detectInvite(m({}), fresh), { code: 'ccc', inviterId: '3' });
  const before = m({ ddd: { uses: 0, maxUses: 1, inviterId: '4' } });
  assert.deepEqual(invites.detectInvite(before, m({})), { code: 'ddd', inviterId: '4' });
  // une invitation supprimée à la main (pas épuisée) ne doit pas être attribuée
  assert.equal(invites.detectInvite(m({ eee: { uses: 0, maxUses: 10, inviterId: '5' } }), m({})), null);
});

test('invitations : deux arrivées simultanées = indéterminé', () => {
  const before = m({ a: { uses: 0, maxUses: 0, inviterId: '1' }, b: { uses: 0, maxUses: 0, inviterId: '2' } });
  const after = m({ a: { uses: 1, maxUses: 0, inviterId: '1' }, b: { uses: 1, maxUses: 0, inviterId: '2' } });
  assert.equal(invites.detectInvite(before, after), null);
});

function setup() {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db);
  return { db, settings, client: { ctx: { db, settings } } };
}

test('invitations : statistiques, départs et classement', () => {
  const { db, client } = setup();
  const add = db.prepare('INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at, left_at) VALUES (?,?,?,?,?,?)');
  add.run(G, 'u1', 'A', 'x', 1, null);
  add.run(G, 'u2', 'A', 'x', 2, 5);
  add.run(G, 'u3', 'A', 'x', 3, null);
  add.run(G, 'u4', 'B', 'y', 4, null);
  add.run(G, 'u5', null, '', 5, null);
  add.run('autre', 'u6', 'A', 'x', 6, null);
  assert.deepEqual(invites.statsFor(client, G, 'A'), { total: 3, left: 1, active: 2 });
  assert.deepEqual(invites.statsFor(client, G, 'Z'), { total: 0, left: 0, active: 0 });
  const board = invites.leaderboard(client, G);
  assert.deepEqual(board.map((r) => [r.userId, r.active, r.total, r.left]), [['A', 2, 3, 1], ['B', 1, 1, 0]]);
  assert.deepEqual(invites.inviterOf(client, G, 'u4'), { inviterId: 'B', code: 'y' });
  assert.equal(invites.inviterOf(client, G, 'inconnu'), null);
});

test('invitations : un départ est enregistré', () => {
  const { db, client, settings } = setup();
  settings.saveModule(G, 'invites', { enabled: true }, {});
  db.prepare('INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, joined_at) VALUES (?,?,?,?,?)').run(G, 'u1', 'A', 'x', 1);
  invites.onMemberRemove(client, { guild: { id: G }, id: 'u1' });
  assert.equal(invites.statsFor(client, G, 'A').left, 1);
});

test('invitations : récompenses sans doublon de rôle', async () => {
  const { db, client, settings } = setup();
  settings.saveModule(G, 'invites', { enabled: true, rewards: [{ count: 2, roleId: '111111111111111111' }] }, {});
  const added = [];
  const member = { roles: { cache: new Map(), add: async (ids) => { added.push(ids); } } };
  const guild = {
    id: G, name: 'Test', memberCount: 4, iconURL: () => null, vanityURLCode: null, roles: { cache: new Map([['111111111111111111', { editable: true }]]) },
    members: { cache: new Map([['A', member]]), me: null },
    invites: { fetch: async () => new Map() },
  };
  client.guilds = { cache: new Map([[G, guild]]) };
  client.users = { cache: new Map(), fetch: async () => ({ username: 'inviteur' }) };
  // 1re arrivée : pas encore assez ; on triche en appelant onMemberAdd avec un cache chauffé
  await invites.refresh(client, guild);
  guild.invites.fetch = async () => new Map([['x', { code: 'x', uses: 1, maxUses: 0, inviterId: 'A' }]]);
  await invites.onMemberAdd(client, { guild, id: 'n1', user: { bot: false, username: 'n1', id: 'n1', createdTimestamp: 0 }, displayAvatarURL: () => '' });
  assert.equal(added.length, 0, '1 invitation < 2');
  guild.invites.fetch = async () => new Map([['x', { code: 'x', uses: 2, maxUses: 0, inviterId: 'A' }]]);
  await invites.onMemberAdd(client, { guild, id: 'n2', user: { bot: false, username: 'n2', id: 'n2', createdTimestamp: 0 }, displayAvatarURL: () => '' });
  assert.equal(added.length, 1);
  assert.deepEqual(added[0], ['111111111111111111']);
  assert.equal(invites.inviterOf(client, G, 'n2').inviterId, 'A');
});

test('invitations : module désactivé par défaut, rien n’est enregistré', async () => {
  const { db, client } = setup();
  await invites.onMemberAdd(client, { guild: { id: G }, id: 'u', user: { bot: false } });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invite_joins').get().n, 0);
});

/* ----------------------------- Statistiques ----------------------------- */
test('statistiques : comptage, écriture en base et série continue', () => {
  const { client, settings } = setup();
  settings.saveModule(G, 'serverstats', { enabled: true, ignoredChannels: ['999999999999999999'] }, {});
  const msg = (channelId, bot = false) => ({ guild: { id: G }, author: { bot }, system: false, channelId, channel: { parentId: null } });
  stats.onMessage(client, msg('c1'));
  stats.onMessage(client, msg('c1'));
  stats.onMessage(client, msg('c2'));
  stats.onMessage(client, msg('c1', true));
  stats.onMessage(client, msg('999999999999999999'));
  stats.onMemberAdd(client, { guild: { id: G }, user: { bot: false } });
  stats.onMemberAdd(client, { guild: { id: G }, user: { bot: true } });
  stats.onMemberRemove(client, { guild: { id: G }, user: { bot: false } });

  const r = stats.report(client, G, 7);
  assert.equal(r.series.length, 7);
  assert.deepEqual(r.totals, { joins: 1, leaves: 1, messages: 3, net: 0 });
  assert.deepEqual(r.channels.map((c) => [c.channelId, c.messages]), [['c1', 2], ['c2', 1]]);
  assert.equal(r.series.at(-1).day, stats.dayOf());

  // un second enregistrement s'ajoute (pas de remplacement)
  stats.onMessage(client, msg('c1'));
  assert.equal(stats.report(client, G, 7).totals.messages, 4);
  assert.equal(stats.report(client, 'autre', 7).totals.messages, 0);
});

test('statistiques : module désactivé = rien compté, durée bornée', () => {
  const { client, settings } = setup();
  settings.saveModule(G, 'serverstats', { enabled: false }, {});
  stats.onMessage(client, { guild: { id: G }, author: { bot: false }, system: false, channelId: 'c', channel: {} });
  assert.equal(stats.report(client, G, 30).totals.messages, 0);
  assert.equal(stats.report(client, G, 100000).series.length, 365);
  assert.equal(stats.report(client, G, 'abc').series.length, 30);
});
