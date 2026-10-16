'use strict';
const { buildMessage, memberVars } = require('../../lib/template');
const { levelFromXp } = require('../../lib/levels');
const { getSendable, safeSend } = require('../util');

/** Dernier gain d'XP par membre (anti-farm). */
const lastGain = new Map();

setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [k, t] of lastGain) if (t < cutoff) lastGain.delete(k);
}, 600000).unref();

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function getRow(db, guildId, userId) {
  return db.prepare('SELECT xp, level, messages FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId)
    || { xp: 0, level: 0, messages: 0 };
}

function setRow(db, guildId, userId, row) {
  db.prepare(`
    INSERT INTO levels (guild_id, user_id, xp, level, messages) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, messages = excluded.messages
  `).run(guildId, userId, row.xp, row.level, row.messages);
}

function rankOf(db, guildId, userId) {
  const row = getRow(db, guildId, userId);
  const better = db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ? AND xp > ?').get(guildId, row.xp).n;
  return better + 1;
}

/** Donne / retire les rôles de récompense selon le niveau. */
async function syncRewards(member, cfg, level) {
  const rewards = cfg.rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  if (!rewards.length) return;
  const wanted = cfg.stackRewards ? rewards : [rewards[rewards.length - 1]];
  const wantedIds = new Set(wanted.map((r) => r.role));

  const toAdd = [...wantedIds].filter((id) => !member.roles.cache.has(id) && member.guild.roles.cache.get(id)?.editable);
  if (toAdd.length) await member.roles.add(toAdd, 'Récompense de niveau').catch(() => {});

  if (!cfg.stackRewards) {
    const others = cfg.rewards.map((r) => r.role).filter((id) => !wantedIds.has(id) && member.roles.cache.has(id) && member.guild.roles.cache.get(id)?.editable);
    if (others.length) await member.roles.remove(others, 'Récompense de niveau (non cumulée)').catch(() => {});
  }
}

async function announce(client, member, settings, channel, level, xp) {
  const cfg = settings.levels;
  if (cfg.announce === 'none') return;
  const payload = buildMessage(cfg.levelUp, memberVars(member, { level: String(level), xp: String(xp) }), settings.general);
  if (!payload) return;

  if (cfg.announce === 'dm') {
    await member.send(payload).catch(() => {});
  } else if (cfg.announce === 'channel') {
    await safeSend(getSendable(member.guild, cfg.announceChannelId), payload);
  } else {
    await safeSend(getSendable(member.guild, channel.id), payload);
  }
}

/** Multiplicateur global × meilleur multiplicateur de rôle du membre. */
function multiplierFor(member, cfg) {
  const roleMult = cfg.roleMultipliers.filter((r) => member.roles.cache.has(r.role)).reduce((m, r) => Math.max(m, r.multiplier), 1);
  return cfg.multiplier * roleMult;
}

async function handleMessage(client, message) {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot) return;
  const settings = client.ctx.settings.get(guild.id);
  const cfg = settings.levels;
  if (!cfg.enabled) return;

  if (cfg.ignoredChannels.includes(message.channelId) || (message.channel.parentId && cfg.ignoredChannels.includes(message.channel.parentId))) return;
  if (member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id))) return;

  const key = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastGain.get(key) || 0) < cfg.cooldown * 1000) return;
  lastGain.set(key, now);

  const lo = Math.min(cfg.xpMin, cfg.xpMax);
  const hi = Math.max(cfg.xpMin, cfg.xpMax);
  const gain = Math.max(0, Math.round(rand(lo, hi) * multiplierFor(member, cfg)));

  const { db } = client.ctx;
  const row = getRow(db, guild.id, message.author.id);
  const oldLevel = row.level;
  row.xp += gain;
  row.messages += 1;
  row.level = levelFromXp(row.xp);
  setRow(db, guild.id, message.author.id, row);

  if (row.level > oldLevel) {
    await syncRewards(member, cfg, row.level).catch(() => {});
    await announce(client, member, settings, message.channel, row.level, row.xp).catch(() => {});
  }
}

/** Utilisé par le dashboard / les commandes pour fixer l'XP à la main. */
async function setXp(client, guild, userId, xp) {
  const { db } = client.ctx;
  const row = getRow(db, guild.id, userId);
  row.xp = Math.max(0, Math.floor(xp));
  row.level = levelFromXp(row.xp);
  setRow(db, guild.id, userId, row);
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (member) await syncRewards(member, client.ctx.settings.get(guild.id).levels, row.level).catch(() => {});
  return row;
}

/** Chaque minute : donne de l'XP aux membres actifs en vocal. */
async function tickVoice(client) {
  const { db, settings } = client.ctx;
  for (const guild of client.guilds.cache.values()) {
    const cfg = settings.module(guild.id, 'levels');
    if (!cfg.enabled || !cfg.voiceXp.enabled) continue;
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased() || channel.id === guild.afkChannelId || cfg.ignoredChannels.includes(channel.id) || (channel.parentId && cfg.ignoredChannels.includes(channel.parentId))) continue;
      const humans = [...channel.members.values()].filter((m) => !m.user.bot);
      if (cfg.voiceXp.requireOthers && humans.length < 2) continue;
      for (const member of humans) {
        const vs = member.voice;
        if (cfg.voiceXp.ignoreMuted && (vs.selfMute || vs.selfDeaf || vs.serverMute || vs.serverDeaf)) continue;
        if (member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id))) continue;
        const row = getRow(db, guild.id, member.id);
        const old = row.level;
        row.xp += Math.max(0, Math.round(cfg.voiceXp.xpPerMinute * multiplierFor(member, cfg)));
        row.level = levelFromXp(row.xp);
        setRow(db, guild.id, member.id, row);
        if (row.level > old) await syncRewards(member, cfg, row.level).catch(() => {});
      }
    }
  }
}

/** Remet l'XP à zéro quand un membre quitte (si l'option est active). */
function onMemberLeave(client, member) {
  const cfg = client.ctx.settings.module(member.guild.id, 'levels');
  if (cfg.enabled && cfg.resetOnLeave) client.ctx.db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(member.guild.id, member.id);
}

module.exports = { handleMessage, getRow, rankOf, setXp, syncRewards, lastGain, tickVoice, onMemberLeave, multiplierFor };
