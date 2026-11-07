'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { hexToInt } = require('../../lib/template');
const { EPHEMERAL } = require('../util');
const val = require('../../lib/valorant');
const mates = require('../modules/mates');

const make = (name, description, build, execute, { always = false } = {}) => ({
  category: 'Valorant',
  ...(always ? {} : { module: 'mates' }),
  data: build(new SlashCommandBuilder().setName(name).setDescription(description)).setContexts(InteractionContextType.Guild),
  execute,
});
const colorOf = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor) || 0xff4655;
const noPing = { parse: [] };

module.exports = [
  // /mate marche dès l'installation, dans n'importe quel salon, sans activer le module (le module règle seulement le salon des annonces, le rôle à mentionner, etc.).
  // La commande ouvre un formulaire : le joueur écrit lui-même le mode, le rang, les agents, l'âge et une note.
  make('mate', 'Cherche des mates (ouvre un formulaire : mode, rang, agents, âge, note)', (b) => b,
    (interaction) => mates.openForm(interaction.client, interaction), { always: true }),

  make('equipes', 'Tire au sort l’attaque et la défense avec les joueurs de ton vocal', (b) => b, async (interaction) => {
    const channel = interaction.member?.voice?.channel;
    if (!channel) return interaction.reply({ content: 'Rejoins d’abord un salon vocal.', flags: EPHEMERAL });
    const players = [...channel.members.values()].filter((m) => !m.user.bot).map((m) => m.id);
    if (players.length < 2) return interaction.reply({ content: 'Il faut au moins 2 joueurs dans le vocal.', flags: EPHEMERAL });
    const { attack, defense } = val.splitTeams(players);
    const list = (ids) => ids.map((i) => `<@${i}>`).join('\n') || '—';
    return interaction.reply({
      embeds: [{ title: 'Équipes tirées au sort', color: colorOf(interaction), fields: [{ name: '⚔️ Attaque', value: list(attack), inline: true }, { name: '🛡️ Défense', value: list(defense), inline: true }] }],
      allowedMentions: noPing,
    });
  }),

  make('agent', 'Tire un agent au hasard (tu peux choisir un rôle)', (b) => b.addStringOption((o) => o
    .setName('role').setDescription('Limiter à un rôle').setRequired(false)
    .addChoices(...val.ROLES.map((r) => ({ name: r, value: r })))), async (interaction) => {
    const a = val.pickAgent(interaction.options.getString('role') || '');
    return interaction.reply({ embeds: [{ title: 'Ton agent', description: `**${a.name}** · ${a.role}`, color: colorOf(interaction) }] });
  }),

  make('map', 'Tire une carte au hasard', (b) => b, async (interaction) => interaction.reply({
    embeds: [{ title: 'Ta carte', description: `**${val.pickMap()}**`, color: colorOf(interaction) }],
  })),

  make('compo', 'Tire une composition de 5 agents (un de chaque rôle + un libre)', (b) => b, async (interaction) => {
    const comp = val.randomComp();
    return interaction.reply({
      embeds: [{ title: 'Composition tirée au sort', description: comp.map((a) => `**${a.name}** · ${a.role}`).join('\n'), color: colorOf(interaction) }],
    });
  }),

  make('defi', 'Un défi au hasard pour pimenter ta prochaine partie', (b) => b, async (interaction) => interaction.reply({
    embeds: [{ title: 'Ton défi', description: val.pickChallenge(), color: colorOf(interaction) }],
  })),
];
