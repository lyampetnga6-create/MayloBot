'use strict';
const { EmbedBuilder, ChannelType, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const { safeText } = require('../../lib/template');
const { getSendable, safeSend } = require('../util');

const COLORS = { green: 0x34d399, red: 0xef4444, orange: 0xf97316, blue: 0x60a5fa, grey: 0x94a3b8, yellow: 0xfbbf24, violet: 0x8b5cf6 };

/** Catégorie de salon de logs pour chaque événement. */
const CATEGORY = {
  messageDelete: 'messages', messageEdit: 'messages', bulkDelete: 'messages', ghostPing: 'messages',
  memberJoin: 'members', memberLeave: 'members', memberUpdate: 'members', timeout: 'members',
  ban: 'moderation', kick: 'moderation',
  channels: 'server', channelUpdate: 'server', roles: 'server', roleUpdate: 'server', serverUpdate: 'server', invites: 'server', threads: 'server',
  voice: 'voice', commands: 'commands',
};

/** Renvoie { cfg, channel } si l'événement doit être journalisé, sinon null. */
function target(client, guild, event, channelId) {
  if (!guild) return null;
  const { logs } = client.ctx.settings.get(guild.id);
  if (!logs.enabled || !logs.events[event]) return null;
  if (channelId && logs.ignoredChannels.includes(channelId)) return null;
  const dest = logs.routes[CATEGORY[event]] || logs.channelId;
  if (!dest) return null;
  const channel = getSendable(guild, dest);
  return channel ? { cfg: logs, channel } : null;
}

const embed = (color, title) => new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
const clip = (s, n = 1000) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const userLine = (u) => `${u} (\`${u.id}\`)`;
const send = (t, e, extra = {}) => safeSend(t.channel, { embeds: [e], allowedMentions: { parse: [] }, ...extra });

/* ------------------------------ Messages ------------------------------ */
async function messageDelete(client, message) {
  if (!message.guild) return;
  const hadMentions = Boolean(message.mentions && (message.mentions.users?.size || message.mentions.roles?.size || message.mentions.everyone));
  const young = message.createdTimestamp && Date.now() - message.createdTimestamp < 120000;

  if (hadMentions && young && message.author && !message.author.bot) {
    const g = target(client, message.guild, 'ghostPing', message.channelId);
    if (g) {
      const mentioned = [...(message.mentions.users?.values() || [])].filter((u) => u.id !== message.author.id).map((u) => `<@${u.id}>`);
      const roles = [...(message.mentions.roles?.values() || [])].map((r) => `<@&${r.id}>`);
      if (mentioned.length || roles.length || message.mentions.everyone) {
        await send(g, embed(COLORS.red, '👻 Mention fantôme').addFields(
          { name: 'Auteur', value: userLine(message.author), inline: true },
          { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
          { name: 'Mentionnait', value: clip([...mentioned, ...roles, message.mentions.everyone ? '@everyone/@here' : ''].filter(Boolean).join(' ')) },
          { name: 'Contenu', value: clip(safeText(message.content || '—')) },
        ));
      }
    }
  }

  const t = target(client, message.guild, 'messageDelete', message.channelId);
  if (!t) return;
  if (message.author?.bot && t.cfg.ignoreBots) return;

  const e = embed(COLORS.red, 'Message supprimé').addFields({ name: 'Salon', value: `<#${message.channelId}>`, inline: true });
  if (message.author) e.addFields({ name: 'Auteur', value: userLine(message.author), inline: true });
  else e.setDescription('_Le message n’était pas en cache : auteur et contenu inconnus._');
  if (message.content) e.addFields({ name: 'Contenu', value: clip(safeText(message.content)) });
  if (message.attachments?.size) e.addFields({ name: 'Pièces jointes', value: clip([...message.attachments.values()].map((a) => a.url).join('\n')) });
  await send(t, e);
}

async function messageUpdate(client, before, after) {
  if (!after.guild || before.content === after.content) return;
  const t = target(client, after.guild, 'messageEdit', after.channelId);
  if (!t) return;
  if (after.author?.bot && t.cfg.ignoreBots) return;
  if (before.content == null) return; // message hors cache : rien à comparer

  const e = embed(COLORS.orange, 'Message modifié')
    .setDescription(`[Aller au message](${after.url})`)
    .addFields(
      { name: 'Auteur', value: after.author ? userLine(after.author) : 'Inconnu', inline: true },
      { name: 'Salon', value: `<#${after.channelId}>`, inline: true },
      { name: 'Avant', value: clip(safeText(before.content) || '—') },
      { name: 'Après', value: clip(safeText(after.content || '') || '—') },
    );
  await send(t, e);
}

async function bulkDelete(client, messages, channel) {
  const guild = channel.guild;
  const t = target(client, guild, 'bulkDelete', channel.id);
  if (!t) return;
  const lines = [...messages.values()].reverse().map((m) => `[${m.createdAt?.toISOString?.().slice(0, 19).replace('T', ' ') || '?'}] ${m.author?.username || 'inconnu'} : ${m.content || '(sans texte)'}`);
  const e = embed(COLORS.red, 'Suppression en masse').addFields(
    { name: 'Salon', value: `<#${channel.id}>`, inline: true },
    { name: 'Messages', value: String(messages.size), inline: true },
  );
  const files = lines.length ? [new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: 'messages-supprimes.txt' })] : [];
  await send(t, e, { files });
}

