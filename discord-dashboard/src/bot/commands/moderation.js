'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { brandedEmbed, safeText } = require('../../lib/template');
const { EPHEMERAL } = require('../util');
const mod = require('../modules/moderation');

const base = (name, description, perm) =>
  new SlashCommandBuilder().setName(name).setDescription(description)
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(perm);

const memberOption = (o) => o.setName('membre').setDescription('Membre ciblé').setRequired(true);
const reasonOption = (o) => o.setName('raison').setDescription('Raison de la sanction').setMaxLength(450);

/** Exécute une sanction depuis une commande slash. */
async function runSanction(interaction, type, perm, extra = {}) {
  const { client, guild } = interaction;
  if (!interaction.memberPermissions?.has(perm)) {
    return interaction.reply({ content: 'Tu n’as pas la permission d’utiliser cette commande.', flags: EPHEMERAL });
  }
  const user = interaction.options.getUser('membre', true);
  const reason = interaction.options.getString('raison') || '';
  const cfg = client.ctx.settings.get(guild.id).moderation;
  if (cfg.requireReason && !reason) {
    return interaction.reply({ content: 'Une raison est obligatoire sur ce serveur.', flags: EPHEMERAL });
  }

  const member = interaction.options.getMember('membre');
  if (type !== 'unban') {
    const problem = mod.hierarchyError(guild, interaction.member, member);
    if (problem) return interaction.reply({ content: `❌ ${problem}`, flags: EPHEMERAL });
  }
  if (user.bot && type === 'warn') return interaction.reply({ content: 'Inutile d’avertir un bot.', flags: EPHEMERAL });

  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const { id, embed } = await mod.sanction(client, { guild, user, moderator: interaction.user, type, reason, ...extra });
    await interaction.editReply({ content: `✅ Dossier #${id} enregistré.`, embeds: [embed] });
  } catch (err) {
    await interaction.editReply(`❌ ${err.message}`);
  }
}

