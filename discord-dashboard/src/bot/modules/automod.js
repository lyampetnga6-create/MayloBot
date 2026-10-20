'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { brandedEmbed, safeText } = require('../../lib/template');
const { getSendable, safeSend, deleteLater } = require('../util');
const { autoWarn, autoTimeout, logModeration } = require('./moderation');

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/([a-z0-9-]{2,32})/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const EMOJI_RE = /<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}/gu;

/** Historique récent des messages par membre (pour l'anti-spam). */
const recent = new Map();

function hostOf(raw) {
  try {
    return new URL(raw.startsWith('www.') ? `https://${raw}` : raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyse un message (fonction pure, testable). Renvoie { rule, detail } ou null.
 * `deps.isOwnInvite(code)` est optionnel (async) pour autoriser les invitations du serveur.
 */
async function inspect(content, mentionCount, cfg, deps = {}) {
  // Invitations
  if (cfg.invites.enabled) {
    const codes = [...content.matchAll(INVITE_RE)].map((m) => m[1]);
    for (const code of codes) {
      const own = cfg.invites.allowOwnServer && deps.isOwnInvite ? await deps.isOwnInvite(code) : false;
      if (!own) return { rule: 'invites', detail: 'Invitation vers un autre serveur' };
    }
  }

  // Liens
  if (cfg.links.enabled) {
    const urls = content.match(URL_RE) || [];
    for (const url of urls) {
      const host = hostOf(url);
      if (!host) continue;
      const allowed = cfg.links.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
      if (!allowed) return { rule: 'links', detail: `Lien non autorisé (${host})` };
    }
  }

  // Majuscules
  if (cfg.caps.enabled) {
    const letters = content.replace(/[^\p{L}]/gu, '');
    if (letters.length >= cfg.caps.minLength) {
      const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
      if ((upper / letters.length) * 100 >= cfg.caps.percent) return { rule: 'caps', detail: 'Trop de majuscules' };
    }
  }

  // Mentions
  if (cfg.mentions.enabled && mentionCount > cfg.mentions.max) {
    return { rule: 'mentions', detail: `${mentionCount} mentions dans un seul message` };
  }

  // Mots interdits
  if (cfg.words.enabled && cfg.words.list.length) {
    const lowered = content.toLowerCase();
    for (const word of cfg.words.list) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(lowered)) return { rule: 'words', detail: 'Mot interdit' };
    }
  }

  // Émojis (Unicode + personnalisés)
  if (cfg.emojis.enabled) {
    const count = (content.match(EMOJI_RE) || []).length;
    if (count > cfg.emojis.max) return { rule: 'emojis', detail: `${count} émojis dans un seul message` };
  }

  // Caractères répétés
  if (cfg.repeated.enabled) {
    const re = new RegExp(`(\\S)\\1{${Math.max(4, cfg.repeated.length - 1)},}`, 'u');
    if (re.test(content)) return { rule: 'repeated', detail: 'Caractères répétés' };
  }

  // Messages trop hauts
  if (cfg.lines.enabled && content.split('\n').length > cfg.lines.max) {
    return { rule: 'lines', detail: `Plus de ${cfg.lines.max} lignes` };
  }

  // Zalgo : plus de 3 diacritiques combinés à la suite
  if (cfg.zalgo.enabled && /[̀-ͯ҉᪰-᫿᷀-᷿⃐-⃿]{4,}/.test(content)) {
    return { rule: 'zalgo', detail: 'Texte déformé' };
  }

  // Pièces jointes
  if (cfg.attachments.enabled && deps.attachmentNames) {
    const bad = deps.attachmentNames.find((n) => cfg.attachments.blockedExtensions.includes(String(n).split('.').pop().toLowerCase()));
    if (bad) return { rule: 'attachments', detail: `Fichier bloqué (${String(bad).slice(0, 40)})` };
  }

  // Messages en double
  if (cfg.duplicates.enabled && deps.isDuplicate && content.trim().length >= 3 && deps.isDuplicate(content)) {
    return { rule: 'duplicates', detail: `Même message répété ${cfg.duplicates.count} fois` };
  }

  return null;
}

/** Anti-spam : renvoie true si le membre dépasse la limite. */
function isSpam(key, cfg, now = Date.now()) {
  const windowMs = cfg.spam.seconds * 1000;
  const list = (recent.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  recent.set(key, list);
  return list.length > cfg.spam.messages;
}

// Nettoyage périodique pour ne pas fuiter de mémoire.
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [k, list] of lastContents) {
    const fresh = list.filter((e) => e.t > cutoff - 480000);
    if (fresh.length) lastContents.set(k, fresh); else lastContents.delete(k);
  }
  for (const [k, list] of recent) {
    const fresh = list.filter((t) => t > cutoff);
    if (fresh.length) recent.set(k, fresh); else recent.delete(k);
  }
}, 60000).unref();

