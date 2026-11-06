'use strict';

module.exports = ({ t, msg, MEMBER_VARS }) => [
  /* ----------------------------- Giveaways ------------------------------ */
  {
    id: 'giveaways',
    category: 'community',
    name: 'Concours (giveaways)',
    icon: 'gift',
    description: 'Concours avec bouton de participation, conditions, entrées bonus et tirage automatique (/concours).',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.roles('managerRoles', 'Rôles qui peuvent lancer des concours (en plus de « Gérer le serveur »)'),
      t.text('buttonLabel', 'Texte du bouton', 'Participer', { maxLength: 80 }),
      t.text('buttonEmoji', 'Émoji du bouton', '🎉', { maxLength: 40 }),
      t.color('color', 'Couleur des embeds (vide = couleur du serveur)', ''),
      t.toggle('dmWinners', 'Prévenir les gagnants en MP', true),
      t.toggle('pingWinners', 'Mentionner les gagnants dans le salon', true),
      t.text('winnerText', 'Annonce des gagnants', '🎉 Félicitations {winners} ! Vous remportez **{prize}** !', { maxLength: 400, description: 'Variables : {winners}, {prize}, {host}' }),
      t.text('noWinnerText', 'Annonce sans gagnant', 'Personne n’a participé au concours **{prize}** 😢', { maxLength: 400 }),
      t.list('bonusEntries', 'Entrées bonus par rôle', [
        t.role('role', 'Rôle'),
        t.number('entries', 'Entrées supplémentaires', 1, 1, 20),
      ], { required: ['role'], max: 10, itemSummary: '{role} +{entries}', addLabel: 'Ajouter un bonus' }),
    ],
  },

  /* ----------------------------- Starboard ------------------------------ */
  {
    id: 'starboard',
    category: 'community',
    name: 'Starboard',
    icon: 'star',
    description: 'Les messages qui reçoivent assez d’étoiles sont mis en avant dans un salon dédié.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon du starboard', ['text']),
      t.text('emoji', 'Émoji', '⭐', { maxLength: 40 }),
      t.number('threshold', 'Réactions nécessaires', 3, 1, 50),
      t.toggle('selfStar', 'Compter la réaction de l’auteur', false),
      t.toggle('ignoreNsfw', 'Ignorer les salons NSFW', true),
      t.channels('ignoredChannels', 'Salons ignorés', ['text', 'forum']),
      t.color('color', 'Couleur (vide = couleur du serveur)', ''),
    ],
  },

  /* ------------------------------ Comptage ------------------------------ */
  {
    id: 'counting',
    category: 'community',
    name: 'Jeu du comptage',
    icon: 'hash',
    description: 'Les membres comptent à tour de rôle : 1, 2, 3… Une erreur et on recommence.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon du comptage', ['text']),
      t.toggle('noConsecutive', 'Interdire de compter deux fois de suite', true),
      t.toggle('resetOnWrong', 'Revenir à 1 en cas d’erreur', true),
      t.toggle('deleteWrong', 'Supprimer les mauvais messages', true),
      t.toggle('reactions', 'Réagir aux bons nombres (✅ / 🏆 pour un record)', true),
      t.text('wrongText', 'Message d’erreur', '❌ {user} a tout gâché au nombre **{count}** ! On repart de 1.', { maxLength: 300 }),
    ],
  },

  /* ---------------------------- Anniversaires --------------------------- */
  {
    id: 'birthdays',
    category: 'community',
    name: 'Anniversaires',
    icon: 'cake',
    description: 'Les membres enregistrent leur date avec /anniversaire, le bot souhaite la fête et donne un rôle pour la journée.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des annonces', ['text']),
      t.number('hour', 'Heure de l’annonce (0-23, selon le fuseau du serveur)', 9, 0, 23),
      t.role('roleId', 'Rôle « anniversaire » (donné pour la journée)'),
      t.message('message', 'Message d’anniversaire', msg('🎂 Joyeux anniversaire {user} ! Toute l’équipe de **{server}** te souhaite une superbe journée 🎉', {
        title: '🎂 Joyeux anniversaire !',
        description: '{user} fête son anniversaire aujourd’hui. Pense à lui souhaiter une belle journée !',
        thumbnail: '{user.avatar}',
      }), { variables: [...MEMBER_VARS, 'age'] }),
    ],
  },

  /* ----------------------------- Réputation ----------------------------- */
  {
    id: 'reputation',
    category: 'community',
    name: 'Réputation',
    icon: 'thumbsUp',
    description: 'Les membres se donnent des points de réputation avec /rep, avec des rôles à la clé.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.number('cooldownHours', 'Un point toutes les (heures)', 24, 1, 720),
      t.text('emoji', 'Émoji', '👍', { maxLength: 40 }),
      t.toggle('allowSelf', 'Autoriser à se donner de la réputation', false),
      t.channel('logChannelId', 'Salon des journaux', ['text']),
      t.list('rewards', 'Rôles par palier de réputation', [
        t.number('points', 'Points nécessaires', 10, 1, 100000),
        t.role('role', 'Rôle'),
      ], { required: ['role'], max: 15, itemSummary: '{points} pts → {role}', addLabel: 'Ajouter un palier' }),
    ],
  },

  /* ----------------------------- Confessions ---------------------------- */
  {
    id: 'confessions',
    category: 'community',
    name: 'Confessions anonymes',
    icon: 'eyeOff',
    description: 'Les membres envoient un message anonyme avec /confession ; le staff peut retrouver l’auteur en cas d’abus.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des confessions', ['text']),
      t.channel('staffChannelId', 'Salon staff (journal avec l’auteur)', ['text']),
      t.toggle('logAuthors', 'Enregistrer l’auteur dans le salon staff', true, { description: 'Si désactivé, les confessions sont réellement anonymes, même pour le staff.' }),
      t.number('cooldown', 'Délai entre deux confessions (secondes)', 120, 0, 86400),
      t.roles('bannedRoles', 'Rôles interdits de confession'),
      t.strings('bannedUsers', 'Membres interdits (identifiants)', { format: 'snowflake', max: 100, itemMaxLength: 20 }),
      t.color('color', 'Couleur (vide = couleur du serveur)', ''),
      t.text('title', 'Titre', 'Confession anonyme #{id}', { maxLength: 100 }),
    ],
  },

  /* ----------------------------- Bump reminder -------------------------- */
  {
    id: 'bump',
    category: 'community',
    name: 'Rappel de bump',
    icon: 'megaphone',
    description: 'Rappelle de « bumper » le serveur (Disboard…) 2 heures après le dernier bump.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des rappels', ['text']),
      t.role('roleId', 'Rôle à mentionner'),
      t.text('botId', 'Identifiant du bot de bump', '302050872383242240', { maxLength: 20, description: 'Disboard par défaut. Change-le pour un autre bot.' }),
      t.strings('triggers', 'Mots qui prouvent un bump réussi', { lowercase: true, max: 10, itemMaxLength: 60, default: ['bump effectué', 'bump done', 'bumped', 'bump réussi'] }),
      t.number('delayMinutes', 'Délai avant le rappel (minutes)', 120, 5, 1440),
      t.text('thanks', 'Remerciement après un bump', '🙌 Merci {user} d’avoir bumpé le serveur ! Rendez-vous dans 2 heures.', { maxLength: 300 }),
      t.text('reminder', 'Texte du rappel', '⏰ C’est l’heure de bumper le serveur avec `/bump` !', { maxLength: 300 }),
    ],
  },

  /* ------------------------------- Boosts ------------------------------- */
  {
    id: 'boosts',
    category: 'community',
    name: 'Remerciement des boosts',
    icon: 'gem',
    description: 'Un message personnalisé quand quelqu’un booste le serveur.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des remerciements', ['text']),
      t.role('roleId', 'Rôle donné aux boosters (en plus de celui de Discord)'),
      t.message('message', 'Message', msg('💎 Merci {user} pour ton boost ! **{server}** compte maintenant {boosts} boosts.', {
        title: 'Un nouveau booster !',
        description: 'Merci {user} de soutenir **{server}** 💜\nLe serveur compte maintenant **{boosts}** boosts.',
        thumbnail: '{user.avatar}',
      }), { variables: [...MEMBER_VARS, 'boosts'] }),
    ],
  },

  /* ------------------------------ Émojis -------------------------------- */
  {
    id: 'emojis',
    extras: 'emojis',
    category: 'community',
    name: 'Émojis du serveur',
    icon: 'smile',
    description: 'Crée des émojis en une commande : /emojis creer cherche une image sur Internet (ex. « logo Diamant 2 »), enlève le fond et l’ajoute au serveur. /emojis ajouter fait pareil avec une image jointe ou un lien.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.toggle('transparent', 'Fond transparent par défaut', true),
      t.number('candidates', 'Nombre de résultats proposés à chaque recherche', 4, 2, 4),
      t.toggle('safeSearch', 'Recherche sécurisée (cache le contenu pour adultes)', true),
    ],
  },
];
