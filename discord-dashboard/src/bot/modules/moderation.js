'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { brandedEmbed, safeText } = require('../../lib/template');
const { getSendable, safeSend, formatMinutes } = require('../util');

const TYPE_LABELS = {
  warn: 'Avertissement',
  timeout: 'Exclusion temporaire',
  untimeout: 'Fin d’exclusion',
  kick: 'Expulsion',
  ban: 'Bannissement',
  unban: 'Débannissement',
  automod: 'Auto-modération',
};
const TYPE_COLORS = {
  warn: 0xfbbf24, timeout: 0xf97316, untimeout: 0x34d399, kick: 0xef4444, ban: 0xb91c1c, unban: 0x34d399, automod: 0x60a5fa,
};

const MAX_TIMEOUT_MIN = 40320; // 28 jours, limite Discord

/* ------------------------------------------------------------------ */
/* Dossiers (cases)                                                    */
/* ------------------------------------------------------------------ */
function createCase(db, { guildId, userId, modId, type, reason = '', duration = null }) {
  const info = db.prepare(
    'INSERT INTO cases (guild_id, user_id, mod_id, type, reason, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(guildId, userId, modId, type, String(reason).slice(0, 500), duration, Date.now());
  return Number(info.lastInsertRowid);
}

function countWarns(db, guildId, userId, expireDays = 0) {
  const since = expireDays > 0 ? Date.now() - expireDays * 86400000 : 0;
  return db.prepare("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn' AND created_at >= ?")
    .get(guildId, userId, since).n;
}

function listWarns(db, guildId, userId) {
  return db.prepare("SELECT * FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn' ORDER BY created_at DESC LIMIT 25")
    .all(guildId, userId);
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */

/** Renvoie un message d'erreur (français) si `moderator` ne peut pas agir sur `target`, sinon null. */
function hierarchyError(guild, moderatorMember, targetMember) {
  if (!targetMember) return null; // utilisateur absent du serveur : rien à comparer
  if (targetMember.id === guild.ownerId) return 'Impossible de sanctionner le propriétaire du serveur.';
  if (moderatorMember && targetMember.id === moderatorMember.id) return 'Tu ne peux pas te sanctionner toi-même.';
  if (targetMember.id === guild.client.user.id) return 'Je ne vais pas me sanctionner moi-même 😅';
  if (moderatorMember && moderatorMember.id !== guild.ownerId
    && moderatorMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
    return 'Ce membre a un rôle égal ou supérieur au tien.';
  }
  const me = guild.members.me;
  if (me && me.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
    return 'Mon rôle est trop bas pour agir sur ce membre (remonte-le dans la liste des rôles).';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */
function caseEmbed(general, guild, { id, type, user, moderator, reason, duration, auto }) {
  const e = brandedEmbed(general)
    .setColor(TYPE_COLORS[type] || 0x60a5fa)
    .setTitle(`${TYPE_LABELS[type] || type}${id ? ` · dossier #${id}` : ''}`)
    .addFields(
      { name: 'Membre', value: `${user} (\`${user.id}\`)`, inline: true },
      { name: 'Modérateur', value: auto ? '🤖 Automatique' : `${moderator}`, inline: true },
    )
    .setTimestamp();
  if (duration) e.addFields({ name: 'Durée', value: formatMinutes(duration), inline: true });
  e.addFields({ name: 'Raison', value: safeText(reason || 'Aucune raison précisée').slice(0, 1000) });
  return e;
}

async function logModeration(client, guild, embed) {
  const s = client.ctx.settings.get(guild.id);
  const channelId = s.moderation.modLogChannelId || (s.logs.enabled && s.logs.channelId) || '';
  await safeSend(getSendable(guild, channelId), { embeds: [embed] });
}

async function dmUser(client, guild, user, { type, reason, duration }) {
  const s = client.ctx.settings.get(guild.id);
  if (!s.moderation.dmOnSanction) return false;
  const e = brandedEmbed(s.general)
    .setColor(TYPE_COLORS[type] || 0x60a5fa)
    .setTitle(`${TYPE_LABELS[type] || type} sur ${guild.name}`)
    .setDescription(safeText(reason || 'Aucune raison précisée'))
    .setTimestamp();
  if (duration) e.addFields({ name: 'Durée', value: formatMinutes(duration) });
  if (s.moderation.appealText) e.addFields({ name: 'Une erreur ?', value: safeText(s.moderation.appealText) });
  try {
    await user.send({ embeds: [e] });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Sanction générique                                                  */
/* ------------------------------------------------------------------ */

/**
 * Applique une sanction, enregistre le dossier, prévient le membre et journalise.
 * Lève une Error (message français) si l'action Discord échoue.
 *
 * @param {object} o { guild, user, moderator(User), type, reason, duration(min), deleteDays, auto }
 */
async function sanction(client, o) {
  const { guild, user, moderator, type, reason = '', duration = null, deleteDays = 0, auto = false } = o;
  const { db } = client.ctx;
  const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);

  if (['timeout', 'kick'].includes(type) && !member) throw new Error('Ce membre n’est plus sur le serveur.');

  // MP avant l'action : après un ban/kick il n'est plus possible de contacter le membre.
  if (['warn', 'timeout', 'kick', 'ban'].includes(type)) {
    // Le module « Contestations » envoie son propre MP (avec le bouton « Contester ») ; sinon MP classique.
    const appeals = require('./appeals');
    appeals.markBotAction(guild.id, user.id, type);
    const sent = o.noAppeal ? false : await appeals.notify(client, guild, user, {
      type, reason, duration, moderator: auto ? null : moderator,
    });
    if (!sent) await dmUser(client, guild, user, { type, reason, duration });
  }

  const auditReason = `${moderator.tag || moderator.username}: ${reason || 'aucune raison'}`.slice(0, 450);
  try {
    switch (type) {
      case 'warn': break;
      case 'timeout': {
        const minutes = Math.min(Math.max(1, duration || 10), MAX_TIMEOUT_MIN);
        await member.timeout(minutes * 60000, auditReason);
        break;
      }
      case 'untimeout':
        await member.timeout(null, auditReason);
        break;
      case 'kick':
        await member.kick(auditReason);
        break;
      case 'ban':
        await guild.members.ban(user.id, { reason: auditReason, deleteMessageSeconds: Math.min(7, Math.max(0, deleteDays)) * 86400 });
        break;
      case 'unban':
        await guild.members.unban(user.id, auditReason);
        break;
      default:
        throw new Error(`Type de sanction inconnu : ${type}`);
    }
  } catch (err) {
    if (err.message?.startsWith('Type de sanction')) throw err;
    if (err.code === 50013) throw new Error('Je n’ai pas la permission nécessaire (ou mon rôle est trop bas).');
    if (err.code === 10026) throw new Error('Ce membre n’est pas banni.');
    throw new Error(`Discord a refusé l’action : ${err.message}`);
  }

  const id = createCase(db, { guildId: guild.id, userId: user.id, modId: moderator.id, type, reason, duration });
  const general = client.ctx.settings.get(guild.id).general;
  const embed = caseEmbed(general, guild, { id, type, user, moderator, reason, duration, auto });
  await logModeration(client, guild, embed);

  if (type === 'warn') await checkEscalation(client, guild, user);
  return { id, embed };
}

/** Applique le palier d'escalade correspondant au nombre d'avertissements actuel. */
async function checkEscalation(client, guild, user) {
  const s = client.ctx.settings.get(guild.id);
  const rules = s.moderation.autoSanctions;
  if (!rules.length) return null;
  const count = countWarns(client.ctx.db, guild.id, user.id, s.moderation.warnExpireDays);
  const rule = rules.find((r) => r.warns === count);
  if (!rule) return null;
  try {
    return await sanction(client, {
      guild, user, moderator: client.user, type: rule.action,
      reason: `Escalade automatique : ${count} avertissements`, duration: rule.duration, auto: true,
    });
  } catch (err) {
    console.warn(`[escalade] ${guild.id}: ${err.message}`);
    return null;
  }
}

/** Raccourci pour les modules internes (auto-modération). */
function autoWarn(client, guild, user, reason) {
  return sanction(client, { guild, user, moderator: client.user, type: 'warn', reason, auto: true });
}
function autoTimeout(client, guild, user, minutes, reason) {
  return sanction(client, { guild, user, moderator: client.user, type: 'timeout', reason, duration: minutes, auto: true });
}

const MOD_PERMS = PermissionFlagsBits;

module.exports = {
  TYPE_LABELS, MAX_TIMEOUT_MIN, MOD_PERMS,
  createCase, countWarns, listWarns, hierarchyError, caseEmbed,
  sanction, checkEscalation, autoWarn, autoTimeout, logModeration,
};
