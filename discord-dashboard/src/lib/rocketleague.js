'use strict';
/**
 * Petits outils Rocket League sans dépendance : équipes aléatoires, identifiants de match privé, modes de jeu et défis.
 * Toutes les fonctions acceptent un générateur aléatoire (`rnd`, renvoie un entier de 0 à n-1) pour rester testables.
 */
const crypto = require('node:crypto');

const rndInt = (n) => crypto.randomInt(n);

/** Modes proposés (LFG, présélections). `team` = taille d'une équipe, `lookFor` = joueurs recherchés par défaut. */
const MODES = [
  { id: 'duel', label: 'Duel 1v1', team: 1, lookFor: 1 },
  { id: 'doubles', label: 'Doubles 2v2', team: 2, lookFor: 1 },
  { id: 'standard', label: 'Standard 3v3', team: 3, lookFor: 2 },
  { id: 'rumble', label: 'Rumble', team: 3, lookFor: 2 },
  { id: 'hoops', label: 'Hoops', team: 2, lookFor: 1 },
  { id: 'dropshot', label: 'Dropshot', team: 3, lookFor: 2 },
  { id: 'snowday', label: 'Snow Day', team: 3, lookFor: 2 },
  { id: 'prive', label: 'Match privé', team: 6, lookFor: 5 },
  { id: 'training', label: 'Entraînement', team: 2, lookFor: 1 },
  { id: 'tournoi', label: 'Tournoi', team: 3, lookFor: 2 },
];
const AGE_MIN = 13; // âge minimum pour avoir un compte Discord
const AGE_MAX = 99;
/** Liens et invitations : refusés dans les champs libres (pas de pub dans les annonces). */
const hasLink = (text) => /(discord\.gg|discord(app)?\.com\/invite|https?:\/\/|www\.)/i.test(String(text || ''));
/** Texte libre d'un formulaire : sans caractères de contrôle, espaces réduits, longueur bornée. */
const cleanField = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Âge saisi à la main : '' = non renseigné (0). Lève une erreur en français si ce n'est pas un nombre admis. */
function parseAge(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return 0;
  const n = /^\d{1,3}\s*(ans?)?$/i.test(raw) ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < AGE_MIN || n > AGE_MAX) throw new Error(`L’âge doit être un nombre entre ${AGE_MIN} et ${AGE_MAX}.`);
  return n;
}

const modeById = (id) => MODES.find((m) => m.id === id) || null;

const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const MODE_WORDS = [
  ['duel', /\b1\s*(v|c|vs)\s*1\b|duel/],
  ['doubles', /\b2\s*(v|c|vs)\s*2\b|double/],
  ['standard', /\b3\s*(v|c|vs)\s*3\b|standard/],
  ['rumble', /rumble/],
  ['hoops', /hoops|basket/],
  ['dropshot', /drop\s*shot/],
  ['snowday', /snow\s*day|hockey/],
  ['prive', /priv|private/],
  ['training', /train|entrain|free\s*play/],
  ['tournoi', /tournoi|tournament|tourney/],
];
/**
 * Mode écrit par le joueur. Un mode connu (2v2, doubles, Rumble…) donne son libellé et son nombre de places habituel ;
 * tout autre texte est gardé tel quel (1 place). Renvoie null si le texte est vide.
 */
function resolveMode(text) {
  const exact = modeById(String(text || '').trim());
  if (exact) return exact;
  const clean = cleanField(text, 40);
  if (!clean) return null;
  const f = fold(clean);
  const hit = MODE_WORDS.find(([, re]) => re.test(f));
  return hit ? modeById(hit[0]) : { id: 'autre', label: clean, team: 0, lookFor: 1 };
}

function shuffle(list, rnd = rndInt) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sépare des joueurs en deux équipes (bleue et orange) ; l'équipe bleue prend le joueur en trop. */
function splitTeams(players, rnd = rndInt) {
  const mixed = shuffle(players, rnd);
  const half = Math.ceil(mixed.length / 2);
  return { blue: mixed.slice(0, half), orange: mixed.slice(half) };
}

