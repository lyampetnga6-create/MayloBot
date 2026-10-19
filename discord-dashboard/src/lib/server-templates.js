'use strict';
/**
 * Plans de serveur : format, validation stricte et modèles prêts à l'emploi (sans IA).
 *
 * Un plan décrit des rôles et des salons ; il n'est JAMAIS appliqué sans validation :
 * tout ce que renvoie l'IA passe par `validatePlan`, qui borne les quantités, nettoie les noms
 * et n'accepte que des préréglages de permissions sûrs (jamais « Administrateur »).
 */

const LIMITS = { roles: 50, categories: 20, channels: 150, perCategory: 50, panels: 10, panelRoles: 25 };

/** Préréglages de permissions (noms des drapeaux discord.js). Aucun ne contient Administrator. */
const PRESETS = {
  none: [],
  helper: ['ManageMessages', 'ModerateMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ViewAuditLog'],
  moderator: ['ManageMessages', 'ModerateMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ViewAuditLog', 'KickMembers', 'BanMembers', 'ManageThreads', 'MentionEveryone'],
  manager: ['ManageMessages', 'ModerateMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ViewAuditLog', 'KickMembers', 'BanMembers', 'ManageThreads', 'MentionEveryone', 'ManageChannels', 'ManageRoles', 'ManageEvents', 'CreateGuildExpressions'],
};

const KINDS = ['staff', 'member', 'cosmetic'];
const CHANNEL_TYPES = ['text', 'voice', 'announcement', 'forum', 'stage'];
const ACCESS = ['public', 'readonly', 'members', 'staff'];
const PURPOSES = ['welcome', 'rules', 'logs', 'tickets', 'suggestions', 'verification', 'announcements', 'general', 'roles', 'videos', 'lives'];

const stripControl = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const lc = (s) => stripControl(s).toLowerCase();

