'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { render, brandedEmbed, hexToInt } = require('../../lib/template');
const { EmbedBuilder } = require('discord.js');
const ai = require('./ai');
const { safeSend } = require('../util');

const busy = new Set();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Vrai si le texte contient l'un des mots (mot entier, insensible à la casse). */
function matchesKeyword(text, keywords) {
  const lowered = String(text).toLowerCase();
  return keywords.some((k) => k && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(k.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(lowered));
}

function buildSystemPrompt(cfg, guild, ticket) {
  const a = cfg.ai;
  const parts = [render(a.systemPrompt, { server: guild.name }) || `Tu es l’assistant du support du serveur ${guild.name}.`];
  parts.push(`Contexte : ticket #${ticket.number}${ticket.topic ? `, sujet « ${ticket.topic} »` : ''}.`);
  if (a.knowledge.trim()) parts.push(`Informations de référence (source de vérité) :\n${a.knowledge.trim()}`);
  const faq = a.faq.filter((f) => f.question && f.answer);
  if (faq.length) parts.push(`FAQ :\n${faq.map((f) => `Q : ${f.question}\nR : ${f.answer}`).join('\n\n')}`);
  parts.push(ai.languageRule(a.language));
  parts.push(ai.SAFETY_RULES);
  return parts.join('\n\n');
}

/** Historique du ticket au format attendu par le modèle. */
async function buildHistory(client, message) {
  const fetched = await message.channel.messages.fetch({ limit: 15 }).catch(() => null);
  const list = fetched ? [...fetched.values()].reverse() : [message];
  const out = [];
  for (const m of list) {
    if (m.system) continue;
    if (m.author.id === client.user.id) {
      if (m.pinned) continue; // message d'accueil
      const text = m.content || m.embeds?.[0]?.description || '';
      if (text) out.push({ role: 'assistant', content: text });
    } else if (!m.author.bot) {
      const text = (m.content || '').replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
      if (text) out.push({ role: 'user', content: `${m.member?.displayName || m.author.username} : ${text}` });
    }
  }
  return out;
}

function humanButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:human').setLabel('Appeler un humain').setEmoji('🙋').setStyle(ButtonStyle.Secondary),
  );
}

/** Mentionne l'équipe du ticket et coupe l'IA. */
async function handoff(client, channel, ticket, cfg, teamRoles, who) {
  client.ctx.db.prepare('UPDATE tickets SET ai_paused = 1 WHERE id = ?').run(ticket.id);
  const pings = cfg.ai.pingOnHandoff ? teamRoles.map((id) => `<@&${id}>`).join(' ') : '';
  await safeSend(channel, {
    content: `🙋 ${who ? `${who} demande` : 'Un membre demande'} un humain. ${pings} L’équipe va te répondre.`.trim(),
    allowedMentions: { roles: teamRoles, parse: [] },
  });
}

/**
 * Répond à un message de ticket si les réglages l'autorisent.
 * `ctx` : { isSupport(member), teamRoles(ticket) } fournis par le module tickets.
 */
async function maybeReply(client, message, ticket, cfg, ctx, { syntheticText } = {}) {
  const a = cfg.ai;
  if (!a.enabled || ticket.ai_paused) return false;
  const channel = message.channel;
  // L'auteur du ticket reste un « client » même s'il est administrateur (utile pour tester).
  if (!syntheticText && message.author.id !== ticket.user_id && message.member && ctx.isSupport(message.member)) return false;
  if (a.stopWhenStaff && ticket.staff_replied) return false;
  if (a.stopWhenClaimed && ticket.claimed_by) return false;
  if (ticket.ai_replies >= a.maxReplies) return false;
  if (a.mode === 'mention' && !syntheticText && !message.mentions?.has(client.user.id)) return false;
  if (a.mode === 'first' && ticket.ai_replies > 0) return false;
  if (busy.has(channel.id)) return false;

  busy.add(channel.id);
  try {
    const text = syntheticText || message.content || '';
    if (!text.trim()) return false;

    if (matchesKeyword(text, a.handoffKeywords)) {
      await handoff(client, channel, ticket, cfg, ctx.teamRoles(ticket), message.author?.toString());
      return true;
    }

    if (a.typing) await channel.sendTyping?.().catch(() => {});
    const history = syntheticText ? [{ role: 'user', content: syntheticText }] : await buildHistory(client, message);
    const answer = await ai.ask(client, message.guild.id, {
      system: buildSystemPrompt(cfg, message.guild, ticket),
      messages: history,
      temperature: a.temperature,
      maxTokens: a.maxTokens,
    });

    const body = answer.slice(0, 1800);
    const payload = { allowedMentions: { parse: [], repliedUser: false }, components: a.humanButton ? [humanButton()] : [] };
    if (a.asEmbed) {
      const e = new EmbedBuilder().setColor(hexToInt(a.color, hexToInt(client.ctx.settings.get(message.guild.id).general.embedColor)))
        .setAuthor({ name: a.persona || 'Assistant' }).setDescription(body);
      if (a.showDisclaimer && a.disclaimer) e.setFooter({ text: a.disclaimer.slice(0, 200) });
      payload.embeds = [e];
    } else {
      payload.content = `**${a.persona || 'Assistant'}** : ${body}${a.showDisclaimer && a.disclaimer ? `\n-# ${a.disclaimer}` : ''}`.slice(0, 2000);
    }

    let sent = null;
    if (!syntheticText) sent = await message.reply(payload).catch(() => null);
    if (!sent) sent = await safeSend(channel, payload);
    if (sent) client.ctx.db.prepare('UPDATE tickets SET ai_replies = ai_replies + 1 WHERE id = ?').run(ticket.id);
    return Boolean(sent);
  } catch (err) {
    if (['not_configured', 'auth', 'disabled'].includes(err.code)) {
      client.ctx.db.prepare('UPDATE tickets SET ai_paused = 1 WHERE id = ?').run(ticket.id);
      await safeSend(channel, { content: '⚠️ L’assistant IA n’est pas disponible pour le moment. Un membre de l’équipe va te répondre.' });
    }
    console.warn(`[tickets/ia] ${message.guild?.id}: ${err.message}`);
    return false;
  } finally {
    busy.delete(channel.id);
  }
}

module.exports = { maybeReply, matchesKeyword, buildSystemPrompt, handoff, humanButton };
