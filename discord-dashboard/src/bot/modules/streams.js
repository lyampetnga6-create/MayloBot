'use strict';
/**
 * Alertes de lives : Twitch, Kick, YouTube et TikTok.
 *
 * - Twitch et Kick passent par leurs API officielles (application gratuite : identifiant + secret dans les variables d'environnement).
 * - YouTube est lu sur la page publique « /live » de la chaîne : aucune clé nécessaire.
 * - TikTok n'a aucune API publique : la vérification lit la page du profil et peut être bloquée par TikTok (expérimental).
 * Le premier passage mémorise l'état sans rien publier ; ensuite chaque nouveau direct déclenche une seule alerte.
 */
const feeds = require('./feeds');
const tiktok = require('../../lib/tiktok');
const { buildMessage, applyPing } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const TIMEOUT_MS = 8000;
const MAX_CHECKS_PER_TICK = 60;
const CONCURRENCY = 5;
const END_CONFIRM_CHECKS = 2; // le direct doit être vu « hors ligne » deux fois de suite avant d'être considéré comme terminé
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PLATFORM_LABELS = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', tiktok: 'TikTok' };

const db = (client) => client.ctx.db;
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const stateKey = (guildId, id) => `live:${guildId}:${id}`;
const readState = (client, guildId, id) => { try { return JSON.parse(kvGet(client, stateKey(guildId, id)) || 'null'); } catch { return null; } };

let fetchImpl = (...args) => fetch(...args);
/** Pour les tests : remplace `fetch`. */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); tiktok.setFetch(fn); }

/** Appel HTTP vers une API (adresses fixes, jamais saisies par un utilisateur). */
async function http(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetchImpl(url, { method, headers: { 'user-agent': BROWSER_UA, accept: 'application/json', ...headers }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let json = null;
  try { json = await res.json(); } catch { /* corps vide ou non JSON */ }
  return { status: res.status, ok: res.ok, json };
}

/* ------------------------------------------------------------------ */
/* Noms de chaînes                                                      */
/* ------------------------------------------------------------------ */
/** Extrait un nom propre depuis ce que l'utilisateur a saisi (nom, @nom ou lien). Lève une erreur en français. */
function normalizeHandle(platform, input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Indique le nom de la chaîne.');
  if (platform === 'twitch') {
    const h = (text.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})/i)?.[1] || text.replace(/^@/, ''));
    if (!/^[A-Za-z0-9_]{3,25}$/.test(h)) throw new Error('Nom Twitch invalide (3 à 25 lettres, chiffres ou _).');
    return h.toLowerCase();
  }
  if (platform === 'kick') {
    const h = (text.match(/kick\.com\/([A-Za-z0-9_-]{2,50})/i)?.[1] || text.replace(/^@/, ''));
    if (!/^[A-Za-z0-9_-]{2,50}$/.test(h)) throw new Error('Nom Kick invalide.');
    return h.toLowerCase();
  }
  if (platform === 'tiktok') {
    const h = (text.match(/tiktok\.com\/@([\w.]{1,40})/i)?.[1] || text.replace(/^@/, ''));
    if (!/^[\w.]{1,40}$/.test(h)) throw new Error('Nom TikTok invalide (ex. @moncompte).');
    return h.toLowerCase();
  }
  if (platform === 'youtube') return text; // résolu plus tard (lien de chaîne ou identifiant UC…)
  throw new Error('Plateforme inconnue.');
}

/* ------------------------------------------------------------------ */
/* Twitch                                                               */
/* ------------------------------------------------------------------ */
let twitchToken = { value: '', exp: 0 };

async function getTwitchToken(cfg, force = false) {
  if (!cfg.twitchClientId || !cfg.twitchClientSecret) throw new Error('Twitch n’est pas configuré : ajoute TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans Railway.');
  if (!force && twitchToken.value && Date.now() < twitchToken.exp) return twitchToken.value;
  const body = new URLSearchParams({ client_id: cfg.twitchClientId, client_secret: cfg.twitchClientSecret, grant_type: 'client_credentials' });
  const r = await http('https://id.twitch.tv/oauth2/token', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!r.ok || !r.json?.access_token) throw new Error('Twitch a refusé les identifiants (vérifie TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET).');
  twitchToken = { value: r.json.access_token, exp: Date.now() + Math.max(60, (r.json.expires_in || 3600) - 120) * 1000 };
  return twitchToken.value;
}

const twitchAvatars = new Map(); // login → { url, exp } : la photo de profil change rarement, un appel toutes les 6 h suffit

