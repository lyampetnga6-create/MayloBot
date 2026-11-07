'use strict';
/** Logique pure des commandes de divertissement et utilitaires (testable sans Discord). */
const crypto = require('node:crypto');

const rand = (n) => crypto.randomInt(n);
const pick = (arr) => arr[rand(arr.length)];

const EIGHT_BALL = [
  'Oui, sans aucun doute.', 'C’est certain.', 'Tout indique que oui.', 'Très probablement.', 'Les signes sont favorables.',
  'Demande-moi plus tard.', 'Je ne peux pas le dire maintenant.', 'Concentre-toi et redemande.',
  'N’y compte pas.', 'Ma réponse est non.', 'Mes sources disent non.', 'Très improbable.', 'Les étoiles disent non.',
];

const JOKES = [
  'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon ils tombent dans le bateau.',
  'Que dit un informaticien quand il se noie ? F1 ! F1 !',
  'Quel est le comble pour un électricien ? De ne pas être au courant.',
  'Pourquoi les développeurs confondent Halloween et Noël ? Parce que 31 OCT = 25 DEC.',
  'Que fait une fraise sur un cheval ? Tagada, tagada !',
  'Pourquoi le livre de maths est-il triste ? Parce qu’il a trop de problèmes.',
  'Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ? Un chat-peint de Noël.',
  'Qu’est-ce qu’un crocodile qui surveille la pharmacie ? Un Lacoste garde-malade.',
  'Pourquoi les serveurs Discord ne jouent-ils jamais à cache-cache ? Parce qu’ils sont toujours en ligne.',
  'Un bug entre dans un bar. Le barman : « On ne sert pas les bugs ici. » Le bug : « Ce n’est pas une fonctionnalité ? »',
  'Que dit un escargot qui monte sur le dos d’une tortue ? « Youhouuu ! »',
  'Pourquoi les poissons détestent-ils l’ordinateur ? À cause du filet.',
];

const FACTS = [
  'Le miel ne se périme jamais : on en a retrouvé de comestible dans des tombes égyptiennes.',
  'Les poulpes ont trois cœurs et un sang bleu.',
  'Un jour sur Vénus dure plus longtemps qu’une année vénusienne.',
  'La tour Eiffel peut grandir de 15 cm en été à cause de la dilatation du métal.',
  'Les bananes sont légèrement radioactives (à cause du potassium 40).',
  'Les loutres se tiennent la patte pendant leur sommeil pour ne pas se perdre.',
  'Il y a plus d’arbres sur Terre que d’étoiles dans la Voie lactée.',
  'Les wombats font des crottes en forme de cubes.',
  'Le cœur d’une crevette est situé dans sa tête.',
  'La première webcam au monde servait à surveiller une cafetière à Cambridge.',
];

const HUGS = {
  hug: ['serre', 'dans ses bras'], pat: ['caresse la tête de', ''], slap: ['donne une claque à', ''], kiss: ['fait un bisou à', ''],
  highfive: ['checke', ''], poke: ['tapote', ''], cuddle: ['fait un gros câlin à', ''], bonk: ['donne un coup de batte à', ''],
};

const QUIZ = [
  { q: 'Quelle est la capitale de l’Australie ?', a: 'Canberra', w: ['Sydney', 'Melbourne', 'Perth'] },
  { q: 'Combien y a-t-il de planètes dans le système solaire ?', a: '8', w: ['7', '9', '10'] },
  { q: 'Qui a peint La Joconde ?', a: 'Léonard de Vinci', w: ['Michel-Ange', 'Raphaël', 'Botticelli'] },
  { q: 'Quel est le plus grand océan ?', a: 'Pacifique', w: ['Atlantique', 'Indien', 'Arctique'] },
  { q: 'En quelle année l’homme a-t-il marché sur la Lune ?', a: '1969', w: ['1965', '1972', '1959'] },
  { q: 'Quel est l’élément chimique de symbole « Fe » ?', a: 'Fer', w: ['Fluor', 'Francium', 'Fermium'] },
  { q: 'Combien de côtés a un hexagone ?', a: '6', w: ['5', '7', '8'] },
  { q: 'Quel langage de programmation porte le nom d’un serpent ?', a: 'Python', w: ['Ruby', 'Java', 'Cobra'] },
  { q: 'Quel pays a la forme d’une botte ?', a: 'Italie', w: ['Grèce', 'Espagne', 'Portugal'] },
  { q: 'Qui a écrit « Les Misérables » ?', a: 'Victor Hugo', w: ['Émile Zola', 'Balzac', 'Alexandre Dumas'] },
  { q: 'Quelle est la plus haute montagne du monde ?', a: 'Everest', w: ['K2', 'Mont Blanc', 'Kilimandjaro'] },
  { q: 'Combien de joueurs y a-t-il dans une équipe de football sur le terrain ?', a: '11', w: ['9', '10', '12'] },
  { q: 'Quel gaz les plantes absorbent-elles pour la photosynthèse ?', a: 'Dioxyde de carbone', w: ['Oxygène', 'Azote', 'Hélium'] },
  { q: 'Quelle est la monnaie du Japon ?', a: 'Yen', w: ['Won', 'Yuan', 'Ringgit'] },
  { q: 'Dans quel pays se trouve le Machu Picchu ?', a: 'Pérou', w: ['Mexique', 'Chili', 'Bolivie'] },
  { q: 'Quel est le plus grand mammifère terrestre ?', a: 'L’éléphant d’Afrique', w: ['La girafe', 'Le rhinocéros', 'L’hippopotame'] },
  { q: 'Combien de touches possède un piano standard ?', a: '88', w: ['76', '92', '100'] },
  { q: 'Quel est le résultat de 7 × 8 ?', a: '56', w: ['54', '48', '64'] },
  { q: 'Quelle planète est surnommée la planète rouge ?', a: 'Mars', w: ['Vénus', 'Jupiter', 'Mercure'] },
  { q: 'Qui a développé la théorie de la relativité ?', a: 'Albert Einstein', w: ['Isaac Newton', 'Niels Bohr', 'Galilée'] },
];

