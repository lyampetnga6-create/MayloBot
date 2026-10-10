'use strict';

module.exports = ({ t, msg }) => [
  /* ----------------------------- Protection ----------------------------- */
  {
    id: 'protection',
    category: 'security',
    extras: 'protection',
    adminOnly: true,
    name: 'Protection du serveur',
    icon: '🏰',
    description: 'Anti-raid, anti-nuke, filtre d’arrivée, liens d’arnaque, quarantaine et verrouillage d’urgence.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer les protections', false),
      t.channel('alertChannelId', 'Salon des alertes de sécurité', ['text']),
      t.heading('Membres de confiance', 'Jamais touchés par les protections (le propriétaire du serveur et le bot le sont toujours).'),
      t.strings('trustedUsers', 'Membres de confiance (identifiants)', { format: 'snowflake', max: 50, itemMaxLength: 20, placeholder: 'Colle un identifiant puis Entrée' }),
      t.roles('trustedRoles', 'Rôles de confiance'),

      t.group('antiRaid', 'Anti-raid (arrivées en masse)', [
        t.toggle('enabled', 'Détecter les raids', false),
        t.number('joins', 'Arrivées nécessaires pour déclencher', 8, 2, 100),
        t.number('seconds', 'Pendant (secondes)', 10, 1, 300),
        t.select('action', 'Que faire des nouveaux arrivants ?', [
          ['alert', 'Seulement alerter'], ['timeout', 'Exclusion temporaire'], ['kick', 'Expulser'], ['ban', 'Bannir'], ['quarantine', 'Mettre en quarantaine'],
        ], 'kick'),
        t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 60, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
        t.number('raidModeMinutes', 'Garder le mode raid actif (minutes, 0 = seulement ce lot)', 15, 0, 1440),
      ]),

      t.group('joinGate', 'Filtre d’arrivée', [
        t.toggle('enabled', 'Filtrer les nouveaux membres', false),
        t.number('minAccountDays', 'Âge minimal du compte Discord (jours, 0 = aucun)', 3, 0, 365),
        t.toggle('requireAvatar', 'Refuser les comptes sans photo de profil', false),
        t.strings('nameFilter', 'Mots interdits dans le pseudo', { lowercase: true, max: 100, itemMaxLength: 40 }),
        t.toggle('blockBots', 'Refuser les bots ajoutés par quelqu’un qui n’est pas de confiance', false),
        t.select('action', 'Sanction', [['kick', 'Expulser'], ['timeout', 'Exclusion temporaire'], ['ban', 'Bannir'], ['quarantine', 'Mettre en quarantaine']], 'kick'),
        t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 1440, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
        t.toggle('dmReason', 'Expliquer la raison en MP', true),
      ]),

      t.group('newMemberLinks', 'Liens des nouveaux membres', [
        t.toggle('enabled', 'Bloquer liens et invitations des membres récents', false),
        t.number('minutes', 'Considéré comme récent pendant (minutes)', 30, 1, 10080),
        t.select('action', 'Réaction', [['delete', 'Supprimer le message'], ['timeout', 'Supprimer + exclusion temporaire']], 'delete'),
        t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 10, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
      ]),

      t.group('scamLinks', 'Liens d’arnaque et d’hameçonnage', [
        t.toggle('enabled', 'Bloquer les faux liens Discord / Steam / Nitro', true),
        t.strings('blockedDomains', 'Domaines à bloquer en plus', { lowercase: true, max: 200, itemMaxLength: 100 }),
        t.select('action', 'Réaction', [['delete', 'Supprimer le message'], ['timeout', 'Supprimer + exclusion temporaire'], ['ban', 'Supprimer + bannir']], 'timeout'),
        t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 1440, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
      ]),

      t.group('antiNuke', 'Anti-nuke (destruction du serveur)', [
        t.toggle('enabled', 'Surveiller les actions dangereuses (journal d’audit)', false),
        t.number('seconds', 'Fenêtre d’observation (secondes)', 30, 5, 600),
        t.number('channelDelete', 'Suppressions de salons tolérées', 3, 1, 50),
        t.number('channelCreate', 'Créations de salons tolérées', 6, 1, 100),
        t.number('roleDelete', 'Suppressions de rôles tolérées', 3, 1, 50),
        t.number('roleCreate', 'Créations de rôles tolérées', 6, 1, 100),
        t.number('ban', 'Bannissements tolérés', 4, 1, 100),
        t.number('kick', 'Expulsions tolérées', 4, 1, 100),
        t.number('webhookCreate', 'Créations de webhooks tolérées', 3, 1, 50),
        t.toggle('guardPermissions', 'Annuler l’ajout de permissions dangereuses (Administrateur, Gérer le serveur…)', true),
        t.select('punishment', 'Sanction du responsable', [
          ['quarantine', 'Lui retirer ses rôles (quarantaine)'], ['kick', 'L’expulser'], ['ban', 'Le bannir'], ['none', 'Seulement alerter'],
        ], 'quarantine'),
      ]),

      t.heading('Quarantaine'),
      t.role('quarantineRoleId', 'Rôle de quarantaine (optionnel)', { description: 'Donné en plus du retrait des rôles. Configure ses permissions pour qu’il ne voie presque rien.' }),

      t.heading('Verrouillage d’urgence', 'Pour la commande /verrouillage.'),
      t.channels('lockdownChannels', 'Salons concernés (vide = tous les salons textuels)', ['text']),
      t.text('lockdownMessage', 'Message affiché dans les salons verrouillés', '🔒 Ce salon est verrouillé temporairement par l’équipe de modération.', { maxLength: 300 }),
    ],
  },

  /* ----------------------------- Honeypot ------------------------------- */
  {
    id: 'honeypot',
    category: 'security',
    extras: 'honeypot',
    name: 'Honeypot (salon piège)',
    icon: '🍯',
    description: 'Un salon que personne ne doit utiliser : quiconque y écrit (bot piraté, spammeur) est sanctionné aussitôt.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le piège', false),
      t.channels('channelIds', 'Salons pièges', ['text']),
      t.heading('Sanction'),
      t.select('action', 'Que faire du membre ?', [['ban', 'Bannir'], ['softban', 'Bannir puis débannir (nettoie ses messages)'], ['kick', 'Expulser'], ['timeout', 'Exclusion temporaire'], ['quarantine', 'Mettre en quarantaine']], 'ban'),
      t.number('timeoutMinutes', 'Durée de l’exclusion (minutes)', 1440, 1, 40320, { showIf: { key: 'action', eq: 'timeout' } }),
      t.select('deleteHistory', 'Supprimer ses messages récents', [
        ['0', 'Ne rien supprimer'], ['3600', 'Dernière heure'], ['21600', '6 dernières heures'], ['86400', '24 dernières heures'], ['259200', '3 derniers jours'], ['604800', '7 derniers jours'],
      ], '86400', { description: 'Disponible pour le bannissement ; pour les autres sanctions, seul le message piège est supprimé.' }),
      t.toggle('recordCase', 'Enregistrer un dossier de modération', true),
      t.heading('Exceptions'),
      t.toggle('ignoreBots', 'Ignorer les bots', true),
      t.toggle('ignoreModerators', 'Ignorer les modérateurs (Gérer les messages)', true),
      t.roles('ignoredRoles', 'Rôles ignorés'),
      t.heading('Messages'),
      t.toggle('dm', 'Prévenir le membre en MP', true),
      t.textarea('dmMessage', 'Message privé', 'Tu as écrit dans un salon piège de **{server}**. Cela arrive quand un compte est piraté ou quand un bot spamme. Si c’était une erreur, contacte l’équipe du serveur.', { maxLength: 800 }),
      t.channel('logChannelId', 'Salon des alertes', ['text']),
      t.message('warning', 'Avertissement affiché dans le salon piège', msg('', {
        title: '⛔ NE PAS ÉCRIRE ICI',
        description: 'Ce salon est un piège anti-spam.\n**Tout message envoyé dans ce salon entraîne une sanction immédiate.**\nSi tu es un humain, ne l’utilise pas.',
        color: '#ef4444',
      }), { variables: ['server'] }),
    ],
  },

  /* --------------------------- Vérification ----------------------------- */
  {
    id: 'verification',
    category: 'security',
    extras: 'verification',
    name: 'Vérification des membres',
    icon: '✅',
    description: 'Les nouveaux restent bloqués tant qu’ils n’ont pas cliqué, résolu un calcul ou répondu à ta question.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer la vérification', false),
      t.channel('channelId', 'Salon du panneau de vérification', ['text']),
      t.select('method', 'Méthode', [['button', 'Un simple bouton'], ['math', 'Un petit calcul (anti-bot)'], ['question', 'Une question avec réponse(s) attendue(s)']], 'button'),
      t.text('question', 'Question posée', 'Quel est le mot de passe indiqué dans les règles ?', { maxLength: 200, showIf: { key: 'method', eq: 'question' } }),
      t.strings('answers', 'Réponses acceptées', { lowercase: true, max: 20, itemMaxLength: 60, showIf: { key: 'method', eq: 'question' } }),
      t.number('maxAttempts', 'Essais autorisés', 3, 1, 10, { showIf: { key: 'method', in: ['math', 'question'] } }),
      t.heading('Rôles'),
      t.roles('verifiedRoles', 'Rôles donnés après vérification'),
      t.role('unverifiedRoleId', 'Rôle « non vérifié » (donné à l’arrivée, retiré ensuite)'),
      t.number('kickAfterMinutes', 'Expulser ceux qui ne se vérifient pas après (minutes, 0 = jamais)', 0, 0, 10080),
      t.heading('Textes'),
      t.message('panel', 'Message du panneau', msg('', {
        title: '✅ Vérification',
        description: 'Clique sur le bouton ci-dessous pour prouver que tu es humain et accéder au serveur.',
      }), { variables: ['server'] }),
      t.text('buttonLabel', 'Texte du bouton', 'Je suis humain', { maxLength: 80 }),
      t.text('buttonEmoji', 'Émoji du bouton', '✅', { maxLength: 40 }),
      t.select('buttonStyle', 'Couleur du bouton', [['Success', 'Vert'], ['Primary', 'Violet / bleu'], ['Secondary', 'Gris'], ['Danger', 'Rouge']], 'Success'),
      t.text('successText', 'Message de réussite', '✅ Tu es vérifié, bienvenue !', { maxLength: 300 }),
      t.text('failText', 'Message d’échec', '❌ Mauvaise réponse. Il te reste {count} essai(s).', { maxLength: 300 }),
      t.channel('logChannelId', 'Salon des journaux de vérification', ['text']),
    ],
  },
];
