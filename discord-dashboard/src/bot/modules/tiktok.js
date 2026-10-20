'use strict';
/**
 * Deux modules TikTok séparés :
 *  - « TikTok · Nouvelles vidéos » : une annonce à chaque nouvelle vidéo postée sur le compte ;
 *  - « TikTok · Lives » : une annonce à chaque nouveau direct.
 * Le premier passage mémorise l'existant sans rien publier. Les sources (non officielles) sont décrites dans lib/tiktok.js.
 */
const tiktok = require('../../lib/tiktok');
const streams = require('./streams');
const { buildMessage } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const SEEN_LIMIT = 100;
const MAX_NEW_PER_CHECK = 3;
const STALE_MS = 3 * 86400000; // une vidéo plus ancienne que ça n'est jamais annoncée (épinglée, republiée…)
const MAX_CHECKS_PER_TICK = 40;
const LIVE_ID = 'tiktok-live';

const db = (client) => client.ctx.db;
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const videoKey = (guildId) => `tiktok:videos:${guildId}`;
const readVideoState = (client, guildId) => { try { return JSON.parse(kvGet(client, videoKey(guildId)) || 'null'); } catch { return null; } };

/* ------------------------------------------------------------------ */
/* Vidéos                                                               */
/* ------------------------------------------------------------------ */
function videoPayload(client, guild, cfg, entry, handle) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const vars = {
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '', memberCount: String(guild.memberCount || 0),
    account: `@${handle}`, title: entry.title || 'Nouvelle vidéo', link: entry.link,
  };
  const payload = buildMessage(cfg.message, vars, general) || { content: `${vars.account} a posté une nouvelle vidéo : ${entry.link}` };
  const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '';
  return {
    ...payload,
    content: [ping, payload.content].filter(Boolean).join(' ') || undefined,
    allowedMentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
  };
}

/** Vérifie le compte et annonce les nouvelles vidéos. Renvoie { posted, initial }. */
async function checkVideos(client, guild, cfg, now = Date.now()) {
  const handle = tiktok.normalizeHandle(cfg.account);
  const state = readVideoState(client, guild.id);
  const save = (extra) => kvSet(client, videoKey(guild.id), JSON.stringify({ seen: state?.seen, source: state?.source || '', ...extra, checkedAt: now }));
  let found;
  try {
    found = await tiktok.lookupVideos(handle, { rsshubUrl: client.ctx.config?.rsshubUrl, feedUrl: cfg.feedUrl });
  } catch (err) {
    save({ error: String(err.message).slice(0, 300) });
    throw err;
  }
  const { entries, source } = found;
  const ids = entries.map((e) => e.id);
  if (!state?.seen) {
    save({ seen: ids.slice(0, SEEN_LIMIT), source, error: '' });
    return { posted: 0, initial: true };
  }

  const known = new Set(state.seen);
  const fresh = entries.filter((e) => !known.has(e.id)).sort((a, b) => a.published - b.published);
  const stale = fresh.filter((e) => e.published && now - e.published > STALE_MS);
  const toPost = fresh.filter((e) => !stale.includes(e)).slice(-MAX_NEW_PER_CHECK);
  const channel = getSendable(guild, cfg.channelId);
  if (!channel && toPost.length) {
    // On ne marque rien comme vu : les vidéos seront annoncées dès que le salon est de nouveau accessible.
    save({ source, error: 'Salon introuvable ou inaccessible.' });
    return { posted: 0, initial: false };
  }

  // Les vidéos anciennes ou au-delà de la limite par passage (rafale) sont marquées vues sans être annoncées ;
  // celles dont l'envoi échoue restent à revoir : elles seront retentées au prochain passage.
  const retry = new Set();
  let posted = 0;
  for (const entry of toPost) {
    if (await safeSend(channel, videoPayload(client, guild, cfg, entry, handle))) posted += 1; else retry.add(entry.id);
  }
  const seen = [...new Set([...ids.filter((id) => !retry.has(id)), ...state.seen])].slice(0, SEEN_LIMIT);
  save({ seen, source, error: retry.size ? 'Discord a refusé le message (permissions manquantes ?).' : '' });
  return { posted, initial: false };
}

/** Bouton « Tester » : envoie la dernière vidéo du compte, sans la marquer comme vue. */
async function testVideo(client, guild, cfg) {
  const handle = tiktok.normalizeHandle(cfg.account);
  const { entries } = await tiktok.lookupVideos(handle, { rsshubUrl: client.ctx.config?.rsshubUrl, feedUrl: cfg.feedUrl });
  const latest = [...entries].sort((a, b) => b.published - a.published)[0];
  if (!latest) throw new Error('Aucune vidéo trouvée sur ce compte (compte privé, vide ou introuvable).');
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) throw new Error('Je ne peux pas écrire dans ce salon.');
  const sent = await safeSend(channel, videoPayload(client, guild, cfg, latest, handle));
  if (!sent) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  return { title: latest.title, url: sent.url };
}

