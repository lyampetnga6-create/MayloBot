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

module.exports = {
  AGE_MIN, AGE_MAX, hasLink, cleanField, parseAge, resolveMode, MODES, modeById, shuffle, splitTeams, matchCredentials, CHALLENGES, pickChallenge };
