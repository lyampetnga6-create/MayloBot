'use strict';
/**
 * Créateur de serveur : génère un plan (IA ou modèle), puis l'applique sur le serveur.
 *
 * Garanties :
 *  - le plan passe toujours par validatePlan (quantités bornées, jamais « Administrateur ») ;
 *  - l'application est idempotente : un rôle / une catégorie / un salon du même nom est réutilisé, rien n'est supprimé ;
 *  - l'application tourne en tâche de fond et son avancement peut être interrogé.
 */
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const ai = require('./ai');
const { extractJson } = require('../../lib/ai');
const { validatePlan, summarize, PRESETS, PURPOSES } = require('../../lib/server-templates');
const { schemaCtx } = require('../../web/guild');
const { wait } = require('../util');

const hexToInt = (hex) => (hex ? parseInt(hex.slice(1), 16) : 0);

const TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
};

/* --------------------------------- IA --------------------------------- */

const PLAN_PROMPT = `Tu es un expert en organisation de serveurs Discord. Tu conçois la structure complète d'un serveur à partir de la description de l'administrateur.
Réponds UNIQUEMENT par un objet JSON valide (pas de texte autour, pas de Markdown) de cette forme :
{
  "name": "nom court du plan",
  "roles": [ { "key": "identifiant-court", "name": "🛡️ Nom du rôle", "color": "#8b5cf6", "hoist": true, "mentionable": false, "kind": "staff|member|cosmetic", "preset": "none|helper|moderator|manager" } ],
  "categories": [ { "name": "📌 NOM DE CATÉGORIE", "access": "public|readonly|members|staff",
    "channels": [ { "name": "nom-du-salon", "type": "text|voice|announcement|forum|stage", "topic": "description courte", "access": "public|readonly|members|staff", "purpose": "welcome|rules|logs|tickets|suggestions|verification|announcements|general", "slowmode": 0, "nsfw": false } ] } ]
}
Règles :
- Liste les rôles du plus important au moins important.
- "kind" : staff = équipe de modération (seuls eux ont un "preset" autre que "none"), member = rôle de base des membres, cosmetic = rôle décoratif (grade, couleur…).
- "access" : public = visible et écrivable par tous ; readonly = visible, lecture seule ; members = réservé aux rôles de kind member et staff ; staff = réservé au staff.
- Prévois un salon "purpose": "welcome", un "rules", un "logs" (accès staff) et, si pertinent, "tickets" et "suggestions".
- Utilise des émojis dans les noms de rôles et de catégories. Noms de salons textuels en minuscules avec des tirets.
- Maximum : 25 rôles, 12 catégories, 80 salons. Reste cohérent avec la description, sois concret et utile.
- N'invente aucune permission : uniquement les "preset" listés.`;

/** Demande un plan à l'IA. Renvoie { plan, warnings }. */
async function generatePlan(client, guild, description, { notes = '' } = {}) {
  const text = String(description || '').trim().slice(0, 2000);
  if (text.length < 8) throw new ai.AiError('Décris le serveur que tu veux (au moins une phrase).', 'bad_request');
  const user = [`Description du serveur voulu :\n${text}`, notes ? `Contraintes supplémentaires :\n${String(notes).slice(0, 1000)}` : ''].filter(Boolean).join('\n\n');
  const reply = await ai.ask(client, guild.id, {
    system: PLAN_PROMPT,
    messages: [{ role: 'user', content: user }],
    temperature: 0.6,
    maxTokens: 4000,
    timeoutMs: 90000,
    force: true,
  });
  const json = extractJson(typeof reply === 'string' ? reply : reply?.text);
  if (!json) throw new ai.AiError('L’IA n’a pas renvoyé un plan lisible. Relance la génération.', 'bad_output');
  return validatePlan(json);
}

/* ------------------------------ Application --------------------------- */

const jobs = new Map(); // guildId -> job

function getJob(guildId) {
  return jobs.get(guildId) || null;
}

function publicJob(job) {
  if (!job) return null;
  const { id, status, done, total, log, error, startedAt, finishedAt, summary } = job;
  return { id, status, done, total, log: log.slice(-200), error, startedAt, finishedAt, summary };
}

