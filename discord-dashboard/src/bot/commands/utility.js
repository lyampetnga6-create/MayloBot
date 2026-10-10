'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, ChannelType } = require('discord.js');
const { brandedEmbed } = require('../../lib/template');
const { config } = require('../../config');
const { EPHEMERAL } = require('../util');

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:D> (<t:${Math.floor(ms / 1000)}:R>)`;

module.exports = [
  {
    data: guildOnly(new SlashCommandBuilder().setName('ping').setDescription('Affiche la latence du bot')),
    category: 'Utilitaire',
    async execute(interaction) {
      const t0 = Date.now();
      await interaction.reply('Pong…');
      const rtt = Date.now() - t0;
      await interaction.editReply(`🏓 Pong ! Aller-retour API : **${rtt} ms** · WebSocket : **${Math.round(interaction.client.ws.ping)} ms**`);
    },
  },

  {
    data: guildOnly(new SlashCommandBuilder().setName('help').setDescription('Liste des commandes disponibles')),
    category: 'Utilitaire',
    async execute(interaction) {
      const { commands } = interaction.client;
      const general = interaction.client.ctx.settings.get(interaction.guild.id).general;
      const byCat = new Map();
      for (const cmd of commands.values()) {
        const cat = cmd.category || 'Autres';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(`\`/${cmd.data.name}\` — ${cmd.data.description}`);
      }
      const e = brandedEmbed(general).setTitle(`Commandes de ${interaction.client.user.username}`);
      for (const [cat, lines] of byCat) e.addFields({ name: cat, value: lines.join('\n').slice(0, 1024) });
      e.addFields({ name: 'Dashboard', value: `Configure tout depuis [le dashboard](${config.baseUrl}/dashboard#/g/${interaction.guild.id}).` });
      await interaction.reply({ embeds: [e], flags: EPHEMERAL });
    },
  },

  {
    data: guildOnly(new SlashCommandBuilder().setName('dashboard').setDescription('Lien vers le dashboard de ce serveur')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)),
    category: 'Utilitaire',
    async execute(interaction) {
      await interaction.reply({ content: `🔧 Dashboard : ${config.baseUrl}/dashboard#/g/${interaction.guild.id}`, flags: EPHEMERAL });
    },
  },

  {
    data: guildOnly(new SlashCommandBuilder().setName('avatar').setDescription('Affiche l’avatar d’un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre ciblé'))),
    category: 'Utilitaire',
    async execute(interaction) {
      const user = interaction.options.getUser('membre') || interaction.user;
      const general = interaction.client.ctx.settings.get(interaction.guild.id).general;
      await interaction.reply({
        embeds: [brandedEmbed(general).setTitle(`Avatar de ${user.username}`).setImage(user.displayAvatarURL({ size: 1024 }))],
      });
    },
  },

  {
    data: guildOnly(new SlashCommandBuilder().setName('userinfo').setDescription('Informations sur un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre ciblé'))),
    category: 'Utilitaire',
    async execute(interaction) {
      const user = interaction.options.getUser('membre') || interaction.user;
      const member = interaction.options.getMember('membre') || (user.id === interaction.user.id ? interaction.member : null);
      const general = interaction.client.ctx.settings.get(interaction.guild.id).general;
      const e = brandedEmbed(general)
        .setTitle(user.username)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'ID', value: `\`${user.id}\``, inline: true },
          { name: 'Compte créé', value: ts(user.createdTimestamp), inline: false },
        );
      if (member) {
        if (member.joinedTimestamp) e.addFields({ name: 'A rejoint le serveur', value: ts(member.joinedTimestamp) });
        const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map((r) => r.toString());
        if (roles.length) e.addFields({ name: `Rôles (${roles.length})`, value: roles.join(' ').slice(0, 1024) });
      }
      await interaction.reply({ embeds: [e] });
    },
  },

  {
    data: guildOnly(new SlashCommandBuilder().setName('serverinfo').setDescription('Informations sur le serveur')),
    category: 'Utilitaire',
    async execute(interaction) {
      const g = interaction.guild;
      const general = interaction.client.ctx.settings.get(g.id).general;
      const count = (type) => g.channels.cache.filter((c) => c.type === type).size;
      const e = brandedEmbed(general)
        .setTitle(g.name)
        .setThumbnail(g.iconURL({ size: 256 }))
        .addFields(
          { name: 'Propriétaire', value: `<@${g.ownerId}>`, inline: true },
          { name: 'Membres', value: String(g.memberCount), inline: true },
          { name: 'Créé', value: ts(g.createdTimestamp) },
          { name: 'Salons', value: `${count(ChannelType.GuildText)} textuels · ${count(ChannelType.GuildVoice)} vocaux · ${count(ChannelType.GuildCategory)} catégories`, inline: true },
          { name: 'Rôles', value: String(g.roles.cache.size - 1), inline: true },
          { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0} (niveau ${g.premiumTier})`, inline: true },
        );
      await interaction.reply({ embeds: [e] });
    },
  },
];
