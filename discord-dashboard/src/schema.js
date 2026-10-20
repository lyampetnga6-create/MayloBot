'use strict';
/**
 * SOURCE UNIQUE DE VÉRITÉ pour tous les réglages du bot.
 *
 * - Le dashboard génère automatiquement ses formulaires à partir de ce fichier.
 * - Le serveur valide / nettoie chaque sauvegarde avec ce même schéma.
 * - Le bot lit les réglages normalisés (jamais de valeur inattendue).
 *
 * Pour ajouter une option : ajoute un champ ici, lis-la dans le module du bot. C'est tout :
 * le formulaire du dashboard apparaît tout seul.
 */
const crypto = require('node:crypto');

const SNOWFLAKE = /^\d{17,20}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* ------------------------------------------------------------------ */
/* Variables utilisables dans les messages                              */
/* ------------------------------------------------------------------ */
const VARIABLE_DOCS = {
  user: 'Mention du membre',
  'user.name': 'Nom d’utilisateur',
  'user.id': 'ID du membre',
  'user.avatar': 'URL de l’avatar',
  'user.created': 'Création du compte (relatif)',
  server: 'Nom du serveur',
  'server.icon': 'URL de l’icône du serveur',
  memberCount: 'Nombre de membres',
  level: 'Niveau atteint',
  xp: 'XP total',
  number: 'Numéro du ticket',
  topic: 'Sujet du ticket',
  reason: 'Raison indiquée',
  channel: 'Mention du salon',
  count: 'Nombre (selon le contexte)',
  seconds: 'Nombre de secondes',
  staff: 'Membre du support concerné',
  prize: 'Lot à gagner',
  winners: 'Gagnant(s)',
  host: 'Organisateur',
  id: 'Numéro / identifiant',
  content: 'Contenu du message',
  stars: 'Nombre d’étoiles',
  link: 'Lien (message ou publication)',
  url: 'Lien du direct',
  age: 'Âge',
  rating: 'Note donnée',
  coins: 'Montant',
  boosts: 'Nombre de boosts du serveur',
  sanction: 'Type de sanction (Bannissement, Expulsion…)',
  duration: 'Durée de la sanction',
  case: 'Numéro du dossier',
  title: 'Titre de la publication',
  author: 'Auteur ou chaîne',
  feed: 'Nom du flux',
  streamer: 'Nom du streamer',
  game: 'Jeu ou catégorie',
  platform: 'Plateforme (Twitch, Kick…)',
  viewers: 'Nombre de spectateurs',
  date: 'Date de la boutique (ex. 20 octobre 2026)',
  newCount: 'Nombre de nouveautés',
  new: 'Liste des nouveautés (nom, type, prix)',
  leavingCount: 'Nombre d’objets en dernier jour',
  leaving: 'Liste des objets en dernier jour',
  inviter: 'Mention de la personne qui a invité',
  'inviter.name': 'Nom de la personne qui a invité',
  invites: 'Invitations actives de l’inviteur',
};

const MEMBER_VARS = ['user', 'user.name', 'user.id', 'user.avatar', 'user.created', 'server', 'server.icon', 'memberCount'];

/* ------------------------------------------------------------------ */
/* Constructeurs de champs                                              */
/* ------------------------------------------------------------------ */
const t = {
  heading: (label, description = '') => ({ type: 'heading', label, description }),
  toggle: (key, label, def = false, o = {}) => ({ type: 'toggle', key, label, default: def, ...o }),
  text: (key, label, def = '', o = {}) => ({ type: 'text', key, label, default: def, maxLength: 200, ...o }),
  textarea: (key, label, def = '', o = {}) => ({ type: 'textarea', key, label, default: def, maxLength: 2000, ...o }),
  number: (key, label, def, min, max, o = {}) => ({ type: 'number', key, label, default: def, min, max, ...o }),
  color: (key, label, def = '', o = {}) => ({ type: 'color', key, label, default: def, ...o }),
  select: (key, label, options, def, o = {}) => ({ type: 'select', key, label, options, default: def ?? options[0][0], ...o }),
  channel: (key, label, kinds = ['text'], o = {}) => ({ type: 'channel', key, label, kinds, default: '', ...o }),
  channels: (key, label, kinds = ['text'], o = {}) => ({ type: 'channels', key, label, kinds, default: [], max: 50, ...o }),
  role: (key, label, o = {}) => ({ type: 'role', key, label, default: '', ...o }),
  roles: (key, label, o = {}) => ({ type: 'roles', key, label, default: [], max: 25, ...o }),
  strings: (key, label, o = {}) => ({ type: 'strings', key, label, default: [], max: 100, itemMaxLength: 100, ...o }),
  list: (key, label, fields, o = {}) => ({ type: 'list', key, label, fields, default: [], max: 25, ...o }),
  group: (key, label, fields, o = {}) => ({ type: 'group', key, label, fields, ...o }),
  message: (key, label, def = {}, o = {}) => ({ type: 'message', key, label, default: def, ...o }),
  id: (key) => ({ type: 'id', key }),
  hidden: (key) => ({ type: 'hidden', key }),
};

