'use strict';

module.exports = ({ t, msg, MEMBER_VARS }) => [
  /* ----------------------------- Salons vocaux -------------------------- */
  {
    id: 'tempvoice',
    category: 'automation',
    name: 'Vocaux temporaires',
    icon: 'volume',
    description: 'Un membre rejoint un salon « créer », le bot lui crée son vocal personnel avec un panneau de contrôle dans le chat du vocal (verrouiller, cacher, bloquer le chat, expulser, transférer, renommer, places, qualité audio, région, équipes aléatoires, match privé…). Le vocal est supprimé quand il est vide.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.heading('Salons « Rejoindre pour créer »', 'Chaque salon crée un vocal pour celui qui le rejoint. Ajoute-en plusieurs pour proposer un vocal par mode de jeu (2v2, 3v3, entraînement…).'),
      t.channel('triggerChannelId', 'Salon « Rejoindre pour créer » principal', ['voice']),
      t.channel('categoryId', 'Catégorie des salons créés (vide = celle du salon « créer »)', ['category']),
      t.text('nameFormat', 'Nom des salons', 'Salon de {user.name}', { maxLength: 80, description: 'Variables : {user.name}, {count}' }),
      t.number('defaultLimit', 'Limite de places par défaut (0 = illimité)', 0, 0, 99),
      t.list('triggers', 'Autres salons « Rejoindre pour créer »', [
        t.channel('channelId', 'Salon « Rejoindre pour créer »', ['voice']),
        t.text('nameFormat', 'Nom des salons créés (vide = celui du module)', '', { maxLength: 80, description: 'Variables : {user.name}, {count}' }),
        t.number('limit', 'Places (0 = limite par défaut du module)', 0, 0, 99),
        t.channel('categoryId', 'Catégorie (vide = celle du module)', ['category']),
      ], { required: ['channelId'], max: 10, itemSummary: '{nameFormat}', addLabel: 'Ajouter un salon « créer »' }),

      t.heading('Panneau de contrôle', 'Publié dans le chat du vocal créé. Le propriétaire et le staff s’en servent pour gérer le vocal.'),
      t.toggle('panelEnabled', 'Publier le panneau de contrôle dans le chat du vocal', true),
      t.roles('adminRoleIds', 'Rôles qui peuvent contrôler tous les vocaux (en plus de ceux qui ont « Gérer les salons »)'),
      t.toggle('rememberSettings', 'Permettre de garder ses réglages d’un vocal à l’autre', true),
      t.toggle('autoTransfer', 'Transférer le vocal à un autre membre quand le propriétaire part', true),
      t.toggle('nativeControl', 'Donner aussi au propriétaire le droit natif « Gérer le salon »', false),
      t.number('emptyDelay', 'Attendre avant de supprimer un vocal vide (secondes)', 0, 0, 600),
      t.toggle('startLocked', 'Créer les vocaux verrouillés', false),
      t.toggle('startChatLocked', 'Créer les vocaux avec le chat bloqué', false),
      t.list('presets', 'Préréglages du sélecteur', [
        t.text('label', 'Nom affiché', '', { maxLength: 60 }),
        t.number('limit', 'Places (0 = illimité)', 0, 0, 99),
        t.text('name', 'Renommer le vocal en (facultatif)', '', { maxLength: 80, description: 'Variable : {user.name}' }),
      ], {
        required: ['label'],
        max: 25,
        itemSummary: '{label}',
        addLabel: 'Ajouter un préréglage',
        default: [
          { label: 'Duel 1v1', limit: 2, name: '1v1 · {user.name}' },
          { label: 'Doubles 2v2', limit: 2, name: '2v2 · {user.name}' },
          { label: 'Standard 3v3', limit: 3, name: '3v3 · {user.name}' },
          { label: 'Classé 3v3 + remplaçant', limit: 4, name: 'Classé · {user.name}' },
          { label: 'Rumble', limit: 6, name: 'Rumble · {user.name}' },
          { label: 'Hoops', limit: 4, name: 'Hoops · {user.name}' },
          { label: 'Dropshot', limit: 6, name: 'Dropshot · {user.name}' },
          { label: 'Snow Day', limit: 6, name: 'Snow Day · {user.name}' },
          { label: 'Match privé', limit: 8, name: 'Match privé · {user.name}' },
          { label: 'Entraînement', limit: 4, name: 'Training · {user.name}' },
          { label: 'Coaching', limit: 2, name: 'Coaching · {user.name}' },
        ],
      }),

      t.group('voiceRole', 'Rôle « en vocal »', [
        t.toggle('enabled', 'Donner un rôle tant que le membre est en vocal', false),
        t.role('roleId', 'Rôle'),
      ]),
    ],
  },

  /* ------------------------------ Compteurs ----------------------------- */
  {
    id: 'counters',
    category: 'automation',
    name: 'Salons compteurs',
    icon: 'activity',
    description: 'Renomme des salons avec des statistiques en direct (membres, boosts…), toutes les 10 minutes.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.list('counters', 'Compteurs', [
        t.channel('channelId', 'Salon à renommer', ['text', 'voice', 'category']),
        t.select('type', 'Statistique', [
          ['members', 'Membres'], ['humans', 'Humains'], ['bots', 'Bots'], ['boosts', 'Boosts'], ['channels', 'Salons'], ['roles', 'Rôles'], ['tickets', 'Tickets ouverts'], ['date', 'Date du jour'],
        ], 'members'),
        t.text('template', 'Modèle du nom', '👥 Membres : {count}', { maxLength: 80, description: 'Utilise {count} pour la valeur.' }),
      ], { required: ['channelId'], max: 10, itemSummary: '{type} → {channelId}', addLabel: 'Ajouter un compteur' }),
    ],
  },

  /* --------------------------- Règles de salon -------------------------- */
  {
    id: 'channelrules',
    category: 'automation',
    name: 'Règles de salon',
    icon: 'ruler',
    description: 'Réactions automatiques, fils auto, publication des annonces, suppression différée, salons « images seulement »…',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.list('rules', 'Règles', [
        t.id('id'),
        t.channel('channelId', 'Salon concerné', ['text', 'forum']),
        t.strings('reactions', 'Réagir automatiquement avec', { max: 5, itemMaxLength: 40, placeholder: 'Un émoji puis Entrée' }),
        t.toggle('autoThread', 'Créer un fil sous chaque message', false),
        t.text('threadName', 'Nom du fil', '{user.name} — discussion', { maxLength: 80, showIf: { key: 'autoThread', eq: true } }),
        t.toggle('autoPublish', 'Publier automatiquement (salon d’annonces)', false),
        t.number('deleteAfter', 'Supprimer les messages après (secondes, 0 = jamais)', 0, 0, 604800),
        t.select('contentRule', 'Contenu autorisé', [
          ['any', 'Tout'], ['media', 'Images / fichiers uniquement'], ['text', 'Texte uniquement (pas de fichiers)'], ['links', 'Liens uniquement'],
        ], 'any'),
        t.toggle('deleteBlocked', 'Supprimer les messages non conformes', true, { showIf: { key: 'contentRule', in: ['media', 'text', 'links'] } }),
        t.roles('exemptRoles', 'Rôles exemptés'),
      ], { required: ['channelId'], max: 25, itemSummary: '{channelId}', addLabel: 'Ajouter une règle' }),
    ],
  },

  /* --------------------------- Messages programmés ---------------------- */
  {
    id: 'automessages',
    category: 'automation',
    name: 'Messages programmés',
    icon: 'alarm',
    description: 'Envoie un message à intervalle régulier ou chaque jour à heure fixe.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.list('messages', 'Messages', [
        t.id('id'),
        t.text('name', 'Nom (interne)', 'Nouveau message', { maxLength: 60 }),
        t.channel('channelId', 'Salon', ['text']),
        t.select('mode', 'Quand ?', [['interval', 'Toutes les X minutes'], ['daily', 'Chaque jour à une heure précise']], 'daily'),
        t.number('everyMinutes', 'Intervalle (minutes)', 60, 5, 43200, { showIf: { key: 'mode', eq: 'interval' } }),
        t.text('at', 'Heure (HH:MM, fuseau du serveur)', '09:00', { maxLength: 5, format: 'time', showIf: { key: 'mode', eq: 'daily' } }),
        t.role('pingRoleId', 'Rôle à mentionner (optionnel)'),
        t.message('message', 'Message', msg('', { title: 'Rappel', description: 'Écris ton message ici.' }), { variables: ['server', 'memberCount'] }),
      ], { required: ['channelId'], max: 25, itemSummary: '{name}', addLabel: 'Ajouter un message programmé' }),
    ],
  },

  /* ----------------------------- Messages épinglés ---------------------- */
  {
    id: 'sticky',
    category: 'automation',
    name: 'Messages collants',
    icon: 'pin',
    description: 'Un message qui reste toujours en bas d’un salon (le bot le renvoie après quelques messages).',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.list('stickies', 'Messages collants', [
        t.channel('channelId', 'Salon', ['text']),
        t.number('every', 'Renvoyer après N messages', 5, 1, 100),
        t.number('minSeconds', 'Délai minimum entre deux renvois (secondes)', 10, 0, 600),
        t.message('message', 'Message', msg('', { title: '📌 À retenir', description: 'Pense à lire les règles du salon avant d’écrire.' }), { variables: ['server'] }),
      ], { required: ['channelId'], max: 25, itemSummary: '{channelId}', addLabel: 'Ajouter un message collant' }),
    ],
  },

  /* ------------------------------- Pseudos ------------------------------ */
  {
    id: 'nickname',
    category: 'automation',
    name: 'Pseudos',
    icon: 'type',
    description: 'Nettoie les pseudos : caractères qui font remonter en haut de la liste, mots interdits, format imposé à l’arrivée.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.group('dehoist', 'Anti-« hoisting »', [
        t.toggle('enabled', 'Retirer les caractères spéciaux en début de pseudo (! # . …)', true),
        t.text('fallback', 'Pseudo de remplacement si rien ne reste', 'Membre', { maxLength: 32 }),
      ]),
      t.group('template', 'Format imposé à l’arrivée', [
        t.toggle('enabled', 'Appliquer un format aux nouveaux membres', false),
        t.text('format', 'Format', '[Membre] {user.name}', { maxLength: 32, description: 'Variables : {user.name}' }),
      ]),
      t.group('banned', 'Mots interdits dans les pseudos', [
        t.toggle('enabled', 'Remplacer les pseudos inappropriés', false),
        t.strings('words', 'Mots interdits', { lowercase: true, max: 200, itemMaxLength: 40 }),
        t.text('replacement', 'Pseudo de remplacement', 'Pseudo modéré', { maxLength: 32 }),
      ]),
    ],
  },
];
