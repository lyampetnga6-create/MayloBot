'use strict';
/**
 * Flux RSS / Atom et chaînes YouTube : les nouveautés sont publiées dans un salon.
 *
 * - Aucune clé d'API : YouTube fournit un flux Atom public pour chaque chaîne.
 * - Le premier passage mémorise les publications existantes sans rien poster (pas de rafale).
 * - Les adresses sont vérifiées : http(s) uniquement, jamais d'adresse privée (anti-SSRF), taille et durée bornées.
 */
const dns = require('node:dns').promises;
const net = require('node:net');
const { buildMessage } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_NEW_PER_CHECK = 3;
const MAX_CHECKS_PER_TICK = 40;
const SEEN_LIMIT = 100;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

const db = (client) => client.ctx.db;
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const stateKey = (guildId, feedId) => `feed:${guildId}:${feedId}`;

/* ------------------------------------------------------------------ */
/* Sécurité réseau                                                      */
/* ------------------------------------------------------------------ */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  return true;
}

/** Lève une erreur si l'adresse n'est pas un site public en http(s). Renvoie l'URL analysée. */
async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('Adresse invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Seules les adresses http et https sont acceptées.');
  if (url.username || url.password) throw new Error('Les adresses avec identifiants ne sont pas acceptées.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Cette adresse n’est pas publique.');
    return url;
  }
  let addresses;
  try { addresses = await dns.lookup(host, { all: true }); } catch { throw new Error('Site introuvable.'); }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Cette adresse n’est pas publique.');
  return url;
}

let fetchImpl = (...args) => fetch(...args);
/** Pour les tests : remplace `fetch`. */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

/** Télécharge un texte (taille et durée bornées, redirections revérifiées). */
async function fetchText(raw, opts = {}) {
  let url = await assertPublicUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; DiscordFeedBot/1.0)', accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5', ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`Le site a répondu ${res.status}.`);
    const limit = opts.maxBytes || MAX_BYTES;
    const reader = res.body?.getReader?.();
    if (!reader) return (await res.text()).slice(0, limit);
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
      if (size > limit) {
        await reader.cancel().catch(() => {});
        if (opts.truncate) break; // pages HTML : le début suffit
        throw new Error('Le flux est trop volumineux.');
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Trop de redirections.');
}

