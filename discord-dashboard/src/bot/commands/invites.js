'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { brandedEmbed } = require('../../lib/template');
const { EPHEMERAL } = require('../util');
const invites = require('../modules/invites');

module.exports = [
  {
    category: 'Communauté',
    module: 'invites',
    data: new SlashCommandBuilder().setName('invitations').setDescription('Suivi des invitations du serveur')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => s.setName('membre').setDescription('Invitations d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (par défaut : toi)')))
      .addSubcommand((s) => s.setName('classement').setDescription('Les membres qui ont fait venir le plus de monde')),
    async execute(interaction) {
      const { guild, client } = interaction;
      const general = client.ctx.settings.module(guild.id, 'general');
      const embed = brandedEmbed(general);
      if (interaction.options.getSubcommand() === 'membre') {
        const user = interaction.options.getUser('membre') || interaction.user;
        const s = invites.statsFor(client, guild.id, user.id);
        const by = invites.inviterOf(client, guild.id, user.id);
        embed.setTitle(`Invitations de ${user.username}`)
          .setDescription(`**${s.active}** invitations actives\n${s.total} au total, ${s.left} parties\n\n${by?.inviterId ? `Arrivé(e) grâce à <@${by.inviterId}>` : 'Origine de l’arrivée inconnue'}`);
      } else {
        const rows = invites.leaderboard(client, guild.id, 10);
        embed.setTitle('Classement des invitations');
        embed.setDescription(rows.length
          ? rows.map((r, i) => `**${i + 1}.** <@${r.userId}> : ${r.active} actives (${r.total} au total)`).join('\n')
          : 'Personne n’a encore invité de membre.');
      }
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    },
  },
];
