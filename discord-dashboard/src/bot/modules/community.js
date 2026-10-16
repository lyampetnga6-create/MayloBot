'use strict';
/**
 * Modules communautaires : suggestions, concours, sondages, starboard, comptage,
 * anniversaires, réputation, confessions anonymes, rappel de bump, remerciement des boosts.
 */
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} = require('discord.js');
const { buildMessage, memberVars, hexToInt, render, safeText, trunc } = require('../../lib/template');
const { getSendable, safeSend, parseEmoji, EPHEMERAL } = require('../util');

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId, id) => client.ctx.settings.module(guildId, id);
const general = (client, guildId) => client.ctx.settings.module(guildId, 'general');
const colorOf = (client, guildId, own) => hexToInt(own || general(client, guildId).embedColor);
const hasRole = (member, ids) => Boolean(member) && ids.some((id) => member.roles.cache.has(id));
const isManager = (member, roleIds = []) => Boolean(member) && (member.permissions.has(PermissionFlagsBits.ManageGuild) || hasRole(member, roleIds));
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const kvDel = (client, key) => db(client).prepare('DELETE FROM kv WHERE key = ?').run(key);

const reply = (interaction, content) => interaction.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
const btn = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const e = parseEmoji(emoji);
  if (e) b.setEmoji(e);
  return b;
};

/** Emoji simple (« 👍 ») ou personnalisé, utilisable dans un bouton. */
const emojiOrNull = (s) => parseEmoji(s);

/* ============================== SUGGESTIONS ============================== */

const SUGG_STATUS = { open: '🕓 En attente', approved: '✅ Approuvée', denied: '❌ Refusée' };

function suggestionVotes(client, id) {
  const rows = db(client).prepare('SELECT vote, COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ? GROUP BY vote').all(id);
  return { up: rows.find((r) => r.vote === 1)?.n || 0, down: rows.find((r) => r.vote === -1)?.n || 0 };
}