function overwritesFor(access, ctx) {
  const { everyoneId, botId, staffIds, memberIds } = ctx;
  const botAllow = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageMessages', 'AddReactions', 'ManageChannels'];
  const out = [];
  if (access === 'public') return out;
  if (access === 'readonly') {
    out.push({ id: everyoneId, deny: ['SendMessages', 'AddReactions', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'] });
    for (const id of staffIds) out.push({ id, allow: ['SendMessages'] });
  } else if (access === 'members' && memberIds.length) {
    out.push({ id: everyoneId, deny: ['ViewChannel'] });
    for (const id of [...memberIds, ...staffIds]) out.push({ id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'Connect', 'Speak'] });
  } else if (access === 'staff' && staffIds.length) {
    out.push({ id: everyoneId, deny: ['ViewChannel'] });
    for (const id of staffIds) out.push({ id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'Connect', 'Speak', 'ManageMessages'] });
  } else {
    return out; // pas de rôle adapté : on laisse public plutôt que de verrouiller tout le monde dehors
  }
  out.push({ id: botId, allow: botAllow });
  return out;
}

/**
 * Lance l'application d'un plan en tâche de fond. Un seul chantier à la fois par serveur.
 * @param {object} opts { wire: boolean (relier les salons aux modules), userId }
 */
function startApply(client, guild, rawPlan, opts = {}) {
  const existing = jobs.get(guild.id);
  if (existing && existing.status === 'running') throw new Error('Un chantier est déjà en cours sur ce serveur.');

  const { plan } = validatePlan(rawPlan);
  const sum = summarize(plan);
  const total = sum.roles + sum.categories + sum.channels + (opts.wire ? 1 : 0);
  const job = { id: Date.now().toString(36), status: 'running', done: 0, total, log: [], error: null, startedAt: Date.now(), finishedAt: null, summary: sum, created: { roles: 0, categories: 0, channels: 0 }, reused: 0 };
  jobs.set(guild.id, job);

  run(client, guild, plan, opts, job).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = Date.now();
    job.log.push(`❌ ${err.message}`);
  });
  return publicJob(job);
}