const RULE_LABELS = {
  invites: 'Invitation Discord', links: 'Lien', caps: 'Majuscules', spam: 'Spam', mentions: 'Mentions de masse', words: 'Mot interdit',
  emojis: 'Trop d’émojis', repeated: 'Caractères répétés', lines: 'Message trop haut', zalgo: 'Texte déformé', attachments: 'Fichier interdit', duplicates: 'Message répété',
};

/** Mémoire des derniers messages d'un membre (détection des doublons). */
const lastContents = new Map();
function makeDuplicateCheck(key, cfg, now = Date.now()) {
  return (content) => {
    const norm = content.trim().toLowerCase().replace(/\s+/g, ' ');
    const list = (lastContents.get(key) || []).filter((e) => now - e.t < cfg.duplicates.seconds * 1000);
    list.push({ t: now, c: norm });
    lastContents.set(key, list.slice(-30));
    return list.filter((e) => e.c === norm).length >= cfg.duplicates.count;
  };
}

/**
 * Appelé pour chaque message de serveur. Renvoie true si le message a été sanctionné
 * (les autres modules doivent alors l'ignorer).
 */
async function handleMessage(client, message, { skipSpam = false } = {}) {
  const { guild, member } = message;
  if (!guild || !member || message.author.bot) return false;
  const settings = client.ctx.settings.get(guild.id);
  const cfg = settings.automod;
  if (!cfg.enabled) return false;

  // Exceptions
  if (cfg.ignoredChannels.includes(message.channelId) || (message.channel.parentId && cfg.ignoredChannels.includes(message.channel.parentId))) return false;
  if (member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id))) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator)) return false;

  let verdict = null;
  if (cfg.spam.enabled && !skipSpam && isSpam(`${guild.id}:${message.author.id}`, cfg)) {
    verdict = { rule: 'spam', detail: `Plus de ${cfg.spam.messages} messages en ${cfg.spam.seconds} s` };
  }
  if (!verdict) {
    const mentionCount = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    verdict = await inspect(message.content || '', mentionCount, cfg, {
      attachmentNames: message.attachments ? [...message.attachments.values()].map((a) => a.name || '') : [],
      isDuplicate: makeDuplicateCheck(`${guild.id}:${message.author.id}`, cfg),
      isOwnInvite: async (code) => {
        if (guild.vanityURLCode && guild.vanityURLCode.toLowerCase() === code.toLowerCase()) return true;
        try {
          const inv = await client.fetchInvite(code);
          return inv.guild?.id === guild.id;
        } catch {
          return false;
        }
      },
    });
  }
  if (!verdict) return false;

  const label = RULE_LABELS[verdict.rule];
  if (message.deletable) await message.delete().catch(() => {});

  if (cfg.notify) {
    const notice = await safeSend(getSendable(guild, message.channelId), {
      content: `${message.author}, ton message a été supprimé : **${label}**.`,
      allowedMentions: { users: [message.author.id] },
    });
    deleteLater(notice, 6);
  }

  const reason = `Auto-modération — ${label} : ${verdict.detail}`;
  try {
    if (cfg.action === 'warn') await autoWarn(client, guild, message.author, reason);
    else if (cfg.action === 'timeout') await autoTimeout(client, guild, message.author, cfg.timeoutMinutes, reason);
  } catch (err) {
    console.warn(`[automod] ${guild.id}: ${err.message}`);
  }

  if (cfg.action === 'none') {
    const embed = brandedEmbed(settings.general)
      .setColor(0x60a5fa)
      .setTitle(`Auto-modération · ${label}`)
      .addFields(
        { name: 'Membre', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
        { name: 'Salon', value: `<#${message.channelId}>`, inline: true },
        { name: 'Détail', value: verdict.detail },
      )
      .setTimestamp();
    if (message.content) embed.addFields({ name: 'Message', value: safeText(message.content).slice(0, 1000) });
    await logModeration(client, guild, embed);
  }
  return true;
}

module.exports = { handleMessage, inspect, isSpam, makeDuplicateCheck, RULE_LABELS, _recent: recent };