function suggestionPayload(client, guild, s) {
  const cfg = cfgOf(client, guild.id, 'suggestions');
  const votes = suggestionVotes(client, s.id);
  const color = s.status === 'approved' ? cfg.approvedColor : s.status === 'denied' ? cfg.deniedColor : cfg.pendingColor;
  const embed = new EmbedBuilder()
    .setColor(hexToInt(color))
    .setTitle(`💡 Suggestion #${s.id}`)
    .setDescription(trunc(safeText(s.content), 3800))
    .addFields({ name: 'Auteur', value: `<@${s.author_id}>`, inline: true }, { name: 'Statut', value: SUGG_STATUS[s.status] || s.status, inline: true });
  if (cfg.voteStyle === 'buttons') embed.addFields({ name: 'Votes', value: `${cfg.upEmoji} **${votes.up}**   ${cfg.downEmoji} **${votes.down}**`, inline: true });
  if (s.reason) embed.addFields({ name: 'Réponse du staff', value: trunc(safeText(s.reason), 1000) });
  embed.setTimestamp(s.created_at);

  const components = [];
  if (s.status === 'open' && cfg.voteStyle === 'buttons') {
    components.push(new ActionRowBuilder().addComponents(
      btn(`sugg:up:${s.id}`, String(votes.up), ButtonStyle.Secondary, cfg.upEmoji),
      btn(`sugg:down:${s.id}`, String(votes.down), ButtonStyle.Secondary, cfg.downEmoji),
      btn(`sugg:approve:${s.id}`, 'Approuver', ButtonStyle.Success),
      btn(`sugg:deny:${s.id}`, 'Refuser', ButtonStyle.Danger),
    ));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function submitSuggestion(client, interaction, content) {
  const { guild, member } = interaction;
  const cfg = cfgOf(client, guild.id, 'suggestions');
  if (!cfg.enabled) return reply(interaction, 'Les suggestions sont désactivées sur ce serveur.');
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) return reply(interaction, 'Le salon des suggestions n’est pas configuré (ou je ne peux pas y écrire).');
  const last = kvGet(client, `sugg-cd:${guild.id}:${member.id}`);
  const left = last ? Number(last) + cfg.cooldown * 1000 - Date.now() : 0;
  if (left > 0) return reply(interaction, `⏳ Patiente encore ${Math.ceil(left / 1000)} s avant une nouvelle suggestion.`);

  const res = db(client).prepare('INSERT INTO suggestions (guild_id, channel_id, author_id, content, created_at) VALUES (?,?,?,?,?)')
    .run(guild.id, channel.id, member.id, content.slice(0, 3800), Date.now());
  const s = db(client).prepare('SELECT * FROM suggestions WHERE id = ?').get(res.lastInsertRowid);
  const sent = await safeSend(channel, suggestionPayload(client, guild, s));
  if (!sent) return reply(interaction, 'Impossible de publier la suggestion.');
  db(client).prepare('UPDATE suggestions SET message_id = ? WHERE id = ?').run(sent.id, s.id);
  kvSet(client, `sugg-cd:${guild.id}:${member.id}`, Date.now());
  if (cfg.voteStyle === 'reactions') {
    for (const e of [cfg.upEmoji, cfg.downEmoji]) await sent.react(e).catch(() => {});
  }
  if (cfg.createThread) await sent.startThread({ name: `Suggestion #${s.id}`.slice(0, 100) }).catch(() => {});
  return reply(interaction, `✅ Ta suggestion #${s.id} a été publiée : ${sent.url}`);
}

async function decideSuggestion(client, guild, id, status, reason, moderator) {
  const s = db(client).prepare('SELECT * FROM suggestions WHERE id = ? AND guild_id = ?').get(id, guild.id);
  if (!s) throw new Error('Suggestion introuvable.');
  if (s.status !== 'open') throw new Error('Cette suggestion a déjà reçu une réponse.');
  db(client).prepare('UPDATE suggestions SET status = ?, reason = ? WHERE id = ?').run(status, reason.slice(0, 1000), id);
  const fresh = { ...s, status, reason };
  const cfg = cfgOf(client, guild.id, 'suggestions');
  const channel = guild.channels.cache.get(s.channel_id);
  const msg = channel && s.message_id ? await channel.messages.fetch(s.message_id).catch(() => null) : null;
  if (msg) await msg.edit(suggestionPayload(client, guild, fresh)).catch(() => {});
  if (cfg.decisionChannelId) {
    const dc = getSendable(guild, cfg.decisionChannelId);
    await safeSend(dc, { content: `${SUGG_STATUS[status]} — suggestion #${id} de <@${s.author_id}> par ${moderator}${reason ? `\n> ${safeText(reason)}` : ''}`, allowedMentions: { parse: [] } });
  }
  if (cfg.dmAuthor) {
    const user = await client.users.fetch(s.author_id).catch(() => null);
    await user?.send(`${SUGG_STATUS[status]} — ta suggestion #${id} sur **${guild.name}**${reason ? ` :\n> ${safeText(reason)}` : '.'}`).catch(() => {});
  }
  return fresh;
}

async function handleSuggestionButton(client, interaction, [, action, rawId]) {
  const id = Number(rawId);
  const { guild, member } = interaction;
  const cfg = cfgOf(client, guild.id, 'suggestions');
  const s = db(client).prepare('SELECT * FROM suggestions WHERE id = ? AND guild_id = ?').get(id, guild.id);
  if (!s) return reply(interaction, 'Suggestion introuvable.');

  if (action === 'up' || action === 'down') {
    if (s.status !== 'open') return reply(interaction, 'Les votes sont clos.');
    const vote = action === 'up' ? 1 : -1;
    const cur = db(client).prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').get(id, member.id);
    if (cur?.vote === vote) db(client).prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(id, member.id);
    else db(client).prepare('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?,?,?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote').run(id, member.id, vote);
    return interaction.update(suggestionPayload(client, guild, s));
  }

  if (!isManager(member, cfg.staffRoles)) return reply(interaction, 'Seul le staff peut répondre aux suggestions.');
  const status = action === 'approve' ? 'approved' : 'denied';
  if (cfg.requireReason) {
    const modal = new ModalBuilder().setCustomId(`sugg:reason:${status}:${id}`).setTitle(status === 'approved' ? 'Approuver la suggestion' : 'Refuser la suggestion')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Raison').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
    return interaction.showModal(modal);
  }
  await decideSuggestion(client, guild, id, status, '', `<@${member.id}>`).catch((e) => reply(interaction, e.message));
  return interaction.deferUpdate().catch(() => {});
}

async function handleSuggestionModal(client, interaction, parts) {
  const [, , status, rawId] = parts;
  const cfg = cfgOf(client, interaction.guild.id, 'suggestions');
  if (!isManager(interaction.member, cfg.staffRoles)) return reply(interaction, 'Seul le staff peut répondre aux suggestions.');
  try {
    await decideSuggestion(client, interaction.guild, Number(rawId), status, interaction.fields.getTextInputValue('reason'), `<@${interaction.member.id}>`);
    return reply(interaction, '✅ Réponse enregistrée.');
  } catch (e) {
    return reply(interaction, e.message);
  }
}

/** Suggestions par réactions : un vote est un ajout d'émoji (rien à faire côté bot). */

/* =============================== CONCOURS =============================== */

function giveawayPayload(client, guild, g, ended = false) {
  const cfg = cfgOf(client, guild.id, 'giveaways');
  const entries = db(client).prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?').get(g.id).n;
  const winners = JSON.parse(g.winner_ids || '[]');
  const e = new EmbedBuilder()
    .setColor(colorOf(client, guild.id, cfg.color))
    .setTitle(`🎉 ${trunc(safeText(g.prize), 200)}`)
    .setDescription([
      ended ? `**Terminé** <t:${Math.floor(g.ends_at / 1000)}:R>` : `Fin : <t:${Math.floor(g.ends_at / 1000)}:R> (<t:${Math.floor(g.ends_at / 1000)}:f>)`,
      `Organisé par : <@${g.host_id}>`,
      `Gagnant(s) : **${g.winners}**`,
      g.required_role ? `Rôle requis : <@&${g.required_role}>` : '',
      g.min_level ? `Niveau minimum : **${g.min_level}**` : '',
      ended ? `\n🏆 ${winners.length ? winners.map((w) => `<@${w}>`).join(', ') : 'Aucun gagnant'}` : '',
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `${entries} participant(s) · Concours #${g.id}` });
  const row = new ActionRowBuilder().addComponents(
    btn(`gw:enter:${g.id}`, cfg.buttonLabel, ButtonStyle.Primary, cfg.buttonEmoji).setDisabled(ended || g.status !== 'active'),
  );
  return { embeds: [e], components: [row], allowedMentions: { parse: [] } };
}

async function createGiveaway(client, interaction, { prize, durationMs, winners, requiredRole, minLevel }) {
  const { guild, member, channel } = interaction;
  const cfg = cfgOf(client, guild.id, 'giveaways');
  if (!cfg.enabled) return reply(interaction, 'Le module Concours est désactivé.');
  if (!isManager(member, cfg.managerRoles)) return reply(interaction, 'Il faut « Gérer le serveur » (ou un rôle autorisé) pour lancer un concours.');
  const target = getSendable(guild, channel.id);
  if (!target) return reply(interaction, 'Je ne peux pas écrire dans ce salon.');
  const endsAt = Date.now() + durationMs;
  const res = db(client).prepare('INSERT INTO giveaways (guild_id, channel_id, prize, winners, host_id, ends_at, required_role, min_level, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(guild.id, channel.id, prize.slice(0, 200), winners, member.id, endsAt, requiredRole || null, minLevel || 0, Date.now());
  const g = db(client).prepare('SELECT * FROM giveaways WHERE id = ?').get(res.lastInsertRowid);
  const sent = await safeSend(target, giveawayPayload(client, guild, g));
  if (!sent) return reply(interaction, 'Impossible de publier le concours.');
  db(client).prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(sent.id, g.id);
  return reply(interaction, `✅ Concours #${g.id} lancé : ${sent.url}`);
}

async function pickWinners(client, guild, g) {
  const cfg = cfgOf(client, guild.id, 'giveaways');
  const ids = db(client).prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(g.id).map((r) => r.user_id);
  const pool = [];
  for (const id of ids) {
    const m = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (!m) continue;
    let weight = 1;
    for (const b of cfg.bonusEntries) if (m.roles.cache.has(b.role)) weight += b.entries;
    pool.push({ id, weight });
  }
  const winners = [];
  while (winners.length < g.winners && pool.length) {
    const total = pool.reduce((n, p) => n + p.weight, 0);
    let r = Math.random() * total;
    const idx = pool.findIndex((p) => (r -= p.weight) < 0);
    winners.push(pool.splice(idx < 0 ? pool.length - 1 : idx, 1)[0].id);
  }
  return winners;
}

async function endGiveaway(client, guild, g, { reroll = false } = {}) {
  const cfg = cfgOf(client, guild.id, 'giveaways');
  const winners = await pickWinners(client, guild, g);
  db(client).prepare("UPDATE giveaways SET status = 'ended', winner_ids = ? WHERE id = ?").run(JSON.stringify(winners), g.id);
  const fresh = { ...g, status: 'ended', winner_ids: JSON.stringify(winners) };
  const channel = guild.channels.cache.get(g.channel_id);
  const msg = channel && g.message_id ? await channel.messages.fetch(g.message_id).catch(() => null) : null;
  if (msg) await msg.edit(giveawayPayload(client, guild, fresh, true)).catch(() => {});
  const vars = { prize: safeText(g.prize), host: `<@${g.host_id}>`, winners: winners.map((w) => `<@${w}>`).join(', ') };
  const text = winners.length ? render(cfg.winnerText, vars) : render(cfg.noWinnerText, vars);
  await safeSend(getSendable(guild, g.channel_id), {
    content: reroll ? `🔁 Nouveau tirage : ${text}` : text,
    allowedMentions: cfg.pingWinners ? { users: winners } : { parse: [] },
  });
  if (cfg.dmWinners) {
    for (const w of winners) {
      const u = await client.users.fetch(w).catch(() => null);
      await u?.send(`🎉 Tu as gagné **${safeText(g.prize)}** sur **${guild.name}** !`).catch(() => {});
    }
  }
  return winners;
}

async function handleGiveawayButton(client, interaction, [, , rawId]) {
  const { guild, member } = interaction;
  const g = db(client).prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?').get(Number(rawId), guild.id);
  if (!g || g.status !== 'active') return reply(interaction, 'Ce concours est terminé.');
  if (g.required_role && !member.roles.cache.has(g.required_role)) return reply(interaction, `Il te faut le rôle <@&${g.required_role}> pour participer.`);
  if (g.min_level) {
    const lvl = db(client).prepare('SELECT level FROM levels WHERE guild_id = ? AND user_id = ?').get(guild.id, member.id)?.level || 0;
    if (lvl < g.min_level) return reply(interaction, `Il te faut le niveau ${g.min_level} pour participer (tu es niveau ${lvl}).`);
  }
  const has = db(client).prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(g.id, member.id);
  if (has) {
    db(client).prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(g.id, member.id);
    await reply(interaction, '↩️ Tu ne participes plus à ce concours.');
  } else {
    db(client).prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?,?)').run(g.id, member.id);
    await reply(interaction, '🎟️ Participation enregistrée, bonne chance !');
  }
  const channel = guild.channels.cache.get(g.channel_id);
  const msg = channel && g.message_id ? await channel.messages.fetch(g.message_id).catch(() => null) : null;
  if (msg) await msg.edit(giveawayPayload(client, guild, g)).catch(() => {});
  return true;
}

async function tickGiveaways(client) {
  const due = db(client).prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?").all(Date.now());
  for (const g of due) {
    const guild = client.guilds.cache.get(g.guild_id);
    if (!guild) continue;
    await endGiveaway(client, guild, g);
  }
}

/* ================================ SONDAGES ============================== */

const BAR = (pct) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function pollPayload(client, guild, p) {
  const options = JSON.parse(p.options);
  const votes = db(client).prepare('SELECT option, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option').all(p.id);
  const counts = options.map((_, i) => votes.find((v) => v.option === i)?.n || 0);
  const voters = db(client).prepare('SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?').get(p.id).n;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const closed = p.status !== 'open';
  const e = new EmbedBuilder()
    .setColor(colorOf(client, guild.id))
    .setTitle(`📊 ${trunc(safeText(p.question), 240)}`)
    .setDescription(options.map((o, i) => `${NUM_EMOJI[i]} **${trunc(safeText(o), 100)}**\n${BAR((counts[i] / total) * 100)} ${counts[i]} (${Math.round((counts[i] / total) * 100)} %)`).join('\n\n'))
    .setFooter({ text: `${voters} votant(s)${p.multi ? ' · choix multiple' : ''}${closed ? ' · sondage clos' : p.ends_at ? '' : ''}` });
  if (!closed && p.ends_at) e.addFields({ name: 'Fin', value: `<t:${Math.floor(p.ends_at / 1000)}:R>` });
  const rows = [];
  if (!closed) {
    for (let i = 0; i < options.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(options.slice(i, i + 5).map((_, j) => btn(`poll:${p.id}:${i + j}`, String(counts[i + j]), ButtonStyle.Secondary, NUM_EMOJI[i + j]))));
    }
  }
  return { embeds: [e], components: rows, allowedMentions: { parse: [] } };
}

