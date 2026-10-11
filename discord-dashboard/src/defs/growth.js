'use strict';

/** Croissance du serveur : flux YouTube / RSS, suivi des invitations, statistiques. */
module.exports = ({ t, msg, MEMBER_VARS }) => [
  /* ------------------------------ Flux -------------------------------- */
  {
    id: 'feeds',
    extras: 'feeds',
    category: 'community',
    name: 'Flux YouTube et RSS',
    icon: 'rss',
    description: 'Publie automatiquement dans un salon les nouvelles vidéos d’une chaîne YouTube ou les articles d’un site (RSS / Atom).',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.number('intervalMinutes', 'Vérifier toutes les (minutes)', 15, 5, 1440),
      t.list('feeds', 'Flux suivis', [
        t.id('id'),
        t.text('name', 'Nom (pour toi)', '', { maxLength: 60 }),
        t.select('type', 'Type', [['youtube', 'Chaîne YouTube'], ['rss', 'Flux RSS / Atom']], 'youtube'),
        t.text('url', 'Adresse', '', { maxLength: 300, description: 'Lien de la chaîne YouTube (youtube.com/@nom ou /channel/…) ou adresse du flux RSS.' }),
        t.channel('channelId', 'Salon de publication', ['text']),
        t.role('pingRoleId', 'Rôle à mentionner (facultatif)'),
        t.message('message', 'Message', msg('**{author}** a publié : {title}\n{link}'), { variables: ['server', 'title', 'link', 'author', 'feed'] }),
      ], { required: ['url', 'channelId'], max: 15, itemSummary: '{name} {url}', addLabel: 'Ajouter un flux' }),
    ],
  },

  /* ---------------------------- Invitations --------------------------- */
  {
    id: 'invites',
    extras: 'invites',
    category: 'community',
    name: 'Suivi des invitations',
    icon: 'link',
    description: 'Sait qui a invité chaque membre, tient un classement des meilleurs inviteurs et donne des rôles en récompense. Le bot a besoin de « Gérer le serveur ».',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon d’annonce (facultatif)', ['text']),
      t.message('message', 'Message d’annonce', msg('{user} a rejoint le serveur, invité par {inviter} ({invites} invitations).'), { variables: [...MEMBER_VARS, 'inviter', 'inviter.name', 'invites'] }),
      t.list('rewards', 'Récompenses', [
        t.number('count', 'Invitations actives nécessaires', 5, 1, 10000),
        t.role('roleId', 'Rôle donné'),
      ], { required: ['roleId'], max: 15, itemSummary: '{count} invitations : {roleId}', addLabel: 'Ajouter une récompense' }),
    ],
  },

  /* ---------------------------- Statistiques -------------------------- */
  {
    id: 'serverstats',
    category: 'essentials',
    name: 'Statistiques du serveur',
    icon: 'chart',
    description: 'Compte les arrivées, départs et messages par jour pour alimenter la page « Statistiques » du dashboard. Aucun contenu de message n’est enregistré.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', true),
      t.channels('ignoredChannels', 'Salons ignorés', ['text', 'forum', 'voice']),
    ],
  },
];
