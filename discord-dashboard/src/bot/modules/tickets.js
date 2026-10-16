'use strict';
const {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, StringSelectMenuBuilder, EmbedBuilder,
} = require('discord.js');
const { buildMessage, brandedEmbed, render, safeText } = require('../../lib/template');
const { EPHEMERAL, getSendable, safeSend, parseEmoji, wait, formatMinutes } = require('../util');
const transcripts = require('./ticket-transcript');
const ticketAi = require('./ticket-ai');

const P = PermissionFlagsBits;
const TICKET_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const lastOpenCache = new Map();

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */
function button(customId, label, emoji, style = 'Primary', disabled = false) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(ButtonStyle[style] || ButtonStyle.Primary).setDisabled(disabled);
  if (label) b.setLabel(label.slice(0, 80));
  const em = parseEmoji(emoji);
  if (em) {
    try { b.setEmoji(em); } catch { /* émoji invalide : on l'ignore */ }
  }
  if (!label && !em) b.setLabel('Ouvrir un ticket');
  return b;
}

/** Tous les rôles « support » connus (général + sujets). */
const allSupportRoles = (cfg) => [...new Set([...cfg.supportRoles, ...cfg.topics.flatMap((t) => t.supportRoles || [])])];

function isSupport(member, cfg) {
  if (!member) return false;
  const roles = allSupportRoles(cfg);
  return member.roles.cache.some((r) => roles.includes(r.id))
    || member.permissions.has(P.ManageChannels)
    || member.permissions.has(P.Administrator);
}

/** Équipe responsable d'un ticket (celle du sujet, sinon l'équipe générale). */
function teamFor(cfg, topicLabel) {
  const topic = topicLabel ? cfg.topics.find((t) => t.label === topicLabel) : null;
  return topic?.supportRoles?.length ? topic.supportRoles : cfg.supportRoles;
}

function ticketRowFor(db, channelId) {
  return db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'").get(channelId);
}

function channelName(cfg, number, user, topic) {
  const raw = render(cfg.nameFormat || 'ticket-{number}', {
    number: String(number).padStart(4, '0'), 'user.name': user.username, topic: topic?.label || '',
  });
  const cleaned = raw.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return cleaned || `ticket-${number}`;
}

const tx = (cfg, key, vars) => render(cfg.texts[key], vars);

async function logEvent(client, guild, cfg, embed, files) {
  if (!cfg.logEvents && !files) return;
  await safeSend(getSendable(guild, cfg.logChannelId), files ? { embeds: [embed], files } : { embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* Panneau                                                             */
/* ------------------------------------------------------------------ */
function panelPayload(client, guild) {
  const s = client.ctx.settings.get(guild.id);
  const cfg = s.tickets;
  const payload = buildMessage(cfg.panel, { server: guild.name, 'server.icon': guild.iconURL() || '' }, s.general) || {};
  if (!payload.content && !payload.embeds) payload.content = 'Clique sur le bouton ci-dessous pour ouvrir un ticket.';

  const topics = cfg.topics.slice(0, 25);
  if (!topics.length) {
    payload.components = [new ActionRowBuilder().addComponents(button('ticket:open:-1', cfg.buttonLabel, cfg.buttonEmoji, cfg.buttonStyle))];
  } else if (cfg.panelStyle === 'menu') {
    const menu = new StringSelectMenuBuilder().setCustomId('ticket:menu').setPlaceholder((cfg.menuPlaceholder || 'Choisis un sujet…').slice(0, 100));
    menu.addOptions(topics.map((tp, i) => {
      const opt = { label: tp.label.slice(0, 100), value: String(i) };
      if (tp.description) opt.description = tp.description.slice(0, 100);
      const em = parseEmoji(tp.emoji);
      if (em) opt.emoji = em;
      return opt;
    }));
    payload.components = [new ActionRowBuilder().addComponents(menu)];
  } else {
    const rows = [];
    for (let i = 0; i < topics.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(topics.slice(i, i + 5).map((tp, j) => button(`ticket:open:${i + j}`, tp.label, tp.emoji, cfg.buttonStyle))));
    }
    payload.components = rows;
  }
  return payload;
}

/** Publie le panneau d'ouverture dans le salon configuré (ou `channelId`). */
async function publishPanel(client, guild, channelId) {
  const cfg = client.ctx.settings.get(guild.id).tickets;
  const channel = getSendable(guild, channelId || cfg.panelChannelId);
  if (!channel) throw new Error('Salon du panneau introuvable ou inaccessible (vérifie mes permissions).');
  return channel.send(panelPayload(client, guild));
}

/* ------------------------------------------------------------------ */
/* Ouverture                                                           */
/* ------------------------------------------------------------------ */

/** Vérifie les conditions d'ouverture. Renvoie { ok: true } ou { ok: false, text }. */
function canOpen(client, guild, member, cfg) {
  const { db } = client.ctx;
  if (!cfg.enabled) return { ok: false, text: 'Les tickets sont désactivés sur ce serveur.' };
  if (cfg.requiredRoles.length && !member.roles.cache.some((r) => cfg.requiredRoles.includes(r.id))) return { ok: false, text: tx(cfg, 'denied', {}) };
  if (member.roles.cache.some((r) => cfg.blockedRoles.includes(r.id))) return { ok: false, text: tx(cfg, 'denied', {}) };
  if (cfg.minMemberDays > 0 && member.joinedTimestamp && Date.now() - member.joinedTimestamp < cfg.minMemberDays * 86400000) {
    return { ok: false, text: tx(cfg, 'denied', {}) };
  }

  if (cfg.cooldown > 0) {
    const last = db.prepare('SELECT MAX(created_at) AS t FROM tickets WHERE guild_id = ? AND user_id = ?').get(guild.id, member.id).t || 0;
    const wait_ = last + cfg.cooldown * 1000 - Date.now();
    if (wait_ > 0) return { ok: false, text: tx(cfg, 'cooldown', { seconds: String(Math.ceil(wait_ / 1000)) }) };
  }

  // Nettoie les tickets dont le salon a disparu, puis applique la limite par membre.
  const mine = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'").all(guild.id, member.id);
  let alive = 0;
  for (const t of mine) {
    if (guild.channels.cache.has(t.channel_id)) alive++;
    else db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), t.id);
  }
  if (alive >= cfg.maxPerUser) return { ok: false, text: tx(cfg, 'limit', { count: String(alive) }) };
  return { ok: true };
}