async function createPoll(client, interaction, { question, options, multi, durationMs }) {
  const { guild, member, channel } = interaction;
  const target = getSendable(guild, channel.id);
  if (!target) return reply(interaction, 'Je ne peux pas écrire dans ce salon.');
  const res = db(client).prepare('INSERT INTO polls (guild_id, channel_id, question, options, multi, ends_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(guild.id, channel.id, question.slice(0, 240), JSON.stringify(options), multi ? 1 : 0, durationMs ? Date.now() + durationMs : null, member.id, Date.now());
  const p = db(client).prepare('SELECT * FROM polls WHERE id = ?').get(res.lastInsertRowid);
  const sent = await safeSend(target, pollPayload(client, guild, p));
  if (!sent) return reply(interaction, 'Impossible de publier le sondage.');
  db(client).prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(sent.id, p.id);
  return reply(interaction, `✅ Sondage #${p.id} publié : ${sent.url}`);
}

async function closePoll(client, guild, p) {
  db(client).prepare("UPDATE polls SET status = 'closed' WHERE id = ?").run(p.id);
  const channel = guild.channels.cache.get(p.channel_id);
  const msg = channel && p.message_id ? await channel.messages.fetch(p.message_id).catch(() => null) : null;
  if (msg) await msg.edit(pollPayload(client, guild, { ...p, status: 'closed' })).catch(() => {});
}

async function handlePollButton(client, interaction, [, rawId, rawIdx]) {
  const { guild, member } = interaction;
  const p = db(client).prepare('SELECT * FROM polls WHERE id = ? AND guild_id = ?').get(Number(rawId), guild.id);
  if (!p || p.status !== 'open') return reply(interaction, 'Ce sondage est clos.');
  const idx = Number(rawIdx);
  const has = db(client).prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option = ?').get(p.id, member.id, idx);
  if (has) db(client).prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option = ?').run(p.id, member.id, idx);
  else {
    if (!p.multi) db(client).prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(p.id, member.id);
    db(client).prepare('INSERT INTO poll_votes (poll_id, user_id, option) VALUES (?,?,?)').run(p.id, member.id, idx);
  }
  return interaction.update(pollPayload(client, guild, p));
}

async function tickPolls(client) {
  const due = db(client).prepare("SELECT * FROM polls WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= ?").all(Date.now());
  for (const p of due) {
    const guild = client.guilds.cache.get(p.guild_id);
    if (guild) await closePoll(client, guild, p);
  }
}

/* ================================ STARBOARD ============================= */

const sameEmoji = (reaction, wanted) => reaction.emoji.name === wanted || reaction.emoji.toString() === wanted;

async function onReaction(client, reaction) {
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild) return;
  const guild = message.guild;
  const cfg = cfgOf(client, guild.id, 'starboard');
  if (!cfg.enabled || !cfg.channelId || !sameEmoji(reaction, cfg.emoji)) return;
  if (message.channelId === cfg.channelId || cfg.ignoredChannels.includes(message.channelId)) return;
  if (cfg.ignoreNsfw && message.channel?.nsfw) return;

  let stars = reaction.count || 0;
  if (!cfg.selfStar) {
    const users = await reaction.users.fetch().catch(() => null);
    if (users?.has(message.author?.id)) stars -= 1;
  }
  const row = db(client).prepare('SELECT * FROM starboard WHERE guild_id = ? AND message_id = ?').get(guild.id, message.id);
  const target = getSendable(guild, cfg.channelId);
  if (!target) return;

  const content = `${cfg.emoji} **${stars}** · ${message.channel}`;
  if (stars < cfg.threshold) {
    if (row?.star_message_id) {
      const sm = await target.messages.fetch(row.star_message_id).catch(() => null);
      await sm?.delete().catch(() => {});
      db(client).prepare('UPDATE starboard SET star_message_id = NULL, stars = ? WHERE guild_id = ? AND message_id = ?').run(stars, guild.id, message.id);
    }
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(colorOf(client, guild.id, cfg.color))
    .setAuthor({ name: message.member?.displayName || message.author?.username || 'Inconnu', iconURL: message.author?.displayAvatarURL?.() })
    .setDescription(trunc(message.content || '', 3800) || null)
    .addFields({ name: 'Source', value: `[Aller au message](${message.url})` })
    .setTimestamp(message.createdTimestamp);
  const img = message.attachments?.find((a) => a.contentType?.startsWith('image/'));
  if (img) embed.setImage(img.url);
  const payload = { content, embeds: [embed], allowedMentions: { parse: [] } };

  const existing = row?.star_message_id ? await target.messages.fetch(row.star_message_id).catch(() => null) : null;
  if (existing) {
    await existing.edit(payload).catch(() => {});
    db(client).prepare('UPDATE starboard SET stars = ? WHERE guild_id = ? AND message_id = ?').run(stars, guild.id, message.id);
  } else {
    const sent = await safeSend(target, payload);
    db(client).prepare(`INSERT INTO starboard (guild_id, message_id, channel_id, star_message_id, stars) VALUES (?,?,?,?,?)
      ON CONFLICT(guild_id, message_id) DO UPDATE SET star_message_id = excluded.star_message_id, stars = excluded.stars`)
      .run(guild.id, message.id, message.channelId, sent?.id || null, stars);
  }
}

/* ================================= COMPTAGE ============================= */

/** Renvoie true si le message appartient au salon de comptage. */
async function onCountingMessage(client, message) {
  const cfg = cfgOf(client, message.guild.id, 'counting');
  if (!cfg.enabled || message.channelId !== cfg.channelId) return false;
  const m = /^\s*(\d{1,12})(?:\s|$)/.exec(message.content);
  if (!m) return false; // discuter dans le salon reste possible
  const n = Number(m[1]);
  let row = db(client).prepare('SELECT * FROM counting WHERE guild_id = ?').get(message.guild.id);
  if (!row) {
    db(client).prepare('INSERT INTO counting (guild_id) VALUES (?)').run(message.guild.id);
    row = { current: 0, last_user: null, highscore: 0, total: 0 };
  }
  const repeated = cfg.noConsecutive && row.last_user === message.author.id;
  if (n === row.current + 1 && !repeated) {
    const high = Math.max(row.highscore, n);
    db(client).prepare('UPDATE counting SET current = ?, last_user = ?, highscore = ?, total = total + 1 WHERE guild_id = ?').run(n, message.author.id, high, message.guild.id);
    if (cfg.reactions) await message.react(n === high && n > row.highscore ? '🏆' : '✅').catch(() => {});
    return true;
  }
  if (cfg.resetOnWrong) db(client).prepare('UPDATE counting SET current = 0, last_user = NULL WHERE guild_id = ?').run(message.guild.id);
  if (cfg.reactions) await message.react('❌').catch(() => {});
  if (cfg.deleteWrong) await message.delete().catch(() => {});
  await safeSend(message.channel, {
    content: render(cfg.wrongText, { user: `<@${message.author.id}>`, count: String(row.current) }),
    allowedMentions: { users: [message.author.id] },
  });
  return true;
}

/* ============================== ANNIVERSAIRES ============================ */

const localNow = (client, guildId) => new Date(Date.now() + general(client, guildId).utcOffset * 3600000);
const ymd = (d) => d.toISOString().slice(0, 10);

function setBirthday(client, guildId, userId, day, month, year) {
  const d = new Date(Date.UTC(2024, month - 1, day)); // 2024 = année bissextile
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return false;
  if (year && (year < 1900 || year > new Date().getUTCFullYear() - 5)) return false;
  db(client).prepare(`INSERT INTO birthdays (guild_id, user_id, day, month, year) VALUES (?,?,?,?,?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET day = excluded.day, month = excluded.month, year = excluded.year`)
    .run(guildId, userId, day, month, year || null);
  return true;
}

async function tickBirthdays(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = cfgOf(client, guild.id, 'birthdays');
    if (!cfg.enabled) continue;
    const now = localNow(client, guild.id);
    if (now.getUTCHours() < cfg.hour) continue;
    const today = ymd(now);
    if (kvGet(client, `bday:${guild.id}`) === today) continue;
    kvSet(client, `bday:${guild.id}`, today);

    const rows = db(client).prepare('SELECT * FROM birthdays WHERE guild_id = ? AND day = ? AND month = ?').all(guild.id, now.getUTCDate(), now.getUTCMonth() + 1);
    const celebrating = new Set(rows.map((r) => r.user_id));
    const channel = getSendable(guild, cfg.channelId);
    for (const r of rows) {
      const member = guild.members.cache.get(r.user_id) || await guild.members.fetch(r.user_id).catch(() => null);
      if (!member) continue;
      if (cfg.roleId) await member.roles.add(cfg.roleId, 'Anniversaire').catch(() => {});
      const age = r.year ? String(now.getUTCFullYear() - r.year) : '';
      const payload = buildMessage(cfg.message, memberVars(member, { age }), general(client, guild.id));
      if (payload && channel) await safeSend(channel, { ...payload, allowedMentions: { users: [member.id] } });
    }
    if (cfg.roleId) {
      const role = guild.roles.cache.get(cfg.roleId);
      for (const m of role?.members.values() || []) if (!celebrating.has(m.id)) await m.roles.remove(cfg.roleId, 'Fin de l’anniversaire').catch(() => {});
    }
  }
}

