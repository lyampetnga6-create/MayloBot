'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildMessage } = require('../../lib/template');
const { EPHEMERAL, getSendable, parseEmoji } = require('../util');

function panelPayload(client, guild, panel) {
  const s = client.ctx.settings.get(guild.id);
  const payload = buildMessage(panel.message, { server: guild.name, 'server.icon': guild.iconURL() || '' }, s.general)
    || { content: 'Choisis tes rôles :' };

  const rows = [];
  panel.roles.slice(0, 25).forEach((r, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder());
    const role = guild.roles.cache.get(r.roleId);
    const b = new ButtonBuilder()
      .setCustomId(`rp:${panel.id}:${r.roleId}`)
      .setStyle(ButtonStyle[r.style] || ButtonStyle.Secondary)
      .setLabel((r.label || role?.name || 'Rôle').slice(0, 80));
    const em = parseEmoji(r.emoji);
    if (em) {
      try { b.setEmoji(em); } catch { /* émoji invalide */ }
    }
    rows[rows.length - 1].addComponents(b);
  });
  payload.components = rows;
  return payload;
}

/** Publie (ou met à jour) le message d'un panneau. Les réglages doivent déjà être enregistrés. */
async function publish(client, guild, panelId) {
  const panel = client.ctx.settings.get(guild.id).rolepanels.panels.find((p) => p.id === panelId);
  if (!panel) throw new Error('Panneau introuvable : enregistre d’abord tes modifications.');
  if (!panel.roles.length) throw new Error('Ajoute au moins un bouton avant de publier.');
  const channel = getSendable(guild, panel.channelId);
  if (!channel) throw new Error('Choisis un salon de publication où je peux écrire.');

  const payload = panelPayload(client, guild, panel);
  let message = null;
  if (panel.messageId) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing && existing.author.id === client.user.id) {
      message = await existing.edit({ content: payload.content ?? null, embeds: payload.embeds ?? [], components: payload.components }).catch(() => null);
    }
  }
  if (!message) message = await channel.send(payload);

  client.ctx.settings.patchModule(guild.id, 'rolepanels', (mod) => {
    const p = mod.panels.find((x) => x.id === panelId);
    if (p) p.messageId = message.id;
  });
  return message;
}

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('rp:')) return false;
  if (!interaction.isButton() || !interaction.guild) return true;

  const [, panelId, roleId] = id.split(':');
  const { guild } = interaction;
  const panel = client.ctx.settings.get(guild.id).rolepanels.panels.find((p) => p.id === panelId);
  if (!panel || !panel.roles.some((r) => r.roleId === roleId)) {
    await interaction.reply({ content: 'Ce panneau n’existe plus.', flags: EPHEMERAL });
    return true;
  }
  const role = guild.roles.cache.get(roleId);
  if (!role || !role.editable) {
    await interaction.reply({ content: 'Je ne peux pas gérer ce rôle (mon rôle est trop bas ou le rôle a été supprimé).', flags: EPHEMERAL });
    return true;
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const member = interaction.member;
  const has = member.roles.cache.has(roleId);

  try {
    if (panel.mode === 'unique') {
      if (has) {
        await member.roles.remove(roleId, 'Panneau de rôles');
        await interaction.editReply(`Rôle **${role.name}** retiré.`);
      } else {
        const others = panel.roles.map((r) => r.roleId).filter((r) => r !== roleId && member.roles.cache.has(r) && guild.roles.cache.get(r)?.editable);
        if (others.length) await member.roles.remove(others, 'Panneau de rôles (exclusif)');
        await member.roles.add(roleId, 'Panneau de rôles');
        await interaction.editReply(`Tu as maintenant le rôle **${role.name}**.`);
      }
    } else if (has) {
      await member.roles.remove(roleId, 'Panneau de rôles');
      await interaction.editReply(`Rôle **${role.name}** retiré.`);
    } else {
      await member.roles.add(roleId, 'Panneau de rôles');
      await interaction.editReply(`Tu as maintenant le rôle **${role.name}**.`);
    }
  } catch (err) {
    await interaction.editReply(`Impossible de modifier tes rôles : ${err.message}`);
  }
  return true;
}

module.exports = { publish, handleInteraction, panelPayload };