/** Crée le salon et envoie l'accueil. `answers` : [{ question, answer }]. */
async function openTicket(client, interaction, topicIndex, answers = []) {
  const { guild, user } = interaction;
  const { db, settings } = client.ctx;
  const s = settings.get(guild.id);
  const cfg = s.tickets;

  const member = interaction.member;
  const check = canOpen(client, guild, member, cfg);
  if (!check.ok) return interaction.editReply(check.text);

  const topic = topicIndex >= 0 ? cfg.topics[topicIndex] : null;
  const categoryId = [topic?.categoryId, cfg.categoryId].find((id) => id && guild.channels.cache.get(id)?.type === ChannelType.GuildCategory);
  const team = (topic?.supportRoles?.length ? topic.supportRoles : cfg.supportRoles).filter((id) => guild.roles.cache.has(id));
  const reason = answers[0]?.answer || '';

  const me = guild.members.me;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: user.id, allow: TICKET_PERMS },
    { id: me.id, allow: [...TICKET_PERMS, P.ManageChannels, P.ManageMessages] },
    ...team.map((id) => ({ id, allow: [...TICKET_PERMS, P.ManageMessages] })),
    ...cfg.observerRoles.filter((id) => guild.roles.cache.has(id) && !team.includes(id)).map((id) => ({ id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] })),
  ];

  const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?').get(guild.id).n;

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName(cfg, number, user, topic),
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      topic: `Ticket #${number} de ${user.username} • ID ${user.id}`,
      permissionOverwrites: overwrites,
      reason: `Ticket ouvert par ${user.username}`,
    });
  } catch (err) {
    console.warn(`[tickets] ${guild.id}: ${err.message}`);
    return interaction.editReply('Je n’ai pas pu créer le salon (il me faut la permission « Gérer les salons » et une catégorie qui n’est pas pleine).');
  }

  const now = Date.now();
  db.prepare('INSERT INTO tickets (guild_id, number, channel_id, user_id, topic, reason, status, created_at, last_activity, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(guild.id, number, channel.id, user.id, topic?.label || '', reason, 'open', now, now, JSON.stringify(answers));
  const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channel.id);

  // Message d'accueil
  const vars = {
    user: `<@${user.id}>`, 'user.name': user.username, 'user.id': user.id,
    'user.avatar': user.displayAvatarURL({ extension: 'png', size: 256 }),
    server: guild.name, number: String(number), topic: topic?.label || 'Général', reason: reason || 'Non précisée',
    memberCount: String(guild.memberCount),
  };
  const payload = buildMessage(cfg.welcome, vars, s.general) || { content: `${vars.user}` };

  if (topic?.welcomeText) {
    const extra = render(topic.welcomeText, vars);
    if (payload.embeds?.[0]) payload.embeds[0].addFields({ name: 'ℹ️ Informations', value: extra.slice(0, 1000) });
    else payload.content = `${payload.content ? `${payload.content}\n` : ''}${extra}`.slice(0, 2000);
  }
  if (answers.length) {
    const fields = answers.filter((a) => a.answer).map((a) => ({ name: a.question.slice(0, 256), value: safeText(a.answer).slice(0, 1000) }));
    if (payload.embeds?.[0]) payload.embeds[0].addFields(fields.slice(0, 20));
    else payload.content = `${payload.content ? `${payload.content}\n\n` : ''}${fields.map((f) => `**${f.name}**\n${f.value}`).join('\n\n')}`.slice(0, 2000);
  }

  const supportPing = cfg.pingSupport ? team.map((id) => `<@&${id}>`).join(' ') : '';
  if (supportPing) payload.content = `${supportPing}${payload.content ? `\n${payload.content}` : ''}`.slice(0, 2000);

  const row = new ActionRowBuilder().addComponents(button('ticket:close', 'Fermer', '🔒', 'Danger'));
  if (cfg.claimEnabled) row.addComponents(button('ticket:claim', 'Prendre en charge', '🙋', 'Success'));
  payload.components = [row];
  payload.allowedMentions = { users: [user.id], roles: team };

  const sent = await safeSend(channel, payload);
  if (sent && cfg.pinWelcome) await sent.pin().catch(() => {});

  await logEvent(client, guild, cfg, brandedEmbed(s.general).setColor(0x34d399).setTitle(`Ticket #${number} ouvert`)
    .addFields({ name: 'Membre', value: `${user} (\`${user.id}\`)`, inline: true }, { name: 'Salon', value: `${channel}`, inline: true },
      ...(topic ? [{ name: 'Sujet', value: safeText(topic.label), inline: true }] : []))
    .setTimestamp());

  // Réponse immédiate de l'IA aux réponses du formulaire
  if (cfg.ai.enabled && cfg.ai.mode !== 'mention' && answers.some((a) => a.answer)) {
    const text = answers.filter((a) => a.answer).map((a) => `${a.question} : ${a.answer}`).join('\n');
    const fakeMessage = { guild, channel, author: user, member, mentions: { has: () => false } };
    ticketAi.maybeReply(client, fakeMessage, ticket, cfg, { isSupport: (m) => isSupport(m, cfg), teamRoles: () => team }, { syntheticText: text }).catch(() => {});
  }

  return interaction.editReply(tx(cfg, 'opened', { channel: `${channel}`, user: `${user}` }));
}