/* ================================ RÉPUTATION ============================ */

async function giveRep(client, interaction, target) {
  const { guild, member } = interaction;
  const cfg = cfgOf(client, guild.id, 'reputation');
  if (!cfg.enabled) return reply(interaction, 'Le module Réputation est désactivé.');
  if (target.bot) return reply(interaction, 'Les bots n’ont pas besoin de réputation 🤖');
  if (target.id === member.id && !cfg.allowSelf) return reply(interaction, 'Tu ne peux pas te donner de la réputation à toi-même.');
  const since = Date.now() - cfg.cooldownHours * 3600000;
  const last = db(client).prepare('SELECT MAX(at) AS at FROM rep_log WHERE guild_id = ? AND from_id = ? AND at > ?').get(guild.id, member.id, since)?.at;
  if (last) return reply(interaction, `⏳ Tu pourras redonner un point <t:${Math.floor((last + cfg.cooldownHours * 3600000) / 1000)}:R>.`);
  db(client).prepare('INSERT INTO rep_log (guild_id, from_id, to_id, at) VALUES (?,?,?,?)').run(guild.id, member.id, target.id, Date.now());
  db(client).prepare('INSERT INTO reputation (guild_id, user_id, points) VALUES (?,?,1) ON CONFLICT(guild_id, user_id) DO UPDATE SET points = points + 1').run(guild.id, target.id);
  const points = db(client).prepare('SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?').get(guild.id, target.id).points;
  const tm = guild.members.cache.get(target.id) || await guild.members.fetch(target.id).catch(() => null);
  if (tm) for (const rw of cfg.rewards) if (points >= rw.points) await tm.roles.add(rw.role, 'Palier de réputation').catch(() => {});
  await safeSend(getSendable(guild, cfg.logChannelId), { content: `${cfg.emoji} <@${member.id}> a donné un point de réputation à <@${target.id}> (total : ${points})`, allowedMentions: { parse: [] } });
  return interaction.reply({ content: `${cfg.emoji} Tu as donné un point de réputation à <@${target.id}> ! Il en a maintenant **${points}**.`, allowedMentions: { users: [target.id] } });
}