module.exports = [
  {
    category: 'Modération',
    data: base('ban', 'Bannit un membre', P.BanMembers)
      .addUserOption(memberOption).addStringOption(reasonOption)
      .addIntegerOption((o) => o.setName('jours').setDescription('Jours de messages à supprimer (0-7)').setMinValue(0).setMaxValue(7)),
    execute: (i) => runSanction(i, 'ban', P.BanMembers, { deleteDays: i.options.getInteger('jours') || 0 }),
  },
  {
    category: 'Modération',
    data: base('unban', 'Débannit un utilisateur', P.BanMembers)
      .addUserOption(memberOption).addStringOption(reasonOption),
    execute: (i) => runSanction(i, 'unban', P.BanMembers),
  },
  {
    category: 'Modération',
    data: base('kick', 'Expulse un membre', P.KickMembers).addUserOption(memberOption).addStringOption(reasonOption),
    execute: (i) => runSanction(i, 'kick', P.KickMembers),
  },
  {
    category: 'Modération',
    data: base('timeout', 'Exclut temporairement un membre', P.ModerateMembers)
      .addUserOption(memberOption)
      .addIntegerOption((o) => o.setName('minutes').setDescription('Durée en minutes').setRequired(true).setMinValue(1).setMaxValue(mod.MAX_TIMEOUT_MIN))
      .addStringOption(reasonOption),
    execute: (i) => runSanction(i, 'timeout', P.ModerateMembers, { duration: i.options.getInteger('minutes', true) }),
  },
  {
    category: 'Modération',
    data: base('untimeout', 'Met fin à l’exclusion d’un membre', P.ModerateMembers).addUserOption(memberOption).addStringOption(reasonOption),
    execute: (i) => runSanction(i, 'untimeout', P.ModerateMembers),
  },
  {
    category: 'Modération',
    data: base('warn', 'Avertit un membre', P.ModerateMembers).addUserOption(memberOption).addStringOption(reasonOption),
    execute: (i) => runSanction(i, 'warn', P.ModerateMembers),
  },

  {
    category: 'Modération',
    data: base('warnings', 'Liste les avertissements d’un membre', P.ModerateMembers).addUserOption(memberOption),
    async execute(interaction) {
      const { client, guild } = interaction;
      const user = interaction.options.getUser('membre', true);
      const rows = mod.listWarns(client.ctx.db, guild.id, user.id);
      const general = client.ctx.settings.get(guild.id).general;
      const e = brandedEmbed(general).setTitle(`Avertissements de ${user.username}`);
      if (!rows.length) e.setDescription('Aucun avertissement. ✨');
      else {
        e.setDescription(rows.map((r) => `**#${r.id}** · <t:${Math.floor(r.created_at / 1000)}:d> · par <@${r.mod_id}>\n${safeText(r.reason || '_Sans raison_').slice(0, 200)}`).join('\n\n').slice(0, 4000));
        e.setFooter({ text: `${mod.countWarns(client.ctx.db, guild.id, user.id, client.ctx.settings.get(guild.id).moderation.warnExpireDays)} avertissement(s) actif(s)` });
      }
      await interaction.reply({ embeds: [e], flags: EPHEMERAL });
    },
  },

  {
    category: 'Modération',
    data: base('unwarn', 'Supprime un avertissement par son numéro de dossier', P.ModerateMembers)
      .addIntegerOption((o) => o.setName('dossier').setDescription('Numéro du dossier').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      const id = interaction.options.getInteger('dossier', true);
      const res = interaction.client.ctx.db.prepare("DELETE FROM cases WHERE id = ? AND guild_id = ? AND type = 'warn'").run(id, interaction.guild.id);
      await interaction.reply({ content: res.changes ? `✅ Avertissement #${id} supprimé.` : '❌ Aucun avertissement avec ce numéro.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Modération',
    data: base('clearwarns', 'Supprime tous les avertissements d’un membre', P.ModerateMembers).addUserOption(memberOption),
    async execute(interaction) {
      const user = interaction.options.getUser('membre', true);
      const res = interaction.client.ctx.db.prepare("DELETE FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn'").run(interaction.guild.id, user.id);
      await interaction.reply({ content: `✅ ${res.changes} avertissement(s) supprimé(s) pour ${user.username}.`, flags: EPHEMERAL });
    },
  },

  {
    category: 'Modération',
    data: base('purge', 'Supprime des messages en masse', P.ManageMessages)
      .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre')),
    async execute(interaction) {
      const n = interaction.options.getInteger('nombre', true);
      const user = interaction.options.getUser('membre');
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        let messages = await interaction.channel.messages.fetch({ limit: 100 });
        if (user) messages = messages.filter((m) => m.author.id === user.id);
        const deleted = await interaction.channel.bulkDelete([...messages.values()].slice(0, n), true);
        await interaction.editReply(`🧹 ${deleted.size} message(s) supprimé(s). (Discord ne permet pas de supprimer en masse les messages de plus de 14 jours.)`);
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
    },
  },

  {
    category: 'Modération',
    data: base('slowmode', 'Règle le mode lent du salon', P.ManageChannels)
      .addIntegerOption((o) => o.setName('secondes').setDescription('0 pour désactiver').setRequired(true).setMinValue(0).setMaxValue(21600)),
    async execute(interaction) {
      const s = interaction.options.getInteger('secondes', true);
      try {
        await interaction.channel.setRateLimitPerUser(s, `Par ${interaction.user.username}`);
        await interaction.reply({ content: s ? `🐢 Mode lent réglé sur ${s} s.` : '✅ Mode lent désactivé.', flags: EPHEMERAL });
      } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, flags: EPHEMERAL });
      }
    },
  },

  ...[['lock', 'Verrouille le salon (personne ne peut écrire)', false], ['unlock', 'Déverrouille le salon', null]].map(([name, desc, value]) => ({
    category: 'Modération',
    data: base(name, desc, P.ManageChannels),
    async execute(interaction) {
      const ch = interaction.channel;
      if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
        return interaction.reply({ content: 'Cette commande ne fonctionne que dans un salon textuel.', flags: EPHEMERAL });
      }
      try {
        await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: value }, { reason: `${name} par ${interaction.user.username}` });
        return interaction.reply({ content: name === 'lock' ? '🔒 Salon verrouillé.' : '🔓 Salon déverrouillé.' });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: EPHEMERAL });
      }
    },
  })),
];
