'use strict';
/**
 * Rôles réaction : un membre ajoute un émoji sous un message et reçoit le rôle correspondant ;
 * en retirant l'émoji, il le perd (selon le mode). Le bot publie son propre message ou ajoute les émojis sous un message existant.
 */
const { buildMessage } = require('../../lib/template');
const { getSendable } = require('../util');

const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'reactionroles');
const stripVariation = (s) => String(s || '').replace(/️/g, '').trim();

/**
 * Comprend l'émoji écrit dans le dashboard : émoji normal, `<:nom:id>` / `<a:nom:id>`, ou `:nom:` (émoji du serveur).
 * Renvoie { key, react, display } ou null. `key` sert à reconnaître la réaction, `react` à l'ajouter, `display` à l'afficher dans un message.
 */
function resolveEmoji(guild, text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const custom = raw.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { key: custom[3], react: `${custom[2]}:${custom[3]}`, display: raw };
  const named = raw.match(/^:(\w{2,32}):$/);
  if (named) {
    const list = [...(guild?.emojis?.cache?.values?.() || [])];
    const e = list.find((x) => x.name === named[1]) || list.find((x) => String(x.name).toLowerCase() === named[1].toLowerCase());
    return e ? { key: e.id, react: `${e.name}:${e.id}`, display: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` } : null;
  }
  // émoji normal : doit contenir au moins un caractère non alphanumérique (pas du texte simple)
  if (/^[\p{L}\p{N}_ -]+$/u.test(raw) || raw.length > 20) return null;
  const clean = stripVariation(raw);
  return clean ? { key: clean, react: raw, display: raw } : null;
}
/** Clé d'une réaction reçue (même forme que `resolveEmoji().key`). */
const reactionKey = (emoji) => emoji.id || stripVariation(emoji.name);

/** Les lignes « émoji → rôle » d'un panneau, avec leurs émojis résolus. Lève une erreur claire si un émoji ou un rôle est invalide. */
function entriesOf(guild, panel, { strict = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of panel.roles || []) {
    const em = resolveEmoji(guild, r.emoji);
    if (!em) {
      if (strict) throw new Error(`Émoji introuvable : « ${r.emoji} ». Utilise un émoji normal, ou le nom d’un émoji du serveur entre deux-points (ex. :diamant:).`);
      continue;
    }
    if (seen.has(em.key)) {
      if (strict) throw new Error(`L’émoji ${em.display} est utilisé deux fois dans ce message.`);
      continue;
    }
    seen.add(em.key);
    out.push({ ...em, roleId: r.roleId });
  }
  return out;
}

function payloadOf(client, guild, panel, entries) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const roles = entries.map((e) => `${e.display} → <@&${e.roleId}>`).join('\n');
  return buildMessage(panel.message, { server: guild.name, 'server.icon': guild.iconURL?.() || '', roles }, general)
    || { content: `Réagis pour obtenir ton rôle :\n${roles}` };
}

/** Publie (ou met à jour) un message à réactions, puis ajoute les émojis dessous. Les réglages doivent déjà être enregistrés. */
async function publish(client, guild, panelId) {
  const panel = cfgOf(client, guild.id).panels.find((p) => p.id === panelId);
  if (!panel) throw new Error('Message introuvable : enregistre d’abord tes modifications.');
  if (!panel.roles.length) throw new Error('Ajoute au moins un émoji avant de publier.');
  const entries = entriesOf(guild, panel, { strict: true });
  for (const e of entries) {
    const role = guild.roles.cache.get(e.roleId);
    if (!role) throw new Error(`Le rôle de l’émoji ${e.display} n’existe plus.`);
    if (!role.editable) throw new Error(`Je ne peux pas donner le rôle « ${role.name} » : mets le rôle du bot au-dessus dans la liste des rôles du serveur.`);
  }
  const existingId = String(panel.existingMessageId || '').trim();
  if (existingId && !/^\d{17,20}$/.test(existingId)) throw new Error('L’identifiant du message doit être un nombre (clic droit sur le message, « Copier l’identifiant du message »).');

  let message = null;
  if (existingId) {
    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) throw new Error('Choisis le salon où se trouve ce message.');
    message = await channel.messages.fetch(existingId).catch(() => null);
    if (!message) throw new Error('Message introuvable dans ce salon : vérifie le salon et l’identifiant.');
  } else {
    const channel = getSendable(guild, panel.channelId);
    if (!channel) throw new Error('Choisis un salon de publication où je peux écrire.');
    const payload = payloadOf(client, guild, panel, entries);
    if (panel.messageId) {
      const old = await channel.messages.fetch(panel.messageId).catch(() => null);
      if (old && old.author?.id === client.user.id) message = await old.edit({ content: payload.content ?? null, embeds: payload.embeds ?? [] }).catch(() => null);
    }
    if (!message) message = await channel.send({ content: payload.content, embeds: payload.embeds, allowedMentions: { parse: [] } });
  }

  // on retire les anciens émojis du bot qui ne sont plus dans la liste, puis on ajoute les nouveaux
  const wanted = new Set(entries.map((e) => e.key));
  for (const r of [...(message.reactions?.cache?.values?.() || [])]) {
    if (!wanted.has(reactionKey(r.emoji)) && r.me) await r.users.remove(client.user.id).catch(() => {});
  }
  for (const e of entries) {
    try { await message.react(e.react); } catch (err) { throw new Error(`Impossible d’ajouter l’émoji ${e.display} (${err.message}). Vérifie la permission « Ajouter des réactions ».`); }
  }

  client.ctx.settings.patchModule(guild.id, 'reactionroles', (mod) => {
    const p = mod.panels.find((x) => x.id === panelId);
    if (p) p.messageId = message.id;
  });
  return message;
}

/** Réaction ajoutée (`added` = true) ou retirée (false) par un membre. */
async function onReaction(client, reaction, user, added) {
  if (!user || user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message?.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const guild = message?.guild;
  if (!guild) return;
  const panels = cfgOf(client, guild.id).panels.filter((p) => p.messageId === message.id && p.channelId === message.channelId);
  if (!panels.length) return;
  const key = reactionKey(reaction.emoji);

  for (const panel of panels) {
    const entries = entriesOf(guild, panel);
    const entry = entries.find((e) => e.key === key);
    if (!entry) continue;
    const role = guild.roles.cache.get(entry.roleId);
    if (!role || !role.editable) continue; // rôle supprimé ou au-dessus du bot : rien à faire
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) continue;
    try {
      if (added) {
        if (panel.mode === 'unique') {
          const others = entries.filter((e) => e.key !== key);
          const held = others.map((e) => e.roleId).filter((id) => member.roles.cache.has(id) && guild.roles.cache.get(id)?.editable);
          if (held.length) await member.roles.remove(held, 'Rôles réaction (exclusif)');
          for (const o of others) await message.reactions?.resolve?.(o.key)?.users?.remove?.(user.id)?.catch?.(() => {});
        }
        if (!member.roles.cache.has(entry.roleId)) await member.roles.add(entry.roleId, 'Rôles réaction');
      } else if (panel.mode !== 'add' && member.roles.cache.has(entry.roleId)) {
        await member.roles.remove(entry.roleId, 'Rôles réaction');
      }
    } catch (err) {
      console.warn(`[rôles réaction] ${guild.id}: ${err.message}`);
    }
  }
}

module.exports = { publish, onReaction, resolveEmoji, reactionKey, entriesOf };
