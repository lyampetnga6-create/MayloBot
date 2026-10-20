'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { hexToInt } = require('../../lib/template');
const { EPHEMERAL } = require('../util');
const rl = require('../../lib/rocketleague');
const rocketleague = require('../modules/rocketleague');

const make = (name, description, build, execute, { always = false } = {}) => ({
  category: 'Rocket League',
  ...(always ? {} : { module: 'rocketleague' }),
  data: build(new SlashCommandBuilder().setName(name).setDescription(description)).setContexts(InteractionContextType.Guild),
  execute,
});
const colorOf = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor) || 0x5865f2;
const noPing = { parse: [] };

module.exports = [
  // /lfg marche dès l'installation, dans n'importe quel salon, sans activer le module (le module règle seulement le salon des annonces, le rôle à mentionner, etc.).
  make('lfg', 'Cherche des coéquipiers : plateforme, rang, mode, âge et une note libre', (b) => b
    .addStringOption((o) => o.setName('mode').setDescription('Mode de jeu').setRequired(true).addChoices(...rl.MODES.map((m) => ({ name: m.label, value: m.id }))))
    .addStringOption((o) => o.setName('plateforme').setDescription('Ta plateforme').addChoices(...rl.PLATFORMS.map((p) => ({ name: p.label, value: p.id }))))
    .addStringOption((o) => o.setName('rang').setDescription('Ton rang').addChoices(...rl.RANKS.map((r) => ({ name: r.label, value: r.id }))))
    .addIntegerOption((o) => o.setName('age').setDescription('Ton âge').setMinValue(rl.AGE_MIN).setMaxValue(rl.AGE_MAX))
    .addIntegerOption((o) => o.setName('places').setDescription('Nombre de joueurs recherchés').setMinValue(1).setMaxValue(7))
    .addStringOption((o) => o.setName('note').setDescription('Ce que tu veux : ambiance, horaires, objectif, micro…').setMaxLength(300)),
  async (interaction) => {
    try {
      const r = await rocketleague.createLfg(interaction.client, interaction.guild, interaction.member, {
        mode: interaction.options.getString('mode', true),
        platform: interaction.options.getString('plateforme') || '',
        rank: interaction.options.getString('rang') || '',
        age: interaction.options.getInteger('age'),
        places: interaction.options.getInteger('places'),
        note: interaction.options.getString('note') || '',
        fallbackChannel: interaction.channel,
      });
      return interaction.reply({ content: `✅ Recherche publiée : ${r.url}`, flags: EPHEMERAL });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: EPHEMERAL });
    }
  }, { always: true }),

  make('equipes', 'Tire au sort deux équipes avec les joueurs de ton vocal', (b) => b, async (interaction) => {
    const channel = interaction.member?.voice?.channel;
    if (!channel) return interaction.reply({ content: 'Rejoins d’abord un salon vocal.', flags: EPHEMERAL });
    const players = [...channel.members.values()].filter((m) => !m.user.bot).map((m) => m.id);
    if (players.length < 2) return interaction.reply({ content: 'Il faut au moins 2 joueurs dans le vocal.', flags: EPHEMERAL });
    const { blue, orange } = rl.splitTeams(players);
    const list = (ids) => ids.map((i) => `<@${i}>`).join('\n') || '—';
    return interaction.reply({
      embeds: [{ title: 'Équipes tirées au sort', color: colorOf(interaction), fields: [{ name: '🔵 Équipe bleue', value: list(blue), inline: true }, { name: '🟠 Équipe orange', value: list(orange), inline: true }] }],
      allowedMentions: noPing,
    });
  }),

  make('matchprive', 'Génère un nom et un mot de passe pour un match privé', (b) => b, async (interaction) => {
    const { name, password } = rl.matchCredentials();
    return interaction.reply({
      embeds: [{
        title: 'Match privé',
        description: 'Dans Rocket League : Jouer, Match privé, Créer un match privé, puis recopie ces informations.',
        color: colorOf(interaction),
        fields: [{ name: 'Nom du match', value: `\`${name}\``, inline: true }, { name: 'Mot de passe', value: `\`${password}\``, inline: true }],
      }],
    });
  }),

  make('defi', 'Un défi au hasard pour pimenter ta prochaine partie', (b) => b, async (interaction) => interaction.reply({
    embeds: [{ title: 'Ton défi', description: rl.pickChallenge(), color: colorOf(interaction) }],
  })),

  make('modealeatoire', 'Choisis le mode de jeu au hasard', (b) => b, async (interaction) => {
    const pool = rl.MODES.filter((m) => ['doubles', 'standard', 'rumble', 'hoops', 'dropshot', 'snowday'].includes(m.id));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return interaction.reply({ embeds: [{ title: 'Mode tiré au sort', description: `**${pick.label}**`, color: colorOf(interaction) }] });
  }),
];
