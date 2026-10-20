'use strict';
/**
 * Outils pour une communauté Rocket League : recherche de joueurs (/lfg avec boutons et expiration),
 * équipes aléatoires, identifiants de match privé, mode et défi au hasard.
 * Les outils sans état (équipes, match, défi) sont dans lib/rocketleague.js.
 */
const rl = require('../../lib/rocketleague');
const { hexToInt } = require('../../lib/template');
const { EPHEMERAL, getSendable } = require('../util');

const PREFIX = 'lfg:';
const MAX_ACTIVE_PER_GUILD = 200;
const cooldown = new Map(); // `${guildId}:${userId}` -> horodatage de la dernière annonce

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'rocketleague');
const key = (guildId, messageId) => `${PREFIX}${guildId}:${messageId}`;
const save = (client, guildId, messageId, post) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key(guildId, messageId), JSON.stringify(post));
const drop = (client, guildId, messageId) => db(client).prepare('DELETE FROM kv WHERE key = ?').run(key(guildId, messageId));
const read = (client, guildId, messageId) => {
  try { return JSON.parse(db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key(guildId, messageId))?.value || 'null'); } catch { return null; }
};
function listPosts(client, guildId) {
  return db(client).prepare('SELECT key, value FROM kv WHERE key LIKE ?').all(`${PREFIX}${guildId ? `${guildId}:` : ''}%`).map((r) => {
    try {
      const [, gid, mid] = r.key.split(':');
      return { guildId: gid, messageId: mid, post: JSON.parse(r.value) };
    } catch { return null; }
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Recherche de joueurs                                                 */
/* ------------------------------------------------------------------ */
const button = (id, label, style, emoji, disabled = false) => ({ type: 2, style, custom_id: `${PREFIX}${id}`, label, emoji: { name: emoji }, ...(disabled ? { disabled: true } : {}) });

/** Rôle le plus haut du membre parmi une liste de rôles (rang, plateforme…), ou ''. */
function bestRole(member, ids) {
  const roles = (ids || []).map((id) => member?.roles?.cache?.get(id)).filter(Boolean);
  roles.sort((a, b) => (b.position || 0) - (a.position || 0));
  return roles[0]?.name || '';
}

function lfgPayload(client, guild, post, now = Date.now()) {
  const color = hexToInt(client.ctx.settings.module(guild.id, 'general').embedColor);
  const left = Math.max(0, post.places - post.joined.length);
  const state = post.closed ? 'closed' : left === 0 ? 'full' : 'open';
  const players = [`<@${post.owner}>`, ...post.joined.map((id) => `<@${id}>`)];
  const fields = [
    { name: 'Mode', value: post.modeLabel, inline: true },
    { name: 'Places', value: state === 'full' ? 'Complet' : `${left} restante${left > 1 ? 's' : ''} sur ${post.places}`, inline: true },
    { name: post.closed ? 'Fin' : 'Expire', value: `<t:${Math.floor((post.closed ? post.closedAt || now : post.expiresAt) / 1000)}:R>`, inline: true },
  ];
  if (post.rank) fields.push({ name: 'Rang', value: post.rank, inline: true });
  if (post.platform) fields.push({ name: 'Plateforme', value: post.platform, inline: true });
  if (post.voiceId) fields.push({ name: 'Vocal', value: `<#${post.voiceId}>`, inline: true });
  if (post.note) fields.push({ name: 'Note', value: post.note });
  fields.push({ name: 'Joueurs', value: players.join('\n') });

  const title = { open: 'Recherche de joueurs', full: 'Groupe complet', closed: 'Recherche terminée' }[state];
  return {
    embeds: [{ title, color: state === 'closed' ? 0x4b5563 : state === 'full' ? 0x22c55e : color || undefined, fields }],
    components: state === 'closed' ? [] : [{
      type: 1,
      components: [
        button('join', 'Je rejoins', 3, '🎮', state === 'full'),
        button('leave', 'Quitter', 2, '↩️'),
        button('close', 'Fermer', 4, '✖️'),
      ],
    }],
  };
}

async function updateMessage(client, guild, post, messageId, extra = {}) {
  const channel = guild.channels.cache.get(post.channelId);
  if (!channel) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return null;
  await message.edit({ ...lfgPayload(client, guild, post), ...extra }).catch(() => {});
  return message;
}

async function closePost(client, guild, messageId, post, now = Date.now()) {
  post.closed = true;
  post.closedAt = now;
  await updateMessage(client, guild, post, messageId, { content: '' });
  drop(client, guild.id, messageId);
}

/**
 * Publie une recherche de joueurs.
 * @returns {Promise<{url: string, messageId: string}>}
 */
async function createLfg(client, guild, member, { mode, note = '', places, fallbackChannel = null, now = Date.now() }) {
  const cfg = cfgOf(client, guild.id);
  const m = rl.modeById(mode);
  if (!m) throw new Error('Mode inconnu.');
  const channel = getSendable(guild, cfg.lfgChannelId) || (fallbackChannel && getSendable(guild, fallbackChannel.id));
  if (!channel) throw new Error('Je ne peux pas écrire dans le salon de recherche de joueurs : choisis-le dans le dashboard (module « Outils Rocket League »).');

  const ck = `${guild.id}:${member.id}`;
  const wait = Math.ceil((((cooldown.get(ck) || 0) + cfg.lfgCooldown * 1000) - now) / 1000);
  if (wait > 0) throw new Error(`Patiente encore ${wait} seconde(s) avant de publier une nouvelle recherche.`);

  const all = listPosts(client, guild.id);
  if (all.length >= MAX_ACTIVE_PER_GUILD) throw new Error('Trop de recherches en cours sur ce serveur. Réessaie dans quelques minutes.');
  // Une seule recherche active par joueur : la précédente est fermée
  for (const old of all.filter((p) => p.post.owner === member.id)) await closePost(client, guild, old.messageId, old.post, now);

  const slots = Math.max(1, Math.min(7, Math.trunc(Number(places)) || m.lookFor));
  const post = {
    owner: member.id,
    mode: m.id,
    modeLabel: m.label,
    places: slots,
    joined: [],
    note: String(note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100),
    rank: bestRole(member, cfg.rankRoleIds),
    platform: bestRole(member, cfg.platformRoleIds),
    voiceId: member.voice?.channelId || '',
    expiresAt: now + cfg.lfgExpireMinutes * 60000,
    channelId: channel.id,
    closed: false,
  };
  const ping = cfg.lfgPingRoleId ? `<@&${cfg.lfgPingRoleId}> ` : '';
  const sent = await channel.send({
    content: `${ping}<@${member.id}> cherche ${slots} joueur${slots > 1 ? 's' : ''} pour du **${m.label}**`,
    ...lfgPayload(client, guild, post, now),
    allowedMentions: { users: [member.id], roles: cfg.lfgPingRoleId ? [cfg.lfgPingRoleId] : [] },
  });
  if (!sent?.id) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  save(client, guild.id, sent.id, post);
  if (cooldown.size > 2000) for (const [k, at] of cooldown) if (now - at > 3600000) cooldown.delete(k);
  cooldown.set(ck, now);
  return { url: sent.url, messageId: sent.id };
}

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith(PREFIX) || !interaction.isButton?.() || !interaction.guild) return false;
  const action = id.slice(PREFIX.length);
  const guild = interaction.guild;
  const messageId = interaction.message?.id;
  const post = messageId ? read(client, guild.id, messageId) : null;
  const say = (content) => interaction.reply({ content, flags: EPHEMERAL });
  if (!post || post.closed) {
    await say('Cette recherche est terminée.');
    return true;
  }
  const userId = interaction.user.id;
  const isOwner = userId === post.owner;

  if (action === 'close') {
    if (!isOwner && !interaction.memberPermissions?.has('ManageMessages')) { await say('Seul l’auteur de la recherche peut la fermer.'); return true; }
    await closePost(client, guild, messageId, post);
    await interaction.deferUpdate?.().catch(() => {});
    return true;
  }
  if (post.expiresAt <= Date.now()) {
    await closePost(client, guild, messageId, post);
    await say('Cette recherche a expiré.');
    return true;
  }
  if (action === 'join') {
    if (isOwner) { await say('C’est ta propre recherche : les autres joueurs vont te rejoindre.'); return true; }
    if (post.joined.includes(userId)) { await say('Tu as déjà rejoint ce groupe.'); return true; }
    if (post.joined.length >= post.places) { await say('Ce groupe est déjà complet.'); return true; }
    post.joined.push(userId);
    save(client, guild.id, messageId, post);
    await interaction.update(lfgPayload(client, guild, post));
    if (post.joined.length >= post.places) {
      const team = [post.owner, ...post.joined].map((i) => `<@${i}>`).join(' ');
      await interaction.channel?.send({ content: `✅ Groupe complet : ${team}. Bonne partie !`, allowedMentions: { users: [post.owner, ...post.joined] } }).catch(() => {});
    } else {
      await interaction.channel?.send({ content: `<@${post.owner}> : <@${userId}> a rejoint ton groupe.`, allowedMentions: { users: [post.owner] } }).catch(() => {});
    }
    return true;
  }
  if (action === 'leave') {
    if (isOwner) { await say('Utilise « Fermer » pour annuler ta recherche.'); return true; }
    if (!post.joined.includes(userId)) { await say('Tu n’es pas dans ce groupe.'); return true; }
    post.joined = post.joined.filter((i) => i !== userId);
    save(client, guild.id, messageId, post);
    await interaction.update(lfgPayload(client, guild, post));
    return true;
  }
  await say('Action inconnue.');
  return true;
}

/** Ferme les recherches expirées (message grisé, boutons retirés). */
async function tickLfg(client, now = Date.now()) {
  for (const { guildId, messageId, post } of listPosts(client)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) { drop(client, guildId, messageId); continue; }
    if (post.closed || post.expiresAt <= now) await closePost(client, guild, messageId, post, now);
  }
}

module.exports = { cooldown, createLfg, handleInteraction, tickLfg, lfgPayload, listPosts, bestRole, MAX_ACTIVE_PER_GUILD };
