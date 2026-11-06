'use strict';
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { buildMessage, brandedEmbed } = require('../../lib/template');
const { EPHEMERAL, getSendable, safeSend, parseEmoji } = require('../util');

const challenges = new Map(); // guild:user -> { answer, attempts, until }
const locked = new Map();     // guild:user -> timestamp de fin de blocage

setInterval(() => {
  const now = Date.now();
  for (const [k, c] of challenges) if (c.expires < now) challenges.delete(k);
  for (const [k, t] of locked) if (t < now) locked.delete(k);
}, 120000).unref();

const rand = (n) => Math.floor(Math.random() * n);
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** Génère un petit calcul : { question, answer }. */
function mathChallenge() {
  const a = 3 + rand(17);
  const b = 2 + rand(12);
  if (rand(2)) return { question: `Combien font ${a} + ${b} ?`, answer: String(a + b) };
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { question: `Combien font ${hi} - ${lo} ?`, answer: String(hi - lo) };
}

function panelPayload(client, guild) {
  const s = client.ctx.settings.get(guild.id);
  const cfg = s.verification;
  const payload = buildMessage(cfg.panel, { server: guild.name, 'server.icon': guild.iconURL() || '' }, s.general)
    || { content: 'Clique sur le bouton pour te vérifier.' };
  const b = new ButtonBuilder().setCustomId('verify:start').setLabel(cfg.buttonLabel.slice(0, 80) || 'Se vérifier')
    .setStyle(ButtonStyle[cfg.buttonStyle] || ButtonStyle.Success);
  const em = parseEmoji(cfg.buttonEmoji);
  if (em) { try { b.setEmoji(em); } catch { /* émoji invalide */ } }
  payload.components = [new ActionRowBuilder().addComponents(b)];
  return payload;
}

async function publishPanel(client, guild) {
  const cfg = client.ctx.settings.module(guild.id, 'verification');
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) throw new Error('Salon de vérification introuvable ou inaccessible.');
  return channel.send(panelPayload(client, guild));
}

async function onMemberAdd(client, member) {
  const cfg = client.ctx.settings.module(member.guild.id, 'verification');
  if (!cfg.enabled || member.user.bot) return;
  if (cfg.unverifiedRoleId && member.guild.roles.cache.get(cfg.unverifiedRoleId)?.editable) {
    await member.roles.add(cfg.unverifiedRoleId, 'Vérification : en attente').catch(() => {});
  }
  if (cfg.kickAfterMinutes > 0) {
    client.ctx.db.prepare('INSERT OR REPLACE INTO pending_verification (guild_id, user_id, joined_at) VALUES (?, ?, ?)').run(member.guild.id, member.id, Date.now());
  }
}

function onMemberRemove(client, member) {
  client.ctx.db.prepare('DELETE FROM pending_verification WHERE guild_id = ? AND user_id = ?').run(member.guild.id, member.id);
}

async function complete(client, interaction, member) {
  const { guild } = interaction;
  const cfg = client.ctx.settings.module(guild.id, 'verification');
  const add = cfg.verifiedRoles.filter((id) => guild.roles.cache.get(id)?.editable);
  if (add.length) await member.roles.add(add, 'Vérification réussie').catch(() => {});
  if (cfg.unverifiedRoleId && member.roles.cache.has(cfg.unverifiedRoleId)) await member.roles.remove(cfg.unverifiedRoleId, 'Vérification réussie').catch(() => {});
  client.ctx.db.prepare('DELETE FROM pending_verification WHERE guild_id = ? AND user_id = ?').run(guild.id, member.id);
  challenges.delete(`${guild.id}:${member.id}`);
  await safeSend(getSendable(guild, cfg.logChannelId), {
    embeds: [brandedEmbed(client.ctx.settings.get(guild.id).general).setColor(0x34d399).setTitle('Membre vérifié').setDescription(`${member} (\`${member.id}\`)`).setTimestamp()],
    allowedMentions: { parse: [] },
  });
  return cfg.successText;
}

