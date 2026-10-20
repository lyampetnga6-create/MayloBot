'use strict';
const { providerChoices } = require('../lib/ai');

module.exports = ({ t }) => [
  {
    id: 'ai',
    category: 'essentials',
    extras: 'ai',
    name: 'Intelligence artificielle',
    icon: 'sparkles',
    description: 'Choisis le fournisseur d’IA, ta clé d’API et les commandes IA. Sert aussi aux tickets et au créateur de serveur.',
    toggle: 'enabled',
    fields: [
      t.toggle('enabled', 'Activer les fonctions d’IA', false),
      t.heading('Fournisseur', 'La clé d’API se saisit plus bas (elle est chiffrée et ne s’affiche jamais). « Celui du bot » utilise la clé du propriétaire du bot, si elle existe.'),
      t.select('provider', 'Fournisseur', providerChoices(), 'default'),
      t.text('model', 'Modèle (vide = modèle par défaut du fournisseur)', '', { maxLength: 100, placeholder: 'ex : gpt-4o-mini, claude-haiku-5-5, llama-3.3-70b-versatile' }),
      t.number('hourlyLimit', 'Requêtes IA maximum par heure pour ce serveur', 60, 1, 2000),
      t.heading('Commandes /ia'),
      t.toggle('commands', 'Activer /ia demander, traduire, résumer, reformuler, expliquer', true),
      t.roles('commandRoles', 'Réservé à ces rôles (vide = tout le monde)'),
      t.channels('allowedChannels', 'Salons autorisés (vide = partout)', ['text', 'forum']),
      t.number('cooldown', 'Délai entre deux demandes d’un membre (secondes)', 15, 0, 3600),
      t.heading('Personnalité de /ia demander'),
      t.textarea('persona', 'Consignes', 'Tu es l’assistant du serveur Discord « {server} ». Réponds de façon claire, brève et sympathique.', { maxLength: 2000 }),
      t.select('language', 'Langue des réponses', [['auto', 'Celle du membre'], ['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais']], 'auto'),
    ],
  },
];
