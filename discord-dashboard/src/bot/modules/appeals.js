'use strict';
/**
 * Contestation des sanctions.
 *
 * 1. À chaque sanction (ban, expulsion, exclusion, avertissement), le membre reçoit un MP avec la raison
 *    et un bouton « Contester ».
 * 2. Le bouton ouvre un formulaire ; l'envoi crée un salon privé réservé au staff avec les boutons
 *    Accepter / Refuser / Refus définitif / Écrire au membre.
 * 3. La décision lève la sanction (déban, fin d'exclusion, avertissement supprimé), prévient le membre
 *    en MP et journalise. Le salon est supprimé après quelques heures.
 *
 * Identifiants de composants (≤ 100 caractères) :
 *   ap:new:<serveur>:<type>        bouton du MP
 *   ap:submit:<serveur>:<type>     formulaire du membre
 *   ap:accept|refuse|final:<id>    boutons du staff        → ap:decide:<mode>:<id> (formulaire du motif)
 *   ap:msg:<id>  → ap:say:<id>     le staff écrit au membre
 *   ap:reply:<id> → ap:answer:<id> le membre répond depuis son MP
 *   ap:close:<id>                  supprime le salon d'une contestation traitée
 */
const {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { buildMessage, brandedEmbed, safeText, trunc } = require('../../lib/template');
const { EPHEMERAL, getSendable, safeSend, formatMinutes } = require('../util');

const P = PermissionFlagsBits;

const TYPE_LABELS = { ban: 'Bannissement', kick: 'Expulsion', timeout: 'Exclusion temporaire', warn: 'Avertissement' };
const TYPES = Object.keys(TYPE_LABELS);
const COLORS = { open: 0x8b5cf6, accepted: 0x34d399, refused: 0xef4444 };
const STAFF_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'appeals');

/* ------------------------------------------------------------------ */
/* Sanctions appliquées par le bot (évite de les traiter deux fois)     */
/* ------------------------------------------------------------------ */
const recentBotActions = new Map();
const key = (g, u, t) => `${g}:${u}:${t}`;

/** À appeler quand le bot applique lui-même une sanction : l'entrée du journal d'audit sera ignorée. */
function markBotAction(guildId, userId, type) {
  recentBotActions.set(key(guildId, userId, type), Date.now());
  if (recentBotActions.size > 500) {
    const limit = Date.now() - 120000;
    for (const [k, v] of recentBotActions) if (v < limit) recentBotActions.delete(k);
  }
}
const wasBotAction = (guildId, userId, type) => Date.now() - (recentBotActions.get(key(guildId, userId, type)) || 0) < 60000;

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */
const isEnabledFor = (cfg, type) => Boolean(cfg?.enabled && cfg.types?.[type]);

/** Rôles du staff : ceux choisis dans le dashboard, sinon tous les rôles qui peuvent modérer. */
function staffRoleIds(guild, cfg) {
  const chosen = (cfg.staffRoles || []).filter((id) => guild.roles.cache.has(id));
  if (chosen.length) return chosen;
  return [...guild.roles.cache.values()]
    .filter((r) => !r.managed && r.id !== guild.id && (r.permissions.has(P.BanMembers) || r.permissions.has(P.ModerateMembers)))
    .map((r) => r.id);
}

function isStaff(member, guild, cfg) {
  if (!member) return false;
  if (member.permissions?.has(P.Administrator) || member.permissions?.has(P.ManageGuild)) return true;
  const roles = (cfg.staffRoles || []).filter((id) => guild.roles.cache.has(id));
  if (roles.length) return member.roles.cache.some((r) => roles.includes(r.id));
  return member.permissions?.has(P.BanMembers) || member.permissions?.has(P.KickMembers) || member.permissions?.has(P.ModerateMembers);
}

function fmtDuration(minutes) { return minutes ? formatMinutes(minutes) : '—'; }

function button(customId, label, style = 'Secondary', disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle[style]).setDisabled(disabled);
}

function textInput(id, label, { paragraph = true, min = 0, max = 1000, required = true, placeholder = '' } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45))
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (min > 0) input.setMinLength(Math.min(min, max));
  if (placeholder) input.setPlaceholder(placeholder.slice(0, 100));
  return new ActionRowBuilder().addComponents(input);
}

function modal(customId, title, rows) {
  return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45)).addComponents(...rows);
}

