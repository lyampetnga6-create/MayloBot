'use strict';
const { ChannelType, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { buildMessage, render, safeText } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');
const mod = require('./moderation');
const protection = require('./protection');

/** Un message dans un salon piège = sanction immédiate. Renvoie true si le message a été traité. */
async function handleMessage(client, message) {
  const { guild } = message;
  if (!guild || message.system) return false;
  const cfg = client.ctx.settings.module(guild.id, 'honeypot');
  if (!cfg.enabled || !cfg.channelIds.includes(message.channelId)) return false;
  if (message.author.id === client.user.id) return false;
  if (message.author.bot && cfg.ignoreBots) return false;

  const member = message.member || await guild.members.fetch(message.author.id).catch(() => null);
  if (member) {
    if (member.id === guild.ownerId) return false;
    if (cfg.ignoreModerators && (member.permissions.has(P.ManageMessages) || member.permissions.has(P.Administrator))) return false;
    if (member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id))) return false;
  }

  const user = message.author;
  const reason = `Honeypot : message envoyé dans le salon piège #${message.channel.name}`;
  if (message.deletable) await message.delete().catch(() => {});

  if (cfg.dm) {
    await user.send({ content: render(cfg.dmMessage, { server: guild.name, 'user.name': user.username }).slice(0, 1900) }).catch(() => {});
  }

  let result = 'sanction appliquée';
  try {
    switch (cfg.action) {
      case 'ban':
        await guild.members.ban(user.id, { reason, deleteMessageSeconds: Number(cfg.deleteHistory) || 0 });
        break;
      case 'softban':
        await guild.members.ban(user.id, { reason, deleteMessageSeconds: Number(cfg.deleteHistory) || 86400 });
        await guild.members.unban(user.id, 'Honeypot (softban)').catch(() => {});
        break;
      case 'kick':
        if (!member) throw new Error('membre absent');
        await member.kick(reason);
        break;
      case 'timeout':
        if (!member) throw new Error('membre absent');
        await member.timeout(Math.min(cfg.timeoutMinutes, 40320) * 60000, reason);
        break;
      case 'quarantine':
        if (!member) throw new Error('membre absent');
        await protection.quarantine(client, guild, member, reason);
        break;
      default:
        break;
    }
  } catch (err) {
    result = `échec : ${err.message}`;
  }

  if (cfg.recordCase) {
    const type = { ban: 'ban', softban: 'ban', kick: 'kick', timeout: 'timeout', quarantine: 'timeout' }[cfg.action] || 'warn';
    mod.createCase(client.ctx.db, {
      guildId: guild.id, userId: user.id, modId: client.user.id, type, reason, duration: cfg.action === 'timeout' ? cfg.timeoutMinutes : null,
    });
  }

  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('🍯 Honeypot déclenché').setTimestamp().addFields(
    { name: 'Membre', value: `${user} (\`${user.id}\`)`, inline: true },
    { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
    { name: 'Sanction', value: `${cfg.action} — ${result}`, inline: true },
  );
  if (message.content) embed.addFields({ name: 'Message', value: safeText(message.content).slice(0, 900) });
  const s = client.ctx.settings.get(guild.id);
  const target = cfg.logChannelId || s.moderation.modLogChannelId || (s.logs.enabled && s.logs.channelId) || '';
  await safeSend(getSendable(guild, target), { embeds: [embed], allowedMentions: { parse: [] } });
  return true;
}

/** Message d'avertissement affiché dans le salon piège. */
async function publishWarning(client, guild, channelId) {
  const s = client.ctx.settings.get(guild.id);
  const channel = getSendable(guild, channelId);
  if (!channel) throw new Error('Salon introuvable ou inaccessible (vérifie mes permissions).');
  const payload = buildMessage(s.honeypot.warning, { server: guild.name, 'server.icon': guild.iconURL() || '' }, s.general)
    || { content: '⛔ **NE PAS ÉCRIRE ICI** : tout message dans ce salon entraîne une sanction immédiate.' };
  const sent = await channel.send(payload);
  await sent.pin().catch(() => {});
  return sent;
}

/** Crée un salon piège prêt à l'emploi et l'ajoute à la liste. */
async function createTrapChannel(client, guild) {
  const channel = await guild.channels.create({
    name: 'ne-pas-écrire-ici',
    type: ChannelType.GuildText,
    topic: '⛔ Salon piège anti-spam : tout message ici entraîne une sanction immédiate.',
    reason: 'Honeypot créé depuis le dashboard',
  }).catch((err) => { throw new Error(`Création impossible : ${err.message}`); });
  client.ctx.settings.patchModule(guild.id, 'honeypot', (c) => {
    if (!c.channelIds.includes(channel.id)) c.channelIds.push(channel.id);
  });
  await publishWarning(client, guild, channel.id).catch(() => {});
  return channel;
}

module.exports = { handleMessage, publishWarning, createTrapChannel };
