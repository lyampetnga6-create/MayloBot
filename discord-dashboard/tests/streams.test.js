'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { SettingsStore } = require('../src/settings');
const streams = require('../src/bot/modules/streams');
const feeds = require('../src/bot/modules/feeds');

const G = '555555555555555555';
const CH = '777777777777777777';
const MIN = 60000;

test('lives : noms de chaînes nettoyés et validés', () => {
  assert.equal(streams.normalizeHandle('twitch', 'https://www.twitch.tv/MonStreamer'), 'monstreamer');
  assert.equal(streams.normalizeHandle('twitch', '@Nom_123'), 'nom_123');
  assert.equal(streams.normalizeHandle('kick', 'https://kick.com/Mon-Slug'), 'mon-slug');
  assert.equal(streams.normalizeHandle('tiktok', 'https://www.tiktok.com/@Moi.Meme'), 'moi.meme');
  assert.equal(streams.normalizeHandle('tiktok', '@moi'), 'moi');
  assert.throws(() => streams.normalizeHandle('twitch', 'a'));
  assert.throws(() => streams.normalizeHandle('twitch', 'pas un nom!'));
  assert.throws(() => streams.normalizeHandle('kick', ''));
  assert.throws(() => streams.normalizeHandle('inconnue', 'abc'));
});

test('lives : décision d’alerte (premier passage, transition, pause)', () => {
  const live = { live: true, session: 's1' };
  const off = { live: false };
  // premier passage : jamais d'alerte, même s'il est déjà en direct
  let r = streams.decide(null, live, 1000, 30 * MIN);
  assert.equal(r.notify, false);
  assert.equal(r.next.live, true);
  // après une erreur au premier passage : toujours silencieux
  assert.equal(streams.decide({ checkedAt: 1, error: 'x' }, live, 2000, 0).notify, false);
  // hors ligne -> en direct : alerte
  const offState = streams.decide(r.next, off, 2000, 30 * MIN).next;
  r = streams.decide(offState, { live: true, session: 's2' }, 3000, 30 * MIN);
  assert.equal(r.notify, true);
  assert.equal(r.next.lastNotified, 3000);
  // toujours en direct : pas de nouvelle alerte
  assert.equal(streams.decide(r.next, { live: true, session: 's2' }, 4000, 0).notify, false);
  // coupure puis reprise dans le délai de pause : pas d'alerte
  const cut = streams.decide(r.next, off, 5000, 30 * MIN).next;
  assert.equal(streams.decide(cut, { live: true, session: 's3' }, 6000, 30 * MIN).notify, false);
  // après le délai : alerte
  assert.equal(streams.decide(cut, { live: true, session: 's3' }, 3000 + 31 * MIN, 30 * MIN).notify, true);
});

test('lives : YouTube, page /live', () => {
  const html = '<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=abcdEFGhijk"><meta property="og:title" content="Mon direct &amp; plus"></head><script>var x={"isLiveNow":true}</script>';
  assert.deepEqual(streams.parseYoutubeLive(html), { live: true, videoId: 'abcdEFGhijk', title: 'Mon direct & plus' });
  const off = '<html><head><link rel="canonical" href="https://www.youtube.com/channel/UC1234567890abcdefghijkl"></head></html>';
  assert.equal(streams.parseYoutubeLive(off).live, false);
  const upcoming = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdEFGhijk">{"isUpcoming":true}';
  assert.equal(streams.parseYoutubeLive(upcoming).live, false, 'un direct programmé n’est pas un direct');
});