/* ------------------------------------------------------------------ */
/* Fermeture                                                           */
/* ------------------------------------------------------------------ */
async function lockChannel(client, guild, channel, ticket, { archiveId, closed }) {
  const prefix = closed ? 'ferme-' : '';
  const base = channel.name.replace(/^ferme-/, '');
  await channel.permissionOverwrites.edit(ticket.user_id, closed ? { SendMessages: false, AttachFiles: false } : { SendMessages: true, AttachFiles: true }).catch(() => {});
  await channel.setName(`${prefix}${base}`.slice(0, 100)).catch(() => {});
  if (archiveId && closed) await channel.setParent(archiveId, { lockPermissions: false }).catch(() => {});
}

async function finalizeClose(client, guild, channel, ticket, closer, reason = '') {
  const { db, settings } = client.ctx;
  const s = settings.get(guild.id);
  const cfg = s.tickets;
  const closedAt = Date.now();

  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, close_reason = ?, closed_by = ? WHERE id = ?")
    .run(closedAt, String(reason).slice(0, 500), closer.id, ticket.id);
  await safeSend(channel, { content: tx(cfg, 'closing', { seconds: String(cfg.closeDelay), user: `<@${ticket.user_id}>` }), allowedMentions: { parse: [] } });

  const opener = await client.users.fetch(ticket.user_id).catch(() => null);
  if (cfg.transcript) {
    const messages = await transcripts.collectMessages(channel);
    const asHtml = cfg.transcriptFormat === 'html';
    const body = asHtml
      ? transcripts.toHtml(messages, { number: ticket.number, opener: opener?.username, topic: ticket.topic, closedBy: closer.username, durationMs: closedAt - ticket.created_at })
      : transcripts.toText(messages);
    const name = `transcript-${ticket.number}.${asHtml ? 'html' : 'txt'}`;
    const make = () => new AttachmentBuilder(Buffer.from(body || '(ticket vide)', 'utf8'), { name });

    const e = brandedEmbed(s.general)
      .setTitle(`Ticket #${ticket.number} fermé`)
      .addFields(
        { name: 'Ouvert par', value: opener ? `${opener} (\`${opener.id}\`)` : `\`${ticket.user_id}\``, inline: true },
        { name: 'Fermé par', value: `${closer}`, inline: true },
        { name: 'Durée', value: formatMinutes(Math.max(1, Math.round((closedAt - ticket.created_at) / 60000))), inline: true },
        { name: 'Messages', value: String(messages.length), inline: true },
      )
      .setTimestamp();
    if (ticket.topic) e.addFields({ name: 'Sujet', value: safeText(ticket.topic), inline: true });
    if (ticket.claimed_by) e.addFields({ name: 'Pris en charge par', value: `<@${ticket.claimed_by}>`, inline: true });
    if (ticket.reason) e.addFields({ name: 'Raison d’ouverture', value: safeText(ticket.reason).slice(0, 500) });
    if (reason) e.addFields({ name: 'Raison de fermeture', value: safeText(reason).slice(0, 500) });

    await safeSend(getSendable(guild, cfg.logChannelId), { embeds: [e], files: [make()] });
    if (cfg.dmTranscript && opener) {
      await opener.send({ content: `Voici le transcript de ton ticket #${ticket.number} sur **${guild.name}**.`, files: [make()] }).catch(() => {});
    }
  } else {
    await logEvent(client, guild, cfg, brandedEmbed(s.general).setColor(0xef4444).setTitle(`Ticket #${ticket.number} fermé`)
      .addFields({ name: 'Fermé par', value: `${closer}`, inline: true }).setTimestamp());
  }

  if (cfg.rating.enabled && opener && closer.id !== ticket.user_id) {
    const row = new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) => button(`ticket:rate:${ticket.id}:${n}`, `${n}`, '⭐', 'Secondary')));
    await opener.send({
      embeds: [brandedEmbed(s.general).setTitle('Ton avis nous intéresse').setDescription(render(cfg.rating.text, { number: String(ticket.number), server: guild.name }))],
      components: [row],
    }).catch(() => {});
  }

  if (cfg.closeDelay > 0) await wait(cfg.closeDelay * 1000);
  if (cfg.closeMode === 'delete') {
    await channel.delete(`Ticket fermé par ${closer.username}`).catch((err) => console.warn(`[tickets] suppression: ${err.message}`));
  } else {
    const archiveId = cfg.closeMode === 'archive' && guild.channels.cache.get(cfg.archiveCategoryId)?.type === ChannelType.GuildCategory ? cfg.archiveCategoryId : null;
    await lockChannel(client, guild, channel, ticket, { archiveId, closed: true });
  }
}

