'use strict';

module.exports = ({ t, msg }) => [
  {
    id: 'suggestions',
    category: 'support',
    name: 'Suggestions',
    icon: '💡',
    description: 'Les membres proposent des idées avec /suggestion, la communauté vote, le staff approuve ou refuse.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer le module', false),
      t.channel('channelId', 'Salon des suggestions', ['text']),
      t.roles('staffRoles', 'Rôles qui peuvent approuver / refuser'),
      t.select('voteStyle', 'Système de vote', [['buttons', 'Boutons (un vote par membre, compteurs en direct)'], ['reactions', 'Réactions']], 'buttons'),
      t.text('upEmoji', 'Émoji « pour »', '👍', { maxLength: 40 }),
      t.text('downEmoji', 'Émoji « contre »', '👎', { maxLength: 40 }),
      t.number('cooldown', 'Délai entre deux suggestions d’un membre (secondes)', 60, 0, 86400),
      t.toggle('createThread', 'Créer un fil de discussion sous chaque suggestion', false),
      t.toggle('dmAuthor', 'Prévenir l’auteur en MP de la décision', true),
      t.toggle('requireReason', 'Exiger une raison pour approuver / refuser', false),
      t.channel('decisionChannelId', 'Salon où publier les décisions (vide = modifier le message d’origine seulement)', ['text']),
      t.heading('Couleurs'),
      t.color('pendingColor', 'En attente', '#8b5cf6'),
      t.color('approvedColor', 'Approuvée', '#34d399'),
      t.color('deniedColor', 'Refusée', '#ef4444'),
    ],
  },
];