async function run(client, guild, plan, opts, job) {
  const me = guild.members.me || await guild.members.fetchMe();
  const need = ['ManageRoles', 'ManageChannels'].filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
  if (need.length) throw new Error('Il me manque les permissions « Gérer les rôles » et/ou « Gérer les salons ».');

  const step = (line) => { job.done += 1; job.log.push(line); };
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  /* ---- Rôles (du plus haut au plus bas, pour garder l'ordre) ---- */
  const roleIds = new Map();
  for (const r of plan.roles) {
    const found = guild.roles.cache.find((x) => x.name.toLowerCase() === r.name.toLowerCase() && !x.managed);
    if (found) {
      roleIds.set(r.key, found.id);
      job.reused++;
      step(`↺ Rôle existant : ${r.name}`);
      continue;
    }
    try {
      const role = await guild.roles.create({
        name: r.name,
        color: hexToInt(r.color) || undefined,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: PRESETS[r.preset] || [],
        reason: 'Créateur de serveur (dashboard)',
      });
      roleIds.set(r.key, role.id);
      job.created.roles++;
      step(`✅ Rôle créé : ${r.name}`);
    } catch (err) {
      step(`⚠️ Rôle « ${r.name} » non créé : ${err.message}`);
    }
    await wait(300);
  }

  const idsOfKind = (...kinds) => plan.roles.filter((r) => kinds.includes(r.kind)).map((r) => roleIds.get(r.key)).filter(Boolean);
  const ow = { everyoneId: guild.id, botId: me.id, staffIds: idsOfKind('staff'), memberIds: idsOfKind('member') };

  /* ---- Catégories et salons ---- */
  const purposeChannel = {};
  for (const cat of plan.categories) {
    let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === cat.name.toLowerCase());
    if (category) {
      job.reused++;
      step(`↺ Catégorie existante : ${cat.name}`);
    } else {
      try {
        category = await guild.channels.create({
          name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: overwritesFor(cat.access, ow), reason: 'Créateur de serveur (dashboard)',
        });
        job.created.categories++;
        step(`✅ Catégorie créée : ${cat.name}`);
      } catch (err) {
        step(`⚠️ Catégorie « ${cat.name} » non créée : ${err.message}`);
        job.done += cat.channels.length;
        continue;
      }
      await wait(300);
    }

    for (const ch of cat.channels) {
      const type = TYPE_MAP[ch.type] ?? ChannelType.GuildText;
      const found = guild.channels.cache.find((c) => c.parentId === category.id && c.type === type && c.name.toLowerCase() === ch.name.toLowerCase());
      if (found) {
        if (ch.purpose && !purposeChannel[ch.purpose]) purposeChannel[ch.purpose] = found.id;
        job.reused++;
        step(`↺ Salon existant : ${ch.name}`);
        continue;
      }
      try {
        const textual = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(type);
        const created = await guild.channels.create({
          name: ch.name,
          type,
          parent: category.id,
          topic: textual && ch.topic ? ch.topic : undefined,
          nsfw: textual ? ch.nsfw : undefined,
          rateLimitPerUser: textual && ch.slowmode ? ch.slowmode : undefined,
          userLimit: type === ChannelType.GuildVoice && ch.userLimit ? ch.userLimit : undefined,
          // Une catégorie déjà restreinte transmet ses règles ; on ne précise que si le salon diffère de la catégorie.
          permissionOverwrites: ch.access === cat.access ? undefined : overwritesFor(ch.access, ow),
          reason: 'Créateur de serveur (dashboard)',
        });
        if (ch.purpose && !purposeChannel[ch.purpose]) purposeChannel[ch.purpose] = created.id;
        job.created.channels++;
        step(`✅ Salon créé : ${ch.name}`);
      } catch (err) {
        step(`⚠️ Salon « ${ch.name} » non créé : ${err.message}`);
      }
      await wait(300);
    }
  }

  /* ---- Branchement sur les modules du bot ---- */
  if (opts.wire) {
    const { settings } = client.ctx;
    const ctx = schemaCtx(guild);
    const patch = (moduleId, changes) => {
      const current = JSON.parse(JSON.stringify(settings.get(guild.id)[moduleId]));
      settings.saveModule(guild.id, moduleId, deepAssign(current, changes), ctx);
    };
    const wired = [];
    try {
      if (purposeChannel.welcome) { patch('welcome', { enabled: true, channelId: purposeChannel.welcome }); wired.push('Bienvenue'); }
      if (purposeChannel.logs) { patch('logs', { enabled: true, channelId: purposeChannel.logs }); wired.push('Journaux'); }
      if (purposeChannel.suggestions) { patch('suggestions', { enabled: true, channelId: purposeChannel.suggestions }); wired.push('Suggestions'); }
      if (purposeChannel.tickets) { patch('tickets', { panelChannelId: purposeChannel.tickets }); wired.push('Tickets (salon du panneau)'); }
      if (purposeChannel.verification) { patch('verification', { channelId: purposeChannel.verification }); wired.push('Vérification'); }
    } catch (err) {
      job.log.push(`⚠️ Branchement partiel : ${err.message}`);
    }
    job.done += 1;
    job.log.push(wired.length ? `🔌 Modules reliés : ${wired.join(', ')}` : 'ℹ️ Aucun salon à relier aux modules.');
  }

  job.done = job.total;
  job.status = 'done';
  job.finishedAt = Date.now();
  job.log.push(`🎉 Terminé : ${job.created.roles} rôle(s), ${job.created.categories} catégorie(s), ${job.created.channels} salon(s) créés ; ${job.reused} déjà présent(s).`);
}

function deepAssign(target, src) {
  for (const [k, val] of Object.entries(src)) {
    if (val && typeof val === 'object' && !Array.isArray(val) && target[k] && typeof target[k] === 'object') deepAssign(target[k], val);
    else target[k] = val;
  }
  return target;
}

module.exports = { generatePlan, startApply, getJob, publicJob, overwritesFor, PLAN_PROMPT, PURPOSES };