/** Remet en service un ticket verrouillé / archivé. */
async function reopen(client, interaction) {
  const { db, settings } = client.ctx;
  const cfg = settings.get(interaction.guild.id).tickets;
  const ticket = db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'closed'").get(interaction.channelId);
  if (!ticket) throw new Error('Ce salon n’est pas un ticket fermé.');
  if (!isSupport(interaction.member, cfg)) throw new Error('Réservé au support.');
  db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, warned = 0, last_activity = ? WHERE id = ?").run(Date.now(), ticket.id);
  const parent = interaction.guild.channels.cache.get(ticket.topic && cfg.topics.find((t) => t.label === ticket.topic)?.categoryId) || interaction.guild.channels.cache.get(cfg.categoryId);
  await lockChannel(client, interaction.guild, interaction.channel, ticket, { closed: false });
  if (parent?.type === ChannelType.GuildCategory) await interaction.channel.setParent(parent.id, { lockPermissions: false }).catch(() => {});
  return `Ticket #${ticket.number} rouvert.`;
}

/** À appeler quand un salon est supprimé : marque le ticket comme fermé. */
function onChannelDelete(client, channel) {
  client.ctx.db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ? AND status = 'open'").run(Date.now(), channel.id);
}

/* ------------------------------------------------------------------ */
/* Messages dans un ticket : activité, IA                              */
/* ------------------------------------------------------------------ */
async function onMessage(client, message) {
  const { db, settings } = client.ctx;
  const ticket = ticketRowFor(db, message.channelId);
  if (!ticket) return false;
  const cfg = settings.get(message.guild.id).tickets;

  db.prepare('UPDATE tickets SET last_activity = ?, warned = 0 WHERE id = ?').run(Date.now(), ticket.id);
  const staff = isSupport(message.member, cfg);
  if (staff && message.author.id !== ticket.user_id && !ticket.staff_replied) {
    db.prepare('UPDATE tickets SET staff_replied = 1 WHERE id = ?').run(ticket.id);
    ticket.staff_replied = 1;
  }
  if (!staff || message.author.id === ticket.user_id) {
    await ticketAi.maybeReply(client, message, ticket, cfg, { isSupport: (m) => isSupport(m, cfg), teamRoles: (t) => teamFor(cfg, t.topic) });
  }
  return true;
}

