'use strict';
/**
 * Lecture publique de TikTok : vidéos d'un compte et état « en direct ».
 *
 * TikTok n'offre aucune API publique pour cela : le bot s'appuie sur des sources non officielles, essayées l'une après l'autre.
 *  - Lives : l'API web « room » de TikTok, puis la page du profil en secours.
 *  - Vidéos : un service public tiers (tikwm.com), puis une instance RSSHub en secours (ou en premier si RSSHUB_URL est défini).
 * Toutes ces sources peuvent être bloquées ou changer sans prévenir : les erreurs sont donc claires et jamais fatales.
 * Les adresses interrogées sont fixes (jamais saisies par un utilisateur), sauf RSSHUB_URL qui vient de la configuration.
 */
const feedsLib = require('../bot/modules/feeds');
const { parseFeed } = feedsLib;

const TIMEOUT_MS = 9000;
const MAX_BYTES = 2_500_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DEFAULT_RSSHUB = 'https://rsshub.app';

let fetchImpl = (...args) => fetch(...args);
/** Pour les tests : remplace `fetch`. */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

/** Nom de compte propre (sans @, sans lien), en minuscules. Lève une erreur en français. */
function normalizeHandle(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Indique ton compte TikTok (ex. @moncompte).');
  const h = text.match(/tiktok\.com\/@([\w.]{1,40})/i)?.[1] || text.replace(/^@/, '');
  if (!/^[\w.]{1,40}$/.test(h)) throw new Error('Nom de compte TikTok invalide (ex. @moncompte).');
  return h.toLowerCase();
}

async function fetchRaw(url, { headers = {} } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'fr-FR,fr;q=0.9', ...headers },
    });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'Le site n’a pas répondu à temps.' : 'Connexion impossible.');
  }
  if (res.status === 403 || res.status === 429) throw new Error(`Le site a bloqué la requête (${res.status}).`);
  if (!res.ok) throw new Error(`Le site a répondu ${res.status}.`);
  return (await res.text()).slice(0, MAX_BYTES);
}

/* ------------------------------------------------------------------ */
/* Lives                                                                */
/* ------------------------------------------------------------------ */
/** Réponse de l'API web « room » de TikTok. Renvoie { live, roomId, nickname, title, viewers } ou lève une erreur. */
function parseLiveRoom(json) {
  if (!json || typeof json !== 'object') throw new Error('Réponse TikTok illisible.');
  if (json.statusCode !== undefined && Number(json.statusCode) !== 0) throw new Error('TikTok a refusé la requête.');
  const user = json.data?.user;
  if (!user || typeof user !== 'object') throw new Error('Réponse TikTok inattendue.');
  const room = json.data.liveRoom && typeof json.data.liveRoom === 'object' ? json.data.liveRoom : {};
  const roomId = String(user.roomId || room.roomId || '');
  const status = Number(user.status ?? room.status ?? 0); // 2 = en direct, 4 = terminé
  const live = Boolean(roomId) && roomId !== '0' && status === 2;
  return {
    live,
    roomId,
    nickname: String(user.nickname || user.uniqueId || ''),
    title: String(room.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    viewers: Math.max(0, Number(room.liveRoomStats?.userCount ?? room.userCount) || 0),
  };
}

/** Page d'un profil TikTok : cherche l'état « en direct ». Renvoie { live, roomId, nickname } ou lève une erreur. */
function parseProfilePage(html) {
  const raw = String(html || '').match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error('TikTok n’a pas renvoyé les informations du profil (le site bloque parfois les serveurs).');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Réponse TikTok illisible.'); }
  const detail = data?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  if (!detail?.userInfo?.user) throw new Error('Compte TikTok introuvable ou privé.');
  const user = detail.userInfo.user;
  const roomId = String(user.roomId || '');
  return { live: Boolean(roomId) && roomId !== '0', roomId, nickname: user.nickname || user.uniqueId || '' };
}

/** L'état « en direct » d'un compte : l'API room d'abord, la page du profil en secours. */
async function lookupLive(handleInput) {
  const handle = normalizeHandle(handleInput);
  const errors = [];
  try {
    const text = await fetchRaw(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json', referer: `https://www.tiktok.com/@${handle}/live` },
    });
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('Réponse TikTok illisible.'); }
    return parseLiveRoom(json);
  } catch (err) { errors.push(err.message); }
  try {
    return { title: '', viewers: 0, ...parseProfilePage(await fetchRaw(`https://www.tiktok.com/@${handle}`, { headers: { accept: 'text/html' } })) };
  } catch (err) { errors.push(err.message); }
  throw new Error([...new Set(errors)].join(' '));
}

/* ------------------------------------------------------------------ */
/* Vidéos                                                               */
/* ------------------------------------------------------------------ */
const VIDEO_ID = /(\d{8,25})/;
const cleanTitle = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Réponse de tikwm.com « user/posts ». Renvoie [{ id, title, link, published }]. */
function parseTikwmPosts(json, handle) {
  if (!json || typeof json !== 'object') throw new Error('Réponse illisible.');
  if (Number(json.code) !== 0) throw new Error(json.msg ? `Service tiers : ${cleanTitle(json.msg).slice(0, 100)}` : 'Réponse inattendue du service tiers.');
  const list = json.data?.videos || json.data?.aweme_list || [];
  if (!Array.isArray(list)) throw new Error('Réponse inattendue du service tiers.');
  return list.map((v) => {
    const id = String(v?.video_id || v?.aweme_id || v?.id || '').match(/^\d{8,25}$/)?.[0] || '';
    return { id, title: cleanTitle(v?.title ?? v?.desc), link: `https://www.tiktok.com/@${handle}/video/${id}`, published: (Number(v?.create_time) || 0) * 1000 };
  }).filter((e) => e.id);
}