function answerModal(label) {
  return new ModalBuilder().setCustomId('verify:modal').setTitle('Vérification').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel(label.slice(0, 45))
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
  );
}

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('verify:')) return false;
  const { guild, member } = interaction;
  if (!guild || !member) return true;
  const cfg = client.ctx.settings.module(guild.id, 'verification');
  const key = `${guild.id}:${member.id}`;
  const say = (content) => interaction.reply({ content, flags: EPHEMERAL });

  if (!cfg.enabled) { await say('La vérification est désactivée.'); return true; }
  const already = cfg.verifiedRoles.length > 0 && cfg.verifiedRoles.every((r) => member.roles.cache.has(r));
  if (already) { await say('Tu es déjà vérifié ✅'); return true; }
  if ((locked.get(key) || 0) > Date.now()) { await say('Trop d’essais ratés. Réessaie dans quelques minutes.'); return true; }

  if (interaction.isButton() && id === 'verify:start') {
    if (cfg.method === 'button') { await say(await complete(client, interaction, member)); return true; }
    if (cfg.method === 'math') {
      const c = mathChallenge();
      challenges.set(key, { answer: c.answer, attempts: 0, expires: Date.now() + 600000 });
      await interaction.showModal(answerModal(c.question));
      return true;
    }
    challenges.set(key, { answer: null, attempts: challenges.get(key)?.attempts || 0, expires: Date.now() + 600000 });
    if (cfg.question.length <= 45) { await interaction.showModal(answerModal(cfg.question)); return true; }
    await interaction.reply({
      content: `**${cfg.question}**`,
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:answer').setLabel('Répondre').setStyle(ButtonStyle.Primary))],
      flags: EPHEMERAL,
    });
    return true;
  }

  if (interaction.isButton() && id === 'verify:answer') {
    await interaction.showModal(answerModal('Ta réponse'));
    return true;
  }

  if (interaction.isModalSubmit() && id === 'verify:modal') {
    const state = challenges.get(key);
    if (!state) { await say('La vérification a expiré. Clique à nouveau sur le bouton.'); return true; }
    const given = norm(interaction.fields.getTextInputValue('answer'));
    const ok = cfg.method === 'math' ? given === state.answer : cfg.answers.some((a) => norm(a) === given);
    if (ok) { await say(await complete(client, interaction, member)); return true; }
    state.attempts += 1;
    const left = cfg.maxAttempts - state.attempts;
    if (left <= 0) {
      locked.set(key, Date.now() + 600000);
      challenges.delete(key);
      await say('Trop d’essais ratés. Réessaie dans 10 minutes.');
    } else {
      await say(cfg.failText.replace('{count}', String(left)));
    }
    return true;
  }
  return true;
}

/** Expulse ceux qui ne se sont pas vérifiés à temps (tâche périodique). */
async function tick(client) {
  const { db, settings } = client.ctx;
  for (const guild of client.guilds.cache.values()) {
    const cfg = settings.module(guild.id, 'verification');
    if (!cfg.enabled || cfg.kickAfterMinutes <= 0) continue;
    const limit = Date.now() - cfg.kickAfterMinutes * 60000;
    const rows = db.prepare('SELECT user_id FROM pending_verification WHERE guild_id = ? AND joined_at < ?').all(guild.id, limit);
    for (const row of rows) {
      db.prepare('DELETE FROM pending_verification WHERE guild_id = ? AND user_id = ?').run(guild.id, row.user_id);
      const member = guild.members.cache.get(row.user_id) || await guild.members.fetch(row.user_id).catch(() => null);
      if (!member) continue;
      const verified = cfg.verifiedRoles.length > 0 && cfg.verifiedRoles.every((r) => member.roles.cache.has(r));
      const stillPending = cfg.unverifiedRoleId ? member.roles.cache.has(cfg.unverifiedRoleId) : !verified;
      if (!stillPending || verified) continue;
      await member.send(`Tu as été retiré de **${guild.name}** car tu ne t’es pas vérifié à temps. Tu peux revenir et réessayer.`).catch(() => {});
      await member.kick('Vérification non effectuée à temps').catch(() => {});
    }
  }
}

module.exports = { publishPanel, panelPayload, onMemberAdd, onMemberRemove, handleInteraction, tick, mathChallenge, norm };