/** Fermeture automatique des tickets inactifs (tâche périodique). */
async function tick(client) {
  const { db, settings } = client.ctx;
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const cfg = settings.get(guild.id).tickets;
    if (!cfg.enabled || !cfg.autoClose.enabled) continue;
    const rows = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open'").all(guild.id);
    for (const row of rows) {
      const channel = guild.channels.cache.get(row.channel_id);
      if (!channel) {
        db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE id = ?").run(now, row.id);
        continue;
      }
      const idle = now - (row.last_activity || row.created_at);
      const limit = cfg.autoClose.afterHours * 3600000;
      const warnAt = limit - cfg.autoClose.warnHours * 3600000;
      if (idle >= limit) {
        await finalizeClose(client, guild, channel, row, client.user, 'Fermé automatiquement (inactivité)');
      } else if (cfg.autoClose.warnHours > 0 && idle >= warnAt && !row.warned) {
        db.prepare('UPDATE tickets SET warned = 1 WHERE id = ?').run(row.id);
        await safeSend(channel, {
          content: render(cfg.autoClose.warnText, { user: `<@${row.user_id}>`, count: String(cfg.autoClose.warnHours) }),
          allowedMentions: { users: [row.user_id] },
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Routage des interactions                                            */
/* ------------------------------------------------------------------ */
function questionsFor(cfg, topic) {
  if (topic?.questions?.length) return topic.questions.slice(0, 5);
  if (cfg.requireReason) return [{ label: cfg.reasonLabel || 'Quelle est la raison de ta demande ?', style: 'paragraph', required: true, placeholder: '' }];
  return [];
}

function questionModal(customId, title, questions) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  questions.forEach((q, i) => {
    const input = new TextInputBuilder().setCustomId(`q${i}`).setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required !== false).setMaxLength(q.style === 'paragraph' ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

async function handleRating(client, interaction, ticketId, value) {
  const { db, settings } = client.ctx;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket || ticket.user_id !== interaction.user.id) {
    await interaction.reply({ content: 'Cette évaluation ne te concerne pas.', flags: EPHEMERAL });
    return true;
  }
  if (ticket.rating) {
    await interaction.update({ content: 'Tu as déjà noté ce ticket, merci !', components: [] });
    return true;
  }
  const n = Math.min(5, Math.max(1, Number(value) || 0));
  db.prepare('UPDATE tickets SET rating = ? WHERE id = ?').run(n, ticket.id);
  const guild = client.guilds.cache.get(ticket.guild_id);
  const cfg = settings.get(ticket.guild_id).tickets;
  await interaction.update({ content: tx(cfg, 'thanksRating', { rating: String(n) }), embeds: [], components: [] });
  if (guild) {
    await safeSend(getSendable(guild, cfg.logChannelId), {
      embeds: [brandedEmbed(settings.get(guild.id).general).setTitle(`Note du ticket #${ticket.number}`)
        .setDescription(`${'⭐'.repeat(n)}${'☆'.repeat(5 - n)}  (${n}/5)\nPar <@${ticket.user_id}>`)],
      allowedMentions: { parse: [] },
    });
  }
  return true;
}

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('ticket:')) return false;
  const [, action, arg, arg2] = id.split(':');

  // La notation arrive en MP : pas de serveur dans l'interaction.
  if (interaction.isButton() && action === 'rate') return handleRating(client, interaction, Number(arg), arg2);

  const { guild } = interaction;
  if (!guild) return true;
  const { db, settings } = client.ctx;
  const cfg = settings.get(guild.id).tickets;
  const deny = async (text) => {
    await interaction.reply({ content: text, flags: EPHEMERAL });
    return true;
  };

  /* --- Ouverture : bouton ou menu --- */
  const openIdx = (interaction.isButton() && action === 'open') ? Number(arg)
    : (interaction.isStringSelectMenu?.() && action === 'menu') ? Number(interaction.values[0]) : null;
  if (openIdx !== null) {
    const check = canOpen(client, guild, interaction.member, cfg);
    if (!check.ok) return deny(check.text);
    const topic = openIdx >= 0 ? cfg.topics[openIdx] : null;
    const questions = questionsFor(cfg, topic);
    if (questions.length) {
      await interaction.showModal(questionModal(`ticket:modal:${openIdx}`, topic?.label || 'Ouvrir un ticket', questions));
      return true;
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    await openTicket(client, interaction, openIdx, []);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'modal') {
    const idx = Number(arg);
    const topic = idx >= 0 ? cfg.topics[idx] : null;
    const questions = questionsFor(cfg, topic);
    const answers = questions.map((q, i) => ({ question: q.label, answer: (interaction.fields.getTextInputValue(`q${i}`) || '').trim() }));
    await interaction.deferReply({ flags: EPHEMERAL });
    await openTicket(client, interaction, idx, answers);
    return true;
  }

  /* --- Les actions suivantes se font dans un salon de ticket --- */
  const ticket = ticketRowFor(db, interaction.channelId);
  if (!ticket) return deny('Ce salon n’est plus un ticket actif.');
  const member = interaction.member;
  const support = isSupport(member, cfg);
  const mayClose = cfg.onlySupportCanClose ? support : (support || interaction.user.id === ticket.user_id);

  if (interaction.isButton() && action === 'human') {
    if (interaction.user.id !== ticket.user_id && !support) return deny('Seul l’auteur du ticket peut faire cette demande.');
    await interaction.update({ components: [] }).catch(() => {});
    await ticketAi.handoff(client, interaction.channel, ticket, cfg, teamFor(cfg, ticket.topic), `${interaction.user}`);
    return true;
  }

  if (interaction.isButton() && action === 'close' && !arg) {
    if (!mayClose) return deny('Tu ne peux pas fermer ce ticket.');
    if (cfg.closeRequiresReason) {
      await interaction.showModal(new ModalBuilder().setCustomId('ticket:closemodal').setTitle('Fermer le ticket').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Raison de la fermeture')
          .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)),
      ));
      return true;
    }
    await interaction.reply({
      content: 'Fermer définitivement ce ticket ?',
      components: [new ActionRowBuilder().addComponents(
        button('ticket:close:confirm', 'Oui, fermer', '✅', 'Danger'),
        button('ticket:close:cancel', 'Annuler', '✖️', 'Secondary'),
      )],
      flags: EPHEMERAL,
    });
    return true;
  }

  if (interaction.isModalSubmit() && action === 'closemodal') {
    if (!mayClose) return deny('Tu ne peux pas fermer ce ticket.');
    await interaction.reply({ content: 'Fermeture en cours…', flags: EPHEMERAL });
    await finalizeClose(client, guild, interaction.channel, ticket, interaction.user, interaction.fields.getTextInputValue('reason'));
    return true;
  }

  if (interaction.isButton() && action === 'close' && arg === 'cancel') {
    await interaction.update({ content: 'Fermeture annulée.', components: [] });
    return true;
  }

  if (interaction.isButton() && action === 'close' && arg === 'confirm') {
    if (!mayClose) return deny('Tu ne peux pas fermer ce ticket.');
    await interaction.update({ content: 'Fermeture en cours…', components: [] });
    await finalizeClose(client, guild, interaction.channel, ticket, interaction.user);
    return true;
  }

  if (interaction.isButton() && action === 'claim') {
    if (!support) return deny('Seul le support peut prendre un ticket en charge.');
    if (ticket.claimed_by) return deny(`Déjà pris en charge par <@${ticket.claimed_by}>.`);
    db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);
    await interaction.update({
      components: [new ActionRowBuilder().addComponents(
        button('ticket:close', 'Fermer', '🔒', 'Danger'),
        button('ticket:claim', 'Pris en charge', '✅', 'Secondary', true),
      )],
    });
    await safeSend(interaction.channel, { content: tx(cfg, 'claimed', { staff: `${interaction.user}`, user: `<@${ticket.user_id}>` }), allowedMentions: { users: [] } });
    await logEvent(client, guild, cfg, brandedEmbed(settings.get(guild.id).general).setTitle(`Ticket #${ticket.number} pris en charge`)
      .addFields({ name: 'Par', value: `${interaction.user}`, inline: true }, { name: 'Salon', value: `${interaction.channel}`, inline: true }).setTimestamp());
    return true;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* Commandes /ticket                                                   */
/* ------------------------------------------------------------------ */
function requireTicket(client, interaction, { support = true } = {}) {
  const ticket = ticketRowFor(client.ctx.db, interaction.channelId);
  if (!ticket) throw new Error('Cette commande s’utilise dans un salon de ticket.');
  const cfg = client.ctx.settings.get(interaction.guild.id).tickets;
  if (support && !isSupport(interaction.member, cfg)) throw new Error('Réservé au support.');
  return { ticket, cfg };
}

async function addMember(client, interaction, user) {
  requireTicket(client, interaction);
  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true,
  });
  return `${user} a été ajouté au ticket.`;
}

async function removeMember(client, interaction, user) {
  const { ticket } = requireTicket(client, interaction);
  if (user.id === ticket.user_id) throw new Error('Impossible de retirer l’auteur du ticket.');
  await interaction.channel.permissionOverwrites.delete(user.id);
  return `${user} a été retiré du ticket.`;
}

async function closeFromCommand(client, interaction, reason = '') {
  const { ticket, cfg } = requireTicket(client, interaction, { support: false });
  const support = isSupport(interaction.member, cfg);
  const mayClose = cfg.onlySupportCanClose ? support : (support || interaction.user.id === ticket.user_id);
  if (!mayClose) throw new Error('Tu ne peux pas fermer ce ticket.');
  if (cfg.closeRequiresReason && !reason) throw new Error('Une raison est obligatoire pour fermer un ticket sur ce serveur.');
  await interaction.editReply('Fermeture en cours…');
  await finalizeClose(client, interaction.guild, interaction.channel, ticket, interaction.user, reason);
}

async function renameTicket(client, interaction, name) {
  requireTicket(client, interaction);
  const clean = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  if (!clean) throw new Error('Nom invalide.');
  await interaction.channel.setName(clean);
  return `Ticket renommé en \`${clean}\`.`;
}

async function claimFromCommand(client, interaction, release = false) {
  const { ticket } = requireTicket(client, interaction);
  if (release) {
    client.ctx.db.prepare('UPDATE tickets SET claimed_by = NULL WHERE id = ?').run(ticket.id);
    return 'Le ticket n’est plus pris en charge.';
  }
  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) throw new Error(`Déjà pris en charge par <@${ticket.claimed_by}>.`);
  client.ctx.db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);
  return 'Tu prends ce ticket en charge.';
}

async function transcriptFromCommand(client, interaction) {
  const { ticket, cfg } = requireTicket(client, interaction);
  const messages = await transcripts.collectMessages(interaction.channel);
  const html = cfg.transcriptFormat === 'html';
  const body = html ? transcripts.toHtml(messages, { number: ticket.number, topic: ticket.topic }) : transcripts.toText(messages);
  return new AttachmentBuilder(Buffer.from(body || '(ticket vide)', 'utf8'), { name: `transcript-${ticket.number}.${html ? 'html' : 'txt'}` });
}

function aiToggle(client, interaction, on) {
  const { ticket } = requireTicket(client, interaction);
  client.ctx.db.prepare('UPDATE tickets SET ai_paused = ? WHERE id = ?').run(on ? 0 : 1, ticket.id);
  return on ? 'L’assistant IA est réactivé pour ce ticket.' : 'L’assistant IA est coupé pour ce ticket.';
}

module.exports = {
  publishPanel, panelPayload, handleInteraction, onChannelDelete, onMessage, tick, reopen,
  addMember, removeMember, closeFromCommand, renameTicket, claimFromCommand, transcriptFromCommand, aiToggle,
  isSupport, canOpen, teamFor, questionsFor, finalizeClose,
};
