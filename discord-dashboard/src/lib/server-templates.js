'use strict';
/**
 * Plans de serveur : format, validation stricte et modèles prêts à l'emploi (sans IA).
 *
 * Un plan décrit des rôles et des salons ; il n'est JAMAIS appliqué sans validation :
 * tout ce que renvoie l'IA passe par `validatePlan`, qui borne les quantités, nettoie les noms
 * et n'accepte que des préréglages de permissions sûrs (jamais « Administrateur »).
 */

const LIMITS = { roles: 50, categories: 20, channels: 150, perCategory: 50 };

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
const PURPOSES = ['welcome', 'rules', 'logs', 'tickets', 'suggestions', 'verification', 'announcements', 'general'];

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

  if (!roles.length && !categories.length) warnings.push('Le plan ne contient ni rôle ni salon.');
  return { plan: { name: stripControl(raw.name).slice(0, 100), roles, categories }, warnings };
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
