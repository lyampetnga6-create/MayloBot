'use strict';
const { ChannelType, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

function channelKind(type) {
  switch (type) {
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return 'text';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice:
      return 'voice';
    case ChannelType.GuildCategory:
      return 'category';
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia:
      return 'forum';
    default:
      return 'other';
  }
}

/** Salons et rôles d'un serveur, triés, pour les sélecteurs du dashboard. */
function guildMeta(guild) {
  const channels = [...guild.channels.cache.values()]
    .map((c) => ({ id: c.id, name: c.name, kind: channelKind(c.type), parentId: c.parentId || null, position: c.rawPosition ?? 0 }))
    .filter((c) => c.kind !== 'other')
    .sort((a, b) => a.position - b.position);

  const everyoneId = guild.id;
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== everyoneId)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '' : r.hexColor, position: r.position, managed: r.managed, editable: r.editable }))
    .sort((a, b) => b.position - a.position);

  return { channels, roles };
}

/** Contexte de validation du schéma : seuls les salons / rôles existants sont acceptés. */
function schemaCtx(guild) {
  const meta = guildMeta(guild);
  return {
    channels: new Map(meta.channels.map((c) => [c.id, c])),
    roles: new Map(meta.roles.filter((r) => !r.managed).map((r) => [r.id, r])),
  };
}

/** Permissions demandées à l'invitation du bot. */
const BOT_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.CreateInstantInvite,
]).bitfield.toString();

function inviteUrl(clientId, guildId) {
  const p = new URLSearchParams({ client_id: clientId, permissions: BOT_PERMISSIONS, scope: 'bot applications.commands' });
  if (guildId) {
    p.set('guild_id', guildId);
    p.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${p}`;
}

module.exports = { channelKind, guildMeta, schemaCtx, inviteUrl, BOT_PERMISSIONS };