/* =============================== CONFESSIONS ============================= */

async function confess(client, interaction, text) {
  const { guild, member } = interaction;
  const cfg = cfgOf(client, guild.id, 'confessions');
  if (!cfg.enabled) return reply(interaction, 'Les confessions sont désactivées.');
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) return reply(interaction, 'Le salon des confessions n’est pas configuré.');
  if (cfg.bannedUsers.includes(member.id) || hasRole(member, cfg.bannedRoles)) return reply(interaction, 'Tu n’as pas le droit d’envoyer de confession.');
  const last = Number(kvGet(client, `conf-cd:${guild.id}:${member.id}`) || 0);
  if (last + cfg.cooldown * 1000 > Date.now()) return reply(interaction, `⏳ Patiente encore ${Math.ceil((last + cfg.cooldown * 1000 - Date.now()) / 1000)} s.`);

  const id = Number(kvGet(client, `conf-n:${guild.id}`) || 0) + 1;
  kvSet(client, `conf-n:${guild.id}`, id);
  kvSet(client, `conf-cd:${guild.id}:${member.id}`, Date.now());
  const embed = new EmbedBuilder().setColor(colorOf(client, guild.id, cfg.color)).setTitle(render(cfg.title, { id: String(id) })).setDescription(trunc(safeText(text), 3800)).setTimestamp();
  const sent = await safeSend(channel, { embeds: [embed], allowedMentions: { parse: [] } });
  if (!sent) return reply(interaction, 'Impossible de publier la confession.');
  if (cfg.logAuthors) {
    await safeSend(getSendable(guild, cfg.staffChannelId), {
      embeds: [new EmbedBuilder().setColor(0x6d28d9).setTitle(`Confession #${id}`).setDescription(trunc(safeText(text), 3800)).addFields({ name: 'Auteur', value: `<@${member.id}> (${member.id})` }, { name: 'Lien', value: sent.url })],
      allowedMentions: { parse: [] },
    });
  }
  return reply(interaction, '🤫 Ta confession a été publiée anonymement.');
}

