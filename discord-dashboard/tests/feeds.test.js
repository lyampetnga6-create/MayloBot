'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { SettingsStore } = require('../src/settings');
const feeds = require('../src/bot/modules/feeds');

const G = '555555555555555555';
const CH = '777777777777777777';
const UC = 'UC1234567890abcdefghijkl';

const RSS = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Mon blog</title>${items.map((i) => `<item><title>${i.title}</title><link>https://exemple.test/${i.id}</link><guid>${i.id}</guid><pubDate>${i.date}</pubDate></item>`).join('')}</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Ma chaîne</title>
<entry><id>yt:video:abc</id><title>Vidéo &amp; test</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><author><name>Maylo</name></author><published>2026-01-02T10:00:00+00:00</published></entry>
<entry><id>yt:video:def</id><title><![CDATA[Autre vidéo]]></title><link rel="alternate" href="https://www.youtube.com/watch?v=def"/><author><name>Maylo</name></author><published>2026-01-01T10:00:00+00:00</published></entry></feed>`;

test('flux : adresses privées refusées (anti-SSRF)', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(feeds.isPrivateAddress(ip), true, ip);
  }
  assert.equal(feeds.isPrivateAddress('93.184.216.34'), false);
  await assert.rejects(feeds.assertPublicUrl('http://127.0.0.1/x'));
  await assert.rejects(feeds.assertPublicUrl('http://[::1]/x'));
  await assert.rejects(feeds.assertPublicUrl('file:///etc/passwd'));
  await assert.rejects(feeds.assertPublicUrl('https://user:pass@93.184.216.34/'));
  await assert.rejects(feeds.assertPublicUrl('pas une adresse'));
  await feeds.assertPublicUrl('https://93.184.216.34/feed');
});

test('flux : lecture RSS et Atom', () => {
  const rss = feeds.parseFeed(RSS([{ id: 'a', title: 'Premier &amp; dernier', date: 'Mon, 05 Jan 2026 10:00:00 GMT' }]));
  assert.equal(rss.title, 'Mon blog');
  assert.equal(rss.entries[0].title, 'Premier & dernier');
  assert.equal(rss.entries[0].link, 'https://exemple.test/a');
  assert.ok(rss.entries[0].published > 0);

  const atom = feeds.parseFeed(ATOM);
  assert.equal(atom.title, 'Ma chaîne');
  assert.equal(atom.entries.length, 2);
  assert.equal(atom.entries[0].title, 'Vidéo & test');
  assert.equal(atom.entries[0].link, 'https://www.youtube.com/watch?v=abc');
  assert.equal(atom.entries[0].author, 'Maylo');
  assert.equal(atom.entries[1].title, 'Autre vidéo');

  assert.throws(() => feeds.parseFeed('<html><body>Bonjour</body></html>'));
});

test('flux : le HTML des titres est neutralisé', () => {
  const p = feeds.parseFeed(RSS([{ id: 'x', title: '&lt;script&gt;alert(1)&lt;/script&gt;Titre', date: '' }]));
  assert.ok(!p.entries[0].title.includes('<'));
});

test('flux : adresse de chaîne YouTube', async () => {
  assert.equal(await feeds.youtubeFeedUrl(UC), `https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`);
  assert.equal(await feeds.youtubeFeedUrl(`https://www.youtube.com/channel/${UC}`), `https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`);
  await assert.rejects(feeds.youtubeFeedUrl('https://evil.test/@moi'));
  await assert.rejects(feeds.youtubeFeedUrl('???'));
});

function setup(feedCfg = {}) {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db);
  const feed = { id: 'f1', name: 'Blog', type: 'rss', url: 'https://93.184.216.34/rss', channelId: CH, pingRoleId: '', ...feedCfg };
  settings.saveModule(G, 'feeds', { enabled: true, intervalMinutes: 5, feeds: [feed] }, {});
  const sent = [];
  const channel = { isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); return { url: 'https://discord.test/m' }; } };
  const guild = { id: G, name: 'Test', memberCount: 3, iconURL: () => null, channels: { cache: new Map([[CH, channel]]) }, members: { me: null } };
  const client = { guilds: { cache: new Map([[G, guild]]) }, ctx: { db, settings } };
  return { db, settings, client, guild, sent, feed: settings.module(G, 'feeds').feeds[0] };
}
const respond = (body) => async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });

test('flux : premier passage silencieux, puis seulement les nouveautés', async () => {
  const { client, guild, sent, feed } = setup();
  feeds.setFetch(respond(RSS([{ id: 'a', title: 'A', date: 'Mon, 05 Jan 2026 10:00:00 GMT' }])));
  const first = await feeds.checkFeed(client, guild, feed);
  assert.deepEqual(first, { posted: 0, initial: true });
  assert.equal(sent.length, 0);

  const again = await feeds.checkFeed(client, guild, feed);
  assert.equal(again.posted, 0);

  feeds.setFetch(respond(RSS([
    { id: 'b', title: 'B', date: 'Tue, 06 Jan 2026 10:00:00 GMT' },
    { id: 'a', title: 'A', date: 'Mon, 05 Jan 2026 10:00:00 GMT' },
  ])));
  const next = await feeds.checkFeed(client, guild, feed);
  assert.equal(next.posted, 1);
  assert.ok(JSON.stringify(sent[0]).includes('exemple.test/b'));

  assert.equal((await feeds.checkFeed(client, guild, feed)).posted, 0, 'pas de doublon');
  feeds.setFetch(null);
});

test('flux : pas plus de 3 publications d’un coup, et mention du rôle', async () => {
  const { client, guild, sent, feed } = setup({ pingRoleId: '888888888888888888' });
  feeds.setFetch(respond(RSS([{ id: 'old', title: 'Old', date: 'Mon, 05 Jan 2026 10:00:00 GMT' }])));
  await feeds.checkFeed(client, guild, feed);
  const many = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) => ({ id, title: id, date: `Tue, 0${i + 6} Jan 2026 10:00:00 GMT` }));
  feeds.setFetch(respond(RSS([...many, { id: 'old', title: 'Old', date: 'Mon, 05 Jan 2026 10:00:00 GMT' }])));
  const r = await feeds.checkFeed(client, guild, feed);
  assert.equal(r.posted, 3);
  assert.ok(String(sent[0].content).includes('<@&888888888888888888>'));
  assert.deepEqual(sent[0].allowedMentions, { roles: ['888888888888888888'] });
  feeds.setFetch(null);
});

test('flux : une erreur réseau est mémorisée pour le dashboard', async () => {
  const { client, guild, feed } = setup();
  feeds.setFetch(async () => ({ ok: false, status: 500, headers: { get: () => null } }));
  await assert.rejects(feeds.checkFeed(client, guild, feed));
  const [st] = feeds.statuses(client, G, [feed]);
  assert.match(st.error, /500/);
  feeds.setFetch(null);
});

test('flux : module déclaré', () => {
  const store = new SettingsStore(openDatabase(':memory:'));
  const cfg = store.module(G, 'feeds');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.intervalMinutes, 15);
  assert.deepEqual(cfg.feeds, []);
});
