'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const ai = require('../modules/ai');
const { render, safeText, trunc } = require('../../lib/template');
const { EPHEMERAL } = require('../util');

const text = (o, name = 'texte', desc = 'Texte', max = 1500) => o.setName(name).setDescription(desc).setRequired(true).setMaxLength(max);
const last = new Map();

/** Nettoie la réponse d'un modèle avant de l'afficher (aucune mention de masse possible). */
function cleanReply(s) {
  return safeText(String(s || '').replace(/@(everyone|here)/gi, '@​$1')).trim();
}

async function run(interaction, build) {
  const { client, guild, member } = interaction;
  const cfg = client.ctx.settings.module(guild.id, 'ai');
  if (!cfg.enabled || !cfg.commands) return interaction.reply({ content: 'Les commandes IA sont désactivées sur ce serveur.', flags: EPHEMERAL });
  if (cfg.commandRoles.length && !cfg.commandRoles.some((r) => member.roles.cache.has(r))) return interaction.reply({ content: 'Tu n’as pas le rôle nécessaire pour utiliser l’IA ici.', flags: EPHEMERAL });
  if (cfg.allowedChannels.length && !cfg.allowedChannels.includes(interaction.channelId)) return interaction.reply({ content: 'L’IA n’est pas disponible dans ce salon.', flags: EPHEMERAL });
  const key = `${guild.id}:${member.id}`;
  const left = (last.get(key) || 0) + cfg.cooldown * 1000 - Date.now();
  if (left > 0) return interaction.reply({ content: `⏳ Patiente encore ${Math.ceil(left / 1000)} s.`, flags: EPHEMERAL });
  last.set(key, Date.now());
  if (last.size > 5000) last.clear();

  await interaction.deferReply();
  try {
    const { system, user, temperature } = build(cfg);
    const answer = await ai.ask(client, guild.id, {
      system: `${system}\n${ai.languageRule(cfg.language)}\n\n${ai.SAFETY_RULES}`,
      messages: [{ role: 'user', content: user }],
      temperature: temperature ?? 0.6,
      maxTokens: 700,
    });
    return interaction.editReply({ content: trunc(cleanReply(answer), 1950) || '…', allowedMentions: { parse: [] } });
  } catch (err) {
    last.delete(key);
    return interaction.editReply({ content: `❌ ${err instanceof ai.AiError ? err.message : 'L’IA a rencontré un problème.'}`, allowedMentions: { parse: [] } });
  }
}

module.exports = [{
  category: 'Intelligence artificielle',
  module: 'ai',
  data: new SlashCommandBuilder().setName('ia').setDescription('Utilise l’intelligence artificielle').setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('demander').setDescription('Pose une question').addStringOption((o) => text(o, 'question', 'Ta question', 1000)))
    .addSubcommand((s) => s.setName('traduire').setDescription('Traduit un texte')
      .addStringOption((o) => text(o))
      .addStringOption((o) => o.setName('langue').setDescription('Langue cible (ex : anglais, japonais)').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('resumer').setDescription('Résume un texte').addStringOption((o) => text(o, 'texte', 'Texte à résumer', 4000)))
    .addSubcommand((s) => s.setName('reformuler').setDescription('Réécrit un texte dans un autre ton')
      .addStringOption((o) => text(o))
      .addStringOption((o) => o.setName('ton').setDescription('Ton voulu').setRequired(true).addChoices(
        { name: 'Professionnel', value: 'professionnel' }, { name: 'Amical', value: 'amical' }, { name: 'Drôle', value: 'humoristique' }, { name: 'Plus court', value: 'plus concis' }, { name: 'Sans fautes', value: 'corrigé (orthographe et grammaire uniquement)' })))
    .addSubcommand((s) => s.setName('expliquer').setDescription('Explique un sujet simplement')
      .addStringOption((o) => text(o, 'sujet', 'Ce que tu veux comprendre', 500))
      .addStringOption((o) => o.setName('niveau').setDescription('Niveau d’explication').addChoices({ name: 'Comme à un enfant', value: 'un enfant de 8 ans' }, { name: 'Débutant', value: 'un débutant' }, { name: 'Expert', value: 'un expert' }))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const o = interaction.options;
    const guildName = interaction.guild.name;
    return run(interaction, (cfg) => {
      switch (sub) {
        case 'demander': return { system: render(cfg.persona, { server: guildName }), user: o.getString('question', true) };
        case 'traduire': return { system: `Tu es un traducteur. Traduis le texte de l'utilisateur en ${o.getString('langue', true)}. Réponds uniquement par la traduction.`, user: o.getString('texte', true), temperature: 0.2 };
        case 'resumer': return { system: 'Résume le texte de l\'utilisateur en quelques phrases claires, en conservant les informations importantes.', user: o.getString('texte', true), temperature: 0.3 };
        case 'reformuler': return { system: `Réécris le texte de l'utilisateur sur un ton ${o.getString('ton', true)}, sans changer le sens. Réponds uniquement par le texte réécrit.`, user: o.getString('texte', true), temperature: 0.5 };
        default: return { system: `Explique le sujet demandé de façon simple et structurée, pour ${o.getString('niveau') || 'un débutant'}. Utilise un exemple concret.`, user: o.getString('sujet', true) };
      }
    });
  },
}];

module.exports.cleanReply = cleanReply;
