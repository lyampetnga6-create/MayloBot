'use strict';
const { REST, Routes } = require('discord.js');

/**
 * Enregistre les commandes slash auprès de Discord.
 * Avec DEV_GUILD_ID : uniquement sur ce serveur (instantané, idéal pour tester).
 * Sans : commandes globales.
 */
async function registerCommands(config, commands) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = [...commands.values()].map((c) => c.data.toJSON());
  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  return body.length;
}

module.exports = { registerCommands };

// Utilisation en ligne de commande : `npm run deploy-commands`
if (require.main === module) {
  const { config, validate } = require('../config');
  const { loadCommands } = require('./commands');
  const problems = validate().filter((p) => p.startsWith('DISCORD_'));
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  registerCommands(config, loadCommands())
    .then((n) => console.log(`✅ ${n} commandes enregistrées.`))
    .catch((err) => { console.error(err); process.exit(1); });
}
