'use strict';
const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, ChannelType, version: djsVersion } = require('discord.js');
const os = require('node:os');
const { hexToInt, safeText, trunc } = require('../../lib/template');
const { parseDuration, formatDuration } = require('../../lib/duration');
const { calculate } = require('../../lib/fun');
const { EPHEMERAL } = require('../util');
const extras = require('../modules/extras');

const g = (b) => b.setContexts(InteractionContextType.Guild);
const colorOf = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor);
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:D> (<t:${Math.floor(ms / 1000)}:R>)`;
const CHANNEL_KIND = {
  [ChannelType.GuildText]: 'Textuel', [ChannelType.GuildVoice]: 'Vocal', [ChannelType.GuildCategory]: 'Catégorie', [ChannelType.GuildAnnouncement]: 'Annonces',
  [ChannelType.GuildForum]: 'Forum', [ChannelType.GuildStageVoice]: 'Conférence', [ChannelType.PublicThread]: 'Fil', [ChannelType.PrivateThread]: 'Fil privé',
};

module.exports = [
  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('rappel').setDescription('Programme un rappel')
      .addSubcommand((s) => s.setName('creer').setDescription('Crée un rappel')
        .addStringOption((o) => o.setName('delai').setDescription('Dans combien de temps ? ex : 30m, 2h, 1j').setRequired(true))
        .addStringOption((o) => o.setName('texte').setDescription('De quoi dois-je te rappeler ?').setRequired(true).setMaxLength(400)))
      .addSubcommand((s) => s.setName('liste').setDescription('Tes rappels en attente'))
      .addSubcommand((s) => s.setName('supprimer').setDescription('Supprime un rappel').addIntegerOption((o) => o.setName('numero').setDescription('Numéro du rappel').setRequired(true)))),
    async execute(interaction) {
      const { client, user } = interaction;
      const sub = interaction.options.getSubcommand();
      if (sub === 'creer') {
        const ms = parseDuration(interaction.options.getString('delai', true));
        if (!ms || ms < 10000 || ms > 365 * 86400000) return interaction.reply({ content: 'Délai invalide (10 secondes à 1 an). Exemples : `30m`, `2h`, `1j`.', flags: EPHEMERAL });
        const id = extras.addReminder(client, { userId: user.id, guildId: interaction.guild.id, channelId: interaction.channelId, text: interaction.options.getString('texte', true), dueAt: Date.now() + ms });
        if (!id) return interaction.reply({ content: `Tu as déjà ${extras.MAX_REMINDERS} rappels en attente.`, flags: EPHEMERAL });
        return interaction.reply({ content: `⏰ Rappel #${id} programmé <t:${Math.floor((Date.now() + ms) / 1000)}:R>.`, flags: EPHEMERAL });
      }
      if (sub === 'liste') {
        const rows = extras.listReminders(client, user.id);
        return interaction.reply({ content: rows.map((r) => `**#${r.id}** <t:${Math.floor(r.due_at / 1000)}:R> — ${trunc(safeText(r.text), 80)}`).join('\n') || 'Aucun rappel en attente.', flags: EPHEMERAL });
      }
      const ok = extras.deleteReminder(client, user.id, interaction.options.getInteger('numero', true));
      return interaction.reply({ content: ok ? 'Rappel supprimé.' : 'Rappel introuvable.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('afk').setDescription('Signale que tu es absent')
      .addStringOption((o) => o.setName('raison').setDescription('Pourquoi ?').setMaxLength(150))),
    async execute(interaction) {
      extras.setAfk(interaction.client, interaction.guild.id, interaction.user.id, interaction.options.getString('raison') || '');
      return interaction.reply({ content: '💤 Tu es maintenant AFK. Je préviendrai ceux qui te mentionnent, et le statut disparaît dès ton prochain message.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('roleinfo').setDescription('Informations sur un rôle').addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))),
    async execute(interaction) {
      const r = interaction.options.getRole('role', true);
      const role = interaction.guild.roles.cache.get(r.id);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(role?.color || colorOf(interaction)).setTitle(`Rôle ${safeText(r.name)}`).addFields(
          { name: 'Identifiant', value: r.id, inline: true },
          { name: 'Couleur', value: role?.hexColor || '—', inline: true },
          { name: 'Membres', value: String(role?.members.size ?? '?'), inline: true },
          { name: 'Affiché à part', value: role?.hoist ? 'Oui' : 'Non', inline: true },
          { name: 'Mentionnable', value: role?.mentionable ? 'Oui' : 'Non', inline: true },
          { name: 'Créé', value: ts(role?.createdTimestamp || Date.now()), inline: false },
        )],
        flags: EPHEMERAL,
      });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('channelinfo').setDescription('Informations sur un salon').addChannelOption((o) => o.setName('salon').setDescription('Salon (ici par défaut)'))),
    async execute(interaction) {
      const c = interaction.options.getChannel('salon') || interaction.channel;
      const ch = interaction.guild.channels.cache.get(c.id) || c;
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`#${ch.name}`).setDescription(ch.topic ? safeText(ch.topic) : null).addFields(
          { name: 'Type', value: CHANNEL_KIND[ch.type] || 'Autre', inline: true },
          { name: 'Identifiant', value: ch.id, inline: true },
          { name: 'Catégorie', value: ch.parent?.name || '—', inline: true },
          { name: 'Mode lent', value: ch.rateLimitPerUser ? `${ch.rateLimitPerUser} s` : 'Aucun', inline: true },
          { name: 'NSFW', value: ch.nsfw ? 'Oui' : 'Non', inline: true },
          { name: 'Créé', value: ts(ch.createdTimestamp), inline: false },
        )],
        flags: EPHEMERAL,
      });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('membres').setDescription('Statistiques de membres du serveur')),
    async execute(interaction) {
      const guild = interaction.guild;
      const humans = guild.members.cache.filter((m) => !m.user.bot).size;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const online = guild.members.cache.filter((m) => m.presence && m.presence.status !== 'offline').size;
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`👥 ${guild.memberCount} membres`)
          .setDescription(`Humains (en cache) : **${humans}**\nBots (en cache) : **${bots}**${online ? `\nEn ligne : **${online}**` : ''}\nBoosts : **${guild.premiumSubscriptionCount || 0}**`)],
      });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('banniere').setDescription('Affiche la bannière d’un membre').addUserOption((o) => o.setName('membre').setDescription('Membre'))),
    async execute(interaction) {
      const user = await (interaction.options.getUser('membre') || interaction.user).fetch(true).catch(() => null);
      const url = user?.bannerURL({ size: 1024 });
      if (!url) return interaction.reply({ content: 'Ce membre n’a pas de bannière.', flags: EPHEMERAL });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`Bannière de ${safeText(user.username)}`).setImage(url)] });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('snipe').setDescription('Dernier message supprimé ou modifié dans ce salon')
      .addStringOption((o) => o.setName('type').setDescription('Quoi ?').addChoices({ name: 'Supprimé', value: 'deleted' }, { name: 'Modifié (ancienne version)', value: 'edited' }))),
    async execute(interaction) {
      // Les messages supprimés peuvent être sensibles : réservé aux membres qui peuvent gérer les messages.
      if (!interaction.memberPermissions.has('ManageMessages')) return interaction.reply({ content: 'Réservé aux modérateurs (Gérer les messages).', flags: EPHEMERAL });
      const kind = interaction.options.getString('type') || 'deleted';
      const entry = extras.getSniped(interaction.channelId)[kind];
      if (!entry || Date.now() - entry.at > 3600000) return interaction.reply({ content: 'Rien à afficher (seule la dernière heure est conservée).', flags: EPHEMERAL });
      const e = new EmbedBuilder().setColor(colorOf(interaction)).setAuthor({ name: entry.name || 'Inconnu' }).setDescription(safeText(entry.content) || '*(sans texte)*').setTimestamp(entry.at)
        .setFooter({ text: kind === 'deleted' ? 'Message supprimé' : 'Avant modification' });
      if (entry.image) e.setImage(entry.image);
      return interaction.reply({ embeds: [e], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('calc').setDescription('Calculatrice (+ - * / % ^, parenthèses, sqrt, pi…)')
      .addStringOption((o) => o.setName('expression').setDescription('Ex : (3+4)*2^3').setRequired(true).setMaxLength(100))),
    async execute(interaction) {
      const expr = interaction.options.getString('expression', true);
      const r = calculate(expr);
      return interaction.reply({ content: r === null ? '❌ Expression invalide.' : `🧮 \`${expr.replace(/`/g, '')}\` = **${Number.isInteger(r) ? r : Number(r.toPrecision(12))}**`, flags: r === null ? EPHEMERAL : undefined });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('timestamp').setDescription('Génère un horodatage Discord')
      .addStringOption((o) => o.setName('dans').setDescription('Dans combien de temps ? ex : 2h30m, 3j').setRequired(true))),
    async execute(interaction) {
      const ms = parseDuration(interaction.options.getString('dans', true));
      if (!ms) return interaction.reply({ content: 'Durée invalide. Exemples : `2h30m`, `3j`.', flags: EPHEMERAL });
      const s = Math.floor((Date.now() + ms) / 1000);
      return interaction.reply({ content: ['d', 't', 'f', 'F', 'R'].map((f) => `<t:${s}:${f}> → \`<t:${s}:${f}>\``).join('\n'), flags: EPHEMERAL });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('emoji').setDescription('Agrandit un émoji personnalisé').addStringOption((o) => o.setName('emoji').setDescription('Un émoji du serveur').setRequired(true))),
    async execute(interaction) {
      const m = /<(a?):(\w+):(\d{17,20})>/.exec(interaction.options.getString('emoji', true));
      if (!m) return interaction.reply({ content: 'Utilise un émoji personnalisé (pas un émoji standard).', flags: EPHEMERAL });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`:${m[2]}:`).setImage(`https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}?size=256`)] });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('botinfo').setDescription('Informations sur le bot')),
    async execute(interaction) {
      const c = interaction.client;
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(c.user.username).setThumbnail(c.user.displayAvatarURL()).addFields(
          { name: 'Serveurs', value: String(c.guilds.cache.size), inline: true },
          { name: 'Commandes', value: String(c.commands.size), inline: true },
          { name: 'Latence', value: `${Math.round(c.ws.ping)} ms`, inline: true },
          { name: 'En ligne depuis', value: `<t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:R>`, inline: true },
          { name: 'Mémoire', value: `${Math.round(process.memoryUsage().rss / 1048576)} Mo`, inline: true },
          { name: 'Technique', value: `Node ${process.version} · discord.js ${djsVersion} · ${os.platform()}`, inline: false },
        )],
        flags: EPHEMERAL,
      });
    },
  },

  {
    category: 'Utilitaire',
    data: g(new SlashCommandBuilder().setName('uptime').setDescription('Depuis quand le bot est en ligne')),
    execute: (interaction) => interaction.reply({ content: `⏱️ En ligne depuis **${formatDuration(Math.round(process.uptime()) * 1000)}**.`, flags: EPHEMERAL }),
  },
];