async function twitchAvatar(login, token, clientId) {
  const hit = twitchAvatars.get(login);
  if (hit && Date.now() < hit.exp) return hit.url;
  try {
    const r = await http(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers: { 'client-id': clientId, authorization: `Bearer ${token}` } });
    const url = r.ok && /^https:\/\//.test(r.json?.data?.[0]?.profile_image_url || '') ? r.json.data[0].profile_image_url : '';
    twitchAvatars.set(login, { url, exp: Date.now() + 6 * 3600000 });
    return url;
  } catch { return ''; } // la photo est facultative : jamais d'erreur
}

async function checkTwitch(client, item) {
  const cfg = client.ctx.config?.streams || {};
  const login = normalizeHandle('twitch', item.handle);
  let r;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getTwitchToken(cfg, attempt > 0);
    r = await http(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, { headers: { 'client-id': cfg.twitchClientId, authorization: `Bearer ${token}` } });
    if (r.status !== 401) break;
  }
  if (!r.ok) throw new Error(`Twitch a répondu ${r.status}.`);
  const s = (r.json?.data || []).find((x) => x.type === 'live');
  const url = `https://www.twitch.tv/${login}`;
  if (!s) return { live: false, url, streamer: login };
  const avatar = await twitchAvatar(login, twitchToken.value, cfg.twitchClientId);
  return {
    avatar,
    live: true, session: String(s.id), streamer: s.user_name || login, title: s.title || '', game: s.game_name || '',
    viewers: Number(s.viewer_count) || 0, url,
    cover: typeof s.thumbnail_url === 'string' ? `${s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Math.floor(Date.now() / 60000)}` : '',
  };
}

/* ------------------------------------------------------------------ */
/* Kick                                                                 */
/* ------------------------------------------------------------------ */
let kickToken = { value: '', exp: 0 };

async function getKickToken(cfg, force = false) {
  if (!cfg.kickClientId || !cfg.kickClientSecret) throw new Error('Kick n’est pas configuré : ajoute KICK_CLIENT_ID et KICK_CLIENT_SECRET dans Railway.');
  if (!force && kickToken.value && Date.now() < kickToken.exp) return kickToken.value;
  const body = new URLSearchParams({ client_id: cfg.kickClientId, client_secret: cfg.kickClientSecret, grant_type: 'client_credentials' });
  const r = await http('https://id.kick.com/oauth/token', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!r.ok || !r.json?.access_token) throw new Error('Kick a refusé les identifiants (vérifie KICK_CLIENT_ID et KICK_CLIENT_SECRET).');
  kickToken = { value: r.json.access_token, exp: Date.now() + Math.max(60, (r.json.expires_in || 3600) - 120) * 1000 };
  return kickToken.value;
}

async function checkKick(client, item) {
  const cfg = client.ctx.config?.streams || {};
  const slug = normalizeHandle('kick', item.handle);
  let r;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getKickToken(cfg, attempt > 0);
    r = await http(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 401) break;
  }
  if (r.status === 403) throw new Error('Kick a bloqué la requête (403). Réessaie plus tard : Kick limite parfois les serveurs.');
  if (!r.ok) throw new Error(`Kick a répondu ${r.status}.`);
  const c = r.json?.data?.[0];
  if (!c) throw new Error('Chaîne Kick introuvable.');
  const url = `https://kick.com/${slug}`;
  if (!c.stream?.is_live) return { live: false, url, streamer: c.slug || slug };
  return {
    live: true, session: String(c.stream.start_time || 'live'), streamer: c.slug || slug, title: c.stream_title || '',
    game: c.category?.name || '', viewers: Number(c.stream.viewer_count) || 0, url,
    cover: /^https:\/\//.test(c.stream.thumbnail || '') ? c.stream.thumbnail : '',
    avatar: /^https:\/\//.test(c.profile_picture || '') ? c.profile_picture : '',
  };
}

/* ------------------------------------------------------------------ */
/* YouTube (page publique /live, sans clé)                              */
/* ------------------------------------------------------------------ */
const ytCache = new Map();

/** Lit la page « /live » d'une chaîne. Renvoie { live, videoId, title } (fonction pure, testée). */
function parseYoutubeLive(html) {
  const text = String(html || '');
  const canonical = text.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/i)?.[1];
  const live = Boolean(canonical) && /"isLiveNow"\s*:\s*true/.test(text);
  if (!live) return { live: false };
  const title = feeds.decode(text.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] || '');
  return { live: true, videoId: canonical, title };
}

