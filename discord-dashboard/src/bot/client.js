'use strict';
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./commands');
const { registerEvents } = require('./events');
const { LicenseService } = require('../lib/license');

/**
 * Crée le client Discord (sans se connecter).
 * Intentions privilégiées à activer dans le portail développeur (onglet « Bot ») :
 *   - SERVER MEMBERS INTENT   (bienvenue, rôles auto, logs de membres)
 *   - MESSAGE CONTENT INTENT  (auto-modération, XP, commandes personnalisées)
 * (Les intentions « Guilds », « Messages », « Reactions », « Invites », « Voice », « Moderation » ne sont pas privilégiées.)
 */
function createBot({ db, settings, config }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildInvites,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User, Partials.Reaction],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
  });

  const license = new LicenseService({ db, config });
  client.ctx = { db, settings, config, license };
  // Après un paiement Stripe, le client reçoit sa clé en message privé (en plus de la page « Abonnement »).
  license.onCreate = async ({ key, ownerId }) => {
    try {
      const user = await client.users.fetch(ownerId);
      await user.send(`🔑 **Merci pour ton abonnement !**\nVoici ta clé de licence : \`${key}\`\n\nActive-la sur ton serveur depuis le dashboard (page « Abonnement ») ou avec la commande \`/licence activer\`.\nGarde-la précieusement : elle te permet d'activer le bot sur 1 serveur.`);
    } catch { /* messages privés fermés : la clé reste visible sur la page « Abonnement » */ }
  };
  client.commands = loadCommands();
  registerEvents(client);
  return client;
}

module.exports = { createBot };
