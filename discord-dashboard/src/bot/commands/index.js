'use strict';
const { Collection } = require('discord.js');

/** Toutes les commandes slash du bot. Pour en ajouter une : crée un fichier et ajoute-le ici (100 commandes maximum, limite Discord). */
const files = [
  require('./utility'),
  require('./moderation'),
  require('./levels'),
  require('./ticket'),
  require('./admin'),
  require('./tools'),
  require('./community'),
  require('./economy'),
  require('./fun'),
  require('./ai'),
  require('./licence'),
  require('./appeals'),
  require('./invites'),
];

const MAX_COMMANDS = 100;

function loadCommands() {
  const commands = new Collection();
  for (const list of files) {
    for (const cmd of list) {
      if (commands.has(cmd.data.name)) throw new Error(`Commande en double : /${cmd.data.name}`);
      commands.set(cmd.data.name, cmd);
    }
  }
  if (commands.size > MAX_COMMANDS) throw new Error(`Trop de commandes (${commands.size}) : Discord en autorise ${MAX_COMMANDS}.`);
  return commands;
}

module.exports = { loadCommands, MAX_COMMANDS };