async function checkYoutube(client, item) {
  const feedUrl = await feeds.youtubeFeedUrl(item.handle, { cache: ytCache });
  const id = feedUrl.match(/channel_id=(UC[\w-]{22})/)?.[1];
  if (!id) throw new Error('Chaîne YouTube introuvable.');
  const html = await feeds.fetchText(`https://www.youtube.com/channel/${id}/live`, {
    maxBytes: 3_000_000, truncate: true,
    headers: { 'user-agent': BROWSER_UA, cookie: 'SOCS=CAI; CONSENT=YES+1', 'accept-language': 'fr-FR,fr;q=0.9' },
  });
  const r = parseYoutubeLive(html);
  const channelUrl = `https://www.youtube.com/channel/${id}`;
  if (!r.live) return { live: false, url: channelUrl, streamer: item.handle };
  const author = feeds.decode(html.match(/"ownerChannelName"\s*:\s*"([^"]*)"/)?.[1] || '');
  return { live: true, session: r.videoId, streamer: author || item.handle, title: r.title, game: '', viewers: 0, url: `https://www.youtube.com/watch?v=${r.videoId}`, cover: `https://i.ytimg.com/vi/${r.videoId}/hqdefault_live.jpg` };
}

/* ------------------------------------------------------------------ */
/* TikTok (expérimental : pas d'API publique)                           */
/* ------------------------------------------------------------------ */
/** Cherche l'état « en direct » dans la page d'un profil TikTok (voir lib/tiktok.js). */
const parseTiktokProfile = tiktok.parseProfilePage;

async function checkTiktok(client, item) {
  const handle = normalizeHandle('tiktok', item.handle);
  const r = await tiktok.lookupLive(handle);
  const url = `https://www.tiktok.com/@${handle}/live`;
  if (!r.live) return { live: false, url, streamer: r.nickname || handle, avatar: r.avatar || '' };
  return {
    live: true, session: r.roomId, streamer: r.nickname || handle, title: r.title || 'Direct TikTok', game: '', viewers: r.viewers || 0, url,
    totalViewers: r.totalViewers || 0, avatar: r.avatar || '', cover: r.cover || '',
  };
}

const CHECKERS = { twitch: checkTwitch, kick: checkKick, youtube: checkYoutube, tiktok: checkTiktok };

/** Interroge la plateforme. Renvoie { live, session, streamer, title, game, viewers, url }. */
function checkStreamer(client, item) {
  const fn = CHECKERS[item.platform];
  if (!fn) return Promise.reject(new Error('Plateforme inconnue.'));
  return fn(client, item);
}

/* ------------------------------------------------------------------ */
/* Logique d'alerte (fonction pure, testée)                             */
/* ------------------------------------------------------------------ */
/**
 * Compare l'état mémorisé au résultat. Renvoie { notify, next }.
 * - premier passage (ou premier passage après une erreur) : on mémorise sans alerter ;
 * - alerte quand le streamer passe de « hors ligne » à « en direct » (ou change de session), hors délai de pause.
 */
function decide(prev, result, now, cooldownMs) {
  const next = { seen: true, live: result.live, session: result.live ? (result.session || '') : (prev?.session || ''), lastNotified: prev?.lastNotified || 0, checkedAt: now, error: '' };
  if (!prev?.seen) return { notify: false, next };
  const newSession = result.live && (!prev.live || Boolean(result.session && prev.session && result.session !== prev.session));
  const notify = newSession && (!prev.lastNotified || now - prev.lastNotified >= cooldownMs);
  if (notify) next.lastNotified = now;
  return { notify, next };
}

