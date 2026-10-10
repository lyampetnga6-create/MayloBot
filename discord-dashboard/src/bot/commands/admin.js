'use strict';
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits: P, EmbedBuilder, ChannelType } = require('discord.js');
const { hexToInt, safeText, trunc, buildMessage } = require('../../lib/template');
const { parseDuration, formatDuration } = require('../../lib/duration');
const { EPHEMERAL, getSendable } = require('../util');
const mod = require('../modules/moderation');
const protection = require('../modules/protection');
const extras = require('../modules/extras');
const webhooks = require('../modules/webhooks');

const base = (name, description, perm) => new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(perm);
const memberOpt = (o, d = 'Membre ciblé') => o.setName('membre').setDescription(d).setRequired(true);
const reasonOpt = (o) => o.setName('raison').setDescription('Raison').setMaxLength(450);

/** Les permissions par défaut d'une commande peuvent être modifiées par le serveur : on revérifie toujours. */
const need = (interaction, perm) => {
  if (interaction.memberPermissions?.has(perm)) return true;
  interaction.reply({ content: 'Tu n’as pas la permission d’utiliser cette commande.', flags: EPHEMERAL });
  return false;
};

const colorOf = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor);

async function targetMember(interaction, name = 'membre') {
  const user = interaction.options.getUser(name, true);
  const member = interaction.options.getMember(name) || await interaction.guild.members.fetch(user.id).catch(() => null);
  return { user, member };
}