/* ------------------------------------------------------------------ */
/* 1. MP envoyé lors de la sanction                                    */
/* ------------------------------------------------------------------ */
function sanctionVars(guild, user, { type, reason, duration, caseId, moderator }) {
  return {
    user: `<@${user.id}>`, 'user.name': user.username, 'user.id': user.id,
    'user.avatar': user.displayAvatarURL?.({ extension: 'png', size: 256 }) || '',
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '',
    memberCount: String(guild.memberCount || 0),
    sanction: TYPE_LABELS[type] || type, reason: safeText(reason || 'Aucune raison précisée'),
    duration: fmtDuration(duration), case: caseId ? `#${caseId}` : '—', staff: moderator ? String(moderator) : '',
  };
}

function buildDm(client, guild, user, info) {
  const s = client.ctx.settings.get(guild.id);
  const cfg = s.appeals;
  const vars = sanctionVars(guild, user, info);
  const payload = buildMessage(cfg.dm, vars, s.general)
    || { embeds: [brandedEmbed(s.general).setTitle(`${vars.sanction} sur ${guild.name}`).setDescription(vars.reason)] };
  if (payload.embeds?.[0]) {
    const embed = payload.embeds[0];
    if (info.duration) embed.addFields({ name: 'Durée', value: vars.duration, inline: true });
    if (cfg.showModerator && info.moderator) embed.addFields({ name: 'Modérateur', value: String(info.moderator), inline: true });
  }
  payload.components = [new ActionRowBuilder().addComponents(button(`ap:new:${guild.id}:${info.type}`, 'Contester cette sanction', 'Primary'))];
  payload.allowedMentions = { parse: [] };
  return payload;
}