/* ------------------------------------------------------------------ */
/* Suivi d'un direct (spectateurs max, durée) – fonctions pures, testées */
/* ------------------------------------------------------------------ */
/** Durée lisible : « 2 h 15 min », « 45 min », « moins d'une minute ». */
function formatDuration(ms) {
  const min = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  if (min < 1) return 'moins d’une minute';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/** Instantané d'un direct, gardé en mémoire pour pouvoir écrire le récapitulatif quand il se termine. */
function snapshot(result, item) {
  return {
    streamer: result.streamer || item.handle || '', title: result.title || '', game: result.game || '', url: result.url || '',
    avatar: result.avatar || '', cover: result.cover || '',
  };
}

function newRun(result, item, now, sent = null) {
  const viewers = Number(result.viewers) || 0;
  return {
    session: result.session || '', startedAt: now, last: viewers, max: viewers, total: Number(result.totalViewers) || 0,
    messageId: sent?.id || '', channelId: sent?.channelId || sent?.channel?.id || '', ...snapshot(result, item),
  };
}

/** Met à jour le suivi avec un nouveau relevé : max de spectateurs, total (si la plateforme le donne), titre, jeu. */
function trackRun(run, result, item) {
  const viewers = Number(result.viewers) || 0;
  const snap = snapshot(result, item);
  return {
    ...run,
    last: viewers, max: Math.max(run.max || 0, viewers), total: Math.max(run.total || 0, Number(result.totalViewers) || 0),
    streamer: snap.streamer || run.streamer, title: snap.title || run.title, game: snap.game || run.game, url: snap.url || run.url,
    avatar: snap.avatar || run.avatar, cover: snap.cover || run.cover,
  };
}

/* ------------------------------------------------------------------ */
/* Publication                                                          */
/* ------------------------------------------------------------------ */
function liveVars(client, guild, item, info) {
  const num = (n) => (Number(n) > 0 ? String(Math.round(Number(n))) : '');
  return {
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '', memberCount: String(guild.memberCount || 0),
    streamer: info.streamer || item.handle, title: info.title || 'Direct en cours', game: info.game || '', url: info.url || '',
    platform: PLATFORM_LABELS[item.platform] || item.platform,
    viewers: String(info.viewers ?? info.last ?? 0),
    maxViewers: String(info.maxViewers ?? info.max ?? 0),
    totalViewers: num(info.totalViewers ?? info.total), // vide si la plateforme ne le donne pas → le champ disparaît du message
    duration: info.duration || '', avatar: info.avatar || '', cover: info.cover || '',
  };
}

function alertPayload(client, guild, item, result) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const vars = liveVars(client, guild, item, result);
  const payload = buildMessage(item.message, vars, general) || { content: `${vars.streamer} est en direct : ${vars.url}` };
  return applyPing(payload, item);
}

/** Récapitulatif de fin de direct (message « terminé »). */
function endPayload(client, guild, item, run, now) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const vars = liveVars(client, guild, item, { ...run, viewers: run.last, maxViewers: run.max, totalViewers: run.total, duration: formatDuration(now - run.startedAt) });
  return buildMessage(item.endMessage, vars, general) || { content: `Le live de ${vars.streamer} est terminé.` };
}

/**
 * Le direct est fini : selon le réglage, on transforme l'annonce d'origine en récapitulatif (« edit »),
 * on envoie un nouveau message (« send ») ou on ne fait rien (« off »). Ne lève jamais d'erreur.
 */
