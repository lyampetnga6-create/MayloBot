'use strict';
/** Économie virtuelle : solde, récompenses, travail, jeux d'argent, boutique, inventaire. */
const { EmbedBuilder } = require('discord.js');
const { hexToInt, safeText } = require('../../lib/template');
const { EPHEMERAL } = require('../util');

const DAY = 86400000;
const cfgOf = (client, gid) => client.ctx.settings.module(gid, 'economy');
const db = (client) => client.ctx.db;
const fmt = (cfg, n) => `${cfg.currencyEmoji} **${Number(n).toLocaleString('fr-FR')}** ${cfg.currencyName}`;

function account(client, gid, uid) {
  const cfg = cfgOf(client, gid);
  db(client).prepare('INSERT OR IGNORE INTO economy (guild_id, user_id, balance) VALUES (?,?,?)').run(gid, uid, cfg.startingBalance);
  return db(client).prepare('SELECT * FROM economy WHERE guild_id = ? AND user_id = ?').get(gid, uid);
}

/** Modifie le solde de façon atomique ; renvoie false si le solde deviendrait négatif. */
function adjust(client, gid, uid, delta) {
  account(client, gid, uid);
  const r = db(client).prepare('UPDATE economy SET balance = balance + ? WHERE guild_id = ? AND user_id = ? AND balance + ? >= 0').run(delta, gid, uid, delta);
  return r.changes > 0;
}

const gate = (client, interaction) => {
  const cfg = cfgOf(client, interaction.guild.id);
  if (!cfg.enabled) {
    interaction.reply({ content: 'L’économie est désactivée sur ce serveur.', flags: EPHEMERAL });
    return null;
  }
  return cfg;
};

const embed = (client, gid) => new EmbedBuilder().setColor(hexToInt(client.ctx.settings.module(gid, 'general').embedColor));

async function balance(client, interaction, user) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const a = account(client, interaction.guild.id, user.id);
  const rank = db(client).prepare('SELECT COUNT(*) + 1 AS r FROM economy WHERE guild_id = ? AND balance > ?').get(interaction.guild.id, a.balance).r;
  await interaction.reply({ embeds: [embed(client, interaction.guild.id).setTitle(`Portefeuille de ${user.username}`).setDescription(`${fmt(cfg, a.balance)}\nClassement : **#${rank}**\nSérie quotidienne : **${a.streak}** jour(s)`)] });
}

async function daily(client, interaction) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const { guild, user } = interaction;
  const a = account(client, guild.id, user.id);
  const since = Date.now() - a.last_daily;
  if (since < DAY) return interaction.reply({ content: `⏳ Prochaine récompense <t:${Math.floor((a.last_daily + DAY) / 1000)}:R>.`, flags: EPHEMERAL });
  const streak = since < 2 * DAY ? Math.min(a.streak + 1, 7) : 1;
  const gain = cfg.dailyAmount + cfg.dailyStreakBonus * (streak - 1);
  db(client).prepare('UPDATE economy SET balance = balance + ?, last_daily = ?, streak = ? WHERE guild_id = ? AND user_id = ?').run(gain, Date.now(), streak, guild.id, user.id);
  await interaction.reply(`🎁 Récompense quotidienne : ${fmt(cfg, gain)} (série de ${streak} jour${streak > 1 ? 's' : ''}).`);
}

const JOBS = ['a livré des pizzas', 'a réparé un serveur', 'a joué du violon dans la rue', 'a promené des chiens', 'a codé un bot Discord', 'a modéré un salon agité', 'a vendu des limonades', 'a peint une fresque', 'a trié des paquets'];

async function work(client, interaction) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const { guild, user } = interaction;
  const a = account(client, guild.id, user.id);
  const ready = a.last_work + cfg.workCooldownMinutes * 60000;
  if (ready > Date.now()) return interaction.reply({ content: `⏳ Tu pourras retravailler <t:${Math.floor(ready / 1000)}:R>.`, flags: EPHEMERAL });
  const lo = Math.min(cfg.workMin, cfg.workMax);
  const hi = Math.max(cfg.workMin, cfg.workMax);
  const gain = lo + Math.floor(Math.random() * (hi - lo + 1));
  db(client).prepare('UPDATE economy SET balance = balance + ?, last_work = ? WHERE guild_id = ? AND user_id = ?').run(gain, Date.now(), guild.id, user.id);
  await interaction.reply(`💼 Tu ${JOBS[Math.floor(Math.random() * JOBS.length)]} et gagnes ${fmt(cfg, gain)}.`);
}

