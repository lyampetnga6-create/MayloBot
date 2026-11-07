'use strict';
/**
 * Outils Valorant sans dépendance : modes, agents, cartes, équipes aléatoires, compositions et défis,
 * plus les petites fonctions de nettoyage utilisées par le formulaire /mate.
 * Toutes les fonctions de tirage acceptent un générateur aléatoire (`rnd`, renvoie un entier de 0 à n-1) pour rester testables.
 */
const crypto = require('node:crypto');

const rndInt = (n) => crypto.randomInt(n);

/** Modes proposés pour /mate. `team` = taille d'un groupe, `lookFor` = joueurs recherchés par défaut. */
const MODES = [
  { id: 'competitif', label: 'Compétitif', team: 5, lookFor: 4 },
  { id: 'premier', label: 'Premier', team: 5, lookFor: 4 },
  { id: 'nonclasse', label: 'Non classé', team: 5, lookFor: 4 },
  { id: 'rapide', label: 'Partie rapide', team: 5, lookFor: 4 },
  { id: 'spikerush', label: 'Spike Rush', team: 5, lookFor: 4 },
  { id: 'melee', label: 'Mêlée générale', team: 5, lookFor: 4 },
  { id: 'escalade', label: 'Escalade', team: 5, lookFor: 4 },
  { id: 'replication', label: 'Réplication', team: 5, lookFor: 4 },
  { id: 'duo', label: 'Duo', team: 2, lookFor: 1 },
  { id: 'perso', label: 'Partie personnalisée', team: 10, lookFor: 7 },
  { id: 'scrim', label: 'Scrim', team: 5, lookFor: 4 },
  { id: 'tournoi', label: 'Tournoi', team: 5, lookFor: 4 },
  { id: 'training', label: 'Entraînement', team: 2, lookFor: 1 },
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

const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MODE_WORDS = [
  ['nonclasse', /non\s*classe|unrated|\bnormale?\b/], // avant « compétitif » : « non classé » contient « classé »
  ['competitif', /compet|ranked|\brank\b|classe/],
  ['premier', /premier/],
  ['rapide', /rapide|swift/],
  ['spikerush', /spike\s*rush|\brush\b/],
  ['melee', /melee|deathmatch|\bdm\b/],
  ['escalade', /escalade|escalation/],
  ['replication', /replic/],
  ['duo', /\bduo\b|\b2\s*(v|c|vs)\s*2\b/],
  ['perso', /perso|custom|\b5\s*(v|c|vs)\s*5\b/],
  ['scrim', /scrim/],
  ['tournoi', /tournoi|tournament|tourney/],
  ['training', /train|entrain|stand\s*de\s*tir|range/],
];
/**
 * Mode écrit par le joueur. Un mode connu (compétitif, premier, spike rush…) donne son libellé et son nombre de places habituel ;
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
const pick = (list, rnd = rndInt) => list[rnd(list.length)];

/* ------------------------------ Agents et cartes ------------------------------ */
const ROLES = ['Duelliste', 'Initiateur', 'Contrôleur', 'Sentinelle'];
/** Agents jouables. Quand Riot en ajoute un, il suffit d'ajouter une ligne ici. */
const AGENTS = [
  ['Astra', 'Contrôleur'], ['Breach', 'Initiateur'], ['Brimstone', 'Contrôleur'], ['Chamber', 'Sentinelle'], ['Clove', 'Contrôleur'],
  ['Cypher', 'Sentinelle'], ['Deadlock', 'Sentinelle'], ['Fade', 'Initiateur'], ['Gekko', 'Initiateur'], ['Harbor', 'Contrôleur'],
  ['Iso', 'Duelliste'], ['Jett', 'Duelliste'], ['KAY/O', 'Initiateur'], ['Killjoy', 'Sentinelle'], ['Neon', 'Duelliste'],
  ['Omen', 'Contrôleur'], ['Phoenix', 'Duelliste'], ['Raze', 'Duelliste'], ['Reyna', 'Duelliste'], ['Sage', 'Sentinelle'],
  ['Skye', 'Initiateur'], ['Sova', 'Initiateur'], ['Tejo', 'Initiateur'], ['Veto', 'Sentinelle'], ['Viper', 'Contrôleur'],
  ['Vyse', 'Sentinelle'], ['Waylay', 'Duelliste'], ['Yoru', 'Duelliste'],
].map(([name, role]) => ({ name, role }));
/** Cartes. La rotation compétitive change à chaque saison : /map tire dans toute cette liste. */
const MAPS = ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset'];

/** Nom de rôle écrit librement (« duelliste », « Sentinelles », « controleur »…) → rôle officiel, ou null. */
function roleKey(text) {
  const w = fold(text).trim().replace(/s$/, '');
  return w.length >= 3 ? ROLES.find((r) => fold(r).startsWith(w)) || null : null;
}

/** Un agent au hasard, éventuellement limité à un rôle (nom du rôle, accents et pluriel tolérés). */
function pickAgent(role = '', rnd = rndInt) {
  const wanted = role ? roleKey(role) : null;
  const pool = wanted ? AGENTS.filter((a) => a.role === wanted) : AGENTS;
  return pick(pool, rnd);
}
const pickMap = (rnd = rndInt) => pick(MAPS, rnd);

/** Composition de 5 agents : un Duelliste, un Initiateur, un Contrôleur, une Sentinelle et un cinquième libre (sans doublon). */
function randomComp(rnd = rndInt) {
  const comp = ROLES.map((role) => pick(AGENTS.filter((a) => a.role === role), rnd));
  const rest = AGENTS.filter((a) => !comp.includes(a));
  comp.push(pick(rest, rnd));
  return comp;
}

/** Sépare des joueurs en deux camps (attaque et défense) ; l'attaque prend le joueur en trop. */
function splitTeams(players, rnd = rndInt) {
  const mixed = shuffle(players, rnd);
  const half = Math.ceil(mixed.length / 2);
  return { attack: mixed.slice(0, half), defense: mixed.slice(half) };
}

const CHALLENGES = [
  'Gagne un round en n’utilisant que le Classic.',
  'Garde le couteau en main jusqu’au premier contact, puis sors ton arme.',
  'Achète uniquement un Sheriff pendant tous les rounds d’éco.',
  'Ne tire jamais en courant : stoppe-toi à chaque tir (counter-strafe).',
  'Fais un headshot avant le troisième round.',
  'Joue un agent que tu n’as jamais joué en classé.',
  'Annonce à voix haute chaque info de l’ennemi avant de bouger.',
  'Ne meurs pas avant le premier contact de l’équipe adverse sur toute la partie.',
  'Utilise toutes tes capacités à chaque round, même les moins utiles.',
  'Garde ton viseur à hauteur de tête pendant toute la partie, même en te déplaçant.',
  'Pose le Spike en défense de site à chaque fois que tu le peux : lance un retake.',
  'Joue toute la partie avec le Phantom ou le Vandal, jamais une autre arme principale.',
  'Fais un clutch (1 contre 2 ou plus) avant la fin de la partie.',
  'Demande une arme à un coéquipier à chaque round d’éco au lieu de l’acheter.',
  'Joue 5 rounds sans jamais te faire repérer en premier : attends toujours l’info.',
  'Fais au moins un triple kill dans la partie.',
  'Désamorce le Spike au moins une fois, même en dernière seconde.',
  'Ne parle que pour donner des infos utiles (pas de râlage) pendant toute la partie.',
  'Achète toujours ton armure avant ton arme, même aux rounds d’éco.',
  'Fais une partie en Mêlée générale avec un seul type d’arme de ton choix.',
];
const pickChallenge = (rnd = rndInt) => pick(CHALLENGES, rnd);

module.exports = {
  AGE_MIN, AGE_MAX, hasLink, cleanField, parseAge, resolveMode, MODES, modeById, shuffle, splitTeams,
  ROLES, AGENTS, MAPS, pickAgent, pickMap, randomComp, CHALLENGES, pickChallenge,
};