async function finishRun(client, guild, item, run, now = Date.now()) {
  const mode = item.endMode || 'edit';
  if (mode === 'off' || !run?.messageId || !run.channelId) return false;
  try {
    const payload = endPayload(client, guild, item, run, now);
    const channel = getSendable(guild, run.channelId);
    if (!channel) return false;
    if (mode === 'send') return Boolean(await safeSend(channel, { ...payload, allowedMentions: { parse: [] } }));
    const message = await channel.messages.fetch(run.messageId);
    await message.edit({ content: payload.content ?? '', embeds: payload.embeds ?? [], components: payload.components ?? [], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.warn(`[lives] fin de direct ${guild.id}/${item.platform}:${item.handle}: ${err.message}`);
    return false;
  }
}

/** Pendant le direct : met à jour l'annonce d'origine (spectateurs, titre, jeu, image) quand quelque chose a changé. Ne lève jamais d'erreur. */
async function refreshLive(client, guild, item, run, result) {
  const sig = [result.viewers, result.title, result.game, result.cover].join('|');
  if (!run?.messageId || !run.channelId || run.sig === sig) return run;
  try {
    const channel = getSendable(guild, run.channelId);
    const message = channel && await channel.messages.fetch(run.messageId);
    if (!message) return run;
    const p = alertPayload(client, guild, item, { ...result, viewers: result.viewers });
    await message.edit({ content: p.content ?? '', embeds: p.embeds ?? [], components: p.components ?? [], allowedMentions: { parse: [] } });
    return { ...run, sig };
  } catch (err) {
    console.warn(`[lives] mise à jour ${guild.id}/${item.platform}:${item.handle}: ${err.message}`);
    return run;
  }
}

/** Vérifie un streamer, publie l'alerte si besoin et écrit le récapitulatif quand le direct se termine. Renvoie { notified, live, ended }. */
async function checkOne(client, guild, item, cooldownMs) {
  const key = stateKey(guild.id, item.id);
  const prev = readState(client, guild.id, item.id);
  let result;
  try {
    result = await checkStreamer(client, item);
  } catch (err) {
    kvSet(client, key, JSON.stringify({ ...(prev || {}), checkedAt: Date.now(), error: String(err.message).slice(0, 200) }));
    throw err;
  }
  const now = Date.now();
  let run = prev?.run || null;
  let seen = result; // ce que « decide » voit
  let ending = null;
  let offlineStreak = 0;

  if (!result.live && run) {
    offlineStreak = (prev.offlineStreak || 0) + 1;
    if (offlineStreak >= END_CONFIRM_CHECKS) { ending = run; run = null; offlineStreak = 0; }
    else seen = { ...result, live: true, session: run.session, viewers: run.last }; // une coupure d'un seul relevé ne termine pas le direct
  } else if (result.live && run && result.session && run.session && result.session !== run.session) {
    ending = run; run = null; // nouveau direct sans avoir vu l'autre se terminer
  }

  const { notify, next } = decide(prev, seen, now, cooldownMs);
  if (notify) {
    const channel = getSendable(guild, item.channelId);
    const sent = await safeSend(channel, alertPayload(client, guild, item, result));
    if (!sent) next.error = 'Salon introuvable ou inaccessible.';
    run = { ...newRun(result, item, now, sent), sig: [result.viewers, result.title, result.game, result.cover].join('|') };
  } else if (seen.live) {
    run = run ? trackRun(run, seen.live && seen === result ? result : { ...seen, streamer: run.streamer, title: run.title, game: run.game, url: run.url }, item) : newRun(result, item, now);
  }

  if (!notify && result.live && run?.messageId && item.liveUpdate !== false) run = await refreshLive(client, guild, item, run, result);

  let ended = false;
  if (ending) ended = await finishRun(client, guild, item, ending, now);

  next.title = result.title || prev?.title || '';
  next.run = run;
  next.offlineStreak = offlineStreak;
  kvSet(client, key, JSON.stringify(next));
  return { notified: notify, live: seen.live, ended };
}

/** Bouton « Tester » : s'il est en direct, envoie l'alerte maintenant ; sinon explique que rien n'est en cours. */
async function testStreamer(client, guild, item) {
  const result = await checkStreamer(client, item);
  if (!result.live) return { live: false };
  const channel = getSendable(guild, item.channelId);
  if (!channel) throw new Error('Je ne peux pas écrire dans ce salon.');
  const sent = await safeSend(channel, alertPayload(client, guild, item, result));
  if (!sent) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  return { live: true, url: sent.url };
}

function statuses(client, guildId, items) {
  return items.map((i) => {
    const s = readState(client, guildId, i.id);
    return { id: i.id, live: Boolean(s?.live), title: s?.title || '', checkedAt: s?.checkedAt || 0, error: s?.error || '' };
  });
}

/** Quelles plateformes sont prêtes à fonctionner ? */
function credentials(client) {
  const c = client.ctx.config?.streams || {};
  return { twitch: Boolean(c.twitchClientId && c.twitchClientSecret), kick: Boolean(c.kickClientId && c.kickClientSecret) };
}

async function tick(client) {
  const due = [];
  for (const guild of client.guilds.cache.values()) {
    const cfg = client.ctx.settings.module(guild.id, 'streams');
    if (!cfg.enabled || !cfg.streamers.length) continue;
    for (const item of cfg.streamers) {
      if (!item.handle || !item.channelId) continue;
      const s = readState(client, guild.id, item.id);
      if (s && Date.now() - (s.checkedAt || 0) < cfg.intervalMinutes * 60000) continue;
      due.push({ guild, item, cooldownMs: cfg.cooldownMinutes * 60000 });
    }
  }
  const batch = due.slice(0, MAX_CHECKS_PER_TICK);
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(async ({ guild, item, cooldownMs }) => {
      try { await checkOne(client, guild, item, cooldownMs); } catch (err) { console.warn(`[lives] ${guild.id}/${item.platform}:${item.handle}: ${err.message}`); }
    }));
  }
}

module.exports = {
  PLATFORM_LABELS, setFetch, normalizeHandle, parseYoutubeLive, parseTiktokProfile, decide,
  formatDuration, alertPayload, liveVars, refreshLive, trackRun, newRun, endPayload, finishRun, checkStreamer, checkOne, testStreamer, statuses, credentials, tick,
};