/* ------------------------------------------------------------------ */
/* Lecture RSS / Atom                                                   */
/* ------------------------------------------------------------------ */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(text) {
  return String(text ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

function entryLink(block) {
  const hrefs = [...block.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]);
  const alt = hrefs.find((a) => /rel=["']alternate["']/i.test(a)) || hrefs.find((a) => /href=/i.test(a) && !/rel=["'](?:self|enclosure|replies)["']/i.test(a));
  const href = alt?.match(/href=["']([^"']+)["']/i)?.[1];
  if (href) return decode(href);
  return tag(block, 'link');
}

/** Lit un flux RSS 2.0 ou Atom. Renvoie { title, entries: [{ id, title, link, author, published }] }. */
function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  if (!blocks.length && !/<(rss|feed|rdf:RDF)\b/i.test(text)) throw new Error('Ce n’est pas un flux RSS ou Atom.');
  const head = text.replace(/<(item|entry)\b[\s\S]*?<\/\1>/gi, '');
  const entries = blocks.map((b) => {
    const link = entryLink(b);
    const author = tag(b, 'name') || tag(b, 'dc:creator') || tag(b, 'author');
    const published = Date.parse(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')) || 0;
    return { id: tag(b, 'guid') || tag(b, 'id') || link, title: tag(b, 'title') || 'Sans titre', link, author, published };
  }).filter((e) => e.id);
  return { title: tag(head, 'title'), entries };
}

/* ------------------------------------------------------------------ */
/* YouTube                                                              */
/* ------------------------------------------------------------------ */
const CHANNEL_ID = /UC[0-9A-Za-z_-]{22}/;

/** Adresse du flux Atom d'une chaîne YouTube (identifiant UC…, /channel/UC…, ou page @nom). */
async function youtubeFeedUrl(input, { cache } = {}) {
  const text = String(input || '').trim();
  const direct = text.match(CHANNEL_ID)?.[0];
  if (direct && (/^UC/.test(text) || /youtube\.com\/channel\//i.test(text) || /channel_id=/.test(text))) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${direct}`;
  }
  let page;
  try { page = new URL(text.startsWith('@') ? `https://www.youtube.com/${text}` : text); } catch { throw new Error('Adresse de chaîne YouTube invalide.'); }
  if (!YT_HOSTS.has(page.hostname.toLowerCase())) throw new Error('Colle l’adresse d’une chaîne YouTube (youtube.com/@nom).');
  const cached = cache?.get(page.toString());
  if (cached) return cached;
  const html = await fetchText(page.toString());
  const id = html.match(/channel_id=(UC[0-9A-Za-z_-]{22})/)?.[1] || html.match(/"(?:channelId|externalId)":"(UC[0-9A-Za-z_-]{22})"/)?.[1];
  if (!id) throw new Error('Chaîne YouTube introuvable à cette adresse.');
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  cache?.set(page.toString(), url);
  return url;
}

/** Adresse du flux RSS des vidéos d'un compte TikTok, via une instance RSSHub (TikTok n'offre pas de flux officiel). */
function tiktokFeedUrl(input, base = 'https://rsshub.app') {
  const text = String(input || '').trim();
  const handle = (text.match(/tiktok\.com\/@([\w.]{1,40})/i)?.[1] || text.replace(/^@/, '')).trim();
  if (!/^[\w.]{1,40}$/.test(handle)) throw new Error('Nom de compte TikTok invalide (ex. @moncompte).');
  return `${String(base || 'https://rsshub.app').replace(/\/+$/, '')}/tiktok/user/@${handle}`;
}

const ytCache = new Map();
const resolveUrl = (client, feed) => {
  if (feed.type === 'youtube') return youtubeFeedUrl(feed.url, { cache: ytCache });
  if (feed.type === 'tiktok') return Promise.resolve(tiktokFeedUrl(feed.url, client.ctx.config?.rsshubUrl));
  return Promise.resolve(feed.url);
};

/* ------------------------------------------------------------------ */
/* Publication                                                          */
/* ------------------------------------------------------------------ */
function messageFor(client, guild, feed, entry, feedTitle) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const vars = {
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '', memberCount: String(guild.memberCount || 0),
    title: entry.title, link: entry.link, author: entry.author || feedTitle || feed.name || '', feed: feed.name || feedTitle || '',
  };
  const payload = buildMessage(feed.message, vars, general) || { content: `${entry.title}\n${entry.link}` };
  const ping = feed.pingRoleId ? `<@&${feed.pingRoleId}>` : '';
  return {
    ...payload,
    content: [ping, payload.content].filter(Boolean).join(' ') || undefined,
    allowedMentions: feed.pingRoleId ? { roles: [feed.pingRoleId] } : { parse: [] },
  };
}

const readState = (client, guildId, feedId) => {
  try { return JSON.parse(kvGet(client, stateKey(guildId, feedId)) || 'null'); } catch { return null; }
};

/** Vérifie un flux et publie les nouveautés. Renvoie { posted, initial }. */
async function checkFeed(client, guild, feed) {
  const key = stateKey(guild.id, feed.id);
  const state = readState(client, guild.id, feed.id);
  try {
    const parsed = parseFeed(await fetchText(await resolveUrl(client, feed)));
    const ids = parsed.entries.map((e) => e.id);
    if (!state?.seen) {
      kvSet(client, key, JSON.stringify({ seen: ids.slice(0, SEEN_LIMIT), checkedAt: Date.now(), error: '' }));
      return { posted: 0, initial: true };
    }
    const known = new Set(state.seen);
    const fresh = parsed.entries.filter((e) => !known.has(e.id));
    fresh.sort((a, b) => a.published - b.published);
    const toPost = fresh.slice(-MAX_NEW_PER_CHECK);
    let posted = 0;
    const channel = getSendable(guild, feed.channelId);
    for (const entry of toPost) {
      if (await safeSend(channel, messageFor(client, guild, feed, entry, parsed.title))) posted += 1;
    }
    const seen = [...new Set([...ids, ...state.seen])].slice(0, SEEN_LIMIT);
    kvSet(client, key, JSON.stringify({ seen, checkedAt: Date.now(), error: channel ? '' : 'Salon introuvable ou inaccessible.' }));
    return { posted, initial: false };
  } catch (err) {
    kvSet(client, key, JSON.stringify({ seen: state?.seen, checkedAt: Date.now(), error: String(err.message).slice(0, 200) }));
    throw err;
  }
}

/** Bouton « Tester » du dashboard : envoie la dernière publication, sans la marquer comme vue. */
async function testFeed(client, guild, feed) {
  const parsed = parseFeed(await fetchText(await resolveUrl(client, feed)));
  const latest = [...parsed.entries].sort((a, b) => b.published - a.published)[0];
  if (!latest) throw new Error('Le flux est vide.');
  const channel = getSendable(guild, feed.channelId);
  if (!channel) throw new Error('Je ne peux pas écrire dans ce salon.');
  const sent = await safeSend(channel, messageFor(client, guild, feed, latest, parsed.title));
  if (!sent) throw new Error('Envoi refusé par Discord.');
  return { title: latest.title, url: sent.url };
}

/** Dernier état connu de chaque flux (pour le dashboard). */
function statuses(client, guildId, feeds) {
  return feeds.map((f) => {
    const s = readState(client, guildId, f.id);
    return { id: f.id, checkedAt: s?.checkedAt || 0, error: s?.error || '', initialized: Boolean(s?.seen) };
  });
}

async function tick(client) {
  let budget = MAX_CHECKS_PER_TICK;
  for (const guild of client.guilds.cache.values()) {
    const cfg = client.ctx.settings.module(guild.id, 'feeds');
    if (!cfg.enabled || !cfg.feeds.length) continue;
    for (const feed of cfg.feeds) {
      if (budget <= 0) return;
      if (!feed.url || !feed.channelId) continue;
      const s = readState(client, guild.id, feed.id);
      if (s && Date.now() - (s.checkedAt || 0) < cfg.intervalMinutes * 60000) continue;
      budget -= 1;
      try { await checkFeed(client, guild, feed); } catch (err) { console.warn(`[flux] ${guild.id}/${feed.name || feed.id}: ${err.message}`); }
    }
  }
}

module.exports = {
  isPrivateAddress, assertPublicUrl, fetchText, setFetch, decode, parseFeed, youtubeFeedUrl, tiktokFeedUrl,
  checkFeed, testFeed, statuses, tick,
};
