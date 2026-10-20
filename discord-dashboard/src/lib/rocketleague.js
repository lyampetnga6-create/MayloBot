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
/** Plateformes et rangs proposés dans /lfg. Les identifiants sont ceux de la commande ; seuls les libellés sont affichés. */
const PLATFORMS = [
  { id: 'pc', label: 'PC' },
  { id: 'ps', label: 'PlayStation' },
  { id: 'xbox', label: 'Xbox' },
  { id: 'switch', label: 'Switch' },
];
const RANKS = [
  { id: 'unranked', label: 'Sans rang' },
  { id: 'bronze', label: 'Bronze' },
  { id: 'silver', label: 'Argent' },
  { id: 'gold', label: 'Or' },
  { id: 'platinum', label: 'Platine' },
  { id: 'diamond', label: 'Diamant' },
  { id: 'champion', label: 'Champion' },
  { id: 'gc', label: 'Grand Champion' },
  { id: 'ssl', label: 'Supersonic Legend' },
];
const AGE_MIN = 13; // âge minimum pour avoir un compte Discord
const AGE_MAX = 99;
const platformById = (id) => PLATFORMS.find((p) => p.id === id) || null;
const rankById = (id) => RANKS.find((r) => r.id === id) || null;
/** Liens et invitations : refusés dans les notes (pas de pub dans les annonces). */
const hasLink = (text) => /(discord\.gg|discord(app)?\.com\/invite|https?:\/\/|www\.)/i.test(String(text || ''));

const modeById = (id) => MODES.find((m) => m.id === id) || null;

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
  PLATFORMS, RANKS, AGE_MIN, AGE_MAX, platformById, rankById, hasLink, MODES, modeById, shuffle, splitTeams, matchCredentials, CHALLENGES, pickChallenge };