async function give(client, interaction, target, amount) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const { guild, user } = interaction;
  if (target.bot || target.id === user.id) return interaction.reply({ content: 'Choisis un autre membre.', flags: EPHEMERAL });
  if (!adjust(client, guild.id, user.id, -amount)) return interaction.reply({ content: 'Solde insuffisant.', flags: EPHEMERAL });
  adjust(client, guild.id, target.id, amount);
  await interaction.reply({ content: `💸 <@${user.id}> a donné ${fmt(cfg, amount)} à <@${target.id}>.`, allowedMentions: { users: [target.id] } });
}

async function bet(client, interaction, amount) {
  const cfg = gate(client, interaction); if (!cfg) return;
  if (!cfg.gambling) return interaction.reply({ content: 'Les jeux d’argent sont désactivés.', flags: EPHEMERAL });
  if (amount > cfg.maxBet) return interaction.reply({ content: `Mise maximale : ${fmt(cfg, cfg.maxBet)}.`, flags: EPHEMERAL });
  const { guild, user } = interaction;
  if (!adjust(client, guild.id, user.id, -amount)) return interaction.reply({ content: 'Solde insuffisant.', flags: EPHEMERAL });
  const win = Math.random() < 0.45; // léger avantage de la maison
  if (win) adjust(client, guild.id, user.id, amount * 2);
  await interaction.reply(win ? `🎉 Gagné ! Tu remportes ${fmt(cfg, amount)} de plus.` : `😢 Perdu… tu perds ${fmt(cfg, amount)}.`);
}

const REELS = ['🍒', '🍋', '🍇', '🔔', '⭐', '💎'];
async function slots(client, interaction, amount) {
  const cfg = gate(client, interaction); if (!cfg) return;
  if (!cfg.gambling) return interaction.reply({ content: 'Les jeux d’argent sont désactivés.', flags: EPHEMERAL });
  if (amount > cfg.maxBet) return interaction.reply({ content: `Mise maximale : ${fmt(cfg, cfg.maxBet)}.`, flags: EPHEMERAL });
  const { guild, user } = interaction;
  if (!adjust(client, guild.id, user.id, -amount)) return interaction.reply({ content: 'Solde insuffisant.', flags: EPHEMERAL });
  const r = [0, 0, 0].map(() => REELS[Math.floor(Math.random() * REELS.length)]);
  let mult = 0;
  if (r[0] === r[1] && r[1] === r[2]) mult = r[0] === '💎' ? 10 : 5;
  else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) mult = 1.5;
  const payout = Math.floor(amount * mult);
  if (payout) adjust(client, guild.id, user.id, payout);
  await interaction.reply(`🎰 | ${r.join(' | ')} |\n${payout ? `Tu gagnes ${fmt(cfg, payout)} (x${mult}) !` : `Perdu… −${fmt(cfg, amount)}`}`);
}

async function shop(client, interaction) {
  const cfg = gate(client, interaction); if (!cfg) return;
  if (!cfg.shop.length) return interaction.reply({ content: 'La boutique est vide pour le moment.', flags: EPHEMERAL });
  const e = embed(client, interaction.guild.id).setTitle('🛒 Boutique');
  for (const item of cfg.shop) {
    const sold = db(client).prepare('SELECT COALESCE(SUM(qty),0) AS n FROM inventory WHERE guild_id = ? AND item_id = ?').get(interaction.guild.id, item.id).n;
    const stock = item.stock ? ` · stock : ${Math.max(0, item.stock - sold)}` : '';
    e.addFields({ name: `${item.emoji || '📦'} ${safeText(item.name)} — ${item.price} ${cfg.currencyEmoji}`, value: `${safeText(item.description || 'Aucune description')}${stock}\n\`/acheter article:${item.name}\`` });
  }
  await interaction.reply({ embeds: [e] });
}