/* ================================== BUMP ================================ */

/** Appelé pour TOUS les messages (y compris ceux des bots). */
async function onBumpMessage(client, message) {
  if (!message.guild) return;
  const cfg = cfgOf(client, message.guild.id, 'bump');
  if (!cfg.enabled || !cfg.botId || message.author.id !== cfg.botId) return;
  const haystack = [message.content, ...message.embeds.map((e) => `${e.title || ''} ${e.description || ''}`)].join(' ').toLowerCase();
  if (!cfg.triggers.some((t) => haystack.includes(t))) return;
  kvSet(client, `bump:${message.guild.id}`, Date.now() + cfg.delayMinutes * 60000);
  const who = message.interactionMetadata?.user || message.interaction?.user;
  if (who && cfg.thanks) await safeSend(message.channel, { content: render(cfg.thanks, { user: `<@${who.id}>` }), allowedMentions: { users: [who.id] } });
}

async function tickBump(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = cfgOf(client, guild.id, 'bump');
    if (!cfg.enabled) continue;
    const due = Number(kvGet(client, `bump:${guild.id}`) || 0);
    if (!due || due > Date.now()) continue;
    kvDel(client, `bump:${guild.id}`);
    const ch = getSendable(guild, cfg.channelId);
    await safeSend(ch, {
      content: `${cfg.roleId ? `<@&${cfg.roleId}> ` : ''}${cfg.reminder}`,
      allowedMentions: cfg.roleId ? { roles: [cfg.roleId] } : { parse: [] },
    });
  }
}