/* ------------------------------------------------------------------ */
/* Message (texte + embed) – composant réutilisé partout               */
/* ------------------------------------------------------------------ */
const EMBED_FIELDS = [
  t.toggle('enabled', 'Utiliser un embed', false),
  t.text('title', 'Titre', '', { maxLength: 256 }),
  t.textarea('description', 'Description', '', { maxLength: 4000 }),
  t.color('color', 'Couleur (vide = couleur du serveur)', ''),
  t.text('thumbnail', 'Miniature (URL ou variable)', '', { maxLength: 500, placeholder: '{user.avatar}' }),
  t.text('image', 'Grande image (URL)', '', { maxLength: 500 }),
  t.text('author', 'Auteur', '', { maxLength: 256 }),
  t.text('footer', 'Pied de page', '', { maxLength: 2048 }),
  t.toggle('timestamp', 'Afficher l’horodatage', false),
];

const MESSAGE_FIELDS = [
  t.textarea('content', 'Texte du message', '', { maxLength: 2000 }),
  t.group('embed', 'Embed', EMBED_FIELDS),
];

function emptyMessage() {
  return defaultsFor(MESSAGE_FIELDS);
}

/** Construit une valeur par défaut de message : msg('Salut {user}', { title: '…', enabled: true }) */
function msg(content = '', embed = null) {
  const m = emptyMessage();
  m.content = content;
  if (embed) m.embed = { ...m.embed, enabled: true, ...embed };
  return m;
}

/* ------------------------------------------------------------------ */
/* Valeurs par défaut                                                   */
/* ------------------------------------------------------------------ */
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function defaultValue(field) {
  switch (field.type) {
    case 'toggle': return !!field.default;
    case 'number': return field.default ?? 0;
    case 'channels': case 'roles': case 'strings': case 'list': return clone(field.default ?? []);
    case 'group': return defaultsFor(field.fields);
    case 'message': return mergeDeep(emptyMessage(), clone(field.default || {}));
    case 'id': case 'hidden': return '';
    default: return field.default ?? '';
  }
}

function defaultsFor(fields) {
  const out = {};
  for (const f of fields) if (f.key) out[f.key] = defaultValue(f);
  return out;
}

