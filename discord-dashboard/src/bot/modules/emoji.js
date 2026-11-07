'use strict';
/**
 * Émojis du serveur : /emojis creer (cherche une image sur Internet, enlève le fond, crée l'émoji),
 * /emojis ajouter (image jointe ou lien), /emojis supprimer, /emojis liste.
 *
 * Services externes (clés à mettre dans les variables Railway, jamais dans le code) :
 *  - BRAVE_API_KEY    : recherche d'images (Brave Search API, formule gratuite).
 *  - REMOVEBG_API_KEY : fond transparent de qualité (remove.bg). Sans cette clé, seuls les PNG à fond uni sont traités.
 * Le traitement des images (lecture et écriture PNG, recadrage, redimensionnement) est fait ici, sans bibliothèque.
 */
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const feeds = require('./feeds');
const { EPHEMERAL } = require('../util');

const EMOJI_SIZE = 128;
const MAX_EMOJI_BYTES = 256 * 1024; // limite de Discord
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const TIMEOUT_MS = 20000;
const PICK_TTL_MS = 10 * 60 * 1000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SLOTS_BY_TIER = [50, 100, 150, 250];
const PREFIX = 'emo:';

let fetchImpl = (...args) => fetch(...args);
/** Pour les tests : remplace `fetch` (téléchargements et services externes). */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); feeds.setFetch(fn); }

/* ------------------------------------------------------------------ */
/* PNG : lecture, écriture, recadrage, redimensionnement                 */
/* ------------------------------------------------------------------ */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Type d'une image d'après ses premiers octets : 'png' | 'jpeg' | 'gif' | 'webp' | ''. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return '';
}

/** Lit un PNG (non entrelacé). Renvoie { width, height, rgba: Uint8Array } ou lève une erreur en français. */
function decodePng(buf) {
  if (sniff(buf) !== 'png') throw new Error('Ce n’est pas un fichier PNG.');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length < len) throw new Error('Fichier PNG tronqué.');
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || !idat.length) throw new Error('Fichier PNG illisible.');
  const { width, height, depth, color, interlace } = ihdr;
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('Image trop grande pour être traitée (12 mégapixels maximum).');
  if (interlace) throw new Error('Les PNG entrelacés ne sont pas pris en charge : exporte l’image en PNG classique.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('Format PNG non pris en charge.');
  if (color === 3 && !palette) throw new Error('Fichier PNG illisible.');

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { throw new Error('Fichier PNG illisible.'); }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new Error('Fichier PNG tronqué.');

  // Filtres PNG
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? rows[dst + i - bpp] : 0;
      const b = y > 0 ? rows[prev + i] : 0;
      const c = y > 0 && i >= bpp ? rows[prev + i - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('Fichier PNG illisible.');
      }
      rows[dst + i] = v & 0xff;
    }
  }

  // Échantillons -> RGBA 8 bits
  const out = new Uint8Array(width * height * 4);
  const maxVal = (1 << Math.min(depth, 8)) - 1;
  const sample = (y, index) => { // valeur brute du n-ième échantillon de la ligne
    const base = y * stride;
    if (depth === 8) return rows[base + index];
    if (depth === 16) return (rows[base + index * 2] << 8) | rows[base + index * 2 + 1];
    const bit = index * depth;
    return (rows[base + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxVal;
  };
  const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxVal));
  const keyOf = (n) => (trns && trns.length >= n * 2 ? Array.from({ length: n }, (_, i) => trns.readUInt16BE(i * 2)) : null);
  const key = color === 0 ? keyOf(1) : color === 2 ? keyOf(3) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (color === 6) { for (let k = 0; k < 4; k++) out[o + k] = to8(sample(y, x * 4 + k)); } else if (color === 2) {
        const r = sample(y, x * 3); const g = sample(y, x * 3 + 1); const b = sample(y, x * 3 + 2);
        out[o] = to8(r); out[o + 1] = to8(g); out[o + 2] = to8(b);
        out[o + 3] = key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
      } else if (color === 0) {
        const v = sample(y, x);
        out[o] = out[o + 1] = out[o + 2] = to8(v);
        out[o + 3] = key && v === key[0] ? 0 : 255;
      } else if (color === 4) {
        const v = to8(sample(y, x * 2));
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = to8(sample(y, x * 2 + 1));
      } else { // palette
        const idx = sample(y, x);
        out[o] = palette[idx * 3] ?? 0; out[o + 1] = palette[idx * 3 + 1] ?? 0; out[o + 2] = palette[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, rgba: out };
}

