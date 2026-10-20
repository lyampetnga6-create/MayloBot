'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { hexToInt, safeText } = require('../../lib/template');
const { parseDuration } = require('../../lib/duration');
const { EPHEMERAL } = require('../util');
const community = require('../modules/community');
const tiktok = require('../modules/tiktok');

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);
const db = (i) => i.client.ctx.db;
const colorOf = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor);

module.exports = [
  /* ----------------------------- Suggestions ---------------------------- */
  {
    category: 'Communauté',
    module: 'suggestions',
    data: guildOnly(new SlashCommandBuilder().setName('suggestion').setDescription('Propose une idée pour le serveur')
      .addSubcommand((s) => s.setName('envoyer').setDescription('Envoie une suggestion')
        .addStringOption((o) => o.setName('texte').setDescription('Ta suggestion').setRequired(true).setMaxLength(1500)))
      .addSubcommand((s) => s.setName('repondre').setDescription('(Staff) Approuve ou refuse une suggestion')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de la suggestion').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('decision').setDescription('Décision').setRequired(true).addChoices({ name: 'Approuver', value: 'approved' }, { name: 'Refuser', value: 'denied' }))
        .addStringOption((o) => o.setName('raison').setDescription('Explication').setMaxLength(900)))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'envoyer') return community.submitSuggestion(interaction.client, interaction, interaction.options.getString('texte', true));
      const cfg = interaction.client.ctx.settings.module(interaction.guild.id, 'suggestions');
      if (!community.isManager(interaction.member, cfg.staffRoles)) return interaction.reply({ content: 'Réservé au staff.', flags: EPHEMERAL });
      try {
        await community.decideSuggestion(interaction.client, interaction.guild, interaction.options.getInteger('numero', true), interaction.options.getString('decision', true), interaction.options.getString('raison') || '', `<@${interaction.user.id}>`);
        return interaction.reply({ content: '✅ Réponse enregistrée.', flags: EPHEMERAL });
      } catch (e) {
        return interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL });
      }
    },
  },

  /* ------------------------------ Concours ------------------------------ */
  {
    category: 'Communauté',
    module: 'giveaways',
    data: guildOnly(new SlashCommandBuilder().setName('concours').setDescription('Gère les concours')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('lancer').setDescription('Lance un concours dans ce salon')
        .addStringOption((o) => o.setName('lot').setDescription('Ce que l’on gagne').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duree').setDescription('Durée : 30m, 2h, 1j, 1w…').setRequired(true))
        .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants').setMinValue(1).setMaxValue(20))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle requis pour participer'))
        .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau minimum').setMinValue(1).setMaxValue(500)))
      .addSubcommand((s) => s.setName('terminer').setDescription('Termine un concours maintenant')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du concours').setRequired(true)))
      .addSubcommand((s) => s.setName('relancer').setDescription('Tire de nouveaux gagnants')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du concours').setRequired(true)))
      .addSubcommand((s) => s.setName('liste').setDescription('Liste les concours en cours'))),
    async execute(interaction) {
      const { client, guild } = interaction;
      const sub = interaction.options.getSubcommand();
      if (sub === 'lancer') {
        const ms = parseDuration(interaction.options.getString('duree', true));
        if (!ms || ms < 10000 || ms > 90 * 86400000) return interaction.reply({ content: 'Durée invalide (entre 10 s et 90 jours). Exemples : `30m`, `2h`, `1j`.', flags: EPHEMERAL });
        return community.createGiveaway(client, interaction, {
          prize: interaction.options.getString('lot', true), durationMs: ms, winners: interaction.options.getInteger('gagnants') || 1,
          requiredRole: interaction.options.getRole('role')?.id, minLevel: interaction.options.getInteger('niveau') || 0,
        });
      }
      if (sub === 'liste') {
        const rows = db(interaction).prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at LIMIT 15").all(guild.id);
        return interaction.reply({ content: rows.map((g) => `**#${g.id}** ${safeText(g.prize)} — fin <t:${Math.floor(g.ends_at / 1000)}:R>`).join('\n') || 'Aucun concours en cours.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
      }
      const g = db(interaction).prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(interaction.options.getInteger('numero', true), guild.id);
      if (!g) return interaction.reply({ content: 'Concours introuvable.', flags: EPHEMERAL });
      if (sub === 'terminer' && g.status !== 'active') return interaction.reply({ content: 'Ce concours est déjà terminé.', flags: EPHEMERAL });
      if (sub === 'relancer' && g.status === 'active') return interaction.reply({ content: 'Ce concours est encore en cours : utilise `terminer`.', flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      await community.endGiveaway(client, guild, g, { reroll: sub === 'relancer' });
      return interaction.editReply('✅ Tirage effectué.');
    },
  },

  /* ------------------------------- Sondages ----------------------------- */
  {
    category: 'Communauté',
    data: guildOnly(new SlashCommandBuilder().setName('sondage').setDescription('Crée un sondage avec boutons')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('question').setDescription('La question').setRequired(true).setMaxLength(240))
      .addStringOption((o) => o.setName('options').setDescription('Choix séparés par « ; » (2 à 10)').setRequired(true).setMaxLength(900))
      .addBooleanOption((o) => o.setName('multiple').setDescription('Autoriser plusieurs choix'))
      .addStringOption((o) => o.setName('duree').setDescription('Durée avant clôture (ex : 1h, 1j) — vide = illimité'))),
    async execute(interaction) {
      const options = interaction.options.getString('options', true).split(/[;|\n]/).map((s) => s.trim().slice(0, 100)).filter(Boolean);
      if (options.length < 2 || options.length > 10) return interaction.reply({ content: 'Il faut entre 2 et 10 choix, séparés par « ; ».', flags: EPHEMERAL });
      const rawDuration = interaction.options.getString('duree');
      const ms = rawDuration ? parseDuration(rawDuration) : null;
      if (rawDuration && (!ms || ms < 60000)) return interaction.reply({ content: 'Durée invalide (minimum 1 minute).', flags: EPHEMERAL });
      return community.createPoll(interaction.client, interaction, { question: interaction.options.getString('question', true), options, multi: interaction.options.getBoolean('multiple') || false, durationMs: ms });
    },
  },

  /* ----------------------------- Anniversaires -------------------------- */
  {
    category: 'Communauté',
    module: 'birthdays',
    data: guildOnly(new SlashCommandBuilder().setName('anniversaire').setDescription('Gère les anniversaires')
      .addSubcommand((s) => s.setName('definir').setDescription('Enregistre ta date d’anniversaire')
        .addIntegerOption((o) => o.setName('jour').setDescription('Jour').setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption((o) => o.setName('mois').setDescription('Mois').setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((o) => o.setName('annee').setDescription('Année (facultatif, pour afficher ton âge)').setMinValue(1900).setMaxValue(2100)))
      .addSubcommand((s) => s.setName('supprimer').setDescription('Supprime ton anniversaire'))
      .addSubcommand((s) => s.setName('voir').setDescription('Affiche l’anniversaire d’un membre').addUserOption((o) => o.setName('membre').setDescription('Membre')))
      .addSubcommand((s) => s.setName('prochains').setDescription('Les prochains anniversaires'))),
    async execute(interaction) {
      const { client, guild, user } = interaction;
      const sub = interaction.options.getSubcommand();
      if (sub === 'definir') {
        const ok = community.setBirthday(client, guild.id, user.id, interaction.options.getInteger('jour', true), interaction.options.getInteger('mois', true), interaction.options.getInteger('annee'));
        return interaction.reply({ content: ok ? '🎂 Anniversaire enregistré !' : '❌ Date invalide.', flags: EPHEMERAL });
      }
      if (sub === 'supprimer') {
        db(interaction).prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?').run(guild.id, user.id);
        return interaction.reply({ content: 'Anniversaire supprimé.', flags: EPHEMERAL });
      }
      if (sub === 'voir') {
        const target = interaction.options.getUser('membre') || user;
        const b = db(interaction).prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?').get(guild.id, target.id);
        return interaction.reply({ content: b ? `🎂 ${target.username} est né(e) le **${b.day}/${b.month}**.` : `${target.username} n’a pas enregistré d’anniversaire.`, flags: EPHEMERAL });
      }
      const now = new Date();
      const rows = db(interaction).prepare('SELECT * FROM birthdays WHERE guild_id = ?').all(guild.id).map((b) => {
        let d = Date.UTC(now.getUTCFullYear(), b.month - 1, b.day);
        if (d < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) d = Date.UTC(now.getUTCFullYear() + 1, b.month - 1, b.day);
        return { ...b, at: d };
      }).sort((a, b) => a.at - b.at).slice(0, 10);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle('🎂 Prochains anniversaires').setDescription(rows.map((r) => `**${String(r.day).padStart(2, '0')}/${String(r.month).padStart(2, '0')}** — <@${r.user_id}>`).join('\n') || 'Aucun anniversaire enregistré.')],
        allowedMentions: { parse: [] },
      });
    },
  },

  /* ------------------------------ Réputation ---------------------------- */
  {
    category: 'Communauté',
    module: 'reputation',
    data: guildOnly(new SlashCommandBuilder().setName('rep').setDescription('Réputation des membres')
      .addSubcommand((s) => s.setName('donner').setDescription('Donne un point de réputation').addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
      .addSubcommand((s) => s.setName('voir').setDescription('Affiche la réputation').addUserOption((o) => o.setName('membre').setDescription('Membre')))
      .addSubcommand((s) => s.setName('classement').setDescription('Les membres les plus appréciés'))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const { guild, user } = interaction;
      if (sub === 'donner') return community.giveRep(interaction.client, interaction, interaction.options.getUser('membre', true));
      if (sub === 'voir') {
        const t = interaction.options.getUser('membre') || user;
        const p = db(interaction).prepare('SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?').get(guild.id, t.id)?.points || 0;
        return interaction.reply({ content: `${t.username} a **${p}** point(s) de réputation.`, flags: EPHEMERAL });
      }
      const rows = db(interaction).prepare('SELECT user_id, points FROM reputation WHERE guild_id = ? ORDER BY points DESC LIMIT 10').all(guild.id);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle('👍 Classement de réputation').setDescription(rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.points}`).join('\n') || 'Personne pour le moment.')],
        allowedMentions: { parse: [] },
      });
    },
  },

  /* ----------------------------- Confessions ---------------------------- */
  {
    category: 'Communauté',
    module: 'confessions',
    data: guildOnly(new SlashCommandBuilder().setName('confession').setDescription('Envoie une confession anonyme')
      .addStringOption((o) => o.setName('texte').setDescription('Ta confession').setRequired(true).setMaxLength(1800))),
    execute: (i) => community.confess(i.client, i, i.options.getString('texte', true)),
  },

  /* ------------------------------- Comptage ----------------------------- */
  {
    category: 'Communauté',
    module: 'counting',
    data: guildOnly(new SlashCommandBuilder().setName('comptage').setDescription('Statistiques du jeu du comptage')),
    async execute(interaction) {
      const row = db(interaction).prepare('SELECT * FROM counting WHERE guild_id = ?').get(interaction.guild.id);
      if (!row) return interaction.reply({ content: 'Personne n’a encore compté ici.', flags: EPHEMERAL });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle('🔢 Comptage')
          .addFields({ name: 'Nombre actuel', value: String(row.current), inline: true }, { name: 'Record', value: String(row.highscore), inline: true }, { name: 'Total de bons nombres', value: String(row.total), inline: true })],
      });
    },
  },

  /* Annonces TikTok à la main : utiles quand la détection automatique est bloquée (fréquent depuis un hébergeur). */
  {
    category: 'Communauté',
    data: new SlashCommandBuilder().setName('tiktok').setDescription('Annonce une vidéo ou un live TikTok à la main')
      .setContexts(InteractionContextType.Guild)
      .setDefaultMemberPermissions(P.ManageGuild)
      .addSubcommand((s) => s.setName('video').setDescription('Annonce une vidéo TikTok')
        .addStringOption((o) => o.setName('lien').setDescription('Lien de la vidéo TikTok').setRequired(true).setMaxLength(300))
        .addStringOption((o) => o.setName('titre').setDescription('Titre à afficher (sinon repris de TikTok)').setMaxLength(200)))
      .addSubcommand((s) => s.setName('live').setDescription('Annonce que tu es en live sur TikTok')
        .addStringOption((o) => o.setName('titre').setDescription('Titre du live').setMaxLength(200))),
    async execute(interaction) {
      const { guild, client } = interaction;
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        if (sub === 'video') {
          const cfg = client.ctx.settings.module(guild.id, 'tiktokvideos');
          const r = await tiktok.announceVideo(client, guild, cfg, { link: interaction.options.getString('lien', true), title: interaction.options.getString('titre') || '' });
          return interaction.editReply({ content: `✅ Vidéo annoncée : ${r.url}` });
        }
        const cfg = client.ctx.settings.module(guild.id, 'tiktoklive');
        const r = await tiktok.announceLive(client, guild, cfg, { title: interaction.options.getString('titre') || '' });
        return interaction.editReply({ content: `✅ Live annoncé : ${r.url}` });
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
    },
  },
];