/* ------------------------------ Membres ------------------------------- */
async function memberJoin(client, member) {
  const t = target(client, member.guild, 'memberJoin');
  if (!t || (member.user.bot && t.cfg.ignoreBots)) return;
  const e = embed(COLORS.green, 'Membre arrivé')
    .setThumbnail(member.displayAvatarURL())
    .addFields(
      { name: 'Membre', value: userLine(member.user), inline: true },
      { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Membres', value: String(member.guild.memberCount), inline: true },
    );
  await send(t, e);
}

async function memberLeave(client, member) {
  const t = target(client, member.guild, 'memberLeave');
  if (!t || (member.user.bot && t.cfg.ignoreBots)) return;
  const e = embed(COLORS.red, 'Membre parti')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields({ name: 'Membre', value: userLine(member.user), inline: true });
  if (member.joinedTimestamp) e.addFields({ name: 'Arrivé', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
  const roles = member.roles?.cache?.filter((r) => r.id !== member.guild.id).map((r) => r.toString());
  if (roles?.length) e.addFields({ name: 'Rôles', value: clip(roles.join(' ')) });
  await send(t, e);
}

async function memberUpdate(client, before, after) {
  const guild = after.guild;
  const user = after.user;

  // Exclusion temporaire posée ou levée
  if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
    const t = target(client, guild, 'timeout');
    if (t && !(user.bot && t.cfg.ignoreBots)) {
      const until = after.communicationDisabledUntilTimestamp;
      const active = until && until > Date.now();
      await send(t, embed(active ? COLORS.orange : COLORS.green, active ? 'Membre exclu temporairement' : 'Fin d’exclusion temporaire')
        .setDescription(userLine(user)).addFields(...(active ? [{ name: 'Jusqu’au', value: `<t:${Math.floor(until / 1000)}:F> (<t:${Math.floor(until / 1000)}:R>)` }] : [])));
    }
  }

  const t = target(client, guild, 'memberUpdate');
  if (!t || (user.bot && t.cfg.ignoreBots)) return;
  const fields = [];
  if (before.nickname !== after.nickname) {
    fields.push({ name: 'Pseudo', value: `${before.nickname || '_aucun_'} → ${after.nickname || '_aucun_'}` });
  }
  if (before.roles && after.roles) {
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    if (added.size) fields.push({ name: 'Rôles ajoutés', value: clip(added.map((r) => r.toString()).join(' ')) });
    if (removed.size) fields.push({ name: 'Rôles retirés', value: clip(removed.map((r) => r.toString()).join(' ')) });
  }
  if (!fields.length) return;
  await send(t, embed(COLORS.blue, 'Membre modifié').setDescription(userLine(user)).addFields(fields));
}

async function ban(client, guildBan, banned) {
  const t = target(client, guildBan.guild, 'ban');
  if (!t) return;
  const e = embed(banned ? COLORS.red : COLORS.green, banned ? 'Membre banni' : 'Membre débanni')
    .addFields({ name: 'Membre', value: userLine(guildBan.user) });
  if (banned && guildBan.reason) e.addFields({ name: 'Raison', value: clip(safeText(guildBan.reason)) });
  await send(t, e);
}

/** Expulsion (détectée via le journal d'audit). */
async function kick(client, guild, entry) {
  const t = target(client, guild, 'kick');
  if (!t) return;
  const e = embed(COLORS.orange, 'Membre expulsé').addFields({ name: 'Membre', value: `<@${entry.targetId}> (\`${entry.targetId}\`)`, inline: true });
  if (entry.executorId) e.addFields({ name: 'Par', value: `<@${entry.executorId}>`, inline: true });
  if (entry.reason) e.addFields({ name: 'Raison', value: clip(safeText(entry.reason)) });
  await send(t, e);
}

/* ---------------------- Salons, rôles, serveur ------------------------ */
const KIND = {
  [ChannelType.GuildText]: 'Texte', [ChannelType.GuildVoice]: 'Vocal', [ChannelType.GuildCategory]: 'Catégorie',
  [ChannelType.GuildAnnouncement]: 'Annonces', [ChannelType.GuildForum]: 'Forum', [ChannelType.GuildStageVoice]: 'Conférence',
};

async function channelChange(client, channel, created) {
  if (!channel.guild) return;
  const t = target(client, channel.guild, 'channels');
  if (!t) return;
  const e = embed(created ? COLORS.green : COLORS.red, created ? 'Salon créé' : 'Salon supprimé')
    .addFields(
      { name: 'Nom', value: created ? `<#${channel.id}> (\`${channel.name}\`)` : `\`${channel.name}\``, inline: true },
      { name: 'Type', value: KIND[channel.type] || 'Autre', inline: true },
    );
  await send(t, e);
}

function channelDiff(a, b) {
  const out = [];
  if (a.name !== b.name) out.push({ name: 'Nom', value: `\`${a.name}\` → \`${b.name}\`` });
  if ((a.topic || '') !== (b.topic || '')) out.push({ name: 'Sujet', value: `${clip(safeText(a.topic || '_aucun_'), 400)} → ${clip(safeText(b.topic || '_aucun_'), 400)}` });
  if (a.nsfw !== undefined && a.nsfw !== b.nsfw) out.push({ name: 'NSFW', value: `${a.nsfw ? 'oui' : 'non'} → ${b.nsfw ? 'oui' : 'non'}` });
  if (a.rateLimitPerUser !== undefined && a.rateLimitPerUser !== b.rateLimitPerUser) out.push({ name: 'Mode lent', value: `${a.rateLimitPerUser}s → ${b.rateLimitPerUser}s` });
  if (a.parentId !== b.parentId) out.push({ name: 'Catégorie', value: `${a.parentId ? `<#${a.parentId}>` : '_aucune_'} → ${b.parentId ? `<#${b.parentId}>` : '_aucune_'}` });
  const ow = (c) => [...(c.permissionOverwrites?.cache?.values() || [])].map((o) => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`).sort().join('|');
  if (a.permissionOverwrites && ow(a) !== ow(b)) out.push({ name: 'Permissions', value: 'Les permissions du salon ont été modifiées.' });
  return out;
}

async function channelUpdate(client, before, after) {
  if (!after.guild) return;
  const t = target(client, after.guild, 'channelUpdate');
  if (!t) return;
  const diff = channelDiff(before, after);
  if (!diff.length) return;
  await send(t, embed(COLORS.blue, 'Salon modifié').setDescription(`<#${after.id}>`).addFields(diff));
}

async function roleChange(client, role, created) {
  const t = target(client, role.guild, 'roles');
  if (!t) return;
  const e = embed(created ? COLORS.green : COLORS.red, created ? 'Rôle créé' : 'Rôle supprimé')
    .addFields({ name: 'Rôle', value: created ? `${role} (\`${role.name}\`)` : `\`${role.name}\`` });
  await send(t, e);
}

async function roleUpdate(client, before, after) {
  const t = target(client, after.guild, 'roleUpdate');
  if (!t) return;
  const out = [];
  if (before.name !== after.name) out.push({ name: 'Nom', value: `\`${before.name}\` → \`${after.name}\`` });
  if (before.hexColor !== after.hexColor) out.push({ name: 'Couleur', value: `${before.hexColor} → ${after.hexColor}` });
  if (before.hoist !== after.hoist) out.push({ name: 'Affiché séparément', value: `${before.hoist ? 'oui' : 'non'} → ${after.hoist ? 'oui' : 'non'}` });
  if (before.mentionable !== after.mentionable) out.push({ name: 'Mentionnable', value: `${before.mentionable ? 'oui' : 'non'} → ${after.mentionable ? 'oui' : 'non'}` });
  if (before.permissions.bitfield !== after.permissions.bitfield) {
    const added = new PermissionsBitField(after.permissions.bitfield & ~before.permissions.bitfield).toArray();
    const removed = new PermissionsBitField(before.permissions.bitfield & ~after.permissions.bitfield).toArray();
    if (added.length) out.push({ name: 'Permissions ajoutées', value: clip(added.join(', ')) });
    if (removed.length) out.push({ name: 'Permissions retirées', value: clip(removed.join(', ')) });
  }
  if (!out.length) return;
  await send(t, embed(COLORS.blue, 'Rôle modifié').setDescription(`${after}`).addFields(out));
}

async function guildUpdate(client, before, after) {
  const t = target(client, after, 'serverUpdate');
  if (!t) return;
  const out = [];
  if (before.name !== after.name) out.push({ name: 'Nom', value: `${before.name} → ${after.name}` });
  if (before.icon !== after.icon) out.push({ name: 'Icône', value: 'L’icône du serveur a changé.' });
  if (before.banner !== after.banner) out.push({ name: 'Bannière', value: 'La bannière du serveur a changé.' });
  if (before.description !== after.description) out.push({ name: 'Description', value: `${clip(before.description || '_aucune_', 400)} → ${clip(after.description || '_aucune_', 400)}` });
  if (before.vanityURLCode !== after.vanityURLCode) out.push({ name: 'URL personnalisée', value: `${before.vanityURLCode || '_aucune_'} → ${after.vanityURLCode || '_aucune_'}` });
  if (before.verificationLevel !== after.verificationLevel) out.push({ name: 'Niveau de vérification', value: `${before.verificationLevel} → ${after.verificationLevel}` });
  if (before.premiumTier !== after.premiumTier) out.push({ name: 'Niveau de boost', value: `${before.premiumTier} → ${after.premiumTier}` });
  if (!out.length) return;
  await send(t, embed(COLORS.violet, 'Serveur modifié').addFields(out));
}

async function inviteChange(client, invite, created) {
  if (!invite.guild) return;
  const guild = client.guilds.cache.get(invite.guild.id);
  const t = target(client, guild, 'invites');
  if (!t) return;
  const e = embed(created ? COLORS.green : COLORS.grey, created ? 'Invitation créée' : 'Invitation supprimée')
    .addFields({ name: 'Code', value: `\`${invite.code}\``, inline: true }, { name: 'Salon', value: invite.channel ? `<#${invite.channel.id}>` : '—', inline: true });
  if (created && invite.inviter) e.addFields({ name: 'Par', value: userLine(invite.inviter), inline: true });
  if (created) e.addFields({ name: 'Utilisations max', value: invite.maxUses ? String(invite.maxUses) : '∞', inline: true });
  await send(t, e);
}

async function threadChange(client, thread, created) {
  if (!thread.guild) return;
  const t = target(client, thread.guild, 'threads', thread.parentId);
  if (!t) return;
  await send(t, embed(created ? COLORS.green : COLORS.red, created ? 'Fil créé' : 'Fil supprimé')
    .addFields({ name: 'Nom', value: created ? `<#${thread.id}> (\`${thread.name}\`)` : `\`${thread.name}\``, inline: true }, { name: 'Salon parent', value: thread.parentId ? `<#${thread.parentId}>` : '—', inline: true }));
}

/* ------------------------------ Vocal ------------------------------- */
async function voiceState(client, before, after) {
  const guild = after.guild || before.guild;
  const t = target(client, guild, 'voice');
  if (!t) return;
  const member = after.member || before.member;
  if (!member || (member.user.bot && t.cfg.ignoreBots)) return;

  let text = null;
  if (!before.channelId && after.channelId) text = `a rejoint <#${after.channelId}>`;
  else if (before.channelId && !after.channelId) text = `a quitté <#${before.channelId}>`;
  else if (before.channelId !== after.channelId) text = `est passé de <#${before.channelId}> à <#${after.channelId}>`;
  if (!text) return;
  await send(t, embed(COLORS.grey, 'Activité vocale').setDescription(`${member} ${text}`));
}

/* ----------------------------- Commandes ---------------------------- */
async function command(client, interaction) {
  if (!interaction.guild) return;
  const t = target(client, interaction.guild, 'commands', interaction.channelId);
  if (!t) return;
  const opts = interaction.options?.data?.map((o) => `${o.name}: ${o.value ?? '…'}`).join(' ') || '';
  await send(t, embed(COLORS.grey, 'Commande utilisée').addFields(
    { name: 'Membre', value: userLine(interaction.user), inline: true },
    { name: 'Salon', value: `<#${interaction.channelId}>`, inline: true },
    { name: 'Commande', value: clip(`/${interaction.commandName} ${safeText(opts)}`.trim(), 500) },
  ));
}

module.exports = {
  messageDelete, messageUpdate, bulkDelete, memberJoin, memberLeave, memberUpdate, ban, kick,
  channelChange, channelUpdate, roleChange, roleUpdate, guildUpdate, inviteChange, threadChange, voiceState, command,
  CATEGORY, target,
};
