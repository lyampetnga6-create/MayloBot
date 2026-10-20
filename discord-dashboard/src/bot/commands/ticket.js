'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, ChannelType } = require('discord.js');
const tickets = require('../modules/tickets');
const { EPHEMERAL } = require('../util');

const userOption = (o) => o.setName('membre').setDescription('Membre concerné').setRequired(true);

module.exports = [
  {
    category: 'Tickets',
    data: new SlashCommandBuilder().setName('ticket').setDescription('Gestion des tickets')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => s.setName('panel').setDescription('Publie le panneau d’ouverture de tickets')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon (par défaut : celui configuré dans le dashboard)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
      .addSubcommand((s) => s.setName('add').setDescription('Ajoute un membre au ticket').addUserOption(userOption))
      .addSubcommand((s) => s.setName('remove').setDescription('Retire un membre du ticket').addUserOption(userOption))
      .addSubcommand((s) => s.setName('close').setDescription('Ferme ce ticket').addStringOption((o) => o.setName('raison').setDescription('Raison de la fermeture').setMaxLength(300)))
      .addSubcommand((s) => s.setName('rename').setDescription('Renomme ce ticket').addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(60)))
      .addSubcommand((s) => s.setName('claim').setDescription('Prends ce ticket en charge'))
      .addSubcommand((s) => s.setName('unclaim').setDescription('Libère ce ticket'))
      .addSubcommand((s) => s.setName('reopen').setDescription('Rouvre ce ticket fermé'))
      .addSubcommand((s) => s.setName('transcript').setDescription('Génère la transcription de ce ticket'))
      .addSubcommand((s) => s.setName('ia').setDescription('Active ou coupe l’assistant IA dans ce ticket')
        .addStringOption((o) => o.setName('etat').setDescription('État').setRequired(true).addChoices({ name: 'Activer', value: 'on' }, { name: 'Couper', value: 'off' }))),

    async execute(interaction) {
      const { client, guild } = interaction;
      const sub = interaction.options.getSubcommand();

      if (sub === 'panel') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'Il faut la permission « Gérer le serveur ».', flags: EPHEMERAL });
        }
        await interaction.deferReply({ flags: EPHEMERAL });
        try {
          const channel = interaction.options.getChannel('salon');
          const sent = await tickets.publishPanel(client, guild, channel?.id);
          return interaction.editReply(`✅ Panneau publié : ${sent.url}`);
        } catch (err) {
          return interaction.editReply(`❌ ${err.message}`);
        }
      }

      await interaction.deferReply({ flags: sub === 'close' ? undefined : EPHEMERAL });
      try {
        switch (sub) {
          case 'add': return await interaction.editReply(await tickets.addMember(client, interaction, interaction.options.getUser('membre', true)));
          case 'remove': return await interaction.editReply(await tickets.removeMember(client, interaction, interaction.options.getUser('membre', true)));
          case 'rename': return await interaction.editReply(await tickets.renameTicket(client, interaction, interaction.options.getString('nom', true)));
          case 'claim': return await interaction.editReply(await tickets.claimFromCommand(client, interaction, false));
          case 'unclaim': return await interaction.editReply(await tickets.claimFromCommand(client, interaction, true));
          case 'reopen': return await interaction.editReply(await tickets.reopen(client, interaction));
          case 'ia': return await interaction.editReply(tickets.aiToggle(client, interaction, interaction.options.getString('etat', true) === 'on'));
          case 'transcript': return await interaction.editReply({ content: 'Voici la transcription :', files: [await tickets.transcriptFromCommand(client, interaction)] });
          default: return await tickets.closeFromCommand(client, interaction, interaction.options.getString('raison') || '');
        }
      } catch (err) {
        return interaction.editReply(`❌ ${err.message}`);
      }
    },
  },
];