const ADJ = ['Turbo', 'Aérien', 'Fou', 'Rapide', 'Sauvage', 'Cosmique', 'Brûlant', 'Glacial', 'Flottant', 'Explosif', 'Furtif', 'Magique'];
const NOUN = ['Boost', 'Plafond', 'Flip', 'Tir', 'Gardien', 'Rotation', 'Rebond', 'Dribble', 'Arène', 'Kickoff', 'Aérien', 'Smash'];

/** Nom et mot de passe pour un match privé : 20 caractères au plus (8 + 8 + chiffres), pour rester dans les limites du jeu. */
function matchCredentials(rnd = rndInt) {
  const name = `${ADJ[rnd(ADJ.length)]} ${NOUN[rnd(NOUN.length)]} ${String(rnd(90) + 10)}`;
  const password = String(rnd(9000) + 1000);
  return { name, password };
}

const CHALLENGES = [
  'Marque un but de la tête uniquement.',
  'Interdit de toucher la balle au sol : tout se joue dans les airs.',
  'Gagne la partie sans jamais sauter plus d’une fois d’affilée.',
  'Fais 3 sauvetages avant de marquer ton premier but.',
  'Joue toute la partie sans utiliser le boost de réserve (uniquement le petit boost).',
  'Fais une passe décisive à chaque but de l’équipe.',
  'Marque un but après un rebond sur le mur arrière.',
  'Reste dernier défenseur pendant toute une partie.',
  'Tente un flip reset à chaque occasion (même raté).',
  'Garde la caméra en mode balle activée et ne regarde jamais la voiture.',
  'Joue une partie en ne touchant la balle que de la roue avant.',
  'Fais un air dribble avant chaque tir.',
  'Remonte le terrain sans toucher le sol depuis ta cage jusqu’au but adverse.',
  'Marque deux buts à chaque kickoff gagné.',
  'Défends uniquement avec des demi-volées.',
  'Ne laisse aucun tir cadré passer : zéro but encaissé en 3 minutes.',
  'Joue la partie avec les yeux sur la mini-carte : décris à voix haute ce que tu vois.',
  'Utilise la même voiture et le même decal pendant toute la session, sans changer.',
  'Fais un ceiling shot et annonce-le avant de le tenter.',
  'Gagne un duel 1v1 en ne marquant que de loin (milieu de terrain).',
];
const pickChallenge = (rnd = rndInt) => CHALLENGES[rnd(CHALLENGES.length)];