function mergeDeep(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (isObj(v) && isObj(base[k])) mergeDeep(base[k], v);
    else base[k] = v;
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Normalisation (validation + nettoyage)                               */
/* ------------------------------------------------------------------ */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanString(v, max, { multiline = false } = {}) {
  let s = String(v).replace(CONTROL_CHARS, '');
  if (!multiline) s = s.replace(/[\r\n]+/g, ' ');
  return s.trim().slice(0, max);
}

/**
 * ctx (optionnel) : { channels: Map<id,{kind}>, roles: Map<id,{...}> }
 * Sans ctx, seul le format des identifiants est vérifié.
 */
function normalizeValue(field, input, ctx = {}, base) {
  const def = base !== undefined ? base : defaultValue(field);
  if (input === undefined) {
    return field.type === 'group' || field.type === 'message' ? normalizeValue(field, {}, ctx, base) : clone(def);
  }

  switch (field.type) {
    case 'toggle':
      return input === true;

    case 'text': {
      if (typeof input !== 'string') return def;
      let s = cleanString(input, field.maxLength ?? 200);
      if (field.format === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : (typeof def === 'string' ? def : '');
      if (field.format === 'slug') {
        s = s.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
      }
      return s;
    }

    case 'textarea':
      return typeof input === 'string' ? cleanString(input, field.maxLength ?? 2000, { multiline: true }) : def;

    case 'number': {
      const n = typeof input === 'number' ? input : Number(input);
      if (!Number.isFinite(n)) return def;
      let out = field.float ? Math.round(n * 100) / 100 : Math.round(n);
      if (typeof field.min === 'number') out = Math.max(field.min, out);
      if (typeof field.max === 'number') out = Math.min(field.max, out);
      return out;
    }

    case 'color':
      if (typeof input === 'string' && HEX_COLOR.test(input)) return input.toLowerCase();
      if (input === '' && def === '') return '';
      return def;

    case 'select': {
      const allowed = field.options.map((o) => o[0]);
      return allowed.includes(input) ? input : def;
    }

    case 'channel': {
      if (typeof input !== 'string' || !SNOWFLAKE.test(input)) return '';
      if (ctx.channels) {
        const c = ctx.channels.get(input);
        if (!c || !(field.kinds || ['text']).includes(c.kind)) return '';
      }
      return input;
    }

    case 'channels': {
      if (!Array.isArray(input)) return def;
      const sub = { ...field, type: 'channel' };
      return unique(input.map((v) => normalizeValue(sub, v, ctx)).filter(Boolean)).slice(0, field.max ?? 50);
    }

    case 'role': {
      if (typeof input !== 'string' || !SNOWFLAKE.test(input)) return '';
      if (ctx.roles && !ctx.roles.has(input)) return '';
      return input;
    }

    case 'roles': {
      if (!Array.isArray(input)) return def;
      const sub = { ...field, type: 'role' };
      return unique(input.map((v) => normalizeValue(sub, v, ctx)).filter(Boolean)).slice(0, field.max ?? 25);
    }

    case 'strings': {
      if (!Array.isArray(input)) return def;
      const out = [];
      const seen = new Set();
      for (const raw of input) {
        if (typeof raw !== 'string') continue;
        let s = cleanString(raw, field.itemMaxLength ?? 100);
        if (field.lowercase) s = s.toLowerCase();
        if (field.format === 'snowflake' && !SNOWFLAKE.test(s)) continue;
        if (!s || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        out.push(s);
        if (out.length >= (field.max ?? 100)) break;
      }
      return out;
    }

    case 'list': {
      if (!Array.isArray(input)) return def;
      const out = [];
      for (const raw of input.slice(0, field.max ?? 25)) {
        if (!isObj(raw)) continue;
        const item = normalizeObject(field.fields, raw, ctx);
        const missing = (field.required || []).some((k) => {
          const v = item[k];
          return v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length);
        });
        if (!missing) out.push(item);
      }
      return out;
    }

    case 'group':
      return normalizeObject(field.fields, isObj(input) ? input : {}, ctx, isObj(def) ? def : undefined);

    case 'message':
      return normalizeObject(MESSAGE_FIELDS, isObj(input) ? input : {}, ctx, isObj(def) ? def : undefined);

    case 'id':
      return typeof input === 'string' && /^[a-z0-9]{6,24}$/i.test(input) ? input : crypto.randomBytes(5).toString('hex');

    case 'hidden':
      return typeof input === 'string' && SNOWFLAKE.test(input) ? input : '';

    default:
      return def;
  }
}

function normalizeObject(fields, input, ctx = {}, base) {
  const out = {};
  for (const f of fields) {
    if (!f.key) continue;
    const has = isObj(input) && Object.prototype.hasOwnProperty.call(input, f.key);
    out[f.key] = normalizeValue(f, has ? input[f.key] : undefined, ctx, base ? base[f.key] : undefined);
    if (f.type === 'id' && !out[f.key]) out[f.key] = crypto.randomBytes(5).toString('hex');
  }
  return out;
}

const unique = (arr) => [...new Set(arr)];

/* ------------------------------------------------------------------ */
/* Les modules                                                          */
/* ------------------------------------------------------------------ */
const MODULES = [
  /* ---------------------------- Général ---------------------------- */
  {
    id: 'general',
    category: 'essentials',
    name: 'Général',
    icon: 'sliders',
    description: 'Apparence des messages du bot, fuseau horaire et commandes autorisées.',
    fields: [
      t.heading('Apparence', 'Le pseudo, l’avatar et la bannière du bot sur ce serveur se règlent dans « Profil du bot ».'),
      t.color('embedColor', 'Couleur par défaut des embeds', '#8b5cf6'),
      t.text('footerText', 'Pied de page des embeds du bot', '', { maxLength: 100, placeholder: 'Ex : Serveur officiel' }),
      t.heading('Fuseau horaire', 'Utilisé pour les anniversaires et les messages programmés (l’heure d’été n’est pas gérée automatiquement).'),
      t.number('utcOffset', 'Décalage horaire (UTC+X)', 1, -12, 14),
      t.heading('Commandes', 'Les modérateurs (Gérer le serveur) ne sont jamais bloqués par ces restrictions.'),
      t.strings('disabledCommands', 'Commandes désactivées sur ce serveur', { lowercase: true, max: 100, itemMaxLength: 32, placeholder: 'ex : 8ball, rps, work' }),
      t.channels('commandChannels', 'Salons où les commandes sont autorisées (vide = partout)', ['text', 'voice', 'forum']),
    ],
  },

  /* ---------------------------- Bienvenue -------------------------- */
  {
    id: 'welcome',
    category: 'essentials',
    name: 'Bienvenue',
    icon: 'userPlus',
    description: 'Accueille (et salue le départ) des membres avec des messages entièrement personnalisables.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.heading('Message de bienvenue'),
      t.channel('channelId', 'Salon de bienvenue', ['text']),
      t.message('message', 'Message', msg('Bienvenue {user} sur **{server}** ! Tu es notre {memberCount}ᵉ membre 🎉', {
        title: 'Bienvenue {user.name} !',
        description: 'Passe lire les règles et présente-toi. Bon séjour parmi nous !',
        thumbnail: '{user.avatar}',
        timestamp: true,
      }), { variables: [...MEMBER_VARS, 'inviter', 'inviter.name', 'invites'] }),
      t.number('deleteAfter', 'Supprimer le message après (secondes, 0 = jamais)', 0, 0, 86400),
      t.heading('Message privé', 'Envoyé en MP au nouveau membre (si ses MP sont ouverts).'),
      t.toggle('dmEnabled', 'Envoyer un MP de bienvenue', false),
      t.message('dm', 'Message privé', msg('Bienvenue sur **{server}**, {user.name} ! 👋'), { variables: MEMBER_VARS, showIf: { key: 'dmEnabled', eq: true } }),
      t.heading('Départ'),
      t.toggle('leaveEnabled', 'Annoncer les départs', false),
      t.channel('leaveChannelId', 'Salon des départs', ['text'], { showIf: { key: 'leaveEnabled', eq: true } }),
      t.message('leave', 'Message de départ', msg('**{user.name}** a quitté le serveur. 😢'), { variables: MEMBER_VARS, showIf: { key: 'leaveEnabled', eq: true } }),
    ],
  },

  /* ---------------------------- Autorôles -------------------------- */
  {
    id: 'autorole',
    category: 'essentials',
    name: 'Rôles automatiques',
    icon: 'tag',
    description: 'Donne des rôles aux nouveaux arrivants et rend leurs anciens rôles à ceux qui reviennent.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.roles('roles', 'Rôles donnés aux membres'),
      t.roles('botRoles', 'Rôles donnés aux bots'),
      t.number('delay', 'Délai avant attribution (secondes)', 0, 0, 3600),
      t.heading('Retour sur le serveur', 'Quand un membre quitte puis revient, le bot peut lui rendre les rôles qu’il avait.'),
      t.toggle('restoreRoles', 'Rendre ses anciens rôles à un membre qui revient', false),
      t.roles('restoreExclude', 'Rôles jamais restaurés'),
    ],
  },

  /* ---------------------------- Automod ---------------------------- */
  {
    id: 'automod',
    category: 'security',
    name: 'Auto-modération',
    icon: 'shield',
    description: 'Filtre invitations, liens, majuscules, spam, mentions, émojis, mots interdits, pièces jointes…',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.heading('Réaction', 'Le message fautif est toujours supprimé.'),
      t.select('action', 'Sanction supplémentaire', [['none', 'Aucune'], ['warn', 'Avertissement'], ['timeout', 'Exclusion temporaire']], 'none'),
      t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 10, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
      t.toggle('notify', 'Prévenir dans le salon (message supprimé après 6 s)', true),
      t.heading('Filtres'),
      t.group('invites', 'Invitations Discord', [
        t.toggle('enabled', 'Bloquer les invitations', true),
        t.toggle('allowOwnServer', 'Autoriser les invitations de ce serveur', true),
      ]),
      t.group('links', 'Liens', [
        t.toggle('enabled', 'Bloquer les liens', false),
        t.strings('allowedDomains', 'Domaines autorisés', { lowercase: true, placeholder: 'youtube.com, twitch.tv…' }),
      ]),
      t.group('caps', 'Majuscules', [
        t.toggle('enabled', 'Bloquer les messages en majuscules', false),
        t.number('minLength', 'Longueur minimale du message', 10, 3, 500),
        t.number('percent', 'Pourcentage de majuscules toléré', 70, 30, 100),
      ]),
      t.group('spam', 'Spam', [
        t.toggle('enabled', 'Bloquer le spam', true),
        t.number('messages', 'Nombre de messages', 5, 2, 30),
        t.number('seconds', 'Pendant (secondes)', 5, 1, 120),
      ]),
      t.group('mentions', 'Mentions de masse', [
        t.toggle('enabled', 'Bloquer les mentions de masse', true),
        t.number('max', 'Mentions maximum par message', 5, 2, 50),
      ]),
      t.group('words', 'Mots interdits', [
        t.toggle('enabled', 'Activer le filtre', false),
        t.strings('list', 'Liste de mots', { lowercase: true, max: 500, itemMaxLength: 50 }),
      ]),
      t.group('emojis', 'Spam d’émojis', [
        t.toggle('enabled', 'Bloquer les messages remplis d’émojis', false),
        t.number('max', 'Émojis maximum par message', 10, 3, 50),
      ]),
      t.group('duplicates', 'Messages en double', [
        t.toggle('enabled', 'Bloquer le même message répété', false),
        t.number('count', 'Répétitions tolérées', 3, 2, 20),
        t.number('seconds', 'Pendant (secondes)', 60, 5, 600),
      ]),
      t.group('repeated', 'Caractères répétés', [
        t.toggle('enabled', 'Bloquer « aaaaaaaaaaaa »', false),
        t.number('length', 'Caractères identiques d’affilée', 12, 5, 100),
      ]),
      t.group('lines', 'Messages trop hauts', [
        t.toggle('enabled', 'Limiter le nombre de lignes', false),
        t.number('max', 'Lignes maximum', 15, 3, 100),
      ]),
      t.group('zalgo', 'Texte déformé (zalgo)', [
        t.toggle('enabled', 'Bloquer le texte avec trop de diacritiques', false),
      ]),
      t.group('attachments', 'Pièces jointes dangereuses', [
        t.toggle('enabled', 'Bloquer certains types de fichiers', false),
        t.strings('blockedExtensions', 'Extensions bloquées', { lowercase: true, max: 50, itemMaxLength: 10, default: ['exe', 'scr', 'bat', 'cmd', 'com', 'vbs', 'jar', 'msi', 'ps1'] }),
      ]),
      t.heading('Exceptions', 'Les modérateurs (Gérer les messages) sont toujours ignorés.'),
      t.channels('ignoredChannels', 'Salons ignorés', ['text', 'voice', 'forum']),
      t.roles('ignoredRoles', 'Rôles ignorés'),
    ],
  },

  /* --------------------------- Modération -------------------------- */
  {
    id: 'moderation',
    category: 'security',
    name: 'Modération',
    icon: 'gavel',
    description: 'Sanctions, historique et escalade automatique selon le nombre d’avertissements.',
    fields: [
      t.heading('Général'),
      t.channel('modLogChannelId', 'Salon des logs de modération', ['text']),
      t.toggle('dmOnSanction', 'Prévenir le membre en MP lors d’une sanction', true),
      t.toggle('requireReason', 'Exiger une raison pour chaque sanction', false),
      t.number('warnExpireDays', 'Les avertissements expirent après (jours, 0 = jamais)', 0, 0, 3650),
      t.text('appealText', 'Texte ajouté aux MP de sanction (ex : lien de contestation)', '', { maxLength: 300, placeholder: 'Contesté ? Écris à modmail@exemple.fr' }),
      t.heading('Escalade automatique', 'Applique une sanction quand un membre atteint un nombre d’avertissements.'),
      t.list('autoSanctions', 'Paliers', [
        t.number('warns', 'Nombre d’avertissements', 3, 1, 50),
        t.select('action', 'Sanction', [['timeout', 'Exclusion temporaire'], ['kick', 'Expulsion'], ['ban', 'Bannissement']], 'timeout'),
        t.number('duration', 'Durée (minutes)', 60, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
      ], { max: 10, itemSummary: '{warns} avertissements → {action}', addLabel: 'Ajouter un palier' }),
    ],
  },

  /* ----------------------------- Niveaux --------------------------- */
  {
    id: 'levels',
    category: 'community',
    name: 'Niveaux & XP',
    icon: 'chart',
    description: 'Système d’XP, annonces de niveau et récompenses en rôles.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.heading('Gain d’XP'),
      t.number('xpMin', 'XP minimum par message', 15, 0, 500),
      t.number('xpMax', 'XP maximum par message', 25, 0, 500),
      t.number('cooldown', 'Délai entre deux gains (secondes)', 60, 0, 3600),
      t.number('multiplier', 'Multiplicateur d’XP', 1, 0.1, 10, { float: true }),
      t.channels('ignoredChannels', 'Salons sans XP', ['text', 'voice', 'forum']),
      t.roles('ignoredRoles', 'Rôles sans XP'),
      t.list('roleMultipliers', 'Multiplicateurs par rôle (le plus élevé s’applique)', [
        t.role('role', 'Rôle'),
        t.number('multiplier', 'Multiplicateur', 2, 0.1, 10, { float: true }),
      ], { required: ['role'], max: 15, itemSummary: '{role} × {multiplier}', addLabel: 'Ajouter un multiplicateur' }),
      t.group('voiceXp', 'XP vocal', [
        t.toggle('enabled', 'Gagner de l’XP en vocal', false),
        t.number('xpPerMinute', 'XP par minute', 5, 1, 100),
        t.toggle('ignoreMuted', 'Pas d’XP si le micro ou le casque est coupé', true),
        t.toggle('requireOthers', 'Pas d’XP si le membre est seul dans le salon', true),
      ]),
      t.toggle('resetOnLeave', 'Remettre l’XP à zéro quand le membre quitte le serveur', false),
      t.heading('Annonce de niveau'),
      t.select('announce', 'Où annoncer ?', [['current', 'Dans le salon du message'], ['channel', 'Dans un salon précis'], ['dm', 'En message privé'], ['none', 'Nulle part']], 'current'),
      t.channel('announceChannelId', 'Salon d’annonce', ['text'], { showIf: { key: 'announce', eq: 'channel' } }),
      t.message('levelUp', 'Message de niveau', msg('🎉 GG {user}, tu passes **niveau {level}** !'), { variables: [...MEMBER_VARS, 'level', 'xp'], showIf: { key: 'announce', in: ['current', 'channel', 'dm'] } }),
      t.heading('Récompenses'),
      t.toggle('stackRewards', 'Cumuler les rôles (sinon seul le plus haut est conservé)', true),
      t.list('rewards', 'Rôles par niveau', [
        t.number('level', 'Niveau', 5, 1, 500),
        t.role('role', 'Rôle'),
      ], { required: ['role'], max: 25, itemSummary: 'Niveau {level} → {role}', addLabel: 'Ajouter une récompense' }),
    ],
  },

  /* ----------------------------- Tickets --------------------------- */
  {
    id: 'tickets',
    category: 'support',
    extras: 'tickets',
    name: 'Tickets',
    icon: 'ticket',
    description: 'Support par salons privés : sujets et formulaires, prise en charge, IA, notes, transcripts…',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),

      t.heading('Où et qui'),
      t.channel('panelChannelId', 'Salon du panneau', ['text']),
      t.channel('categoryId', 'Catégorie des tickets ouverts', ['category']),
      t.roles('supportRoles', 'Rôles du support'),
      t.roles('observerRoles', 'Rôles qui voient les tickets en lecture seule'),
      t.text('nameFormat', 'Nom des salons', 'ticket-{number}', { maxLength: 60, placeholder: 'ticket-{number}', description: 'Variables : {number}, {user.name}, {topic}' }),

      t.heading('Qui peut ouvrir un ticket'),
      t.number('maxPerUser', 'Tickets ouverts maximum par membre', 1, 1, 10),
      t.number('cooldown', 'Délai entre deux ouvertures (secondes, 0 = aucun)', 0, 0, 86400),
      t.roles('requiredRoles', 'Réservé à ces rôles (vide = tout le monde)'),
      t.roles('blockedRoles', 'Rôles qui ne peuvent pas ouvrir de ticket'),
      t.number('minMemberDays', 'Ancienneté minimale sur le serveur (jours)', 0, 0, 365),
      t.toggle('requireReason', 'Demander la raison à l’ouverture (si le sujet n’a pas de formulaire)', false),
      t.text('reasonLabel', 'Question posée', 'Quelle est la raison de ta demande ?', { maxLength: 45, showIf: { key: 'requireReason', eq: true } }),

      t.heading('Dans le ticket'),
      t.toggle('claimEnabled', 'Bouton « Prendre en charge »', true),
      t.toggle('pingSupport', 'Mentionner le support à l’ouverture', true),
      t.toggle('pinWelcome', 'Épingler le message d’accueil', true),
      t.toggle('closeRequiresReason', 'Demander une raison à la fermeture', false),
      t.toggle('onlySupportCanClose', 'Seul le support peut fermer un ticket', false),

      t.heading('Fermeture'),
      t.select('closeMode', 'À la fermeture…', [['delete', 'Supprimer le salon'], ['lock', 'Verrouiller le salon (le garder)'], ['archive', 'Déplacer dans une catégorie d’archives']], 'delete'),
      t.channel('archiveCategoryId', 'Catégorie d’archives', ['category'], { showIf: { key: 'closeMode', eq: 'archive' } }),
      t.number('closeDelay', 'Délai avant fermeture effective (secondes)', 5, 0, 300),
      t.group('autoClose', 'Fermeture automatique si inactif', [
        t.toggle('enabled', 'Fermer les tickets sans activité', false),
        t.number('afterHours', 'Sans message depuis (heures)', 72, 1, 720),
        t.number('warnHours', 'Prévenir quelques heures avant (0 = pas d’avertissement)', 12, 0, 168),
        t.textarea('warnText', 'Message d’avertissement', '⏳ {user}, ce ticket sera fermé dans {count} h sans nouvelle activité.', { maxLength: 500 }),
      ]),
      t.group('rating', 'Note de satisfaction', [
        t.toggle('enabled', 'Demander une note au membre en MP après la fermeture', false),
        t.textarea('text', 'Message envoyé', 'Comment s’est passé ton ticket #{number} sur **{server}** ? Donne une note de 1 à 5.', { maxLength: 500 }),
      ]),

      t.heading('Journaux et transcripts'),
      t.channel('logChannelId', 'Salon des journaux et transcripts', ['text']),
      t.toggle('logEvents', 'Journaliser aussi les ouvertures et prises en charge', true),
      t.toggle('transcript', 'Générer un transcript à la fermeture', true),
      t.select('transcriptFormat', 'Format du transcript', [['html', 'Page web (HTML, mise en forme)'], ['txt', 'Texte brut']], 'html'),
      t.toggle('dmTranscript', 'Envoyer le transcript au membre en MP', false),

      t.heading('Panneau d’ouverture'),
      t.message('panel', 'Message du panneau', msg('', {
        title: '🎫 Besoin d’aide ?',
        description: 'Clique sur le bouton ci-dessous pour ouvrir un ticket. Un membre de l’équipe te répondra au plus vite.',
      }), { variables: ['server'] }),
      t.select('panelStyle', 'Présentation des sujets', [['buttons', 'Un bouton par sujet'], ['menu', 'Menu déroulant']], 'buttons'),
      t.text('buttonLabel', 'Texte du bouton (sans sujet)', 'Ouvrir un ticket', { maxLength: 80 }),
      t.text('buttonEmoji', 'Émoji du bouton (sans sujet)', '🎫', { maxLength: 40 }),
      t.select('buttonStyle', 'Couleur des boutons', [['Primary', 'Violet / bleu'], ['Secondary', 'Gris'], ['Success', 'Vert'], ['Danger', 'Rouge']], 'Primary'),
      t.text('menuPlaceholder', 'Texte du menu', 'Choisis un sujet…', { maxLength: 100, showIf: { key: 'panelStyle', eq: 'menu' } }),

      t.heading('Sujets', 'Chaque sujet peut avoir sa catégorie, son équipe, son texte d’accueil et un formulaire de 5 questions maximum.'),
      t.list('topics', 'Sujets', [
        t.text('label', 'Nom du sujet', '', { maxLength: 80 }),
        t.text('emoji', 'Émoji', '', { maxLength: 40 }),
        t.text('description', 'Description courte (menu déroulant)', '', { maxLength: 100 }),
        t.channel('categoryId', 'Catégorie spécifique (optionnel)', ['category']),
        t.roles('supportRoles', 'Équipe spécifique (vide = équipe générale)'),
        t.textarea('welcomeText', 'Texte d’accueil supplémentaire', '', { maxLength: 800 }),
        t.list('questions', 'Questions du formulaire', [
          t.text('label', 'Question', '', { maxLength: 45 }),
          t.select('style', 'Taille de la réponse', [['short', 'Courte (une ligne)'], ['paragraph', 'Longue (paragraphe)']], 'short'),
          t.toggle('required', 'Réponse obligatoire', true),
          t.text('placeholder', 'Texte d’exemple', '', { maxLength: 100 }),
        ], { required: ['label'], max: 5, itemSummary: '{label}', addLabel: 'Ajouter une question' }),
      ], { required: ['label'], max: 25, itemSummary: '{emoji} {label}', addLabel: 'Ajouter un sujet' }),

      t.heading('Message d’accueil dans le ticket'),
      t.message('welcome', 'Message d’accueil', msg('{user}', {
        title: 'Ticket #{number}',
        description: 'Merci d’avoir ouvert un ticket. Décris ton problème en détail, l’équipe arrive.\n\n**Sujet :** {topic}\n**Raison :** {reason}',
      }), { variables: ['user', 'user.name', 'server', 'number', 'topic', 'reason'] }),

      t.heading('Textes du bot', 'Tous les messages du système de tickets. Variables : {user}, {channel}, {count}, {seconds}, {staff}, {number}.'),
      t.group('texts', 'Textes', [
        t.text('opened', 'Ticket ouvert', '✅ Ton ticket est ouvert : {channel}', { maxLength: 300 }),
        t.text('limit', 'Limite de tickets atteinte', 'Tu as déjà {count} ticket(s) ouvert(s). Ferme-le(s) avant d’en ouvrir un nouveau.', { maxLength: 300 }),
        t.text('cooldown', 'Délai non écoulé', 'Patiente encore {seconds} s avant d’ouvrir un nouveau ticket.', { maxLength: 300 }),
        t.text('denied', 'Ouverture refusée', 'Tu ne peux pas ouvrir de ticket ici.', { maxLength: 300 }),
        t.text('closing', 'Fermeture en cours', '🔒 Ce ticket va être fermé dans {seconds} secondes…', { maxLength: 300 }),
        t.text('claimed', 'Prise en charge', '🙋 {staff} prend ce ticket en charge.', { maxLength: 300 }),
        t.text('thanksRating', 'Merci pour la note', 'Merci pour ta note ! ⭐', { maxLength: 300 }),
      ]),

      t.group('ai', '🤖 Assistant IA dans les tickets', [
        t.toggle('enabled', 'Répondre automatiquement dans les tickets', false),
        t.select('mode', 'Quand répondre ?', [
          ['always', 'À chaque message du membre'],
          ['first', 'Seulement au premier message'],
          ['mention', 'Seulement quand on mentionne le bot'],
        ], 'always'),
        t.toggle('stopWhenStaff', 'Se taire dès qu’un membre du support écrit', true),
        t.toggle('stopWhenClaimed', 'Se taire quand le ticket est pris en charge', true),
        t.number('maxReplies', 'Réponses maximum par ticket', 5, 1, 50),
        t.text('persona', 'Nom de l’assistant', 'Assistant', { maxLength: 40 }),
        t.textarea('systemPrompt', 'Consignes (personnalité, règles, ton…)', 'Tu es l’assistant du support du serveur Discord « {server} ». Réponds de façon courte, polie et utile. Si tu ne connais pas la réponse, dis-le et propose d’appeler un humain.', { maxLength: 3000 }),
        t.textarea('knowledge', 'Base de connaissances (règles, tarifs, horaires, procédures…)', '', { maxLength: 8000, placeholder: 'Colle ici tout ce que l’assistant doit savoir sur ton serveur.' }),
        t.list('faq', 'FAQ (questions / réponses)', [
          t.text('question', 'Question', '', { maxLength: 200 }),
          t.textarea('answer', 'Réponse', '', { maxLength: 800 }),
        ], { required: ['question', 'answer'], max: 40, itemSummary: '{question}', addLabel: 'Ajouter une question' }),
        t.select('language', 'Langue des réponses', [['auto', 'Celle du membre'], ['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['nl', 'Néerlandais']], 'auto'),
        t.number('temperature', 'Créativité (0 = très factuel, 1 = créatif)', 0.4, 0, 1.5, { float: true }),
        t.number('maxTokens', 'Longueur maximale d’une réponse (tokens)', 500, 100, 1500),
        t.strings('handoffKeywords', 'Mots qui appellent un humain', { lowercase: true, max: 30, itemMaxLength: 40, default: ['humain', 'staff', 'modérateur', 'support'] }),
        t.toggle('pingOnHandoff', 'Mentionner le support quand un humain est demandé', true),
        t.toggle('humanButton', 'Bouton « Appeler un humain » sous les réponses', true),
        t.toggle('showDisclaimer', 'Afficher un avertissement sous les réponses', true),
        t.text('disclaimer', 'Texte de l’avertissement', '🤖 Réponse générée par une IA, elle peut se tromper.', { maxLength: 200, showIf: { key: 'showDisclaimer', eq: true } }),
        t.toggle('asEmbed', 'Répondre dans un embed', false),
        t.color('color', 'Couleur de l’embed (vide = couleur du serveur)', '', { showIf: { key: 'asEmbed', eq: true } }),
        t.toggle('typing', 'Afficher « est en train d’écrire… »', true),
      ]),
    ],
  },

  /* --------------------------- Rôles à boutons --------------------- */
  {
    id: 'rolepanels',
    category: 'automation',
    name: 'Rôles à boutons',
    icon: 'circleDot',
    description: 'Messages avec boutons pour que les membres choisissent leurs rôles.',
    fields: [
      t.list('panels', 'Panneaux', [
        t.id('id'),
        t.hidden('messageId'),
        t.text('name', 'Nom (interne)', 'Mon panneau', { maxLength: 60 }),
        t.channel('channelId', 'Salon de publication', ['text']),
        t.select('mode', 'Mode', [['toggle', 'Chaque bouton ajoute / retire son rôle'], ['unique', 'Un seul rôle à la fois (exclusif)']], 'toggle'),
        t.message('message', 'Message', msg('', {
          title: 'Choisis tes rôles',
          description: 'Clique sur un bouton pour obtenir (ou retirer) le rôle correspondant.',
        }), { variables: ['server'] }),
        t.list('roles', 'Boutons', [
          t.role('roleId', 'Rôle'),
          t.text('label', 'Texte du bouton', '', { maxLength: 80, placeholder: 'Laisse vide pour utiliser le nom du rôle' }),
          t.text('emoji', 'Émoji', '', { maxLength: 40 }),
          t.select('style', 'Couleur', [['Secondary', 'Gris'], ['Primary', 'Bleu'], ['Success', 'Vert'], ['Danger', 'Rouge']], 'Secondary'),
        ], { required: ['roleId'], max: 25, itemSummary: '{emoji} {roleId}', addLabel: 'Ajouter un bouton' }),
      ], { required: ['name'], max: 10, itemSummary: '{name}', addLabel: 'Créer un panneau', panelActions: 'rolepanel' }),
    ],
  },

  /* ----------------------- Commandes personnalisées ---------------- */
  {
    id: 'commands',
    category: 'automation',
    name: 'Commandes perso',
    icon: 'message',
    description: 'Crée tes propres commandes à préfixe et des réponses automatiques.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.heading('Commandes'),
      t.text('prefix', 'Préfixe', '!', { maxLength: 5 }),
      t.list('commands', 'Commandes personnalisées', [
        t.text('name', 'Nom (sans préfixe)', '', { maxLength: 32, format: 'slug' }),
        t.textarea('response', 'Réponse', '', { maxLength: 2000 }),
        t.toggle('asEmbed', 'Envoyer dans un embed', false),
        t.toggle('reply', 'Répondre au message de l’auteur', true),
        t.toggle('deleteInvocation', 'Supprimer le message de l’auteur', false),
        t.roles('allowedRoles', 'Réservé à ces rôles (vide = tout le monde)'),
      ], { required: ['name', 'response'], max: 50, itemSummary: '{name}', addLabel: 'Ajouter une commande', variables: ['user', 'user.name', 'server', 'memberCount', 'channel'] }),
      t.heading('Réponses automatiques'),
      t.list('autoresponders', 'Réponses automatiques', [
        t.text('trigger', 'Déclencheur', '', { maxLength: 100 }),
        t.select('match', 'Condition', [['contains', 'Le message contient'], ['exact', 'Le message est exactement'], ['startsWith', 'Le message commence par']], 'contains'),
        t.textarea('response', 'Réponse', '', { maxLength: 2000 }),
        t.number('cooldown', 'Délai entre deux réponses (secondes)', 10, 0, 3600),
        t.toggle('reply', 'Répondre au message de l’auteur', true),
      ], { required: ['trigger', 'response'], max: 50, itemSummary: '{trigger}', addLabel: 'Ajouter une réponse', variables: ['user', 'user.name', 'server', 'memberCount', 'channel'] }),
    ],
  },

  /* ------------------------------- Logs ---------------------------- */
  {
    id: 'logs',
    category: 'security',
    name: 'Journaux',
    icon: 'scroll',
    description: 'Garde une trace de tout ce qui se passe, avec un salon différent par type d’événement si tu veux.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des journaux (par défaut)', ['text']),
      t.toggle('ignoreBots', 'Ignorer les bots', true),
      t.channels('ignoredChannels', 'Salons ignorés', ['text', 'voice', 'forum']),
      t.group('routes', 'Un salon par type d’événement (optionnel)', [
        t.channel('messages', 'Messages', ['text']),
        t.channel('members', 'Membres', ['text']),
        t.channel('moderation', 'Modération', ['text']),
        t.channel('server', 'Salons, rôles et serveur', ['text']),
        t.channel('voice', 'Vocal', ['text']),
        t.channel('commands', 'Commandes', ['text']),
      ]),
      t.group('events', 'Événements journalisés', [
        t.toggle('messageDelete', 'Messages supprimés', true),
        t.toggle('messageEdit', 'Messages modifiés', true),
        t.toggle('bulkDelete', 'Suppressions en masse (purge)', true),
        t.toggle('ghostPing', 'Mentions fantômes (message supprimé qui mentionnait quelqu’un)', true),
        t.toggle('memberJoin', 'Arrivées', true),
        t.toggle('memberLeave', 'Départs', true),
        t.toggle('memberUpdate', 'Pseudo & rôles modifiés', true),
        t.toggle('timeout', 'Exclusions temporaires', true),
        t.toggle('ban', 'Bannissements / débannissements', true),
        t.toggle('kick', 'Expulsions', true),
        t.toggle('channels', 'Salons créés / supprimés', true),
        t.toggle('channelUpdate', 'Salons modifiés (nom, sujet, permissions)', true),
        t.toggle('roles', 'Rôles créés / supprimés', true),
        t.toggle('roleUpdate', 'Rôles modifiés (nom, couleur, permissions)', true),
        t.toggle('serverUpdate', 'Réglages du serveur modifiés', true),
        t.toggle('invites', 'Invitations créées / supprimées', false),
        t.toggle('threads', 'Fils créés / supprimés', false),
        t.toggle('voice', 'Activité vocale', false),
        t.toggle('commands', 'Utilisation des commandes slash', false),
      ]),
    ],
  },
];