/** Envoie le MP de sanction avec le bouton « Contester ». Renvoie true si le MP est parti. */
async function notify(client, guild, user, info) {
  const cfg = cfgOf(client, guild.id);
  if (!isEnabledFor(cfg, info.type)) return false;
  try {
    await user.send(buildDm(client, guild, user, info));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Sanctions faites à la main dans Discord (journal d'audit)           */
/* ------------------------------------------------------------------ */
async function onAuditEntry(client, guild, entry) {
  const { AuditLogEvent } = require('discord.js');
  let type = null;
  let duration = null;
  if (entry.action === AuditLogEvent.MemberBanAdd) type = 'ban';
  else if (entry.action === AuditLogEvent.MemberKick) type = 'kick';
  else if (entry.action === AuditLogEvent.MemberUpdate) {
    const change = (entry.changes || []).find((c) => c.key === 'communication_disabled_until');
    const until = change?.new ? new Date(change.new).getTime() : 0;
    if (until > Date.now()) { type = 'timeout'; duration = Math.max(1, Math.round((until - Date.now()) / 60000)); }
  }
  if (!type) return;
  const user = entry.target;
  if (!user?.id) return;
  const cfg = cfgOf(client, guild.id);
  if (!isEnabledFor(cfg, type)) return;
  if (wasBotAction(guild.id, user.id, type)) return;
  if (entry.executorId === client.user.id) return; // sanction du bot déjà gérée par sanction()

  const { createCase } = require('./moderation');
  const reason = entry.reason || '';
  const caseId = createCase(db(client), { guildId: guild.id, userId: user.id, modId: entry.executorId || client.user.id, type, reason, duration });
  const sent = await notify(client, guild, user, { type, reason, duration, caseId, moderator: entry.executor });
  if (!sent) {
    const s = client.ctx.settings.get(guild.id);
    const channelId = cfg.logChannelId || s.moderation.modLogChannelId || (s.logs.enabled && s.logs.channelId) || '';
    await safeSend(getSendable(guild, channelId), {
      embeds: [brandedEmbed(s.general).setColor(0xfbbf24).setTitle('Contestation impossible par MP')
        .setDescription(`Je n’ai pas pu envoyer le message de contestation à ${user} (MP fermés, ou aucun serveur en commun après un bannissement ou une expulsion manuels). Pour que le MP parte toujours, sanctionne avec \`/ban\`, \`/kick\` ou \`/timeout\`.`)
        .addFields({ name: 'Sanction', value: TYPE_LABELS[type], inline: true }, { name: 'Dossier', value: `#${caseId}`, inline: true })],
      allowedMentions: { parse: [] },
    });
  }
}

/* ------------------------------------------------------------------ */
/* 2. Le membre clique sur « Contester »                                */
/* ------------------------------------------------------------------ */
const latestCase = (client, guildId, userId, type) => db(client)
  .prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? AND type = ? ORDER BY id DESC LIMIT 1').get(guildId, userId, type);

/** Le membre a-t-il le droit de contester maintenant ? → { ok, text, row } */
async function eligibility(client, guild, user, type) {
  const cfg = cfgOf(client, guild.id);
  if (!isEnabledFor(cfg, type)) return { ok: false, text: 'Les contestations sont désactivées pour ce type de sanction.' };
  const row = latestCase(client, guild.id, user.id, type);
  if (!row) return { ok: false, text: 'Je ne retrouve pas cette sanction dans mes dossiers.' };
  if (cfg.expireDays > 0 && Date.now() - row.created_at > cfg.expireDays * 86400000) {
    return { ok: false, text: `Le délai pour contester (${cfg.expireDays} jours) est dépassé.` };
  }
  const previous = db(client).prepare('SELECT * FROM appeals WHERE guild_id = ? AND case_id = ? ORDER BY id DESC').all(guild.id, row.id);
  if (previous.some((a) => a.status === 'open')) return { ok: false, text: 'Une contestation est déjà en cours d’examen pour cette sanction.' };
  if (previous.some((a) => a.status === 'accepted')) return { ok: false, text: 'Ta contestation a déjà été acceptée.' };
  if (previous.some((a) => a.final)) return { ok: false, text: 'Ta contestation a été refusée de façon définitive.' };
  if (previous.length >= cfg.maxAppeals) return { ok: false, text: 'Tu as atteint le nombre maximum de contestations pour cette sanction.' };
  const last = previous[0];
  if (last && cfg.cooldownHours > 0 && (last.decided_at || 0) + cfg.cooldownHours * 3600000 > Date.now()) {
    return { ok: false, text: `Tu pourras recontester <t:${Math.ceil(((last.decided_at || 0) + cfg.cooldownHours * 3600000) / 1000)}:R>.` };
  }
  if (type === 'ban') {
    const banned = await guild.bans.fetch(user.id).then(() => true).catch((e) => (e?.code === 10026 ? false : true));
    if (!banned) return { ok: false, text: 'Tu n’es plus banni de ce serveur.' };
  }
  return { ok: true, row, cfg };
}

function appealForm(cfg, guild, type) {
  const rows = [textInput('why', 'Pourquoi lever cette sanction ?', { min: cfg.minLength, max: 1000, placeholder: 'Explique ce qui s’est passé et pourquoi la sanction devrait être levée.' })];
  for (const [i, q] of (cfg.questions || []).slice(0, 3).entries()) {
    rows.push(textInput(`q${i}`, q.label, { required: q.required, max: 500 }));
  }
  return modal(`ap:submit:${guild.id}:${type}`, `Contester : ${TYPE_LABELS[type]}`, rows);
}

const guildFromId = (client, id) => (/^\d{17,20}$/.test(id) ? client.guilds.cache.get(id) : null);
const licensed = (client, guild) => client.ctx.license.status(guild.id, guild.ownerId).allowed;

async function onNewButton(client, interaction, [guildId, type]) {
  const guild = guildFromId(client, guildId);
  if (!guild || !TYPES.includes(type) || !licensed(client, guild)) {
    return interaction.reply({ content: 'Ce serveur n’accepte plus de contestations.', flags: EPHEMERAL });
  }
  const check = await eligibility(client, guild, interaction.user, type);
  if (!check.ok) return interaction.reply({ content: check.text, flags: EPHEMERAL });
  return interaction.showModal(appealForm(check.cfg, guild, type));
}

/* ------------------------------------------------------------------ */
/* 3. Création du salon staff                                           */
/* ------------------------------------------------------------------ */
function slug(name) {
  return String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'membre';
}

function decisionRows(appeal, cfg) {
  const rows = [new ActionRowBuilder().addComponents(
    button(`ap:accept:${appeal.id}`, 'Accepter', 'Success'),
    button(`ap:refuse:${appeal.id}`, 'Refuser', 'Danger'),
    button(`ap:final:${appeal.id}`, 'Refus définitif', 'Secondary'),
  )];
  if (cfg.allowStaffMessage) rows.push(new ActionRowBuilder().addComponents(button(`ap:msg:${appeal.id}`, 'Écrire au membre', 'Secondary')));
  return rows;
}

function appealEmbed(client, guild, appeal, row, user, answers) {
  const s = client.ctx.settings.get(guild.id);
  const e = brandedEmbed(s.general).setColor(COLORS[appeal.status] || COLORS.open)
    .setTitle(`Contestation #${appeal.id} · ${TYPE_LABELS[appeal.type]}`)
    .setThumbnail(user.displayAvatarURL?.({ extension: 'png', size: 128 }) || null)
    .addFields(
      { name: 'Membre', value: `${user} (\`${user.id}\`)`, inline: true },
      { name: 'Dossier', value: `#${row.id}`, inline: true },
      { name: 'Sanction du', value: `<t:${Math.floor(row.created_at / 1000)}:f>`, inline: true },
      { name: 'Modérateur', value: row.mod_id === client.user.id ? 'Automatique' : `<@${row.mod_id}>`, inline: true },
      { name: 'Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Raison de la sanction', value: safeText(row.reason || 'Aucune raison précisée').slice(0, 1000) },
    );
  for (const a of answers) e.addFields({ name: trunc(a.question, 256), value: safeText(a.answer || '—').slice(0, 1000) });
  const earlier = db(client).prepare("SELECT COUNT(*) AS n FROM appeals WHERE guild_id = ? AND user_id = ? AND id < ?").get(guild.id, user.id, appeal.id).n;
  if (earlier) e.addFields({ name: 'Contestations précédentes', value: String(earlier), inline: true });
  if (appeal.status !== 'open') {
    e.addFields({ name: appeal.status === 'accepted' ? 'Acceptée' : (appeal.final ? 'Refusée (définitif)' : 'Refusée'), value: `Par <@${appeal.decided_by}> · <t:${Math.floor(appeal.decided_at / 1000)}:R>\n${safeText(appeal.decision_reason || 'Aucun motif.')}`.slice(0, 1000) });
  }
  return e;
}

async function onSubmit(client, interaction, [guildId, type]) {
  const guild = guildFromId(client, guildId);
  if (!guild || !TYPES.includes(type) || !licensed(client, guild)) {
    return interaction.reply({ content: 'Ce serveur n’accepte plus de contestations.', flags: EPHEMERAL });
  }
  const user = interaction.user;
  const check = await eligibility(client, guild, user, type);
  if (!check.ok) return interaction.reply({ content: check.text, flags: EPHEMERAL });
  const { cfg, row } = check;

  const why = interaction.fields.getTextInputValue('why').trim();
  if (why.length < cfg.minLength) return interaction.reply({ content: `Ton explication est trop courte (${cfg.minLength} caractères minimum).`, flags: EPHEMERAL });
  const answers = [{ question: 'Explication du membre', answer: why }];
  for (const [i, q] of (cfg.questions || []).slice(0, 3).entries()) {
    let v = '';
    try { v = interaction.fields.getTextInputValue(`q${i}`).trim(); } catch { /* champ absent */ }
    if (v || q.required) answers.push({ question: q.label, answer: v });
  }
  await interaction.deferReply({ flags: EPHEMERAL });

  // Salon privé : invisible pour tous, visible pour le staff et le bot.
  const me = guild.members.me;
  const staff = staffRoleIds(guild, cfg);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    ...(me ? [{ id: me.id, allow: [...STAFF_PERMS, P.ManageChannels] }] : []),
    ...staff.map((id) => ({ id, allow: STAFF_PERMS })),
  ];
  const parent = cfg.categoryId && guild.channels.cache.get(cfg.categoryId)?.type === ChannelType.GuildCategory ? cfg.categoryId : undefined;
  let channel;
  try {
    channel = await guild.channels.create({
      name: `contestation-${slug(user.username)}`.slice(0, 90), type: ChannelType.GuildText, parent,
      topic: `Contestation de ${user.username} (${user.id}) · ${TYPE_LABELS[type]}`,
      permissionOverwrites: overwrites, reason: `Contestation de ${user.username}`,
    });
  } catch (err) {
    console.warn(`[contestation] ${guild.id}: ${err.message}`);
    return interaction.editReply('Je n’ai pas pu créer le salon de contestation sur ce serveur. Prévenez un administrateur (il me faut « Gérer les salons »).');
  }

  const info = db(client).prepare('INSERT INTO appeals (guild_id, user_id, case_id, type, status, channel_id, answers, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(guild.id, user.id, row.id, type, 'open', channel.id, JSON.stringify(answers), Date.now());
  const appeal = db(client).prepare('SELECT * FROM appeals WHERE id = ?').get(Number(info.lastInsertRowid));

  const ping = cfg.pingStaff ? (cfg.staffRoles || []).filter((id) => guild.roles.cache.has(id)).map((id) => `<@&${id}>`).join(' ') : '';
  const sent = await safeSend(channel, {
    content: ping || undefined,
    embeds: [appealEmbed(client, guild, appeal, row, user, answers)],
    components: decisionRows(appeal, cfg),
    allowedMentions: { roles: (cfg.staffRoles || []) },
  });
  if (sent) {
    db(client).prepare('UPDATE appeals SET message_id = ? WHERE id = ?').run(sent.id, appeal.id);
    await sent.pin().catch(() => {});
  }

  // Le bouton du MP ne sert plus : on le retire.
  if (interaction.message?.edit) await interaction.message.edit({ components: [] }).catch(() => {});

  const s = client.ctx.settings.get(guild.id);
  const received = buildMessage(cfg.received, sanctionVars(guild, user, { type, reason: row.reason, caseId: row.id }), s.general)
    || { content: `Ta contestation #${appeal.id} a bien été transmise à l’équipe de **${guild.name}**. Tu recevras la réponse ici, en message privé.` };
  await interaction.editReply({ content: received.content, embeds: received.embeds });
  return null;
}

/* ------------------------------------------------------------------ */
/* 4. Décisions du staff                                                */
/* ------------------------------------------------------------------ */
function openAppeal(client, id, guildId) {
  const appeal = db(client).prepare('SELECT * FROM appeals WHERE id = ? AND guild_id = ?').get(Number(id) || 0, guildId);
  return appeal || null;
}

async function staffGuard(client, interaction, id) {
  const { guild } = interaction;
  const cfg = cfgOf(client, guild.id);
  if (!isStaff(interaction.member, guild, cfg)) {
    await interaction.reply({ content: 'Seul le staff peut traiter les contestations.', flags: EPHEMERAL });
    return null;
  }
  const appeal = openAppeal(client, id, guild.id);
  if (!appeal) { await interaction.reply({ content: 'Cette contestation n’existe plus.', flags: EPHEMERAL }); return null; }
  return { guild, cfg, appeal };
}

async function onDecisionButton(client, interaction, mode, id) {
  const g = await staffGuard(client, interaction, id);
  if (!g) return null;
  if (g.appeal.status !== 'open') return interaction.reply({ content: 'Cette contestation a déjà été traitée.', flags: EPHEMERAL });
  const label = { accept: 'Accepter la contestation', refuse: 'Refuser la contestation', final: 'Refus définitif' }[mode];
  const hint = { accept: 'Message envoyé au membre (facultatif).', refuse: 'Pourquoi refuser ? Le membre le lira.', final: 'Pourquoi refuser définitivement ? Le membre le lira.' }[mode];
  return interaction.showModal(modal(`ap:decide:${mode}:${id}`, label, [
    textInput('reason', hint, { min: g.cfg.requireReason ? 3 : 0, required: g.cfg.requireReason, max: 800 }),
  ]));
}

/** Prépare une invitation à usage unique pour que le membre puisse revenir. */
async function makeInvite(guild, cfg, reason) {
  const candidates = [cfg.inviteChannelId, guild.rulesChannelId, guild.systemChannelId].filter(Boolean);
  let channel = candidates.map((id) => guild.channels.cache.get(id)).find((c) => c?.isTextBased?.() && c.createInvite);
  if (!channel) channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has(P.CreateInstantInvite));
  if (!channel) return null;
  try {
    const invite = await channel.createInvite({ maxAge: 7 * 86400, maxUses: 1, unique: true, reason });
    return invite.url;
  } catch { return null; }
}

/** Annule la sanction d'origine. Renvoie un texte décrivant ce qui a été fait. */
async function liftSanction(client, guild, appeal, staffUser, reason) {
  const { createCase } = require('./moderation');
  const why = `Contestation #${appeal.id} acceptée par ${staffUser.username}`;
  if (appeal.type === 'ban') {
    await guild.members.unban(appeal.user_id, why);
    db(client).prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?').run(guild.id, appeal.user_id);
    createCase(db(client), { guildId: guild.id, userId: appeal.user_id, modId: staffUser.id, type: 'unban', reason: `Contestation acceptée. ${reason}`.trim() });
    return 'Le membre a été débanni.';
  }
  if (appeal.type === 'timeout') {
    const member = await guild.members.fetch(appeal.user_id).catch(() => null);
    if (member) await member.timeout(null, why);
    createCase(db(client), { guildId: guild.id, userId: appeal.user_id, modId: staffUser.id, type: 'untimeout', reason: `Contestation acceptée. ${reason}`.trim() });
    return 'L’exclusion temporaire a été levée.';
  }
  if (appeal.type === 'warn') {
    db(client).prepare("DELETE FROM cases WHERE id = ? AND guild_id = ? AND type = 'warn'").run(appeal.case_id, guild.id);
    return 'L’avertissement a été supprimé.';
  }
  return 'Sanction conservée dans l’historique (une expulsion ne peut pas être annulée).';
}

async function onDecideSubmit(client, interaction, [mode, id]) {
  const g = await staffGuard(client, interaction, id);
  if (!g) return null;
  const { guild, cfg } = g;
  let { appeal } = g;
  if (appeal.status !== 'open') return interaction.reply({ content: 'Cette contestation a déjà été traitée.', flags: EPHEMERAL });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (cfg.requireReason && reason.length < 3) return interaction.reply({ content: 'Un motif est obligatoire.', flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });

  const accepted = mode === 'accept';
  const final = mode === 'final';
  let lifted = '';
  if (accepted) {
    try {
      lifted = await liftSanction(client, guild, appeal, interaction.user, reason);
    } catch (err) {
      const text = err.code === 50013 ? 'il me manque une permission (Bannir des membres / Exclure temporairement des membres).' : err.message;
      return interaction.editReply(`Je n’ai pas pu lever la sanction : ${text}`);
    }
  }

  const now = Date.now();
  const closeAt = cfg.autoCloseHours > 0 ? now + cfg.autoCloseHours * 3600000 : null;
  db(client).prepare('UPDATE appeals SET status = ?, final = ?, decided_at = ?, decided_by = ?, decision_reason = ?, close_at = ? WHERE id = ?')
    .run(accepted ? 'accepted' : 'refused', final ? 1 : 0, now, interaction.user.id, reason.slice(0, 800), closeAt, appeal.id);
  appeal = openAppeal(client, appeal.id, guild.id);

  // MP au membre
  const user = await client.users.fetch(appeal.user_id).catch(() => null);
  const row = db(client).prepare('SELECT * FROM cases WHERE id = ?').get(appeal.case_id) || { id: appeal.case_id, created_at: appeal.created_at, mod_id: interaction.user.id, reason: '' };
  let dmOk = false;
  if (user) {
    const s = client.ctx.settings.get(guild.id);
    const vars = sanctionVars(guild, user, { type: appeal.type, reason: row.reason, caseId: row.id });
    vars.reason = safeText(reason || 'Aucun motif précisé');
    const template = accepted ? cfg.accepted : cfg.refused;
    const payload = buildMessage(template, vars, s.general) || {
      embeds: [brandedEmbed(s.general).setColor(accepted ? COLORS.accepted : COLORS.refused)
        .setTitle(accepted ? 'Contestation acceptée' : 'Contestation refusée').setDescription(vars.reason)],
    };
    if (!accepted && !final && cfg.maxAppeals > 1) {
      payload.embeds?.[0]?.addFields({ name: 'Nouvelle demande', value: cfg.cooldownHours ? `Tu pourras refaire une demande dans ${formatMinutes(cfg.cooldownHours * 60)}.` : 'Tu peux refaire une demande.' });
    }
    if (final) payload.embeds?.[0]?.addFields({ name: 'Décision définitive', value: 'Aucune nouvelle contestation n’est possible pour cette sanction.' });
    if (accepted && cfg.inviteOnAccept && ['ban', 'kick'].includes(appeal.type)) {
      const url = await makeInvite(guild, cfg, `Contestation #${appeal.id} acceptée`);
      if (url) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Revenir sur le serveur').setURL(url))];
    }
    payload.allowedMentions = { parse: [] };
    dmOk = await user.send(payload).then(() => true).catch(() => false);
  }

  // Message du salon + journal
  const channel = guild.channels.cache.get(appeal.channel_id);
  if (channel) {
    const answers = JSON.parse(appeal.answers || '[]');
    const embedUser = user || { id: appeal.user_id, username: appeal.user_id, createdTimestamp: Date.now(), displayAvatarURL: () => null, toString: () => `<@${appeal.user_id}>` };
    const original = appeal.message_id ? await channel.messages.fetch(appeal.message_id).catch(() => null) : null;
    const closeRow = new ActionRowBuilder().addComponents(button(`ap:close:${appeal.id}`, 'Supprimer ce salon', 'Secondary'));
    const embed = appealEmbed(client, guild, appeal, row, embedUser, answers);
    if (original) await original.edit({ embeds: [embed], components: [closeRow] }).catch(() => {});
    await safeSend(channel, {
      content: `${accepted ? 'Contestation acceptée' : final ? 'Contestation refusée définitivement' : 'Contestation refusée'} par ${interaction.user}.${lifted ? ` ${lifted}` : ''}${dmOk ? '' : ' Le membre n’a pas pu être prévenu en MP.'}${closeAt ? `\nCe salon sera supprimé <t:${Math.floor(closeAt / 1000)}:R>.` : ''}`,
      allowedMentions: { parse: [] },
    });
  }
  const s = client.ctx.settings.get(guild.id);
  const logChannelId = cfg.logChannelId || s.moderation.modLogChannelId || (s.logs.enabled && s.logs.channelId) || '';
  await safeSend(getSendable(guild, logChannelId), {
    embeds: [brandedEmbed(s.general).setColor(accepted ? COLORS.accepted : COLORS.refused)
      .setTitle(`Contestation #${appeal.id} ${accepted ? 'acceptée' : 'refusée'}`)
      .addFields({ name: 'Membre', value: `<@${appeal.user_id}> (\`${appeal.user_id}\`)`, inline: true }, { name: 'Sanction', value: TYPE_LABELS[appeal.type], inline: true },
        { name: 'Décidé par', value: `${interaction.user}`, inline: true }, { name: 'Motif', value: safeText(reason || 'Aucun').slice(0, 1000) })
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
  return interaction.editReply(`Décision enregistrée. ${lifted}${dmOk ? '' : ' (Le membre n’a pas pu être prévenu en MP.)'}`.trim());
}

/* ------------------------------------------------------------------ */
/* 5. Dialogue staff ↔ membre                                           */
/* ------------------------------------------------------------------ */
async function onStaffMessageButton(client, interaction, id) {
  const g = await staffGuard(client, interaction, id);
  if (!g) return null;
  if (g.appeal.status !== 'open') return interaction.reply({ content: 'Cette contestation est déjà traitée.', flags: EPHEMERAL });
  return interaction.showModal(modal(`ap:say:${id}`, 'Écrire au membre', [textInput('text', 'Ton message', { max: 1500 })]));
}

async function onStaffSay(client, interaction, id) {
  const g = await staffGuard(client, interaction, id);
  if (!g) return null;
  const text = interaction.fields.getTextInputValue('text').trim();
  const user = await client.users.fetch(g.appeal.user_id).catch(() => null);
  const s = client.ctx.settings.get(g.guild.id);
  const sent = user && await user.send({
    embeds: [brandedEmbed(s.general).setTitle(`Message de l’équipe de ${g.guild.name}`).setDescription(safeText(text)).setFooter({ text: `Contestation #${g.appeal.id}` })],
    components: [new ActionRowBuilder().addComponents(button(`ap:reply:${g.appeal.id}`, 'Répondre', 'Primary'))],
    allowedMentions: { parse: [] },
  }).then(() => true).catch(() => false);
  await safeSend(interaction.channel, { embeds: [brandedEmbed(s.general).setColor(0x60a5fa).setAuthor({ name: `${interaction.user.username} → membre` }).setDescription(safeText(text))], allowedMentions: { parse: [] } });
  return interaction.reply({ content: sent ? 'Message envoyé au membre.' : 'Je n’ai pas pu envoyer le MP (MP fermés).', flags: EPHEMERAL });
}

async function onMemberReplyButton(client, interaction, id) {
  const appeal = db(client).prepare('SELECT * FROM appeals WHERE id = ?').get(Number(id) || 0);
  if (!appeal || appeal.user_id !== interaction.user.id) return interaction.reply({ content: 'Cette contestation n’existe plus.', flags: EPHEMERAL });
  if (appeal.status !== 'open') return interaction.reply({ content: 'Cette contestation est déjà traitée.', flags: EPHEMERAL });
  return interaction.showModal(modal(`ap:answer:${id}`, 'Répondre au staff', [textInput('text', 'Ta réponse', { max: 1500 })]));
}

async function onMemberAnswer(client, interaction, id) {
  const appeal = db(client).prepare('SELECT * FROM appeals WHERE id = ?').get(Number(id) || 0);
  if (!appeal || appeal.user_id !== interaction.user.id || appeal.status !== 'open') return interaction.reply({ content: 'Cette contestation est déjà traitée.', flags: EPHEMERAL });
  const guild = guildFromId(client, appeal.guild_id);
  const channel = guild?.channels.cache.get(appeal.channel_id);
  if (!channel) return interaction.reply({ content: 'Le salon de cette contestation n’existe plus.', flags: EPHEMERAL });
  const text = interaction.fields.getTextInputValue('text').trim();
  const s = client.ctx.settings.get(guild.id);
  await safeSend(channel, { embeds: [brandedEmbed(s.general).setColor(COLORS.open).setAuthor({ name: `${interaction.user.username} (le membre)`, iconURL: interaction.user.displayAvatarURL?.() }).setDescription(safeText(text))], allowedMentions: { parse: [] } });
  return interaction.reply({ content: 'Ta réponse a été transmise au staff.', flags: EPHEMERAL });
}

async function onCloseButton(client, interaction, id) {
  const g = await staffGuard(client, interaction, id);
  if (!g) return null;
  if (g.appeal.status === 'open') return interaction.reply({ content: 'Traite d’abord la contestation (accepter ou refuser).', flags: EPHEMERAL });
  await interaction.reply({ content: 'Salon supprimé dans quelques secondes.', flags: EPHEMERAL });
  db(client).prepare("UPDATE appeals SET channel_id = '' , close_at = NULL WHERE id = ?").run(g.appeal.id);
  await interaction.channel.delete(`Contestation #${g.appeal.id} terminée`).catch(() => {});
  return null;
}

/* ------------------------------------------------------------------ */
/* Routage des interactions + tâche périodique                          */
/* ------------------------------------------------------------------ */
async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('ap:')) return false;
  const [, action, ...rest] = id.split(':');
  if (interaction.guild && !licensed(client, interaction.guild)) return false;

  if (interaction.isButton()) {
    if (action === 'new') await onNewButton(client, interaction, rest);
    else if (['accept', 'refuse', 'final'].includes(action)) await onDecisionButton(client, interaction, action, rest[0]);
    else if (action === 'msg') await onStaffMessageButton(client, interaction, rest[0]);
    else if (action === 'reply') await onMemberReplyButton(client, interaction, rest[0]);
    else if (action === 'close') await onCloseButton(client, interaction, rest[0]);
    else return false;
    return true;
  }
  if (interaction.isModalSubmit()) {
    if (action === 'submit') await onSubmit(client, interaction, rest);
    else if (action === 'decide') await onDecideSubmit(client, interaction, rest);
    else if (action === 'say') await onStaffSay(client, interaction, rest[0]);
    else if (action === 'answer') await onMemberAnswer(client, interaction, rest[0]);
    else return false;
    return true;
  }
  return false;
}

/** Supprime les salons des contestations traitées depuis assez longtemps. */
async function tick(client) {
  const due = db(client).prepare("SELECT * FROM appeals WHERE close_at IS NOT NULL AND close_at <= ? AND channel_id != ''").all(Date.now());
  for (const a of due) {
    const guild = client.guilds.cache.get(a.guild_id);
    if (!guild) continue;
    const channel = guild.channels.cache.get(a.channel_id);
    if (channel) await channel.delete(`Contestation #${a.id} terminée`).catch(() => {});
    db(client).prepare("UPDATE appeals SET channel_id = '', close_at = NULL WHERE id = ?").run(a.id);
  }
}

module.exports = {
  TYPE_LABELS, TYPES, markBotAction, wasBotAction, isEnabledFor, notify, buildDm, onAuditEntry, eligibility,
  handleInteraction, tick, staffRoleIds, isStaff, sanctionVars,
};