/** Écrit un PNG RGBA 8 bits. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1; // filtre « Sub » : compresse mieux les aplats
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[y * stride + i - 4] : 0;
      raw[y * (stride + 1) + 1 + i] = (rgba[y * stride + i] - left) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Retire les bords transparents. Lève une erreur si l'image est entièrement transparente. */
function trimTransparent({ width, height, rgba }) {
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) throw new Error('L’image est entièrement transparente : rien à garder.');
  if (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1) return { width, height, rgba };
  const w = x1 - x0 + 1; const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(rgba.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba: out };
}

/** Met l'image dans un carré de `size` pixels (moyenne par zones, alpha pré-multiplié), centrée sur fond transparent. */
function fitSquare({ width, height, rgba }, size = EMOJI_SIZE) {
  const scale = size / Math.max(width, height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(size * size * 4);
  const ox = Math.floor((size - dw) / 2);
  const oy = Math.floor((size - dh) / 2);
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * height) / dh; const sy1 = ((y + 1) * height) / dh;
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * width) / dw; const sx1 = ((x + 1) * width) / dw;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(height, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.min(width, Math.ceil(sx1)); sx++) {
          const wgt = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const i = (sy * width + sx) * 4;
          const al = rgba[i + 3] / 255;
          r += rgba[i] * al * wgt; g += rgba[i + 1] * al * wgt; b += rgba[i + 2] * al * wgt; a += al * wgt; wsum += wgt;
        }
      }
      const o = ((oy + y) * size + ox + x) * 4;
      if (a > 0 && wsum > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / wsum) * 255);
      }
    }
  }
  return { width: size, height: size, rgba: out };
}

const hasTransparency = ({ rgba }) => { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true; return false; };

/**
 * Rend transparent un fond uni : on part des bords et on efface les pixels de la couleur du fond (tolérance `tol`).
 * Ne fait rien si les coins n'ont pas la même couleur. Renvoie le nombre de pixels effacés.
 */
function clearFlatBackground({ width, height, rgba }, tol = 36) {
  const at = (x, y) => (y * width + x) * 4;
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => [rgba[at(x, y)], rgba[at(x, y) + 1], rgba[at(x, y) + 2]]);
  const near = (p, q, t) => Math.abs(p[0] - q[0]) <= t && Math.abs(p[1] - q[1]) <= t && Math.abs(p[2] - q[2]) <= t;
  const bg = corners.find((c) => corners.filter((d) => near(c, d, tol)).length >= 3);
  if (!bg) return 0;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height || seen[y * width + x]) return;
    const i = at(x, y);
    if (!near([rgba[i], rgba[i + 1], rgba[i + 2]], bg, tol)) return;
    seen[y * width + x] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let cleared = 0;
  while (stack.length) {
    const y = stack.pop(); const x = stack.pop();
    rgba[at(x, y) + 3] = 0;
    cleared++;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return cleared;
}