const CATEGORIES = [
  { id: 'essentials', name: 'Essentiel' },
  { id: 'security', name: 'Sécurité' },
  { id: 'support', name: 'Support' },
  { id: 'community', name: 'Communauté' },
  { id: 'rocketleague', name: 'Rocket League' },
  { id: 'fun', name: 'Fun & économie' },
  { id: 'automation', name: 'Automatisation' },
];

// Les modules plus récents vivent dans src/defs/ (même format, mêmes outils).
MODULES.push(...require('./defs')({ t, msg, MEMBER_VARS }));

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

function defaultModule(mod) {
  return defaultsFor(mod.fields);
}

function defaultSettings() {
  const out = {};
  for (const m of MODULES) out[m.id] = defaultModule(m);
  return out;
}

function normalizeModule(mod, input, ctx = {}, base) {
  return normalizeObject(mod.fields, isObj(input) ? input : {}, ctx, base);
}

/** Version sérialisable pour le navigateur. */
function publicSchema() {
  return { modules: MODULES, variables: VARIABLE_DOCS, messageFields: MESSAGE_FIELDS, categories: CATEGORIES };
}

module.exports = {
  MODULES,
  CATEGORIES,
  MODULE_BY_ID,
  VARIABLE_DOCS,
  MESSAGE_FIELDS,
  SNOWFLAKE,
  defaultSettings,
  defaultModule,
  normalizeModule,
  normalizeValue,
  normalizeObject,
  publicSchema,
  emptyMessage,
};