/* ================================== BOOSTS ============================== */

async function onMemberUpdate(client, before, after) {
  if (before.partial || before.premiumSince || !after.premiumSince) return;
  const cfg = cfgOf(client, after.guild.id, 'boosts');
  if (!cfg.enabled) return;
  if (cfg.roleId) await after.roles.add(cfg.roleId, 'Booster').catch(() => {});
  const payload = buildMessage(cfg.message, memberVars(after, { boosts: String(after.guild.premiumSubscriptionCount || 0) }), general(client, after.guild.id));
  if (payload) await safeSend(getSendable(after.guild, cfg.channelId), { ...payload, allowedMentions: { users: [after.id] } });
}

/* ============================ Routage interactions ======================= */

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!interaction.guild) return false;
  const parts = id.split(':');
  if (interaction.isButton()) {
    if (parts[0] === 'sugg') { await handleSuggestionButton(client, interaction, parts); return true; }
    if (parts[0] === 'gw') { await handleGiveawayButton(client, interaction, parts); return true; }
    if (parts[0] === 'poll') { await handlePollButton(client, interaction, parts); return true; }
  }
  if (interaction.isModalSubmit() && parts[0] === 'sugg' && parts[1] === 'reason') { await handleSuggestionModal(client, interaction, parts); return true; }
  return false;
}

module.exports = {
  submitSuggestion, decideSuggestion, createGiveaway, endGiveaway, tickGiveaways, createPoll, closePoll, tickPolls,
  onReaction, onCountingMessage, setBirthday, tickBirthdays, giveRep, confess, onBumpMessage, tickBump, onMemberUpdate,
  handleInteraction, emojiOrNull, isManager,
};
