'use strict';
const {
  SlashCommandBuilder, InteractionContextType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const fun = require('../../lib/fun');
const { hexToInt, safeText } = require('../../lib/template');
const { EPHEMERAL } = require('../util');

const g = (b) => b.setContexts(InteractionContextType.Guild);
const color = (i) => hexToInt(i.client.ctx.settings.module(i.guild.id, 'general').embedColor);
const text = (o, name = 'texte', desc = 'Texte') => o.setName(name).setDescription(desc).setRequired(true).setMaxLength(500);
const member = (o, desc = 'Membre') => o.setName('membre').setDescription(desc).setRequired(true);
const bar = (pct) => '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
const noPing = { parse: [] };

const make = (name, description, build, execute) => ({
  category: 'Divertissement',
  module: 'fun',
  data: g(build(new SlashCommandBuilder().setName(name).setDescription(description))),
  execute,
});

/** Parties de morpion en cours (en mémoire : elles ne survivent pas à un redémarrage). */
const games = new Map();
const tttBoard = (game) => {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    rows.push(new ActionRowBuilder().addComponents([0, 1, 2].map((c) => {
      const idx = r * 3 + c;
      const v = game.board[idx];
      return new ButtonBuilder().setCustomId(`ttt:${game.id}:${idx}`).setLabel(v || '·').setStyle(v === 'X' ? ButtonStyle.Primary : v === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(Boolean(v) || game.over);
    })));
  }
  return rows;
};

async function handleTicTacToe(client, interaction) {
  const [, id, idx] = interaction.customId.split(':');
  const game = games.get(id);
  if (!game) return interaction.reply({ content: 'Cette partie est terminée.', flags: EPHEMERAL });
  const turnId = game.turn === 'X' ? game.x : game.o;
  if (![game.x, game.o].includes(interaction.user.id)) return interaction.reply({ content: 'Tu ne fais pas partie de cette partie.', flags: EPHEMERAL });
  if (interaction.user.id !== turnId) return interaction.reply({ content: 'Ce n’est pas ton tour.', flags: EPHEMERAL });
  game.board[Number(idx)] = game.turn;
  const win = fun.tttWinner(game.board);
  game.turn = game.turn === 'X' ? 'O' : 'X';
  if (win) { game.over = true; games.delete(id); }
  const head = win === 'draw' ? '🤝 Égalité !' : win ? `🏆 <@${win === 'X' ? game.x : game.o}> gagne !` : `Tour de <@${game.turn === 'X' ? game.x : game.o}> (${game.turn})`;
  return interaction.update({ content: `❌ <@${game.x}>  vs  ⭕ <@${game.o}>\n${head}`, components: tttBoard(game), allowedMentions: { users: [game.x, game.o] } });
}

const ACTIONS = Object.keys(fun.HUGS);
const ACTION_LABELS = { hug: 'un câlin', pat: 'une caresse', slap: 'une claque', kiss: 'un bisou', highfive: 'un high five', poke: 'une tape', cuddle: 'un gros câlin', bonk: 'un coup de batte' };

const commands = [
  make('8ball', 'Pose une question à la boule magique', (b) => b.addStringOption((o) => text(o, 'question', 'Ta question')),
    (i) => i.reply({ embeds: [new EmbedBuilder().setColor(color(i)).setTitle('🎱 Boule magique').addFields({ name: 'Question', value: safeText(i.options.getString('question', true)) }, { name: 'Réponse', value: fun.pick(fun.EIGHT_BALL) })] })),

  make('pileouface', 'Lance une pièce', (b) => b, (i) => i.reply(`🪙 La pièce tombe sur **${fun.coinflip()}** !`)),

  make('des', 'Lance des dés (ex : 2d6+3)', (b) => b.addStringOption((o) => o.setName('formule').setDescription('Ex : d20, 3d6, 2d8+4').setMaxLength(20)), (i) => {
    const r = fun.rollDice(i.options.getString('formule') || 'd6');
    if (!r) return i.reply({ content: 'Formule invalide. Exemples : `d20`, `3d6`, `2d8+4` (20 dés maximum).', flags: EPHEMERAL });
    return i.reply(`🎲 ${r.count}d${r.sides}${r.bonus ? (r.bonus > 0 ? `+${r.bonus}` : r.bonus) : ''} → [${r.rolls.join(', ')}] = **${r.total}**`);
  }),

  make('pfc', 'Pierre, feuille, ciseaux contre le bot', (b) => b.addStringOption((o) => o.setName('choix').setDescription('Ton choix').setRequired(true).addChoices(...fun.RPS.map((r) => ({ name: r, value: r })))), (i) => {
    const me = i.options.getString('choix', true);
    const bot = fun.pick(fun.RPS);
    const out = fun.rpsOutcome(me, bot);
    return i.reply(`Tu joues **${me}**, je joue **${bot}** → ${out === 0 ? '🤝 égalité' : out > 0 ? '🏆 tu gagnes !' : '😈 j’ai gagné !'}`);
  }),

  make('choisir', 'Le bot choisit pour toi', (b) => b.addStringOption((o) => text(o, 'options', 'Choix séparés par « ; »')), (i) => {
    const opts = i.options.getString('options', true).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) return i.reply({ content: 'Donne au moins deux options séparées par « ; ».', flags: EPHEMERAL });
    return i.reply({ content: `🤔 Je choisis : **${safeText(fun.pick(opts))}**`, allowedMentions: noPing });
  }),

  make('ship', 'Compatibilité entre deux membres', (b) => b.addUserOption((o) => member(o, 'Premier membre')).addUserOption((o) => o.setName('membre2').setDescription('Second membre (toi par défaut)')), (i) => {
    const a = i.options.getUser('membre', true);
    const b = i.options.getUser('membre2') || i.user;
    const pct = fun.shipScore(a.id, b.id);
    return i.reply({ content: `💞 **${safeText(a.username)}** × **${safeText(b.username)}**\n${bar(pct)} **${pct} %**`, allowedMentions: noPing });
  }),

  make('noter', 'Note quelque chose sur 10', (b) => b.addStringOption((o) => text(o, 'sujet', 'Ce que le bot doit noter')), (i) => {
    const s = i.options.getString('sujet', true);
    return i.reply({ content: `⭐ Je donne **${fun.rateScore(s)}/10** à « ${safeText(s)} »`, allowedMentions: noPing });
  }),

  make('blague', 'Une blague (pas toujours drôle)', (b) => b, (i) => i.reply(fun.pick(fun.JOKES))),
  make('fait', 'Un fait surprenant', (b) => b, (i) => i.reply(`🧠 ${fun.pick(fun.FACTS)}`)),

  make('calin', 'Fais un geste affectueux (ou pas) à quelqu’un', (b) => b
    .addUserOption((o) => member(o, 'Destinataire'))
    .addStringOption((o) => o.setName('geste').setDescription('Quel geste ?').addChoices(...ACTIONS.map((a) => ({ name: ACTION_LABELS[a], value: a })))), (i) => {
    const kind = i.options.getString('geste') || 'hug';
    const target = i.options.getUser('membre', true);
    return i.reply({ content: `${kind === 'slap' || kind === 'bonk' ? '👋' : '💜'} <@${i.user.id}> offre **${ACTION_LABELS[kind]}** à <@${target.id}> !`, allowedMentions: { users: [target.id] } });
  }),

  make('quiz', 'Une question de culture générale', (b) => b, async (i) => {
    const q = fun.pick(fun.QUIZ);
    const options = fun.shuffle([q.a, ...q.w]);
    const id = `${i.id}`;
    const row = new ActionRowBuilder().addComponents(options.map((o, k) => new ButtonBuilder().setCustomId(`quiz:${id}:${k}`).setLabel(o.slice(0, 80)).setStyle(ButtonStyle.Secondary)));
    const msg = await i.reply({ embeds: [new EmbedBuilder().setColor(color(i)).setTitle('❓ Quiz').setDescription(q.q).setFooter({ text: 'Tu as 20 secondes' })], components: [row], fetchReply: true });
    const collector = msg.createMessageComponentCollector({ time: 20000, filter: (b) => b.customId.startsWith(`quiz:${id}:`) });
    const answered = new Set();
    collector.on('collect', async (b) => {
      if (answered.has(b.user.id)) return b.reply({ content: 'Tu as déjà répondu.', flags: EPHEMERAL });
      answered.add(b.user.id);
      const good = options[Number(b.customId.split(':')[2])] === q.a;
      await b.reply({ content: good ? '✅ Bonne réponse !' : `❌ Raté ! C’était **${q.a}**.`, flags: EPHEMERAL });
      return null;
    });
    collector.on('end', () => i.editReply({ components: [], embeds: [new EmbedBuilder().setColor(color(i)).setTitle('❓ Quiz').setDescription(`${q.q}\n\n✅ Réponse : **${q.a}** (${answered.size} participant(s))`)] }).catch(() => {}));
    return null;
  }),

  make('morpion', 'Défie un membre au morpion', (b) => b.addUserOption((o) => member(o, 'Adversaire')), async (i) => {
    const opp = i.options.getUser('membre', true);
    if (opp.bot || opp.id === i.user.id) return i.reply({ content: 'Choisis un autre membre (humain).', flags: EPHEMERAL });
    const game = { id: i.id, x: i.user.id, o: opp.id, turn: 'X', board: Array(9).fill(''), over: false };
    games.set(game.id, game);
    setTimeout(() => games.delete(game.id), 15 * 60000).unref?.();
    return i.reply({ content: `❌ <@${game.x}>  vs  ⭕ <@${game.o}>\nTour de <@${game.x}> (X)`, components: tttBoard(game), allowedMentions: { users: [game.x, game.o] } });
  }),

  make('inverser', 'Écrit un texte à l’envers', (b) => b.addStringOption((o) => text(o)), (i) => i.reply({ content: fun.reverseText(i.options.getString('texte', true)), allowedMentions: noPing })),
  make('retourner', 'Retourne un texte (tête en bas)', (b) => b.addStringOption((o) => text(o)), (i) => i.reply({ content: fun.upsideDown(i.options.getString('texte', true)), allowedMentions: noPing })),
  make('moquer', 'tRaNsFoRmE uN tExTe', (b) => b.addStringOption((o) => text(o)), (i) => i.reply({ content: fun.mockCase(i.options.getString('texte', true)), allowedMentions: noPing })),
  make('applaudir', 'Ajoute des 👏 entre les mots', (b) => b.addStringOption((o) => text(o)), (i) => i.reply({ content: fun.CLAP(i.options.getString('texte', true)), allowedMentions: noPing })),
  make('morse', 'Traduit un texte en morse', (b) => b.addStringOption((o) => text(o)), (i) => i.reply({ content: `\`${fun.toMorse(i.options.getString('texte', true)) || '…'}\`` })),
];

module.exports = commands;
module.exports.handleTicTacToe = handleTicTacToe;