module.exports = [
  {
    category: 'Modération',
    data: base('pseudo', 'Change le pseudo d’un membre', P.ManageNicknames)
      .addUserOption((o) => memberOpt(o)).addStringOption((o) => o.setName('nouveau').setDescription('Nouveau pseudo (vide = réinitialiser)').setMaxLength(32)),
    async execute(interaction) {
      if (!need(interaction, P.ManageNicknames)) return null;
      const { member } = await targetMember(interaction);
      if (!member) return interaction.reply({ content: 'Membre introuvable.', flags: EPHEMERAL });
      const problem = mod.hierarchyError(interaction.guild, interaction.member, member);
      if (problem) return interaction.reply({ content: `❌ ${problem}`, flags: EPHEMERAL });
      await member.setNickname(interaction.options.getString('nouveau') || null, `Par ${interaction.user.username}`)
        .then(() => interaction.reply({ content: '✅ Pseudo modifié.', flags: EPHEMERAL }))
        .catch((e) => interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL }));
      return null;
    },
  },

  {
    category: 'Modération',
    data: base('tempban', 'Bannit un membre pour une durée limitée', P.BanMembers)
      .addUserOption((o) => memberOpt(o)).addStringOption((o) => o.setName('duree').setDescription('Ex : 12h, 3j, 2w').setRequired(true)).addStringOption(reasonOpt),
    async execute(interaction) {
      if (!need(interaction, P.BanMembers)) return null;
      const ms = parseDuration(interaction.options.getString('duree', true));
      if (!ms || ms < 60000 || ms > 365 * 86400000) return interaction.reply({ content: 'Durée invalide (1 minute à 1 an). Exemples : `12h`, `3j`, `2w`.', flags: EPHEMERAL });
      const { user, member } = await targetMember(interaction);
      const problem = mod.hierarchyError(interaction.guild, interaction.member, member);
      if (problem) return interaction.reply({ content: `❌ ${problem}`, flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        const reason = `${interaction.options.getString('raison') || 'Sans raison'} [temporaire : ${formatDuration(ms)}]`;
        const { id } = await mod.sanction(interaction.client, { guild: interaction.guild, user, moderator: interaction.user, type: 'ban', reason, duration: Math.round(ms / 60000) });
        extras.scheduleUnban(interaction.client, interaction.guild.id, user.id, Date.now() + ms);
        return interaction.editReply(`✅ Dossier #${id} : banni jusqu’à <t:${Math.floor((Date.now() + ms) / 1000)}:f>.`);
      } catch (e) {
        return interaction.editReply(`❌ ${e.message}`);
      }
    },
  },

  {
    category: 'Modération',
    data: base('softban', 'Bannit puis débannit pour effacer les messages récents', P.BanMembers)
      .addUserOption((o) => memberOpt(o)).addStringOption(reasonOpt),
    async execute(interaction) {
      if (!need(interaction, P.BanMembers)) return null;
      const { user, member } = await targetMember(interaction);
      const problem = mod.hierarchyError(interaction.guild, interaction.member, member);
      if (problem) return interaction.reply({ content: `❌ ${problem}`, flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        const { id } = await mod.sanction(interaction.client, { guild: interaction.guild, user, moderator: interaction.user, type: 'ban', reason: `[softban] ${interaction.options.getString('raison') || ''}`.trim(), deleteDays: 7 });
        await interaction.guild.members.unban(user.id, 'Softban').catch(() => {});
        return interaction.editReply(`✅ Dossier #${id} : messages des 7 derniers jours supprimés, membre débanni.`);
      } catch (e) {
        return interaction.editReply(`❌ ${e.message}`);
      }
    },
  },

  {
    category: 'Modération',
    data: base('role', 'Ajoute ou retire un rôle', P.ManageRoles)
      .addSubcommand((s) => s.setName('ajouter').setDescription('Donne un rôle').addUserOption((o) => memberOpt(o)).addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true)))
      .addSubcommand((s) => s.setName('retirer').setDescription('Retire un rôle').addUserOption((o) => memberOpt(o)).addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true))),
    async execute(interaction) {
      if (!need(interaction, P.ManageRoles)) return null;
      const { member } = await targetMember(interaction);
      const role = interaction.options.getRole('role', true);
      if (!member) return interaction.reply({ content: 'Membre introuvable.', flags: EPHEMERAL });
      const mine = interaction.member.roles.highest;
      if (role.managed || (interaction.user.id !== interaction.guild.ownerId && role.position >= mine.position)) return interaction.reply({ content: '❌ Tu ne peux pas gérer ce rôle (hiérarchie ou rôle d’intégration).', flags: EPHEMERAL });
      if (role.position >= interaction.guild.members.me.roles.highest.position) return interaction.reply({ content: '❌ Mon rôle est trop bas pour gérer celui-ci.', flags: EPHEMERAL });
      const add = interaction.options.getSubcommand() === 'ajouter';
      await (add ? member.roles.add(role, `Par ${interaction.user.username}`) : member.roles.remove(role, `Par ${interaction.user.username}`))
        .then(() => interaction.reply({ content: `✅ Rôle **${safeText(role.name)}** ${add ? 'ajouté à' : 'retiré à'} ${safeText(member.user.username)}.`, flags: EPHEMERAL }))
        .catch((e) => interaction.reply({ content: `❌ ${e.message}`, flags: EPHEMERAL }));
      return null;
    },
  },

  {
    category: 'Modération',
    data: base('nuke', 'Recrée ce salon à l’identique (vide tous les messages)', P.ManageChannels)
      .addBooleanOption((o) => o.setName('confirmer').setDescription('Mets « True » pour confirmer').setRequired(true)),
    async execute(interaction) {
      if (!need(interaction, P.ManageChannels)) return null;
      if (!interaction.options.getBoolean('confirmer', true)) return interaction.reply({ content: 'Annulé.', flags: EPHEMERAL });
      const ch = interaction.channel;
      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) return interaction.reply({ content: 'Cette commande ne fonctionne que dans un salon textuel.', flags: EPHEMERAL });
      if (interaction.client.ctx.db.prepare("SELECT 1 FROM tickets WHERE channel_id = ? AND status = 'open'").get(ch.id)) return interaction.reply({ content: 'Impossible dans un ticket ouvert.', flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        const clone = await ch.clone({ reason: `Nuke par ${interaction.user.username}` });
        await clone.setPosition(ch.position).catch(() => {});
        await ch.delete(`Nuke par ${interaction.user.username}`);
        await clone.send(`💥 Salon recréé par <@${interaction.user.id}>.`).catch(() => {});
      } catch (e) {
        await interaction.editReply(`❌ ${e.message}`).catch(() => {});
      }
      return null;
    },
  },

  /* ------------------------------ Notes & historique ------------------------ */
  {
    category: 'Modération',
    data: base('note', 'Notes privées du staff sur un membre', P.ModerateMembers)
      .addSubcommand((s) => s.setName('ajouter').setDescription('Ajoute une note').addUserOption((o) => memberOpt(o)).addStringOption((o) => o.setName('texte').setDescription('Note').setRequired(true).setMaxLength(500)))
      .addSubcommand((s) => s.setName('liste').setDescription('Affiche les notes').addUserOption((o) => memberOpt(o)))
      .addSubcommand((s) => s.setName('supprimer').setDescription('Supprime une note').addIntegerOption((o) => o.setName('numero').setDescription('Numéro').setRequired(true))),
    async execute(interaction) {
      if (!need(interaction, P.ModerateMembers)) return null;
      const { db } = interaction.client.ctx;
      const gid = interaction.guild.id;
      const sub = interaction.options.getSubcommand();
      if (sub === 'ajouter') {
        const user = interaction.options.getUser('membre', true);
        const r = db.prepare('INSERT INTO notes (guild_id, user_id, mod_id, note, created_at) VALUES (?,?,?,?,?)').run(gid, user.id, interaction.user.id, interaction.options.getString('texte', true), Date.now());
        return interaction.reply({ content: `📝 Note #${r.lastInsertRowid} ajoutée.`, flags: EPHEMERAL });
      }
      if (sub === 'supprimer') {
        const r = db.prepare('DELETE FROM notes WHERE id = ? AND guild_id = ?').run(interaction.options.getInteger('numero', true), gid);
        return interaction.reply({ content: r.changes ? 'Note supprimée.' : 'Note introuvable.', flags: EPHEMERAL });
      }
      const user = interaction.options.getUser('membre', true);
      const rows = db.prepare('SELECT * FROM notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 15').all(gid, user.id);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`Notes sur ${user.username}`).setDescription(rows.map((n) => `**#${n.id}** <t:${Math.floor(n.created_at / 1000)}:d> par <@${n.mod_id}> — ${safeText(n.note)}`).join('\n') || 'Aucune note.')],
        flags: EPHEMERAL, allowedMentions: { parse: [] },
      });
    },
  },

  {
    category: 'Modération',
    data: base('historique', 'Dossier complet d’un membre (sanctions, notes)', P.ModerateMembers).addUserOption((o) => memberOpt(o)),
    async execute(interaction) {
      if (!need(interaction, P.ModerateMembers)) return null;
      const { db } = interaction.client.ctx;
      const user = interaction.options.getUser('membre', true);
      const gid = interaction.guild.id;
      const cases = db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10').all(gid, user.id);
      const total = db.prepare('SELECT type, COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? GROUP BY type').all(gid, user.id);
      const notes = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE guild_id = ? AND user_id = ?').get(gid, user.id).n;
      const e = new EmbedBuilder().setColor(colorOf(interaction)).setTitle(`Dossier de ${user.username}`).setThumbnail(user.displayAvatarURL())
        .setDescription(cases.map((c) => `**#${c.id}** ${mod.TYPE_LABELS?.[c.type] || c.type} — <t:${Math.floor(c.created_at / 1000)}:d>${c.reason ? ` — ${trunc(safeText(c.reason), 80)}` : ''}`).join('\n') || 'Aucune sanction.')
        .addFields({ name: 'Totaux', value: total.map((t) => `${t.type}: ${t.n}`).join(' · ') || '—', inline: true }, { name: 'Notes', value: String(notes), inline: true });
      return interaction.reply({ embeds: [e], flags: EPHEMERAL });
    },
  },

  /* -------------------------------- Protection ------------------------------ */
  {
    category: 'Sécurité',
    data: base('verrouillage', 'Verrouille ou déverrouille tout le serveur (urgence)', P.Administrator)
      .addSubcommand((s) => s.setName('activer').setDescription('Empêche d’écrire dans les salons').addStringOption(reasonOpt))
      .addSubcommand((s) => s.setName('desactiver').setDescription('Rétablit les permissions d’origine'))
      .addSubcommand((s) => s.setName('etat').setDescription('Indique si le serveur est verrouillé')),
    async execute(interaction) {
      if (!need(interaction, P.Administrator)) return null;
      const { client, guild } = interaction;
      const sub = interaction.options.getSubcommand();
      if (sub === 'etat') return interaction.reply({ content: protection.isLockedDown(client, guild.id) ? '🔒 Le serveur est verrouillé.' : '🔓 Le serveur n’est pas verrouillé.', flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      const on = sub === 'activer';
      if (on && protection.isLockedDown(client, guild.id)) return interaction.editReply('Le serveur est déjà verrouillé.');
      const n = await protection.lockdown(client, guild, on, interaction.options.getString?.('raison') || `Par ${interaction.user.username}`);
      return interaction.editReply(on ? `🔒 ${n} salon(s) verrouillé(s). Utilise \`/verrouillage desactiver\` pour rétablir.` : `🔓 ${n} salon(s) rétabli(s).`);
    },
  },

  {
    category: 'Sécurité',
    data: base('raidmode', 'Active le mode raid (filtre renforcé des arrivées)', P.ManageGuild)
      .addSubcommand((s) => s.setName('activer').setDescription('Active le mode raid').addIntegerOption((o) => o.setName('minutes').setDescription('Durée (défaut : 30)').setMinValue(1).setMaxValue(1440)))
      .addSubcommand((s) => s.setName('desactiver').setDescription('Désactive le mode raid'))
      .addSubcommand((s) => s.setName('etat').setDescription('État du mode raid')),
    async execute(interaction) {
      if (!need(interaction, P.ManageGuild)) return null;
      const { client, guild } = interaction;
      const sub = interaction.options.getSubcommand();
      if (sub === 'activer') {
        const m = interaction.options.getInteger('minutes') || 30;
        protection.setRaidMode(client, guild.id, m);
        return interaction.reply({ content: `🚨 Mode raid activé pour ${m} minute(s).`, flags: EPHEMERAL });
      }
      if (sub === 'desactiver') { protection.setRaidMode(client, guild.id, 0); return interaction.reply({ content: '✅ Mode raid désactivé.', flags: EPHEMERAL }); }
      const until = protection.raidModeUntil(client, guild.id);
      return interaction.reply({ content: until > Date.now() ? `🚨 Mode raid actif jusqu’à <t:${Math.floor(until / 1000)}:T>.` : 'Mode raid inactif.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Sécurité',
    data: base('quarantaine', 'Isole un membre suspect (retire ses rôles et le réduit au silence)', P.ModerateMembers)
      .addUserOption((o) => memberOpt(o)).addStringOption(reasonOpt),
    async execute(interaction) {
      if (!need(interaction, P.ModerateMembers)) return null;
      const { member } = await targetMember(interaction);
      if (!member) return interaction.reply({ content: 'Membre introuvable.', flags: EPHEMERAL });
      const problem = mod.hierarchyError(interaction.guild, interaction.member, member);
      if (problem) return interaction.reply({ content: `❌ ${problem}`, flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      const n = await protection.quarantine(interaction.client, interaction.guild, member, interaction.options.getString('raison') || `Quarantaine par ${interaction.user.username}`);
      return interaction.editReply(`🧪 ${safeText(member.user.username)} est en quarantaine (${n} rôle(s) mis de côté). \`/liberer\` pour annuler.`);
    },
  },

  {
    category: 'Sécurité',
    data: base('liberer', 'Sort un membre de quarantaine', P.ModerateMembers).addUserOption((o) => memberOpt(o)),
    async execute(interaction) {
      if (!need(interaction, P.ModerateMembers)) return null;
      const { member } = await targetMember(interaction);
      if (!member) return interaction.reply({ content: 'Membre introuvable.', flags: EPHEMERAL });
      await interaction.deferReply({ flags: EPHEMERAL });
      try {
        const n = await protection.unquarantine(interaction.client, interaction.guild, member, `Libéré par ${interaction.user.username}`);
        return interaction.editReply(`✅ ${safeText(member.user.username)} est libéré (${n} rôle(s) rendu(s)).`);
      } catch (e) {
        return interaction.editReply(`❌ ${e.message}`);
      }
    },
  },

  /* --------------------------------- Messages ------------------------------- */
  {
    category: 'Utilitaire',
    data: base('annonce', 'Publie une annonce en embed dans un salon', P.ManageMessages)
      .addChannelOption((o) => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addStringOption((o) => o.setName('titre').setDescription('Titre').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('message').setDescription('Contenu (utilise \\n pour un retour à la ligne)').setRequired(true).setMaxLength(3500))
      .addRoleOption((o) => o.setName('mention').setDescription('Rôle à mentionner'))
      .addStringOption((o) => o.setName('couleur').setDescription('Couleur hexadécimale, ex : #8b5cf6')),
    async execute(interaction) {
      if (!need(interaction, P.ManageMessages)) return null;
      const ch = getSendable(interaction.guild, interaction.options.getChannel('salon', true).id);
      if (!ch) return interaction.reply({ content: 'Je ne peux pas écrire dans ce salon.', flags: EPHEMERAL });
      const role = interaction.options.getRole('mention');
      if (role && !role.mentionable && !interaction.memberPermissions.has(P.MentionEveryone)) return interaction.reply({ content: 'Tu ne peux pas mentionner ce rôle.', flags: EPHEMERAL });
      const e = new EmbedBuilder().setColor(hexToInt(interaction.options.getString('couleur'), colorOf(interaction)))
        .setTitle(interaction.options.getString('titre', true)).setDescription(interaction.options.getString('message', true).replace(/\\n/g, '\n')).setTimestamp();
      const sent = await ch.send({ content: role ? `<@&${role.id}>` : undefined, embeds: [e], allowedMentions: role ? { roles: [role.id] } : { parse: [] } }).catch(() => null);
      return interaction.reply({ content: sent ? `✅ Annonce publiée : ${sent.url}` : '❌ Échec de l’envoi.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Utilitaire',
    data: base('dire', 'Fait parler le bot dans un salon', P.ManageMessages)
      .addStringOption((o) => o.setName('texte').setDescription('Message').setRequired(true).setMaxLength(1900))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon (ici par défaut)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    async execute(interaction) {
      if (!need(interaction, P.ManageMessages)) return null;
      const ch = getSendable(interaction.guild, (interaction.options.getChannel('salon') || interaction.channel).id);
      if (!ch) return interaction.reply({ content: 'Je ne peux pas écrire dans ce salon.', flags: EPHEMERAL });
      await ch.send({ content: interaction.options.getString('texte', true), allowedMentions: { parse: [] } });
      return interaction.reply({ content: '✅ Envoyé.', flags: EPHEMERAL });
    },
  },

  {
    category: 'Utilitaire',
    data: base('envoyer-message', 'Envoie un message de ta bibliothèque (créé dans le dashboard)', P.ManageMessages)
      .addStringOption((o) => o.setName('nom').setDescription('Nom du message enregistré').setRequired(true).setMaxLength(80))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon (ici par défaut)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    async execute(interaction) {
      if (!need(interaction, P.ManageMessages)) return null;
      const { db, settings } = interaction.client.ctx;
      const name = interaction.options.getString('nom', true);
      const found = webhooks.listSaved(db, interaction.guild.id, { search: name, pageSize: 30 }).rows;
      const hit = found.find((r) => r.name.toLowerCase() === name.toLowerCase()) || found[0];
      if (!hit) return interaction.reply({ content: 'Aucun message enregistré ne porte ce nom. Crée-le dans le dashboard (page « Webhooks & messages »).', flags: EPHEMERAL });
      const saved = webhooks.getSaved(db, interaction.guild.id, hit.id);
      const payload = buildMessage(saved.message, { server: interaction.guild.name, memberCount: String(interaction.guild.memberCount) }, settings.module(interaction.guild.id, 'general'));
      const ch = getSendable(interaction.guild, (interaction.options.getChannel('salon') || interaction.channel).id);
      if (!payload || !ch) return interaction.reply({ content: 'Message vide ou salon inaccessible.', flags: EPHEMERAL });
      await ch.send({ ...payload, allowedMentions: { parse: [] } });
      return interaction.reply({ content: `✅ « ${safeText(saved.name)} » envoyé.`, flags: EPHEMERAL });
    },
  },
];