/* ------------------------------------------------------------------ */
/* Téléchargement et services externes                                  */
/* ------------------------------------------------------------------ */
/** Télécharge une image (adresses publiques uniquement, redirections revérifiées, taille bornée). */
async function downloadImage(raw, { maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  let url = await feeds.assertPublicUrl(raw);
  for (let i = 0; i <= 4; i++) {
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': BROWSER_UA, accept: 'image/png,image/webp,image/jpeg,image/gif,image/*;q=0.8' } });
    } catch (err) {
      throw new Error(err?.name === 'TimeoutError' ? 'Le site de l’image n’a pas répondu à temps.' : 'Impossible de télécharger l’image.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers?.get?.('location')) { url = await feeds.assertPublicUrl(new URL(res.headers.get('location'), url).toString()); continue; }
    if (res.status === 403 || res.status === 429) throw new Error(`Le site de l’image a refusé le téléchargement (${res.status}). Essaie un autre résultat.`);
    if (!res.ok) throw new Error(`Le site de l’image a répondu ${res.status}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('L’image est trop lourde (8 Mo maximum).');
    return buf;
  }
  throw new Error('Trop de redirections.');
}

/** Fond transparent avec remove.bg. Renvoie un PNG. */
async function removeBackground(key, buffer) {
  const form = new FormData();
  form.append('image_file', new Blob([buffer]), 'image');
  form.append('size', 'auto');
  form.append('format', 'png');
  let res;
  try {
    res = await fetchImpl('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key, accept: 'image/png' }, body: form, signal: AbortSignal.timeout(45000) });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'remove.bg n’a pas répondu à temps.' : 'Connexion impossible à remove.bg.');
  }
  if (res.status === 402) throw new Error('Les crédits remove.bg sont épuisés (50 images gratuites par mois). Réessaie le mois prochain ou prends un forfait.');
  if (res.status === 401 || res.status === 403) throw new Error('La clé remove.bg est refusée (REMOVEBG_API_KEY).');
  if (res.status === 429) throw new Error('remove.bg est surchargé : réessaie dans une minute.');
  if (!res.ok) throw new Error('remove.bg n’a pas pu traiter cette image : essaie un autre résultat.');
  const png = Buffer.from(await res.arrayBuffer());
  if (sniff(png) !== 'png') throw new Error('remove.bg a renvoyé un fichier inattendu.');
  return png;
}

/** Recherche d'images (Brave Search API). Renvoie jusqu'à `count` candidats { title, source, image, thumb, width, height }. */
async function searchImages(key, query, { count = 4, safe = true } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!q) throw new Error('Écris ce que tu cherches.');
  const url = `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({ q: `${q} png transparent`, count: '30', safesearch: safe ? 'strict' : 'off', search_lang: 'fr', country: 'FR' })}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'X-Subscription-Token': key, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'La recherche d’images n’a pas répondu à temps.' : 'Connexion impossible au service de recherche d’images.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('La clé de recherche d’images est refusée (BRAVE_API_KEY).');
  if (res.status === 429) throw new Error('Limite de recherches atteinte (2 000 par mois en gratuit) ou trop de requêtes : réessaie plus tard.');
  if (!res.ok) throw new Error(`Le service de recherche d’images a répondu ${res.status}.`);
  let json;
  try { json = await res.json(); } catch { throw new Error('Réponse illisible du service de recherche d’images.'); }
  const seen = new Set();
  const list = [];
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    const image = String(r?.properties?.url || '');
    const thumb = String(r?.thumbnail?.src || '');
    if (!/^https:\/\/\S{4,500}$/.test(image) || !/^https:\/\/\S{4,500}$/.test(thumb) || seen.has(image)) continue;
    if (/\.svg(\?|$)/i.test(image)) continue; // le SVG n'est lu ni par remove.bg ni par Discord
    const width = Number(r?.properties?.width) || 0; const height = Number(r?.properties?.height) || 0;
    if ((width && width < 48) || (height && height < 48)) continue;
    seen.add(image);
    list.push({ title: String(r?.title || '').replace(/\s+/g, ' ').trim().slice(0, 80), source: String(r?.source || '').slice(0, 60), image, thumb, width, height, png: /\.png(\?|$)/i.test(image) });
  }
  list.sort((a, b) => Number(b.png) - Number(a.png)); // un PNG est souvent déjà transparent
  return list.slice(0, count).map(({ png, ...c }) => c);
}

/* ------------------------------------------------------------------ */
/* Fabrication de l'image de l'émoji                                    */
/* ------------------------------------------------------------------ */
const TOO_HEAVY = 'L’image fait plus de 256 Ko et ce n’est pas un PNG : choisis-en une plus légère.';

/** PNG -> PNG 128×128 (recadré sur le contenu si `trim`). */
function squarePng(png, { trim, clearBackground = false }) {
  let img = decodePng(png);
  let note = '';
  if (clearBackground && !hasTransparency(img)) {
    const cleared = clearFlatBackground(img);
    note = cleared ? 'fond uni retiré' : 'aucun fond uni détecté : image gardée telle quelle';
  } else if (clearBackground) note = 'l’image était déjà transparente';
  if (trim) img = trimTransparent(img);
  const small = fitSquare(img);
  return { buffer: encodePng(small.width, small.height, small.rgba), note };
}

/**
 * Prépare l'image d'un émoji.
 * @param {{ buffer: Buffer, transparent: boolean, removebgKey?: string }} opts
 * @returns {Promise<{ buffer: Buffer, animated: boolean, note: string }>}
 */
async function prepareEmojiImage({ buffer, transparent, removebgKey = '' }) {
  const type = sniff(buffer);
  if (!type) throw new Error('Ce fichier n’est pas une image (PNG, JPG, GIF ou WebP attendu).');
  if (transparent) {
    if (removebgKey) {
      const png = await removeBackground(removebgKey, buffer);
      const r = squarePng(png, { trim: true });
      return { buffer: r.buffer, animated: false, note: 'fond retiré avec remove.bg' };
    }
    if (type !== 'png') throw new Error('Pour enlever le fond d’une image JPG, WebP ou GIF, il faut une clé remove.bg (variable REMOVEBG_API_KEY dans Railway). Sans clé, seuls les PNG à fond uni sont traités.');
    const r = squarePng(buffer, { trim: true, clearBackground: true });
    return { buffer: r.buffer, animated: false, note: r.note };
  }
  if (type === 'png') return { buffer: squarePng(buffer, { trim: false }).buffer, animated: false, note: '' };
  if (buffer.length > MAX_EMOJI_BYTES) throw new Error(TOO_HEAVY);
  return { buffer, animated: type === 'gif', note: '' };
}

/* ------------------------------------------------------------------ */
/* Émojis du serveur                                                    */
/* ------------------------------------------------------------------ */
/** Nom d'émoji valide : 2 à 32 caractères, lettres, chiffres et « _ ». */
function cleanEmojiName(text) {
  const name = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^:+|:+$/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32).replace(/_+$/g, '');
  return name.length >= 2 ? name : '';
}

function uniqueName(guild, base) {
  const taken = new Set([...(guild.emojis?.cache?.values?.() || [])].map((e) => String(e.name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 32 - String(i).length - 1)}_${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

function emojiLimits(guild) {
  const max = SLOTS_BY_TIER[Math.max(0, Math.min(3, Number(guild.premiumTier) || 0))];
  const list = [...(guild.emojis?.cache?.values?.() || [])];
  return { max, staticUsed: list.filter((e) => !e.animated).length, animatedUsed: list.filter((e) => e.animated).length };
}

function assertCanCreate(guild, animated = false) {
  if (!guild.members?.me?.permissions?.has?.('ManageGuildExpressions')) throw new Error('Il me manque la permission « Gérer les expressions » : ajoute-la à mon rôle dans les paramètres du serveur.');
  const l = emojiLimits(guild);
  if ((animated ? l.animatedUsed : l.staticUsed) >= l.max) throw new Error(`Le serveur a atteint sa limite de ${l.max} émojis ${animated ? 'animés' : 'classiques'}. Supprime-en un ou booste le serveur.`);
}

async function createEmoji(guild, { name, buffer, reason }) {
  try {
    return await guild.emojis.create({ attachment: buffer, name, reason });
  } catch (err) {
    const msg = String(err?.message || '');
    if (/permission|missing access/i.test(msg)) throw new Error('Discord a refusé : il me manque la permission « Gérer les expressions ».');
    if (/maximum number|emoji slots|limit/i.test(msg)) throw new Error('Le serveur a atteint sa limite d’émojis.');
    if (/file cannot be larger|too large|size/i.test(msg)) throw new Error('Discord a refusé l’image (trop lourde).');
    throw new Error('Discord a refusé de créer cet émoji.');
  }
}

const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'emojis');
const keysOf = (client) => ({ brave: client.ctx.config?.emoji?.braveKey || '', removebg: client.ctx.config?.emoji?.removebgKey || '' });

/** Image -> émoji : télécharge si besoin, prépare, crée. Renvoie { emoji, note }. */
async function buildAndCreate(client, guild, { url, buffer, name, transparent, reason }) {
  assertCanCreate(guild);
  const source = buffer || await downloadImage(url);
  const prepared = await prepareEmojiImage({ buffer: source, transparent, removebgKey: keysOf(client).removebg });
  assertCanCreate(guild, prepared.animated);
  const emoji = await createEmoji(guild, { name: uniqueName(guild, name), buffer: prepared.buffer, reason });
  return { emoji, note: prepared.note };
}

/* ------------------------------------------------------------------ */
/* Choix du résultat de recherche (boutons)                             */
/* ------------------------------------------------------------------ */
const db = (client) => client.ctx.db;
const pickKey = (token) => `emoji:pick:${token}`;
const savePick = (client, token, state) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(pickKey(token), JSON.stringify(state));
const readPick = (client, token) => { try { return JSON.parse(db(client).prepare('SELECT value FROM kv WHERE key = ?').get(pickKey(token))?.value || 'null'); } catch { return null; } };
const dropPick = (client, token) => db(client).prepare('DELETE FROM kv WHERE key = ?').run(pickKey(token));
/** Supprime les choix expirés (appelé à chaque nouvelle recherche). */
const cleanPicks = (client, now = Date.now()) => {
  for (const row of db(client).prepare("SELECT key, value FROM kv WHERE key LIKE 'emoji:pick:%'").all()) {
    try { if (JSON.parse(row.value).expiresAt < now) db(client).prepare('DELETE FROM kv WHERE key = ?').run(row.key); } catch { db(client).prepare('DELETE FROM kv WHERE key = ?').run(row.key); }
  }
};

function pickerPayload(token, state, header) {
  const url = `https://search.brave.com/images?q=${encodeURIComponent(state.query)}`;
  const lines = state.cands.map((c, i) => `**${i + 1}.** ${c.title || 'Sans titre'}${c.source ? ` · ${c.source}` : ''}${c.width && c.height ? ` · ${c.width}×${c.height}` : ''}`);
  // Des embeds qui ont la même adresse s'affichent en une seule grille d'images.
  const embeds = state.cands.map((c, i) => ({ url, image: { url: c.thumb }, ...(i === 0 ? { title: `Émoji :${state.name}:`, description: lines.join('\n'), footer: { text: 'Résultats de recherche : les images appartiennent à leurs auteurs' } } : {}) }));
  return {
    content: header,
    embeds,
    components: [{
      type: 1,
      components: [
        ...state.cands.map((_, i) => ({ type: 2, style: 2, custom_id: `${PREFIX}${token}:${i}`, label: String(i + 1) })),
        { type: 2, style: 4, custom_id: `${PREFIX}${token}:x`, label: 'Annuler' },
      ],
    }],
  };
}

/* ------------------------------------------------------------------ */
/* Commandes                                                            */
/* ------------------------------------------------------------------ */
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
const emojiText = (e) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

async function runCreate(client, interaction) {
  const { guild } = interaction;
  const cfg = cfgOf(client, guild.id);
  const query = String(interaction.options.getString('demande', true)).trim();
  const transparent = interaction.options.getBoolean('fond_transparent') ?? cfg.transparent;
  const given = interaction.options.getString('nom');
  const name = cleanEmojiName(given || (isUrl(query) ? '' : query));
  if (given && !name) throw new Error('Le nom de l’émoji doit contenir au moins 2 lettres ou chiffres.');
  assertCanCreate(guild);

  if (isUrl(query)) { // un lien collé dans « demande » : pas de recherche
    if (!name) throw new Error('Ajoute le nom de l’émoji avec l’option « nom ».');
    const r = await buildAndCreate(client, guild, { url: query, name, transparent, reason: `Émoji créé par ${interaction.user.tag || interaction.user.id}` });
    return interaction.editReply({ content: `✅ Émoji créé : ${emojiText(r.emoji)} \`:${r.emoji.name}:\`${r.note ? ` (${r.note})` : ''}` });
  }
  if (!name) throw new Error('Décris l’image avec au moins 2 lettres ou chiffres, ou donne un nom avec l’option « nom ».');
  const keys = keysOf(client);
  if (!keys.brave) throw new Error('La recherche d’images n’est pas encore activée : il faut la clé BRAVE_API_KEY dans Railway (voir la page « Émojis du serveur » du dashboard). En attendant, utilise /emojis ajouter avec une image.');
  const cands = await searchImages(keys.brave, query, { count: cfg.candidates, safe: cfg.safeSearch });
  if (!cands.length) throw new Error(`Aucune image trouvée pour « ${query.slice(0, 60)} ». Essaie avec d’autres mots (ex. le nom du jeu + « logo »).`);
  cleanPicks(client);
  const token = crypto.randomBytes(5).toString('hex');
  const state = { guildId: guild.id, userId: interaction.user.id, query: query.slice(0, 100), name, transparent, cands, expiresAt: Date.now() + PICK_TTL_MS };
  savePick(client, token, state);
  return interaction.editReply(pickerPayload(token, state, `Choisis l’image à transformer en émoji **:${name}:**${transparent ? ' (fond transparent)' : ''} :`));
}

async function runAdd(client, interaction) {
  const { guild } = interaction;
  const cfg = cfgOf(client, guild.id);
  const name = cleanEmojiName(interaction.options.getString('nom', true));
  if (!name) throw new Error('Le nom de l’émoji doit contenir au moins 2 lettres ou chiffres.');
  const file = interaction.options.getAttachment('image');
  const link = (interaction.options.getString('lien') || '').trim();
  if (!file && !link) throw new Error('Joins une image (option « image ») ou colle un lien (option « lien »).');
  const transparent = interaction.options.getBoolean('fond_transparent') ?? cfg.transparent;
  assertCanCreate(guild);
  if (file && file.size > MAX_DOWNLOAD_BYTES) throw new Error('L’image est trop lourde (8 Mo maximum).');
  const r = await buildAndCreate(client, guild, { url: file ? file.url : link, name, transparent, reason: `Émoji ajouté par ${interaction.user.tag || interaction.user.id}` });
  return interaction.editReply({ content: `✅ Émoji créé : ${emojiText(r.emoji)} \`:${r.emoji.name}:\`${r.note ? ` (${r.note})` : ''}` });
}

async function runDelete(client, interaction) {
  const { guild } = interaction;
  if (!guild.members?.me?.permissions?.has?.('ManageGuildExpressions')) throw new Error('Il me manque la permission « Gérer les expressions ».');
  const wanted = cleanEmojiName(interaction.options.getString('nom', true)).toLowerCase();
  const found = [...guild.emojis.cache.values()].filter((e) => String(e.name).toLowerCase() === wanted);
  if (!found.length) throw new Error('Aucun émoji de ce nom sur le serveur (voir /emojis liste).');
  if (found.length > 1) throw new Error(`Il y a ${found.length} émojis qui s’appellent « ${wanted} » : supprime-les depuis les paramètres du serveur ou renomme-les.`);
  await guild.emojis.delete(found[0].id, `Supprimé par ${interaction.user.tag || interaction.user.id}`);
  return interaction.editReply({ content: `🗑️ Émoji \`:${found[0].name}:\` supprimé.` });
}

async function runList(client, interaction) {
  const list = [...interaction.guild.emojis.cache.values()];
  const l = emojiLimits(interaction.guild);
  if (!list.length) return interaction.editReply({ content: 'Ce serveur n’a pas encore d’émoji personnalisé.' });
  let text = '';
  for (const e of list) { const line = `${emojiText(e)} \`:${e.name}:\`\n`; if (text.length + line.length > 3500) { text += '…'; break; } text += line; }
  return interaction.editReply({ embeds: [{ title: `Émojis du serveur (${l.staticUsed}/${l.max} classiques · ${l.animatedUsed}/${l.max} animés)`, description: text }] });
}

/** Commande /emojis : tout passe par une réponse différée (la recherche et le traitement d'image prennent quelques secondes). */
async function handleCommand(interaction) {
  const { client } = interaction;
  const sub = interaction.options.getSubcommand();
  if (!interaction.memberPermissions?.has?.('ManageGuildExpressions')) return interaction.reply({ content: 'Il faut la permission « Gérer les expressions » pour utiliser cette commande.', flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    if (sub === 'creer') return await runCreate(client, interaction);
    if (sub === 'ajouter') return await runAdd(client, interaction);
    if (sub === 'supprimer') return await runDelete(client, interaction);
    return await runList(client, interaction);
  } catch (err) {
    return interaction.editReply({ content: `❌ ${err.message}`, embeds: [], components: [] });
  }
}

/** Boutons du choix d'image. */
async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith(PREFIX) || !interaction.isButton?.() || !interaction.guild) return false;
  const [token, action] = id.slice(PREFIX.length).split(':');
  const state = readPick(client, token);
  const say = (content) => interaction.reply({ content, flags: EPHEMERAL });
  if (!state || state.guildId !== interaction.guild.id || state.expiresAt < Date.now()) { if (state) dropPick(client, token); await say('Cette recherche a expiré : relance /emojis creer.'); return true; }
  if (interaction.user.id !== state.userId) { await say('Seule la personne qui a lancé la recherche peut choisir.'); return true; }
  if (action === 'x') {
    dropPick(client, token);
    await interaction.update({ content: 'Recherche annulée.', embeds: [], components: [] });
    return true;
  }
  const chosen = state.cands[Number(action)];
  if (!chosen) { await say('Choix inconnu.'); return true; }
  await interaction.update({ content: '⏳ Création de l’émoji…', embeds: [], components: [] });
  try {
    const r = await buildAndCreate(client, interaction.guild, { url: chosen.image, name: state.name, transparent: state.transparent, reason: `Émoji créé par ${interaction.user.tag || interaction.user.id}` });
    dropPick(client, token);
    await interaction.editReply({ content: `✅ Émoji créé : ${emojiText(r.emoji)} \`:${r.emoji.name}:\`${r.note ? ` (${r.note})` : ''}`, embeds: [], components: [] });
  } catch (err) {
    // on garde la liste : le résultat choisi n'a pas marché, un autre peut convenir
    await interaction.editReply(pickerPayload(token, state, `❌ ${err.message}\nChoisis un autre résultat :`));
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */
function status(client, guild) {
  const keys = keysOf(client);
  const l = emojiLimits(guild);
  return {
    search: Boolean(keys.brave), background: Boolean(keys.removebg),
    canManage: Boolean(guild.members?.me?.permissions?.has?.('ManageGuildExpressions')),
    limit: l.max, staticUsed: l.staticUsed, animatedUsed: l.animatedUsed,
  };
}
function listEmojis(guild) {
  return [...guild.emojis.cache.values()].map((e) => ({ id: e.id, name: e.name, animated: Boolean(e.animated), url: typeof e.imageURL === 'function' ? e.imageURL({ size: 64 }) : (e.url || '') }));
}
async function deleteEmoji(guild, emojiId, who = '') {
  if (!guild.members?.me?.permissions?.has?.('ManageGuildExpressions')) throw new Error('Il me manque la permission « Gérer les expressions ».');
  const e = guild.emojis.cache.get(emojiId);
  if (!e) throw new Error('Émoji introuvable.');
  await guild.emojis.delete(e.id, who ? `Supprimé depuis le dashboard par ${who}` : 'Supprimé depuis le dashboard');
  return e.name;
}

module.exports = {
  setFetch, sniff, decodePng, encodePng, trimTransparent, fitSquare, clearFlatBackground, hasTransparency,
  downloadImage, removeBackground, searchImages, prepareEmojiImage, cleanEmojiName, uniqueName, emojiLimits, assertCanCreate,
  buildAndCreate, handleCommand, handleInteraction, status, listEmojis, deleteEmoji, cleanPicks, MAX_EMOJI_BYTES, EMOJI_SIZE,
};