test('lives : TikTok, page de profil', () => {
  const page = (user) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user } } } })}</script>`;
  assert.deepEqual(streams.parseTiktokProfile(page({ roomId: '7123', nickname: 'Moi' })), { live: true, roomId: '7123', nickname: 'Moi' });
  assert.equal(streams.parseTiktokProfile(page({ roomId: '', nickname: 'Moi' })).live, false);
  assert.equal(streams.parseTiktokProfile(page({ roomId: '0', nickname: 'Moi' })).live, false);
  assert.throws(() => streams.parseTiktokProfile('<html>captcha</html>'), /bloque/);
  assert.throws(() => streams.parseTiktokProfile('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{}</script>'), /introuvable/);
});

test('vidéos TikTok : adresse du flux RSSHub', () => {
  assert.equal(feeds.tiktokFeedUrl('@moi'), 'https://rsshub.app/tiktok/user/@moi');
  assert.equal(feeds.tiktokFeedUrl('https://www.tiktok.com/@Moi.Meme?lang=fr', 'https://hub.exemple.test/'), 'https://hub.exemple.test/tiktok/user/@Moi.Meme');
  assert.throws(() => feeds.tiktokFeedUrl('pas valide !'));
});

/* --------------------------- API Twitch / Kick --------------------------- */
function setup(cfgStreams = { twitchClientId: 'id', twitchClientSecret: 'sec', kickClientId: 'kid', kickClientSecret: 'ksec' }, item = {}) {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db);
  const base = { id: 's1', platform: 'twitch', handle: 'monstreamer', channelId: CH, pingRoleId: '' };
  settings.saveModule(G, 'streams', { enabled: true, streamers: [{ ...base, ...item }] }, {});
  const sent = [];
  const channel = { isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); return { url: 'https://discord.test/m' }; } };
  const guild = { id: G, name: 'Test', memberCount: 3, iconURL: () => null, channels: { cache: new Map([[CH, channel]]) }, members: { me: null } };
  const client = { guilds: { cache: new Map([[G, guild]]) }, ctx: { db, settings, config: { streams: cfgStreams } } };
  return { client, guild, sent, item: settings.module(G, 'streams').streamers[0] };
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function twitchFetch(live) {
  return async (url) => {
    if (String(url).includes('oauth2/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    return json(200, { data: live ? [{ id: '999', type: 'live', user_name: 'MonStreamer', title: 'Super jeu', game_name: 'Zelda', viewer_count: 42 }] : [] });
  };
}

test('lives : Twitch, hors ligne puis en direct, une seule alerte', async () => {
  const { client, guild, sent, item } = setup();
  streams.setFetch(twitchFetch(false));
  assert.deepEqual(await streams.checkOne(client, guild, item, 0), { notified: false, live: false });
  streams.setFetch(twitchFetch(true));
  assert.deepEqual(await streams.checkOne(client, guild, item, 0), { notified: true, live: true });
  assert.equal(sent.length, 1);
  const text = JSON.stringify(sent[0]);
  assert.ok(text.includes('MonStreamer') && text.includes('Super jeu') && text.includes('https://www.twitch.tv/monstreamer'));
  assert.deepEqual(await streams.checkOne(client, guild, item, 0), { notified: false, live: true }, 'pas de doublon');
  assert.equal(sent.length, 1);
  assert.equal(streams.statuses(client, G, [item])[0].live, true);
  streams.setFetch(null);
});

test('lives : déjà en direct au premier passage = pas d’alerte', async () => {
  const { client, guild, sent, item } = setup();
  streams.setFetch(twitchFetch(true));
  await streams.checkOne(client, guild, item, 0);
  assert.equal(sent.length, 0);
  streams.setFetch(null);
});

test('lives : mention du rôle', async () => {
  const { client, guild, sent, item } = setup(undefined, { pingRoleId: '888888888888888888' });
  streams.setFetch(twitchFetch(false));
  await streams.checkOne(client, guild, item, 0);
  streams.setFetch(twitchFetch(true));
  await streams.checkOne(client, guild, item, 0);
  assert.ok(String(sent[0].content).includes('<@&888888888888888888>'));
  assert.deepEqual(sent[0].allowedMentions, { roles: ['888888888888888888'] });
  streams.setFetch(null);
});

test('lives : identifiants manquants = erreur claire mémorisée', async () => {
  const { client, guild, item } = setup({});
  streams.setFetch(twitchFetch(true));
  await assert.rejects(streams.checkOne(client, guild, item, 0), /TWITCH_CLIENT_ID/);
  assert.match(streams.statuses(client, G, [item])[0].error, /TWITCH/);
  assert.deepEqual(streams.credentials(client), { twitch: false, kick: false });
  streams.setFetch(null);
});

test('lives : Kick en direct, introuvable et bloqué', async () => {
  const { client, guild, item } = setup(undefined, { platform: 'kick', handle: 'kicker' });
  const kick = (status, body) => async (url) => (String(url).includes('oauth/token') ? json(200, { access_token: 'k', expires_in: 3600 }) : json(status, body));
  streams.setFetch(kick(200, { data: [{ slug: 'kicker', stream_title: 'Soirée', category: { name: 'Just Chatting' }, stream: { is_live: true, viewer_count: 7, start_time: '2026-10-11T10:00:00Z' } }] }));
  const r = await streams.checkStreamer(client, item);
  assert.deepEqual([r.live, r.title, r.game, r.viewers, r.url], [true, 'Soirée', 'Just Chatting', 7, 'https://kick.com/kicker']);
  streams.setFetch(kick(200, { data: [{ slug: 'kicker', stream: { is_live: false } }] }));
  assert.equal((await streams.checkStreamer(client, item)).live, false);
  streams.setFetch(kick(200, { data: [] }));
  await assert.rejects(streams.checkStreamer(client, item), /introuvable/);
  streams.setFetch(kick(403, {}));
  await assert.rejects(streams.checkStreamer(client, item), /bloqué/);
  streams.setFetch(null);
});

test('lives : « Tester » envoie l’alerte seulement si le streamer est en direct', async () => {
  const { client, guild, sent, item } = setup();
  streams.setFetch(twitchFetch(false));
  assert.deepEqual(await streams.testStreamer(client, guild, item), { live: false });
  assert.equal(sent.length, 0);
  streams.setFetch(twitchFetch(true));
  const r = await streams.testStreamer(client, guild, item);
  assert.equal(r.live, true);
  assert.equal(sent.length, 1);
  streams.setFetch(null);
});

test('lives : module déclaré avec des valeurs par défaut sûres', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  const cfg = store.module(G, 'streams');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.intervalMinutes, 2);
  assert.equal(cfg.cooldownMinutes, 30);
  assert.deepEqual(cfg.streamers, []);
});