/** Flux RSSHub d'un compte. L'identifiant est celui de la vidéo (même valeur quelle que soit la source). */
function parseRsshubPosts(xml, handle) {
  return parseFeed(xml).entries.map((e) => {
    const id = (e.link.match(/\/video\/(\d{8,25})/) || e.id.match(/\/video\/(\d{8,25})/) || e.id.match(VIDEO_ID) || [])[1] || '';
    return { id, title: cleanTitle(e.title === 'Sans titre' ? '' : e.title), link: id ? `https://www.tiktok.com/@${handle}/video/${id}` : e.link, published: e.published || 0 };
  }).filter((e) => e.id);
}

async function fromTikwm(handle) {
  const text = await fetchRaw(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=12&cursor=0`, { headers: { accept: 'application/json' } });
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Réponse illisible.'); }
  return parseTikwmPosts(json, handle);
}

async function fromRsshub(handle, base) {
  const url = `${String(base || DEFAULT_RSSHUB).replace(/\/+$/, '')}/tiktok/user/@${handle}`;
  return parseRsshubPosts(await fetchRaw(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } }), handle);
}

/** Adresse d'un flux RSS personnalisé : « {account} » est remplacé par le compte. Lève une erreur en français si l'adresse est invalide. */
function customFeedUrl(template, handle) {
  const text = String(template || '').trim();
  if (!/^https?:\/\//i.test(text)) throw new Error('L’adresse du flux doit commencer par https://');
  const url = text.replace(/\{account\}/gi, encodeURIComponent(handle));
  try { new URL(url); } catch { throw new Error('Adresse du flux invalide.'); }
  return url;
}

async function fromCustomFeed(handle, template) {
  // Même protection que le module « Flux » : adresses publiques uniquement, taille et durée bornées.
  const xml = await feedsLib.fetchText(customFeedUrl(template, handle), { maxBytes: MAX_BYTES });
  return parseRsshubPosts(xml, handle);
}

/**
 * Dernières vidéos d'un compte. Renvoie { entries, source } ; lève une erreur si aucune source n'a répondu.
 * Une source qui répond « aucune vidéo » n'est pas une erreur, mais on essaie quand même l'autre avant de conclure.
 */
async function lookupVideos(handleInput, { rsshubUrl = '', feedUrl = '' } = {}) {
  const handle = normalizeHandle(handleInput);
  const customHub = rsshubUrl && String(rsshubUrl).replace(/\/+$/, '') !== DEFAULT_RSSHUB;
  const sources = [
    { name: 'tikwm', run: () => fromTikwm(handle) },
    { name: 'rsshub', run: () => fromRsshub(handle, rsshubUrl) },
  ];
  if (customHub) sources.reverse();
  if (String(feedUrl || '').trim()) sources.unshift({ name: 'feed', run: () => fromCustomFeed(handle, feedUrl) });
  const errors = [];
  let empty = null;
  for (const src of sources) {
    try {
      const entries = await src.run();
      if (entries.length) return { entries, source: src.name };
      empty = { entries: [], source: src.name };
    } catch (err) { errors.push(`${{ tikwm: 'Service tikwm', rsshub: 'RSSHub', feed: 'Ton flux RSS' }[src.name]} : ${err.message}`); }
  }
  if (empty) return empty;
  throw new Error(errors.join(' | '));
}

/** Lien d'une vidéo TikTok (long ou court). Renvoie { url, handle, id } ; lève une erreur en français sinon. */
function parseVideoLink(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Colle le lien de ta vidéo TikTok (ex. https://www.tiktok.com/@moncompte/video/123…).'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Ce lien n’est pas un lien TikTok.');
  if (!/^((www|m|vm|vt)\.)?tiktok\.com$/.test(host)) throw new Error('Ce lien n’est pas un lien TikTok.');
  const m = u.pathname.match(/^\/@([\w.]{1,40})\/video\/(\d{8,25})/);
  if (m) return { url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, handle: m[1].toLowerCase(), id: m[2] };
  if (/^(vm|vt)\./.test(host) && /^\/[\w-]{4,20}\/?$/.test(u.pathname)) return { url: `https://${host}${u.pathname}`, handle: '', id: '' }; // lien court : TikTok le résout lui-même
  throw new Error('Ce lien ne mène pas à une vidéo TikTok.');
}

/** Titre d'une vidéo via l'oEmbed public de TikTok (un lien à la fois, pas de liste). Renvoie '' si indisponible : jamais fatal. */
async function videoTitle(url) {
  try {
    const text = await fetchRaw(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { accept: 'application/json' } });
    const json = JSON.parse(text);
    return { title: cleanTitle(json.title), author: String(json.author_unique_id || '').replace(/[^\w.]/g, '').toLowerCase() };
  } catch { return { title: '', author: '' }; }
}

module.exports = {
  customFeedUrl, parseVideoLink, videoTitle,
  setFetch, normalizeHandle, parseLiveRoom, parseProfilePage, lookupLive, parseTikwmPosts, parseRsshubPosts, lookupVideos, DEFAULT_RSSHUB,
};