async function buy(client, interaction, name) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const { guild, member } = interaction;
  const item = cfg.shop.find((i) => i.name.toLowerCase() === name.toLowerCase()) || cfg.shop.find((i) => i.name.toLowerCase().includes(name.toLowerCase()));
  if (!item) return interaction.reply({ content: 'Article introuvable. Regarde `/boutique`.', flags: EPHEMERAL });
  if (item.stock) {
    const sold = db(client).prepare('SELECT COALESCE(SUM(qty),0) AS n FROM inventory WHERE guild_id = ? AND item_id = ?').get(guild.id, item.id).n;
    if (sold >= item.stock) return interaction.reply({ content: 'Cet article est en rupture de stock.', flags: EPHEMERAL });
  }
  if (item.type === 'role') {
    if (!item.roleId || !guild.roles.cache.has(item.roleId)) return interaction.reply({ content: 'Le rôle de cet article n’existe plus.', flags: EPHEMERAL });
    if (member.roles.cache.has(item.roleId)) return interaction.reply({ content: 'Tu as déjà ce rôle.', flags: EPHEMERAL });
  }
  if (!adjust(client, guild.id, member.id, -item.price)) return interaction.reply({ content: 'Solde insuffisant.', flags: EPHEMERAL });
  if (item.type === 'role') {
    const ok = await member.roles.add(item.roleId, 'Achat en boutique').then(() => true).catch(() => false);
    if (!ok) {
      adjust(client, guild.id, member.id, item.price);
      return interaction.reply({ content: 'Je ne peux pas donner ce rôle (hiérarchie). Tu as été remboursé.', flags: EPHEMERAL });
    }
  }
  db(client).prepare('INSERT INTO inventory (guild_id, user_id, item_id, qty) VALUES (?,?,?,1) ON CONFLICT(guild_id, user_id, item_id) DO UPDATE SET qty = qty + 1').run(guild.id, member.id, item.id);
  await interaction.reply(`🛍️ Tu as acheté **${safeText(item.name)}** pour ${fmt(cfg, item.price)}.`);
}

async function inventory(client, interaction, user) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const rows = db(client).prepare('SELECT item_id, qty FROM inventory WHERE guild_id = ? AND user_id = ?').all(interaction.guild.id, user.id);
  const lines = rows.map((r) => {
    const item = cfg.shop.find((i) => i.id === r.item_id);
    return `${item?.emoji || '📦'} ${safeText(item?.name || 'Objet retiré')} ×${r.qty}`;
  });
  await interaction.reply({ embeds: [embed(client, interaction.guild.id).setTitle(`Inventaire de ${user.username}`).setDescription(lines.join('\n') || 'Vide.')] });
}

async function richest(client, interaction) {
  const cfg = gate(client, interaction); if (!cfg) return;
  const rows = db(client).prepare('SELECT user_id, balance FROM economy WHERE guild_id = ? ORDER BY balance DESC LIMIT 10').all(interaction.guild.id);
  const medals = ['🥇', '🥈', '🥉'];
  await interaction.reply({
    embeds: [embed(client, interaction.guild.id).setTitle('💰 Les plus riches').setDescription(rows.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — ${fmt(cfg, r.balance)}`).join('\n') || 'Personne pour le moment.')],
    allowedMentions: { parse: [] },
  });
}

/** Gain automatique par message (1 fois par minute et par membre). */
const lastChat = new Map();
function onMessage(client, message) {
  const cfg = cfgOf(client, message.guild.id);
  if (!cfg.enabled || !cfg.chatReward) return;
  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() - (lastChat.get(key) || 0) < 60000) return;
  lastChat.set(key, Date.now());
  if (lastChat.size > 20000) lastChat.clear();
  adjust(client, message.guild.id, message.author.id, cfg.chatReward);
}

module.exports = { account, adjust, balance, daily, work, give, bet, slots, shop, buy, inventory, richest, onMessage };