/**
 * Annonce manuelle (commande /tiktok video) : marche même quand les sources automatiques sont bloquées.
 * Le titre vient de l'oEmbed de TikTok si possible, sinon de ce que tu indiques, sinon l'annonce n'a que le lien.
 */
async function announceVideo(client, guild, cfg, { link, title = '' }) {
  const parsed = tiktok.parseVideoLink(link);
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) throw new Error('Choisis d’abord le salon des annonces dans le module « TikTok · Nouvelles vidéos » (je dois pouvoir y écrire).');
  const info = title ? { title: '', author: '' } : await tiktok.videoTitle(parsed.url);
  const handle = parsed.handle || info.author || (() => { try { return tiktok.normalizeHandle(cfg.account); } catch { return ''; } })();
  const entry = { title: String(title || info.title || '').replace(/\s+/g, ' ').trim().slice(0, 200), link: parsed.url };
  const sent = await safeSend(channel, videoPayload(client, guild, cfg, entry, handle || 'tiktok'));
  if (!sent) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  if (parsed.id) {
    // La vidéo annoncée à la main ne sera pas annoncée une seconde fois par la surveillance automatique.
    const state = readVideoState(client, guild.id);
    if (state?.seen && !state.seen.includes(parsed.id)) kvSet(client, videoKey(guild.id), JSON.stringify({ ...state, seen: [parsed.id, ...state.seen].slice(0, SEEN_LIMIT) }));
  }
  return { url: sent.url, title: entry.title };
}

/** Annonce manuelle d'un live (commande /tiktok live). */
async function announceLive(client, guild, cfg, { title = '' }) {
  const handle = tiktok.normalizeHandle(cfg.account);
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) throw new Error('Choisis d’abord le salon des annonces dans le module « TikTok · Lives » (je dois pouvoir y écrire).');
  const general = client.ctx.settings.module(guild.id, 'general');
  const url = `https://www.tiktok.com/@${handle}/live`;
  const vars = {
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '', memberCount: String(guild.memberCount || 0),
    streamer: `@${handle}`, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Direct en cours', game: '', url, platform: 'TikTok', viewers: '0',
  };
  const payload = buildMessage(cfg.message, vars, general) || { content: `${vars.streamer} est en direct : ${url}` };
  const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '';
  const sent = await safeSend(channel, {
    ...payload,
    content: [ping, payload.content].filter(Boolean).join(' ') || undefined,
    allowedMentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
  });
  if (!sent) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  return { url: sent.url };
}

function videoStatus(client, guildId) {
  const s = readVideoState(client, guildId);
  return { checkedAt: s?.checkedAt || 0, error: s?.error || '', source: s?.source || '', initialized: Boolean(s?.seen) };
}

async function tickVideos(client) {
  let budget = MAX_CHECKS_PER_TICK;
  for (const guild of client.guilds.cache.values()) {
    if (budget <= 0) return;
    const cfg = client.ctx.settings.module(guild.id, 'tiktokvideos');
    if (!cfg.enabled || !cfg.account || !cfg.channelId) continue;
    const s = readVideoState(client, guild.id);
    if (s && Date.now() - (s.checkedAt || 0) < cfg.intervalMinutes * 60000) continue;
    budget -= 1;
    try { await checkVideos(client, guild, cfg); } catch (err) { console.warn(`[tiktok vidéos] ${guild.id}: ${err.message}`); }
  }
}

/* ------------------------------------------------------------------ */
/* Lives                                                                */
/* ------------------------------------------------------------------ */
/** Le compte du module, au format attendu par le moteur d'alertes de lives. */
const liveItem = (cfg) => ({ id: LIVE_ID, platform: 'tiktok', handle: cfg.account, channelId: cfg.channelId, pingRoleId: cfg.pingRoleId, message: cfg.message });

function liveStatus(client, guildId, cfg) {
  const s = streams.statuses(client, guildId, [liveItem(cfg)])[0];
  return { live: s.live, title: s.title, checkedAt: s.checkedAt, error: s.error };
}

/** Bouton « Tester » : s'il est en direct, envoie l'annonce maintenant ; sinon explique que rien n'est en cours. */
async function testLive(client, guild, cfg) {
  tiktok.normalizeHandle(cfg.account); // message d'erreur clair si le compte est vide ou invalide
  return streams.testStreamer(client, guild, liveItem(cfg));
}

async function tickLive(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = client.ctx.settings.module(guild.id, 'tiktoklive');
    if (!cfg.enabled || !cfg.account || !cfg.channelId) continue;
    const item = liveItem(cfg);
    const s = streams.statuses(client, guild.id, [item])[0];
    if (s.checkedAt && Date.now() - s.checkedAt < cfg.intervalMinutes * 60000) continue;
    try { await streams.checkOne(client, guild, item, cfg.cooldownMinutes * 60000); } catch (err) { console.warn(`[tiktok lives] ${guild.id}: ${err.message}`); }
  }
}

module.exports = { checkVideos, testVideo, announceVideo, announceLive, videoStatus, tickVideos, liveItem, liveStatus, testLive, tickLive, STALE_MS, LIVE_ID };
