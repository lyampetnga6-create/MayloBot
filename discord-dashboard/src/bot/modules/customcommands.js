'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { render, memberVars, brandedEmbed } = require('../../lib/template');
const { safeSend } = require('../util');

const cooldowns = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, until] of cooldowns) if (until < now) cooldowns.delete(k);
}, 300000).unref();

function matches(rule, content) {
  const text = content.trim().toLowerCase();
  const trigger = rule.trigger.trim().toLowerCase();
  if (!trigger) return false;
  switch (rule.match) {
    case 'exact': return text === trigger;
    case 'startsWith': return text.startsWith(trigger);
    default: return text.includes(trigger);
  }
}

async function respond(message, text, { asEmbed = false, reply = true, general }) {
  const body = render(text, memberVars(message.member, { channel: `<#${message.channelId}>` }));
  if (!body.trim()) return;
  const payload = asEmbed
    ? { embeds: [brandedEmbed(general).setDescription(body.slice(0, 4096))] }
    : { content: body.slice(0, 2000) };
  payload.allowedMentions = { parse: ['users', 'roles'], repliedUser: false };
  if (reply) {
    try {
      await message.reply(payload);
      return;
    } catch { /* message d'origine supprimé : on envoie normalement */ }
  }
  await safeSend(message.channel, payload);
}

/** Renvoie true si le message a déclenché une commande ou une réponse automatique. */
async function handleMessage(client, message) {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot || !message.content) return false;
  const settings = client.ctx.settings.get(guild.id);
  const cfg = settings.commands;
  if (!cfg.enabled) return false;

  /* --- Commandes à préfixe --- */
  if (cfg.prefix && message.content.startsWith(cfg.prefix)) {
    const name = message.content.slice(cfg.prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
    const cmd = name && cfg.commands.find((c) => c.name === name);
    if (cmd) {
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (cmd.allowedRoles.length && !isAdmin && !member.roles.cache.some((r) => cmd.allowedRoles.includes(r.id))) return true;
      await respond(message, cmd.response, { asEmbed: cmd.asEmbed, reply: cmd.reply, general: settings.general });
      if (cmd.deleteInvocation && message.deletable) await message.delete().catch(() => {});
      return true;
    }
  }

  /* --- Réponses automatiques --- */
  for (const rule of cfg.autoresponders) {
    if (!matches(rule, message.content)) continue;
    const key = `${guild.id}:${rule.trigger.toLowerCase()}`;
    if ((cooldowns.get(key) || 0) > Date.now()) continue;
    if (rule.cooldown > 0) cooldowns.set(key, Date.now() + rule.cooldown * 1000);
    await respond(message, rule.response, { reply: rule.reply, general: settings.general });
    return true;
  }
  return false;
}

module.exports = { handleMessage, matches };
