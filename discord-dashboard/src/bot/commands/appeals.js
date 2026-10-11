'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits: P } = require('discord.js');
const { brandedEmbed } = require('../../lib/template');
const { EPHEMERAL } = require('../util');
const appeals = require('../modules/appeals');

const STATUS = { open: 'En cours', accepted: 'Acceptée', refused: 'Refusée' };

module.exports = [
  {
    category: 'Modération',
    module: 'appeals',
    data: new SlashCommandBuilder().setName('contestation').setDescription('Consulte les contestations de sanctions')
      .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(P.ModerateMembers)
      .addSubcommand((s) => s.setName('liste').setDescription('Contestations en attente de réponse'))
      .addSubcommand((s) => s.setName('membre').setDescription('Historique des contestations d’un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))),
    async execute(interaction) {
      const { guild, client } = interaction;
      const cfg = client.ctx.settings.module(guild.id, 'appeals');
      if (!appeals.isStaff(interaction.member, guild, cfg)) {
        return interaction.reply({ content: 'Seul le staff peut consulter les contestations.', flags: EPHEMERAL });
      }
      const general = client.ctx.settings.module(guild.id, 'general');
      const sub = interaction.options.getSubcommand();
      const { db } = client.ctx;
      let rows;
      let title;
      if (sub === 'liste') {
        rows = db.prepare("SELECT * FROM appeals WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT 15").all(guild.id);
        title = 'Contestations en attente';
      } else {
        const user = interaction.options.getUser('membre', true);
        rows = db.prepare('SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 15').all(guild.id, user.id);
        title = `Contestations de ${user.username}`;
      }
      const embed = brandedEmbed(general).setTitle(title);
      if (!rows.length) embed.setDescription('Aucune contestation.');
      else {
        embed.setDescription(rows.map((a) => {
          const link = a.channel_id ? ` · <#${a.channel_id}>` : '';
          return `**#${a.id}** · <@${a.user_id}> · ${appeals.TYPE_LABELS[a.type] || a.type} · ${STATUS[a.status]}${a.final ? ' (définitif)' : ''}${link}\n<t:${Math.floor(a.created_at / 1000)}:R>`;
        }).join('\n\n').slice(0, 4000));
      }
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    },
  },
];
