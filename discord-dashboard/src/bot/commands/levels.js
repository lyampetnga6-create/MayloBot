'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { brandedEmbed } = require('../../lib/template');
const { progress, bar } = require('../../lib/levels');
const { getRow, rankOf } = require('../modules/levels');
const { EPHEMERAL } = require('../util');

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);

function disabled(interaction) {
  const cfg = interaction.client.ctx.settings.get(interaction.guild.id).levels;
  if (cfg.enabled) return false;
  interaction.reply({ content: 'Le système de niveaux est désactivé sur ce serveur.', flags: EPHEMERAL });
  return true;
}

module.exports = [
  {
    category: 'Niveaux',
    data: guildOnly(new SlashCommandBuilder().setName('rank').setDescription('Affiche ton niveau et ton XP')
      .addUserOption((o) => o.setName('membre').setDescription('Membre ciblé'))),
    async execute(interaction) {
      if (disabled(interaction)) return;
      const user = interaction.options.getUser('membre') || interaction.user;
      const { db, settings } = interaction.client.ctx;
      const row = getRow(db, interaction.guild.id, user.id);
      const p = progress(row.xp);
      const e = brandedEmbed(settings.get(interaction.guild.id).general)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .addFields(
          { name: 'Niveau', value: String(p.level), inline: true },
          { name: 'Classement', value: `#${rankOf(db, interaction.guild.id, user.id)}`, inline: true },
          { name: 'Messages', value: String(row.messages), inline: true },
          { name: `Progression · ${p.current} / ${p.needed} XP`, value: `${bar(p.ratio)} ${Math.round(p.ratio * 100)} %` },
        )
        .setFooter({ text: `${row.xp} XP au total` });
      await interaction.reply({ embeds: [e] });
    },
  },

  {
    category: 'Niveaux',
    data: guildOnly(new SlashCommandBuilder().setName('leaderboard').setDescription('Classement des membres les plus actifs')
      .addIntegerOption((o) => o.setName('page').setDescription('Page du classement').setMinValue(1))),
    async execute(interaction) {
      if (disabled(interaction)) return;
      const page = interaction.options.getInteger('page') || 1;
      const { db, settings } = interaction.client.ctx;
      const rows = db.prepare('SELECT user_id, xp, level FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 10 OFFSET ?')
        .all(interaction.guild.id, (page - 1) * 10);
      const e = brandedEmbed(settings.get(interaction.guild.id).general).setTitle(`🏆 Classement — ${interaction.guild.name}`);
      if (!rows.length) e.setDescription('Personne dans le classement pour l’instant.');
      else {
        const medals = ['🥇', '🥈', '🥉'];
        e.setDescription(rows.map((r, i) => {
          const pos = (page - 1) * 10 + i;
          return `${medals[pos] || `**${pos + 1}.**`} <@${r.user_id}> — niveau **${r.level}** · ${r.xp} XP`;
        }).join('\n'));
        e.setFooter({ text: `Page ${page}` });
      }
      await interaction.reply({ embeds: [e], allowedMentions: { parse: [] } });
    },
  },
];
