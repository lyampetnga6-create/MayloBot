'use strict';
const { EmbedBuilder } = require('discord.js');

const VAR_RE = /\{([a-zA-Z0-9_.]+)\}/g;

/** Remplace {variable} par sa valeur ; les variables inconnues restent telles quelles. */
function render(template, vars = {}) {
  if (typeof template !== 'string' || !template) return '';
  return template.replace(VAR_RE, (whole, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole));
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function isHttpUrl(s) {
  if (typeof s !== 'string' || !s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function hexToInt(hex, fallback = 0x8b5cf6) {
  if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) return parseInt(hex.slice(1), 16);
  return fallback;
}

/**
 * Transforme un « message » du dashboard ({ content, embed }) en charge utile Discord.
 * Renvoie null si le message est vide (rien à envoyer).
 *
 * @param {object} cfg       valeur d'un champ de type `message`
 * @param {object} vars      variables disponibles ({user}, {server}…)
 * @param {object} general   réglages du module « general » (couleur / footer par défaut)
 */
function buildMessage(cfg, vars = {}, general = {}) {
  if (!cfg) return null;
  const payload = {};

  const content = trunc(render(cfg.content, vars), 2000).trim();
  if (content) payload.content = content;

  const e = cfg.embed;
  if (e && e.enabled) {
    const embed = new EmbedBuilder();
    let hasBody = false;

    const title = trunc(render(e.title, vars), 256).trim();
    if (title) { embed.setTitle(title); hasBody = true; }

    const description = trunc(render(e.description, vars), 4096).trim();
    if (description) { embed.setDescription(description); hasBody = true; }

    const author = trunc(render(e.author, vars), 256).trim();
    if (author) { embed.setAuthor({ name: author }); hasBody = true; }

    const footerText = trunc(render(e.footer, vars) || general.footerText || '', 2048).trim();
    if (footerText) embed.setFooter({ text: footerText });

    const thumb = render(e.thumbnail, vars).trim();
    if (isHttpUrl(thumb)) { embed.setThumbnail(thumb); hasBody = true; }

    const image = render(e.image, vars).trim();
    if (isHttpUrl(image)) { embed.setImage(image); hasBody = true; }

    embed.setColor(hexToInt(e.color || general.embedColor));
    if (e.timestamp) embed.setTimestamp();

    if (hasBody) payload.embeds = [embed];
  }

  return payload.content || payload.embeds ? payload : null;
}

/** Variables standard à partir d'un membre de serveur. */
function memberVars(member, extra = {}) {
  const user = member.user;
  return {
    user: `<@${user.id}>`,
    'user.name': user.username,
    'user.id': user.id,
    'user.avatar': member.displayAvatarURL({ extension: 'png', size: 256 }),
    'user.created': `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
    server: member.guild.name,
    'server.icon': member.guild.iconURL({ extension: 'png', size: 256 }) || '',
    memberCount: String(member.guild.memberCount),
    ...extra,
  };
}

/** Mêmes variables mais pour un simple utilisateur dans un serveur (membre parti, etc.). */
function userVars(user, guild, extra = {}) {
  return {
    user: `<@${user.id}>`,
    'user.name': user.username,
    'user.id': user.id,
    'user.avatar': user.displayAvatarURL({ extension: 'png', size: 256 }),
    'user.created': `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
    server: guild.name,
    'server.icon': guild.iconURL({ extension: 'png', size: 256 }) || '',
    memberCount: String(guild.memberCount),
    ...extra,
  };
}

/** Embed « maison » avec la couleur / le pied de page du serveur. */
function brandedEmbed(general = {}) {
  const e = new EmbedBuilder().setColor(hexToInt(general.embedColor));
  if (general.footerText) e.setFooter({ text: general.footerText });
  return e;
}

/** Échappe les mentions pour afficher du texte utilisateur sans pinger personne. */
function safeText(s) {
  return String(s).replace(/@(everyone|here)/g, '@​$1').replace(/<@([&!]?\d+)>/g, '<@​$1>');
}

module.exports = { render, buildMessage, memberVars, userVars, brandedEmbed, hexToInt, isHttpUrl, safeText, trunc };
