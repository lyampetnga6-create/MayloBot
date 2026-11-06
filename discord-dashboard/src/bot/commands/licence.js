'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { LicenseError } = require('../../lib/license');
const { EPHEMERAL } = require('../util');

const fmt = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;

function statusText(client, guild) {
  const { license, config } = client.ctx;
  const st = license.status(guild.id, guild.ownerId);
  switch (st.state) {
    case 'disabled': return 'Les licences ne sont pas activées sur ce bot : tout est gratuit.';
    case 'free': return '🎁 Ce serveur est offert (aucun abonnement nécessaire).';
    case 'licensed': return `✅ **Licence active**${st.periodEnd ? ` — prochaine échéance le ${fmt(st.periodEnd)}` : ''}.`;
    case 'trial': return `🕒 **Essai gratuit** jusqu’au ${fmt(st.trialEndsAt)}.\nPour continuer ensuite : ${config.baseUrl}/dashboard#/account (${config.license.priceLabel}).`;
    default: return `🔒 **Essai terminé.** Le bot est en pause sur ce serveur.\nAbonne-toi (${config.license.priceLabel}) : ${config.baseUrl}/dashboard#/account puis utilise \`/licence activer\`.`;
  }
}

module.exports = [{
  category: 'Administration',
  data: new SlashCommandBuilder()
    .setName('licence')
    .setDescription('Abonnement et clé de licence de ce serveur')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('statut').setDescription('Voir l’état de l’essai ou de la licence'))
    .addSubcommand((s) => s.setName('activer').setDescription('Activer une clé de licence sur ce serveur')
      .addStringOption((o) => o.setName('cle').setDescription('Ta clé (KEY-XXXX-XXXX-XXXX-XXXX)').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('desactiver').setDescription('Retirer la clé de ce serveur (pour la réutiliser ailleurs)')),

  async execute(interaction) {
    const client = interaction.client;
    const { license } = client.ctx;
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const reply = (content) => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply('Il faut la permission « Gérer le serveur » pour utiliser cette commande.');
    if (!license.enabled) return reply(statusText(client, guild));

    try {
      if (sub === 'statut') {
        const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle('Abonnement').setDescription(statusText(client, guild));
        return await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      }
      if (sub === 'activer') {
        const lic = license.getByKey(interaction.options.getString('cle', true));
        if (!lic) return await reply('❌ Clé introuvable. Vérifie-la (format `KEY-XXXX-XXXX-XXXX-XXXX`).');
        license.activate(lic.id, guild.id, interaction.user.id);
        return await reply(`✅ Clé activée : le bot est actif sur **${guild.name}**.`);
      }
      const had = license.deactivate(guild.id);
      return await reply(had ? '✅ Clé retirée de ce serveur. Tu peux l’activer sur un autre serveur.' : 'Aucune clé n’est activée sur ce serveur.');
    } catch (err) {
      if (err instanceof LicenseError) return reply(`❌ ${err.message}`);
      throw err;
    }
  },
}];