/* ------------------------------------------------------------------ */
/* Boutique d'objets : lecture de la page publique itemshop.gg           */
/* ------------------------------------------------------------------ */
// Rocket League n'a pas d'API publique pour sa boutique : on lit la page d'un site de suivi (adresse fixe, jamais saisie par un utilisateur).
const SHOP_URL = 'https://itemshop.gg/rocket-league';
const SHOP_SOURCE = 'itemshop.gg';
const DERIVED_SECTIONS = new Set(['new-today', 'leaving-soon']); // listes qui reprennent des objets déjà présents ailleurs

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const safeImage = (url) => { const u = decodeEntities(url).trim(); return /^https:\/\/[^\s"'<>]{4,290}$/.test(u) ? u : ''; };

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Lit la page de la boutique. Renvoie { date, banner, sections: [{ id, key, title, derived, items: [{ name, image, kind, price, badge }] }], itemCount }.
 * Lève une erreur en français si la page n'a plus le format attendu : rien n'est alors annoncé.
 */
function parseShop(html) {
  const page = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const starts = [];
  const re = /<section\b[^>]*\bid="([^"]+)"[^>]*>/g;
  for (let m = re.exec(page); m; m = re.exec(page)) starts.push({ id: m[1], at: m.index, len: m[0].length });
  const byId = new Map();
  for (const st of starts) {
    const end = page.indexOf('</section>', st.at);
    const body = page.slice(st.at + st.len, end < 0 ? undefined : end);
    const title = cleanField(stripTags((body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || ''), 80);
    const items = [];
    for (const chunk of body.split(/<div class="isg-card[ "]/).slice(1)) {
      const name = cleanField(decodeEntities((chunk.match(/aria-label="([^"]*)"/) || [])[1] || ''), 100);
      const image = safeImage((chunk.match(/<img\b[^>]*\bsrc="([^"]+)"/) || [])[1] || '');
      if (!name || !image) continue;
      const paragraphs = [...chunk.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((x) => stripTags(x[1]));
      const price = cleanField(stripTags((chunk.match(/data-currency="[^"]*"[^>]*>(?:<img\b[^>]*>)?\s*<span\b[^>]*>([^<]*)<\/span>/) || [])[1] || ''), 20);
      const badge = cleanField(stripTags((chunk.match(/class="isg-badge[^"]*"[^>]*>([^<]*)</) || [])[1] || ''), 30);
      items.push({ name, image, kind: cleanField(paragraphs[1] || '', 80), price, badge });
    }
    if (!title && !items.length) continue;
    const key = st.id.replace(/-\d+$/, '');
    const known = byId.get(key);
    if (!known) { byId.set(key, { id: st.id, key, title: title || key, derived: DERIVED_SECTIONS.has(key), items }); continue; }
    // la même section peut apparaître deux fois dans la page : on fusionne sans doublon
    const have = new Set(known.items.map((i) => `${i.name}|${i.image}`));
    for (const it of items) if (!have.has(`${it.name}|${it.image}`)) known.items.push(it);
  }
  const sections = [...byId.values()].filter((sec) => sec.items.length);
  const unique = new Set(sections.filter((sec) => !sec.derived).flatMap((sec) => sec.items.map((i) => `${i.name}|${i.image}`)));
  if (unique.size < 5) throw new Error('La page de la boutique n’a plus le format attendu (aucun objet trouvé). Le site a sûrement changé : rien n’est annoncé.');

  const title = stripTags((page.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const d = title.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  const month = d ? MONTHS_EN.indexOf(d[1].toLowerCase()) : -1;
  const date = d && month >= 0 ? `${d[3]}-${String(month + 1).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}` : '';
  const banner = safeImage((page.match(/<meta\b[^>]*property="og:image"[^>]*content="([^"]+)"/) || page.match(/<meta\b[^>]*content="([^"]+)"[^>]*property="og:image"/) || [])[1] || '');
  return { date, banner, sections, itemCount: unique.size };
}

const itemKey = (i) => `${i.name}|${i.image}`;
/** Empreinte de la boutique (change quand un objet ou un prix change ; les listes « nouveau » et « dernier jour » ne comptent pas). */
function shopSignature(shop) {
  const rows = shop.sections.filter((sec) => !sec.derived).flatMap((sec) => sec.items.map((i) => `${itemKey(i)}|${i.price}`)).sort();
  return crypto.createHash('sha1').update(rows.join('\n')).digest('hex').slice(0, 16);
}
/** Clés de tous les objets (une seule fois chacun), hors listes dérivées. */
const shopKeys = (shop) => [...new Set(shop.sections.filter((sec) => !sec.derived).flatMap((sec) => sec.items.map(itemKey)))];
const sectionOf = (shop, key) => shop.sections.find((sec) => sec.key === key);

/** Nouveautés : la liste « new today » du site ; à défaut, les objets absents de la boutique précédente. */
function newItems(shop, previousKeys = []) {
  const listed = sectionOf(shop, 'new-today')?.items;
  if (listed?.length) return listed;
  const had = new Set(previousKeys);
  const seen = new Set();
  return shop.sections.filter((sec) => !sec.derived).flatMap((sec) => sec.items).filter((i) => !had.has(itemKey(i)) && !seen.has(itemKey(i)) && seen.add(itemKey(i)));
}
const leavingItems = (shop) => sectionOf(shop, 'leaving-soon')?.items || [];

/* ---- Textes en français ---- */
const RARITY_FR = [['black market', 'Marché noir'], ['very rare', 'Très rare'], ['uncommon', 'Peu commun'], ['exotic', 'Exotique'], ['import', 'Import'], ['limited', 'Limité'], ['common', 'Commun'], ['rare', 'Rare']];
const KIND_FR = {
  body: 'Carrosserie', 'goal explosion': 'Explosion de but', wheels: 'Jantes', decal: 'Décalcomanie', 'animated decal': 'Décalcomanie animée', trail: 'Traînée', 'player anthem': 'Hymne',
  antenna: 'Antenne', topper: 'Chapeau', boost: 'Boost', 'paint finish': 'Peinture', 'player banner': 'Bannière', 'avatar border': 'Cadre d’avatar', 'player title': 'Titre', 'engine audio': 'Son du moteur',
};
function frKind(text) {
  const raw = cleanField(text, 80);
  const items = raw.match(/^(\d+) items?\b(.*)$/i);
  if (items) return `${items[1]} objet${items[1] === '1' ? '' : 's'}${items[2].replace(/Credits each/i, 'crédits chacun').replace(/Credits/i, 'crédits')}`;
  const low = raw.toLowerCase();
  const rarity = RARITY_FR.find(([en]) => low.startsWith(`${en} `));
  const rest = rarity ? raw.slice(rarity[0].length + 1) : raw;
  const kind = KIND_FR[rest.toLowerCase()] || rest;
  return rarity ? `${kind} · ${rarity[1]}` : kind;
}
function frPrice(price) {
  const p = cleanField(price, 20);
  if (!p) return '';
  if (/^free$/i.test(p)) return 'Gratuit';
  return /^[\d,]+$/.test(p) ? `${p.replace(/,/g, ' ')} crédits` : p;
}
const SECTION_FR = { 'new-today': 'Nouveautés du jour', 'leaving-soon': 'Derniers jours', 'featured-shop': 'Boutique à la une', bundles: 'Lots', rlcs: 'RLCS' };
const sectionTitle = (sec) => SECTION_FR[sec.key] || sec.title;
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function frDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS_FR[Number(m[2]) - 1]} ${m[1]}` : '';
}
/** Liste à puces d'objets, bornée en longueur. */
function itemLines(items, max = 1000) {
  const lines = [];
  let size = 0;
  for (const [n, it] of items.entries()) {
    const line = `• **${it.name}**${it.kind ? ` (${frKind(it.kind)})` : ''}${it.price ? ` : ${frPrice(it.price)}` : ''}`;
    if (size + line.length + 1 > max) { lines.push(`… et ${items.length - n} autre${items.length - n > 1 ? 's' : ''}`); break; }
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n') || 'Rien pour le moment.';
}
/** Images à montrer : nouveautés d'abord, puis derniers jours, sans doublon. */
function pickImages(shop, previousKeys, limit) {
  const out = [];
  const seen = new Set();
  for (const it of [...newItems(shop, previousKeys), ...leavingItems(shop)]) {
    if (out.length >= limit) break;
    if (!seen.has(it.image)) { seen.add(it.image); out.push(it); }
  }
  return out;
}

module.exports = {
  SHOP_URL, SHOP_SOURCE, parseShop, shopSignature, shopKeys, newItems, leavingItems, frKind, frPrice, frDate, itemLines, pickImages, sectionTitle, decodeEntities,
  AGE_MIN, AGE_MAX, hasLink, cleanField, parseAge, resolveMode, MODES, modeById, shuffle, splitTeams, matchCredentials, CHALLENGES, pickChallenge };