function cleanRoleName(s) {
  return stripControl(s).replace(/[@#:`]/g, '').slice(0, 100).trim();
}

function cleanChannelName(s, type) {
  let n = stripControl(s).replace(/[@#:`]/g, '');
  if (type === 'voice' || type === 'stage') return n.slice(0, 100).trim();
  // Les salons textuels n'ont ni espaces ni majuscules.
  n = n.toLowerCase().replace(/\s+/g, '-').replace(/-{3,}/g, '--').replace(/^-+|-+$/g, '');
  return n.slice(0, 100);
}

function cleanCategoryName(s) {
  return stripControl(s).replace(/[@#:`]/g, '').slice(0, 100).trim();
}

function cleanColor(c) {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim().toLowerCase() : '';
}

/**
 * Valide et nettoie un plan brut (venant de l'IA ou d'un import). Ne lève pas d'exception :
 * renvoie le plan nettoyé + la liste des corrections effectuées.
 */
function validatePlan(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') return { plan: { roles: [], categories: [] }, warnings: ['Plan vide ou illisible.'] };

  /* ---- Rôles ---- */
  const roles = [];
  const roleKeys = new Set();
  const seenNames = new Set();
  for (const r of Array.isArray(raw.roles) ? raw.roles : []) {
    if (roles.length >= LIMITS.roles) { warnings.push(`Plus de ${LIMITS.roles} rôles : les suivants sont ignorés.`); break; }
    const name = cleanRoleName(r?.name);
    if (!name) continue;
    if (seenNames.has(name.toLowerCase())) { warnings.push(`Rôle en double ignoré : ${name}`); continue; }
    seenNames.add(name.toLowerCase());
    let key = lc(r.key || name).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `role${roles.length + 1}`;
    while (roleKeys.has(key)) key += '_';
    roleKeys.add(key);
    let preset = PRESETS[r.preset] ? r.preset : 'none';
    if (r.preset && !PRESETS[r.preset]) warnings.push(`Rôle « ${name} » : préréglage de permissions inconnu, remplacé par « aucun ».`);
    const kind = KINDS.includes(r.kind) ? r.kind : (preset !== 'none' ? 'staff' : 'cosmetic');
    // Un rôle « membre/décoratif » ne reçoit jamais de permissions de modération.
    if (kind !== 'staff' && preset !== 'none') { preset = 'none'; warnings.push(`Rôle « ${name} » : permissions retirées (réservées aux rôles du staff).`); }
    roles.push({ key, name, color: cleanColor(r.color), hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable), kind, preset });
  }

  /* ---- Catégories et salons ---- */
  const categories = [];
  let channelCount = 0;
  for (const c of Array.isArray(raw.categories) ? raw.categories : []) {
    if (categories.length >= LIMITS.categories) { warnings.push(`Plus de ${LIMITS.categories} catégories : les suivantes sont ignorées.`); break; }
    const name = cleanCategoryName(c?.name);
    if (!name) continue;
    const access = ACCESS.includes(c.access) ? c.access : 'public';
    const channels = [];
    const names = new Set();
    for (const ch of Array.isArray(c.channels) ? c.channels : []) {
      if (channelCount >= LIMITS.channels) { warnings.push(`Plus de ${LIMITS.channels} salons : les suivants sont ignorés.`); break; }
      if (channels.length >= LIMITS.perCategory) break;
      const type = CHANNEL_TYPES.includes(ch?.type) ? ch.type : 'text';
      const chName = cleanChannelName(ch?.name, type);
      if (!chName) continue;
      const dup = `${type}:${chName}`;
      if (names.has(dup)) continue;
      names.add(dup);
      channels.push({
        name: chName,
        type,
        topic: stripControl(ch.topic).slice(0, type === 'forum' ? 1024 : 1024),
        access: ACCESS.includes(ch.access) ? ch.access : access,
        purpose: PURPOSES.includes(ch.purpose) ? ch.purpose : '',
        nsfw: Boolean(ch.nsfw),
        slowmode: Math.max(0, Math.min(21600, Math.trunc(Number(ch.slowmode) || 0))),
        userLimit: type === 'voice' ? Math.max(0, Math.min(99, Math.trunc(Number(ch.userLimit) || 0))) : 0,
      });
      channelCount++;
    }
    categories.push({ name, access, channels });
  }

  /* ---- Panneaux de rôles à boutons (facultatif) : seuls des rôles décoratifs du plan peuvent être choisis par les membres ---- */
  const selfRoles = [];
  for (const p of Array.isArray(raw.selfRoles) ? raw.selfRoles : []) {
    if (selfRoles.length >= LIMITS.panels) break;
    const name = stripControl(p?.name).replace(/[@#:`]/g, '').slice(0, 60);
    const keys = [...new Set((Array.isArray(p?.roles) ? p.roles : []).map(String))]
      .filter((k) => roles.some((r) => r.key === k && r.kind === 'cosmetic'))
      .slice(0, LIMITS.panelRoles);
    if (!name || !keys.length) continue;
    selfRoles.push({ name, mode: p.mode === 'unique' ? 'unique' : 'toggle', roles: keys });
  }

  if (!roles.length && !categories.length) warnings.push('Le plan ne contient ni rôle ni salon.');
  return { plan: { name: stripControl(raw.name).slice(0, 100), roles, categories, selfRoles }, warnings };
}

/** Résumé chiffré d'un plan. */
function summarize(plan) {
  return {
    roles: plan.roles.length,
    categories: plan.categories.length,
    channels: plan.categories.reduce((n, c) => n + c.channels.length, 0),
  };
}

/* ------------------------------ Modèles ------------------------------- */

const t = (name, topic = '', extra = {}) => ({ name, type: 'text', topic, ...extra });
const v = (name, extra = {}) => ({ name, type: 'voice', ...extra });

const STAFF_ROLES = [
  { key: 'owner', name: '👑 Fondateur', color: '#a855f7', hoist: true, kind: 'staff', preset: 'manager' },
  { key: 'admin', name: '🛡️ Administrateur', color: '#8b5cf6', hoist: true, kind: 'staff', preset: 'manager' },
  { key: 'mod', name: '🔨 Modérateur', color: '#7c3aed', hoist: true, kind: 'staff', preset: 'moderator' },
  { key: 'helper', name: '💜 Helper', color: '#c4b5fd', hoist: true, kind: 'staff', preset: 'helper' },
];

const STAFF_CATEGORY = {
  name: '🔒 STAFF',
  access: 'staff',
  channels: [t('staff-général', 'Discussion de l’équipe'), t('staff-logs', 'Journaux du bot', { purpose: 'logs' }), t('sanctions', 'Suivi des sanctions'), v('Réunion staff')],
};

const INFO_CATEGORY = {
  name: '📌 INFORMATIONS',
  access: 'readonly',
  channels: [
    t('bienvenue', 'Les nouveaux membres sont accueillis ici', { purpose: 'welcome' }),
    t('règlement', 'Lis les règles avant de participer', { purpose: 'rules' }),
    t('annonces', 'Les nouveautés du serveur', { type: 'announcement', purpose: 'announcements' }),
  ],
};

const SUPPORT_CATEGORY = {
  name: '🎫 SUPPORT',
  access: 'public',
  channels: [
    t('ouvrir-un-ticket', 'Clique sur le bouton pour contacter le staff', { purpose: 'tickets', access: 'readonly' }),
    t('suggestions', 'Propose tes idées pour le serveur', { purpose: 'suggestions' }),
  ],
};


/* ---------------------- Communauté Rocket League ---------------------- */
const rl = (key, name, color, extra = {}) => ({ key, name, color, kind: 'cosmetic', preset: 'none', ...extra });

const RL_RANKS = [
  rl('rank-none', '🔰 Sans rang', '#6b7280'),
  rl('rank-bronze', '🥉 Bronze', '#cd7f32'),
  rl('rank-silver', '🥈 Argent', '#c0c0c0'),
  rl('rank-gold', '🥇 Or', '#ffd700'),
  rl('rank-platinum', '💠 Platine', '#3bd1f5'),
  rl('rank-diamond', '💎 Diamant', '#4a7cff'),
  rl('rank-champion', '🏆 Champion', '#d946ef'),
  rl('rank-gc', '🔥 Grand Champion', '#ef4444'),
  rl('rank-ssl', '⚡ Supersonic Legend', '#f8fafc'),
];
const RL_PLATFORMS = [
  rl('plat-pc', '🖥️ PC', '#94a3b8'),
  rl('plat-ps', '🎮 PlayStation', '#2563eb'),
  rl('plat-xbox', '🟩 Xbox', '#16a34a'),
  rl('plat-switch', '🕹️ Switch', '#ef4444'),
];
const RL_MODES = [
  rl('mode-1v1', '🎯 1v1', '#fb923c'),
  rl('mode-2v2', '🤝 2v2', '#fbbf24'),
  rl('mode-3v3', '👥 3v3', '#a3e635'),
  rl('mode-special', '🎪 Modes spéciaux', '#2dd4bf'),
];
const RL_REGIONS = [
  rl('reg-fr', '🇫🇷 France', '#60a5fa'),
  rl('reg-be', '🇧🇪 Belgique', '#facc15'),
  rl('reg-ch', '🇨🇭 Suisse', '#f87171'),
  rl('reg-qc', '🇨🇦 Québec', '#38bdf8'),
  rl('reg-other', '🌍 Autre région', '#9ca3af'),
];
const RL_PINGS = [
  rl('notif-annonces', '📢 Annonces', '#c4b5fd', { mentionable: true }),
  rl('notif-videos', '🎬 Notif vidéos', '#f472b6', { mentionable: true }),
  rl('notif-lives', '🔴 Notif lives', '#ef4444', { mentionable: true }),
  rl('notif-drops', '🎁 Drops & giveaways', '#34d399', { mentionable: true }),
  rl('notif-tournois', '🏟️ Tournois', '#fbbf24', { mentionable: true }),
];

const ROCKET_LEAGUE = {
  id: 'rocketleague',
  name: 'Communauté Rocket League',
  icon: '🚀',
  description: 'Serveur complet pour joueurs de Rocket League : rangs, recherche d’équipe, coaching, tournois, échanges, TikTok et lives.',
  plan: {
    name: 'Rocket League',
    roles: [
      ...STAFF_ROLES,
      rl('coach', '🎓 Coach', '#38bdf8', { hoist: true }),
      rl('creator', '🎬 Créateur', '#f472b6', { hoist: true }),
      rl('captain', '🧢 Capitaine d’équipe', '#fb923c', { hoist: true }),
      rl('vip', '✨ VIP', '#f0abfc', { hoist: true }),
      { key: 'member', name: '🚀 Joueur', color: '#a78bfa', kind: 'member', preset: 'none' },
      ...RL_RANKS, ...RL_PLATFORMS, ...RL_MODES, ...RL_REGIONS, ...RL_PINGS,
    ],
    selfRoles: [
      { name: 'Ton rang', mode: 'unique', roles: RL_RANKS.map((r) => r.key) },
      { name: 'Ta plateforme', mode: 'toggle', roles: RL_PLATFORMS.map((r) => r.key) },
      { name: 'Tes modes de jeu', mode: 'toggle', roles: RL_MODES.map((r) => r.key) },
      { name: 'Ta région', mode: 'unique', roles: RL_REGIONS.map((r) => r.key) },
      { name: 'Notifications', mode: 'toggle', roles: RL_PINGS.map((r) => r.key) },
    ],
    categories: [
      {
        name: '📌 INFORMATIONS',
        access: 'readonly',
        channels: [
          t('bienvenue', 'Les nouveaux joueurs sont accueillis ici', { purpose: 'welcome' }),
          t('règlement', 'Lis les règles avant de jouer avec nous', { purpose: 'rules' }),
          t('annonces', 'Les nouveautés du serveur', { type: 'announcement', purpose: 'announcements' }),
          t('choisis-tes-rôles', 'Rang, plateforme, modes, région et notifications : clique sur les boutons', { purpose: 'roles' }),
          t('faq', 'Les questions qu’on nous pose le plus souvent'),
          t('guide-anti-arnaque', 'Échanges, drops, faux giveaways : comment ne pas se faire avoir'),
          t('liens-utiles', 'Tracker, replays, outils d’entraînement et sites de confiance'),
        ],
      },
      {
        name: '🚀 ACTUS ROCKET LEAGUE',
        access: 'readonly',
        channels: [
          t('actus-rocket-league', 'Les news du jeu', { type: 'announcement' }),
          t('patch-notes', 'Mises à jour et changements d’équilibrage'),
          t('boutique-objets', 'La boutique d’objets du jour'),
          t('événements-saison', 'Événements en jeu, récompenses et passe de saison'),
          t('esport', 'RLCS et compétitions officielles : dates et résultats'),
        ],
      },
      {
        name: '🎬 TIKTOK & LIVES',
        access: 'readonly',
        channels: [
          t('nouvelles-vidéos', 'Chaque nouvelle vidéo TikTok est annoncée ici', { purpose: 'videos' }),
          t('lives-tiktok', 'Prévenu dès que le live démarre', { purpose: 'lives' }),
          t('tutos-et-astuces', 'Les tutos à retrouver ou à revoir'),
        ],
      },
      {
        name: '💬 COMMUNAUTÉ',
        access: 'members',
        channels: [
          t('général', 'Discute de tout et de rien', { purpose: 'general' }),
          t('présentations', 'Présente-toi : pseudo, rang, plateforme, objectifs'),
          t('off-topic', 'Tout ce qui n’a pas de rapport avec Rocket League'),
          t('mèmes-rocket-league', 'Les meilleures blagues du jeu'),
          t('clips-et-buts', 'Tes plus beaux buts, sauvetages et fails', { slowmode: 10 }),
          t('garage-et-customisation', 'Voitures, decals, jantes et combinaisons', { slowmode: 10 }),
          t('bot-commandes', 'Utilise les commandes du bot ici'),
        ],
      },
      {
        name: '🎮 JOUER ENSEMBLE',
        access: 'members',
        channels: [
          t('recherche-de-joueurs', 'Cherche des partenaires pour une partie : précise ton rang, ta plateforme et le mode', { slowmode: 30 }),
          t('recherche-2v2', 'Trouve un coéquipier pour les Doubles', { slowmode: 30 }),
          t('recherche-3v3', 'Complète ton équipe pour les Standard', { slowmode: 30 }),
          t('recherche-modes-spéciaux', 'Rumble, Hoops, Dropshot et Snow Day', { slowmode: 30 }),
          t('coéquipier-fixe', 'Cherche un partenaire régulier pour progresser ensemble'),
          t('recherche-de-team', 'Équipes qui recrutent et joueurs qui cherchent une team'),
          t('sessions-entraînement', 'Organise une session d’entraînement'),
          t('scrims', 'Matchs d’entraînement entre équipes'),
        ],
      },
      {
        name: '📈 PROGRESSER',
        access: 'members',
        channels: [
          t('conseils-généraux', 'Pose tes questions et partage tes conseils'),
          { name: 'analyse-de-replays', type: 'forum', topic: 'Un post par replay : indique ton rang, le moment à analyser et ce que tu voudrais améliorer' },
          t('mécaniques-de-base', 'Conduite, boost, premières touches, sauts et saves'),
          t('rotations-et-placement', 'Rotations, positionnement et lecture du jeu'),
          t('défense-et-gardien', 'Sauvetages, défense et jeu de dernier défenseur'),
          t('mécaniques-avancées', 'Flip reset, air dribble, ceiling shots, wall dribble'),
          t('training-packs', 'Partage tes codes de packs d’entraînement'),
          t('réglages-caméra-commandes', 'Caméra, sensibilité, deadzone et configuration manette ou clavier'),
          t('coaching', 'Demande un coaching ou propose le tien'),
        ],
      },
      {
        name: '🏆 COMPÉTITION',
        access: 'members',
        channels: [
          t('inscriptions-tournois', 'Inscris-toi aux tournois du serveur'),
          t('résultats', 'Résultats et classements des tournois'),
          t('ligues-et-équipes', 'Ligues communautaires, équipes et calendriers'),
          t('défis-de-la-semaine', 'Un défi chaque semaine : relève-le et partage ta preuve'),
          t('pronostics-esport', 'Tes pronostics sur les matchs de RLCS'),
          t('discussion-tournois', 'Discute des tournois en cours'),
        ],
      },
      {
        name: '🔄 ÉCHANGES & DROPS',
        access: 'members',
        channels: [
          t('échanges', 'Propose ou cherche un échange. Lis d’abord le guide anti-arnaque', { slowmode: 30 }),
          t('estimation-de-prix', 'Demande la valeur d’un objet'),
          t('drops-et-giveaways', 'Drops, concours et cadeaux de la communauté'),
          t('bons-plans', 'Promos, codes et bons plans'),
          t('preuves-et-avis', 'Échanges réussis et retours sur les vendeurs'),
        ],
      },
      {
        name: '🥇 SALONS PAR RANG',
        access: 'members',
        channels: [
          t('bronze-argent', 'Pour les joueurs Bronze et Argent'),
          t('or-platine', 'Pour les joueurs Or et Platine'),
          t('diamant', 'Pour les joueurs Diamant'),
          t('champion-et-plus', 'Champion, Grand Champion et Supersonic Legend'),
        ],
      },
      {
        name: '🔊 VOCAL DÉTENTE',
        access: 'members',
        channels: [v('Lobby'), v('Discussion 1'), v('Discussion 2'), v('Musique'), v('AFK')],
      },
      {
        name: '🏁 PARTIES CLASSÉES',
        access: 'members',
        channels: [
          v('1v1 · Salle 1', { userLimit: 2 }), v('1v1 · Salle 2', { userLimit: 2 }),
          v('Doubles 2v2 · Salle 1', { userLimit: 2 }), v('Doubles 2v2 · Salle 2', { userLimit: 2 }), v('Doubles 2v2 · Salle 3', { userLimit: 2 }),
          v('Standard 3v3 · Salle 1', { userLimit: 3 }), v('Standard 3v3 · Salle 2', { userLimit: 3 }), v('Standard 3v3 · Salle 3', { userLimit: 3 }), v('Standard 3v3 · Salle 4', { userLimit: 3 }),
        ],
      },
      {
        name: '🎲 MODES & ENTRAÎNEMENT',
        access: 'members',
        channels: [
          v('Rumble', { userLimit: 6 }), v('Hoops', { userLimit: 4 }), v('Dropshot', { userLimit: 6 }), v('Snow Day', { userLimit: 6 }),
          v('Match privé', { userLimit: 8 }), v('Entraînement libre', { userLimit: 4 }),
          { name: 'Analyse en direct', type: 'stage', topic: 'Analyse de replays et séances de coaching ouvertes à tous' },
        ],
      },
      {
        ...SUPPORT_CATEGORY,
        channels: [...SUPPORT_CATEGORY.channels, t('aide-et-questions', 'Une question sur le serveur ou le bot ? Pose-la ici')],
      },
      {
        name: '🔒 STAFF',
        access: 'staff',
        channels: [
          t('staff-général', 'Discussion de l’équipe'),
          t('staff-logs', 'Journaux du bot', { purpose: 'logs' }),
          t('sanctions', 'Suivi des sanctions'),
          t('organisation-tournois', 'Préparation des tournois, brackets et récompenses'),
          t('contenu-et-annonces', 'Préparer les annonces, vidéos et lives à relayer'),
          v('Réunion staff'),
        ],
      },
    ],
  },
};

const TEMPLATES = [
  {
    id: 'communaute',
    name: 'Communauté générale',
    icon: '💬',
    description: 'Un serveur convivial : accueil, discussions, médias, vocaux et staff.',
    plan: {
      name: 'Communauté',
      roles: [
        ...STAFF_ROLES,
        { key: 'vip', name: '✨ VIP', color: '#f0abfc', kind: 'cosmetic', preset: 'none' },
        { key: 'member', name: '💬 Membre', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        INFO_CATEGORY,
        { name: '💬 DISCUSSIONS', access: 'members', channels: [t('général', 'Discute de tout et de rien', { purpose: 'general' }), t('présentations', 'Présente-toi !'), t('médias', 'Images, vidéos et mèmes'), t('bot-commandes', 'Utilise les commandes du bot ici')] },
        { name: '🎲 DÉTENTE', access: 'members', channels: [t('compte-jusqu-à-l-infini', 'Compte à tour de rôle'), t('confessions', 'Messages anonymes'), t('mèmes', 'Le meilleur de l’humour')] },
        { name: '🔊 VOCAUX', access: 'members', channels: [v('Discussion 1'), v('Discussion 2'), v('Musique'), v('AFK')] },
        SUPPORT_CATEGORY,
        STAFF_CATEGORY,
      ],
    },
  },
  {
    id: 'gaming',
    name: 'Gaming',
    icon: '🎮',
    description: 'Pour une team ou une communauté de joueurs : recherche d’équipe, clips, salons vocaux par jeu.',
    plan: {
      name: 'Gaming',
      roles: [
        ...STAFF_ROLES,
        { key: 'pro', name: '🏆 Joueur confirmé', color: '#facc15', kind: 'cosmetic', preset: 'none' },
        { key: 'member', name: '🎮 Joueur', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        INFO_CATEGORY,
        { name: '🎮 COMMUNAUTÉ', access: 'members', channels: [t('général', '', { purpose: 'general' }), t('recherche-équipe', 'Trouve des partenaires de jeu'), t('clips-et-exploits', 'Partage tes meilleurs moments'), t('actus-jeux', 'Sorties et mises à jour'), t('tournois', 'Événements et compétitions')] },
        { name: '🔊 SALONS VOCAUX', access: 'members', channels: [v('Lobby'), v('Équipe 1', { userLimit: 5 }), v('Équipe 2', { userLimit: 5 }), v('Équipe 3', { userLimit: 5 }), v('Chill & musique'), v('AFK')] },
        SUPPORT_CATEGORY,
        STAFF_CATEGORY,
      ],
    },
  },
  ROCKET_LEAGUE,
  {
    id: 'etude',
    name: 'Études & entraide',
    icon: '📚',
    description: 'Salons par matière, entraide aux devoirs, salles de travail silencieuses.',
    plan: {
      name: 'Études',
      roles: [
        ...STAFF_ROLES.slice(1),
        { key: 'tuteur', name: '🎓 Tuteur', color: '#38bdf8', kind: 'cosmetic', preset: 'none', hoist: true },
        { key: 'member', name: '📚 Étudiant', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        INFO_CATEGORY,
        { name: '📚 MATIÈRES', access: 'members', channels: [t('maths'), t('sciences'), t('langues'), t('histoire-géo'), t('informatique'), t('autres-matières')] },
        { name: '🤝 ENTRAIDE', access: 'members', channels: [t('aide-aux-devoirs', 'Pose ta question, quelqu’un t’aidera', { slowmode: 10 }), t('méthodes-de-travail'), t('orientation'), t('détente', '', { purpose: 'general' })] },
        { name: '🔊 SALLES DE TRAVAIL', access: 'members', channels: [v('Travail silencieux'), v('Travail en groupe'), v('Pause café'), v('Pomodoro 25/5')] },
        SUPPORT_CATEGORY,
        STAFF_CATEGORY,
      ],
    },
  },
  {
    id: 'creatif',
    name: 'Créatifs & artistes',
    icon: '🎨',
    description: 'Galeries, retours constructifs, commandes et collaborations.',
    plan: {
      name: 'Créatifs',
      roles: [
        ...STAFF_ROLES.slice(1),
        { key: 'pro', name: '🖌️ Artiste confirmé', color: '#f472b6', kind: 'cosmetic', preset: 'none', hoist: true },
        { key: 'member', name: '🎨 Créatif', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        INFO_CATEGORY,
        { name: '🎨 GALERIES', access: 'members', channels: [t('dessin-et-illustration'), t('3d-et-animation'), t('photo'), t('musique-et-son'), t('écriture')] },
        { name: '🤝 COLLABORATION', access: 'members', channels: [t('feedback', 'Demande des retours constructifs'), t('collaborations', 'Cherche des partenaires de projet'), t('commandes-et-offres', 'Propose ou cherche des prestations'), t('inspiration')] },
        { name: '🔊 VOCAUX', access: 'members', channels: [v('Atelier'), v('Live de création'), v('Détente')] },
        SUPPORT_CATEGORY,
        STAFF_CATEGORY,
      ],
    },
  },
  {
    id: 'boutique',
    name: 'Boutique / service client',
    icon: '🛒',
    description: 'Vitrine, avis, support par tickets et suivi des commandes.',
    plan: {
      name: 'Boutique',
      roles: [
        { key: 'owner', name: '👑 Gérant', color: '#a855f7', hoist: true, kind: 'staff', preset: 'manager' },
        { key: 'mod', name: '🔨 Support', color: '#7c3aed', hoist: true, kind: 'staff', preset: 'moderator' },
        { key: 'client', name: '💎 Client', color: '#34d399', kind: 'member', preset: 'none', hoist: true },
        { key: 'member', name: '👤 Visiteur', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        INFO_CATEGORY,
        { name: '🛒 BOUTIQUE', access: 'readonly', channels: [t('catalogue', 'Nos produits et services'), t('tarifs'), t('avis-clients', 'Ce que disent nos clients'), t('nouveautés')] },
        { name: '💬 COMMUNAUTÉ', access: 'members', channels: [t('général', '', { purpose: 'general' }), t('questions-avant-achat')] },
        { name: '🎫 SUPPORT', access: 'public', channels: [t('ouvrir-un-ticket', 'Une question, un problème ? Ouvre un ticket', { purpose: 'tickets', access: 'readonly' }), t('suivi-de-commande'), t('suggestions', '', { purpose: 'suggestions' })] },
        STAFF_CATEGORY,
      ],
    },
  },
  {
    id: 'minimal',
    name: 'Minimal (démarrage rapide)',
    icon: '⚡',
    description: 'Le strict nécessaire : accueil, règlement, discussion, un vocal et le staff.',
    plan: {
      name: 'Minimal',
      roles: [
        { key: 'mod', name: '🔨 Modérateur', color: '#7c3aed', hoist: true, kind: 'staff', preset: 'moderator' },
        { key: 'member', name: '💬 Membre', color: '#a78bfa', kind: 'member', preset: 'none' },
      ],
      categories: [
        { name: '📌 INFOS', access: 'readonly', channels: [t('bienvenue', '', { purpose: 'welcome' }), t('règlement', '', { purpose: 'rules' })] },
        { name: '💬 DISCUSSION', access: 'members', channels: [t('général', '', { purpose: 'general' }), v('Vocal')] },
        { name: '🔒 STAFF', access: 'staff', channels: [t('staff', ''), t('logs', 'Journaux du bot', { purpose: 'logs' })] },
      ],
    },
  },
];

/** Modèles tels qu'ils sont affichés (le plan est validé pour garantir sa cohérence). */
function listTemplates() {
  return TEMPLATES.map((tpl) => {
    const { plan } = validatePlan(tpl.plan);
    return { id: tpl.id, name: tpl.name, icon: tpl.icon, description: tpl.description, summary: summarize(plan) };
  });
}

function getTemplate(id) {
  const tpl = TEMPLATES.find((x) => x.id === id);
  return tpl ? validatePlan(JSON.parse(JSON.stringify(tpl.plan))) : null;
}

module.exports = { LIMITS, PRESETS, KINDS, CHANNEL_TYPES, ACCESS, PURPOSES, validatePlan, summarize, listTemplates, getTemplate, TEMPLATES };
