'use strict';

/** Croissance du serveur : flux YouTube / RSS, suivi des invitations, statistiques. */
module.exports = ({ t, msg, MEMBER_VARS }) => [
  /* ----------------------- TikTok : nouvelles vidéos ------------------- */
  {
    id: 'tiktokvideos',
    extras: 'tiktokvideos',
    category: 'community',
    name: 'TikTok · Nouvelles vidéos',
    icon: 'video',
    description: 'Annonce dans un salon chaque nouvelle vidéo que tu postes sur TikTok. Le bot vérifie ton compte régulièrement ; au premier passage il note tes vidéos existantes sans rien publier.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.text('account', 'Ton compte TikTok', '', { maxLength: 200, description: 'Ton @ (ex. @moncompte) ou le lien de ton profil TikTok.' }),
      t.channel('channelId', 'Salon des annonces', ['text']),
      t.role('pingRoleId', 'Rôle à mentionner (facultatif)'),
      t.number('intervalMinutes', 'Vérifier toutes les (minutes)', 10, 5, 1440),
      t.message('message', 'Message', msg('**{account}** vient de poster une nouvelle vidéo sur TikTok !\n{title}\n{link}'), { variables: ['server', 'account', 'title', 'link'] }),
    ],
  },

  /* ------------------------- TikTok : lives --------------------------- */
  {
    id: 'tiktoklive',
    extras: 'tiktoklive',
    category: 'community',
    name: 'TikTok · Lives',
    icon: 'radio',
    description: 'Prévient ton serveur dès que tu lances un live TikTok. Le bot surveille ton compte toutes les quelques minutes et n’envoie qu’une seule annonce par live.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.text('account', 'Ton compte TikTok', '', { maxLength: 200, description: 'Ton @ (ex. @moncompte) ou le lien de ton profil TikTok.' }),
      t.channel('channelId', 'Salon des annonces', ['text']),
      t.role('pingRoleId', 'Rôle à mentionner (facultatif)'),
      t.number('intervalMinutes', 'Vérifier toutes les (minutes)', 2, 1, 60),
      t.number('cooldownMinutes', 'Délai minimum entre deux annonces (minutes)', 30, 0, 1440, { description: 'Évite les doubles annonces quand un live se coupe puis reprend.' }),
      t.message('message', 'Message', msg('**{streamer}** est en live sur TikTok : {title}\n{url}'), { variables: ['server', 'streamer', 'title', 'url', 'viewers'] }),
    ],
  },

  /* ------------------------------ Flux -------------------------------- */
  {
    id: 'feeds',
    extras: 'feeds',
    category: 'community',
    name: 'Vidéos YouTube, TikTok et RSS',
    icon: 'rss',
    description: 'Publie automatiquement dans un salon les nouvelles vidéos d’une chaîne YouTube ou d’un compte TikTok, ou les articles d’un site (RSS / Atom). Pour TikTok, utilise plutôt le module dédié « TikTok · Nouvelles vidéos ». Pour les lives, voir « Alertes de lives ».',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.number('intervalMinutes', 'Vérifier toutes les (minutes)', 15, 5, 1440),
      t.list('feeds', 'Flux suivis', [
        t.id('id'),
        t.text('name', 'Nom (pour toi)', '', { maxLength: 60 }),
        t.select('type', 'Type', [['youtube', 'Nouvelles vidéos YouTube'], ['tiktok', 'Nouvelles vidéos TikTok (expérimental)'], ['rss', 'Flux RSS / Atom']], 'youtube'),
        t.text('url', 'Adresse', '', { maxLength: 300, description: 'YouTube : lien de la chaîne (youtube.com/@nom). TikTok : @moncompte. RSS : adresse du flux.' }),
        t.channel('channelId', 'Salon de publication', ['text']),
        t.role('pingRoleId', 'Rôle à mentionner (facultatif)'),
        t.message('message', 'Message', msg('**{author}** a publié : {title}\n{link}'), { variables: ['server', 'title', 'link', 'author', 'feed'] }),
      ], { required: ['url', 'channelId'], max: 15, itemSummary: '{name} {url}', addLabel: 'Ajouter un flux' }),
    ],
  },

  /* ------------------------------- Lives ------------------------------ */
  {
    id: 'streams',
    extras: 'streams',
    category: 'community',
    name: 'Alertes de lives',
    icon: 'radio',
    description: 'Préviens ton serveur dès qu’un streamer lance un direct sur Twitch, Kick ou YouTube. Pour ton compte TikTok, utilise le module dédié « TikTok · Lives ».',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.number('intervalMinutes', 'Vérifier toutes les (minutes)', 2, 1, 60),
      t.number('cooldownMinutes', 'Délai minimum entre deux alertes du même streamer (minutes)', 30, 0, 1440, { description: 'Évite les doubles alertes quand un direct se coupe puis reprend.' }),
      t.list('streamers', 'Streamers suivis', [
        t.id('id'),
        t.select('platform', 'Plateforme', [['twitch', 'Twitch'], ['kick', 'Kick'], ['youtube', 'YouTube (lives)'], ['tiktok', 'TikTok (expérimental)']], 'twitch'),
        t.text('handle', 'Nom ou lien de la chaîne', '', { maxLength: 200, description: 'Twitch et Kick : le nom (ex. monstreamer). YouTube : youtube.com/@nom. TikTok : @moncompte.' }),
        t.channel('channelId', 'Salon des alertes', ['text']),
        t.role('pingRoleId', 'Rôle à mentionner (facultatif)'),
        t.message('message', 'Message', msg('**{streamer}** est en direct sur {platform} : {title}\n{url}'), { variables: ['server', 'streamer', 'title', 'game', 'url', 'platform', 'viewers'] }),
      ], { required: ['handle', 'channelId'], max: 25, itemSummary: '{platform} {handle}', addLabel: 'Ajouter un streamer' }),
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
