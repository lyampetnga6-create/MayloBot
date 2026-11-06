'use strict';
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const eco = require('../modules/economy');

const g = (b) => b.setContexts(InteractionContextType.Guild);
const amount = (o) => o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1).setMaxValue(10000000);

module.exports = [
  {
    category: 'Économie', module: 'economy',
    data: g(new SlashCommandBuilder().setName('solde').setDescription('Affiche ton solde').addUserOption((o) => o.setName('membre').setDescription('Membre'))),
    execute: (i) => eco.balance(i.client, i, i.options.getUser('membre') || i.user),
  },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('daily').setDescription('Récupère ta récompense quotidienne')), execute: (i) => eco.daily(i.client, i) },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('travailler').setDescription('Travaille pour gagner de l’argent')), execute: (i) => eco.work(i.client, i) },
  {
    category: 'Économie', module: 'economy',
    data: g(new SlashCommandBuilder().setName('donner').setDescription('Donne de l’argent à un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Bénéficiaire').setRequired(true)).addIntegerOption(amount)),
    execute: (i) => eco.give(i.client, i, i.options.getUser('membre', true), i.options.getInteger('montant', true)),
  },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('parier').setDescription('Parie sur pile ou face (quitte ou double)').addIntegerOption(amount)), execute: (i) => eco.bet(i.client, i, i.options.getInteger('montant', true)) },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('machine').setDescription('Joue à la machine à sous').addIntegerOption(amount)), execute: (i) => eco.slots(i.client, i, i.options.getInteger('montant', true)) },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('boutique').setDescription('Affiche la boutique du serveur')), execute: (i) => eco.shop(i.client, i) },
  {
    category: 'Économie', module: 'economy',
    data: g(new SlashCommandBuilder().setName('acheter').setDescription('Achète un article de la boutique')
      .addStringOption((o) => o.setName('article').setDescription('Nom de l’article').setRequired(true).setMaxLength(60))),
    execute: (i) => eco.buy(i.client, i, i.options.getString('article', true)),
  },
  {
    category: 'Économie', module: 'economy',
    data: g(new SlashCommandBuilder().setName('inventaire').setDescription('Affiche ton inventaire').addUserOption((o) => o.setName('membre').setDescription('Membre'))),
    execute: (i) => eco.inventory(i.client, i, i.options.getUser('membre') || i.user),
  },
  { category: 'Économie', module: 'economy', data: g(new SlashCommandBuilder().setName('riches').setDescription('Classement des plus riches')), execute: (i) => eco.richest(i.client, i) },
];