/* ------------------------------- Aléatoire ------------------------------ */

function rollDice(spec) {
  const m = /^(\d{1,2})?d(\d{1,4})(?:([+-])(\d{1,5}))?$/i.exec(String(spec).trim().replace(/\s+/g, ''));
  if (!m) return null;
  const count = Number(m[1] || 1);
  const sides = Number(m[2]);
  if (count < 1 || count > 20 || sides < 2) return null;
  const rolls = Array.from({ length: count }, () => 1 + rand(sides));
  const bonus = m[3] ? (m[3] === '-' ? -Number(m[4]) : Number(m[4])) : 0;
  return { rolls, bonus, total: rolls.reduce((a, b) => a + b, 0) + bonus, count, sides };
}

/** Pierre-feuille-ciseaux : 0 = égalité, 1 = le joueur gagne, -1 = il perd. */
const RPS = ['pierre', 'feuille', 'ciseaux'];
function rpsOutcome(player, bot) {
  if (player === bot) return 0;
  return (player === 'pierre' && bot === 'ciseaux') || (player === 'feuille' && bot === 'pierre') || (player === 'ciseaux' && bot === 'feuille') ? 1 : -1;
}

/** Pourcentage « de compatibilité » stable pour un couple (toujours le même, quel que soit l’ordre). */
function shipScore(a, b) {
  const key = [String(a), String(b)].sort().join(':');
  const h = crypto.createHash('sha256').update(key).digest();
  return h.readUInt16BE(0) % 101;
}

function rateScore(label) {
  const h = crypto.createHash('sha256').update(String(label).toLowerCase()).digest();
  return h[0] % 11;
}

function coinflip() { return rand(2) === 0 ? 'pile' : 'face'; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* -------------------------------- Morpion ------------------------------- */

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** @param {string[]} board 9 cases : '', 'X' ou 'O' → 'X' | 'O' | 'draw' | null */
function tttWinner(board) {
  for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? 'draw' : null;
}

/* ------------------------------- Calculatrice --------------------------- */

/**
 * Évalue une expression arithmétique sans jamais utiliser eval.
 * Opérateurs : + - * / % ^ ( ), décimaux, constantes pi/e, fonctions sqrt/abs/round/floor/ceil.
 * @returns {number|null}
 */
function calculate(input) {
  const src = String(input).toLowerCase().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!src || src.length > 120) return null;
  const tokens = [];
  const re = /(\d+\.?\d*|\.\d+)|([a-z]+)|([-+*/%^()])/gy;
  let m; let last = 0;
  while ((m = re.exec(src))) {
    if (m.index !== last) return null;
    last = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'n', v: Number(m[1]) });
    else if (m[2]) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
  }
  if (last !== src.length) return null;

  let i = 0;
  const FN = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  const CONST = { pi: Math.PI, e: Math.E };
  const peek = () => tokens[i];
  const eat = (v) => { if (peek()?.t === 'op' && peek().v === v) { i++; return true; } return false; };
  let depth = 0;

  function primary() {
    const tk = peek();
    if (!tk) throw new Error('fin');
    if (tk.t === 'n') { i++; return tk.v; }
    if (tk.t === 'id') {
      i++;
      if (tk.v in CONST) return CONST[tk.v];
      if (tk.v in FN && eat('(')) { const v = expr(); if (!eat(')')) throw new Error(')'); return FN[tk.v](v); }
      throw new Error('id');
    }
    if (eat('(')) { if (++depth > 20) throw new Error('profondeur'); const v = expr(); depth--; if (!eat(')')) throw new Error(')'); return v; }
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    throw new Error('token');
  }
  function unary() { return power(); }
  function power() { const base = primary(); if (eat('^')) { const ex = unary(); return base ** ex; } return base; }
  function term() {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else if (eat('%')) v %= unary();
      else if (peek() && (peek().t === 'n' || peek().t === 'id' || (peek().t === 'op' && peek().v === '('))) v *= unary(); // 2(3), 2pi
      else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }
  try {
    const result = expr();
    if (i !== tokens.length || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/* -------------------------------- Texte --------------------------------- */

const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };

function toMorse(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split('').map((c) => (c === ' ' ? '/' : MORSE[c] || '')).filter(Boolean).join(' ');
}

function mockCase(text) { let k = 0; return [...String(text)].map((c) => (/\p{L}/u.test(c) ? (k++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c)).join(''); }
function reverseText(text) { return [...String(text)].reverse().join(''); }
const CLAP = (text) => String(text).trim().split(/\s+/).join(' 👏 ');

const FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', '?': '¿', '!': '¡', '.': '˙', ',': '\'' };
function upsideDown(text) { return [...String(text).toLowerCase()].reverse().map((c) => FLIP[c] || c).join(''); }

module.exports = {
  EIGHT_BALL, JOKES, FACTS, HUGS, QUIZ, RPS, pick, rand, rollDice, rpsOutcome, shipScore, rateScore, coinflip, shuffle,
  tttWinner, calculate, toMorse, mockCase, reverseText, CLAP, upsideDown,
};
