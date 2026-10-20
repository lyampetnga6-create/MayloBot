'use strict';
const { Events, MessageFlags, PermissionFlagsBits, AuditLogEvent, Guild } = require('discord.js');

const automod = require('./modules/automod');
const levels = require('./modules/levels');
const welcome = require('./modules/welcome');
const logs = require('./modules/logs');
const tickets = require('./modules/tickets');
const rolepanels = require('./modules/rolepanels');
const custom = require('./modules/customcommands');
const protection = require('./modules/protection');
const appeals = require('./modules/appeals');
const feeds = require('./modules/feeds');
const streams = require('./modules/streams');
const tiktok = require('./modules/tiktok');
const voicecontrol = require('./modules/voicecontrol');
const rocketleague = require('./modules/rocketleague');
const invites = require('./modules/invites');
const serverstats = require('./modules/serverstats');
const dms = require('./modules/dms');
const honeypot = require('./modules/honeypot');
const verification = require('./modules/verification');
const community = require('./modules/community');
const economy = require('./modules/economy');
const automation = require('./modules/automation');
const extras = require('./modules/extras');
const funCommands = require('./commands/fun');
const { MODULE_BY_ID } = require('../schema');
const { applyPresence } = require('./presence');
const { registerCommands } = require('./deploy');
const { startScheduler } = require('./scheduler');

/** Exécute un gestionnaire sans jamais laisser une erreur faire tomber le bot. */
const safe = (name, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error(`[${name}]`, err);
  }
};

/* --------------------------- Abonnement / essai --------------------------- */
/** Serveur concerné par un événement Discord (message, membre, salon, rôle, réaction, entrée de journal…). */
function guildOfArgs(args) {
  for (const a of args) {
    if (!a) continue;
    if (a instanceof Guild) return a;
    const g = a.guild || a.message?.guild || a.channel?.guild;
    if (g) return g;
  }
  return null;
}

/** Le serveur a-t-il le droit d'utiliser le bot (essai en cours ou licence active) ? Toujours vrai si les licences sont désactivées. */
const isAllowed = (client, guild) => {
  if (!guild) return true;
  const full = client.guilds.cache.get(guild.id) || guild; // certains événements ne donnent qu'un serveur partiel (sans propriétaire)
  return client.ctx.license.status(full.id, full.ownerId).allowed;
};

/**
 * Comme `safe`, mais ne fait rien sur les serveurs dont l'essai est terminé et qui n'ont pas de licence active.
 * (Le bot reste présent mais muet : plus de modération, de logs ni de modules.)
 */
const live = (client, name, fn) => safe(name, async (...args) => {
  if (!isAllowed(client, guildOfArgs(args))) return;
  await fn(...args);
});

/** Vue du client Discord qui ne montre que les serveurs autorisés : les tâches périodiques ignorent donc les autres. */
function gatedClient(client) {
  if (!client.ctx.license.enabled) return client;
  const license = client.ctx.license;
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'guilds') {
        const cache = target.guilds.cache.filter((g) => license.status(g.id, g.ownerId).allowed);
        return { cache };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Message affiché aux membres d'un serveur dont l'essai est terminé. */
function expiredMessage(client) {
  const { config } = client.ctx;
  return `🔒 **L’essai gratuit de ce serveur est terminé.**\nUn administrateur peut activer le bot avec une clé de licence (${config.license.priceLabel}) : ${config.baseUrl}/dashboard#/account\nou avec la commande \`/licence activer\`.`;
}

const MIN = 60 * 1000;

/** Tâches périodiques du bot. */
const JOBS = [
  { name: 'tickets', everyMs: 5 * MIN, run: (c) => tickets.tick(c) },
  { name: 'contestations', everyMs: 5 * MIN, run: (c) => appeals.tick(c) },
  { name: 'flux', everyMs: 2 * MIN, firstMs: 60 * 1000, run: (c) => feeds.tick(c) },
  { name: 'lives', everyMs: MIN, firstMs: 45 * 1000, run: (c) => streams.tick(c) },
  { name: 'tiktok vidéos', everyMs: 2 * MIN, firstMs: 75 * 1000, run: (c) => tiktok.tickVideos(c) },
  { name: 'recherche de joueurs', everyMs: 2 * MIN, firstMs: 90 * 1000, run: (c) => rocketleague.tickLfg(c) },
  { name: 'boutique Rocket League', everyMs: 5 * MIN, firstMs: 2 * MIN, run: (c) => rocketleague.tickShop(c) },
  { name: 'tiktok lives', everyMs: MIN, firstMs: 50 * 1000, run: (c) => tiktok.tickLive(c) },
  { name: 'nettoyage messagerie', everyMs: 60 * MIN, firstMs: 5 * MIN, run: (c) => dms.tick(c) },
  { name: 'statistiques', everyMs: 30 * 1000, run: (c) => serverstats.tick(c) },
  { name: 'vérification', everyMs: 2 * MIN, run: (c) => verification.tick(c) },
  { name: 'concours', everyMs: 15 * 1000, run: (c) => community.tickGiveaways(c) },
  { name: 'sondages', everyMs: 30 * 1000, run: (c) => community.tickPolls(c) },
  { name: 'rappels', everyMs: 15 * 1000, run: (c) => extras.tickReminders(c) },
  { name: 'bans temporaires', everyMs: MIN, run: (c) => extras.tickTempBans(c) },
  { name: 'anniversaires', everyMs: 10 * MIN, run: (c) => community.tickBirthdays(c) },
  { name: 'bump', everyMs: MIN, run: (c) => community.tickBump(c) },
  { name: 'compteurs', everyMs: 10 * MIN, run: (c) => automation.tickCounters(c) },
  { name: 'messages programmés', everyMs: MIN, run: (c) => automation.tickAutoMessages(c) },
  { name: 'xp vocal', everyMs: MIN, firstMs: 60 * 1000, run: (c) => levels.tickVoice(c) },
];

/**
 * Vérifie qu'une commande peut s'exécuter ici (module activé, commande non désactivée, bon salon).
 * Renvoie un message d'erreur, ou null si tout est bon.
 */
function commandBlocked(client, interaction, cmd) {
  const { settings } = client.ctx;
  const gid = interaction.guild.id;
  const general = settings.module(gid, 'general');
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const name = cmd.data.name;

  if (general.disabledCommands.some((n) => n.replace(/^\//, '') === name)) return `La commande \`/${name}\` est désactivée sur ce serveur.`;
  if (!isAdmin && general.commandChannels.length) {
    const ch = interaction.channel;
    if (!general.commandChannels.includes(interaction.channelId) && !(ch?.parentId && general.commandChannels.includes(ch.parentId))) {
      return `Les commandes sont réservées à certains salons : ${general.commandChannels.slice(0, 5).map((id) => `<#${id}>`).join(', ')}.`;
    }
  }
  if (cmd.module) {
    const mod = MODULE_BY_ID.get(cmd.module);
    if (mod?.toggle && !settings.module(gid, cmd.module)[mod.toggle]) return `Le module « ${mod.name} » est désactivé. Un administrateur peut l’activer depuis le dashboard.`;
    if (cmd.module === 'fun') {
      const fun = settings.module(gid, 'fun');
      if (!isAdmin && fun.allowedChannels.length && !fun.allowedChannels.includes(interaction.channelId)) return `Les commandes de divertissement sont réservées à : ${fun.allowedChannels.slice(0, 5).map((id) => `<#${id}>`).join(', ')}.`;
    }
  }
  return null;
}

const funCooldown = new Map();
function funCooldownLeft(client, interaction) {
  const cd = client.ctx.settings.module(interaction.guild.id, 'fun').cooldown;
  if (!cd) return 0;
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  const left = (funCooldown.get(key) || 0) + cd * 1000 - Date.now();
  if (left > 0) return Math.ceil(left / 1000);
  funCooldown.set(key, Date.now());
  if (funCooldown.size > 10000) funCooldown.clear();
  return 0;
}

function registerEvents(client) {
  const { config } = client.ctx;
  let stopScheduler = null;

  client.once(Events.ClientReady, safe('ready', async (c) => {
    console.log(`✅ Connecté en tant que ${c.user.tag} sur ${c.guilds.cache.size} serveur(s)`);
    applyPresence(client);
    setInterval(() => applyPresence(client), 10 * 60 * 1000).unref();
    stopScheduler = startScheduler(client, JOBS.map((job) => ({ ...job, run: (c) => job.run(gatedClient(c)) })));
    // Démarre l'essai gratuit des serveurs où le bot est déjà présent.
    for (const g of c.guilds.cache.values()) client.ctx.license.status(g.id, g.ownerId);
    await automation.cleanupTempVoice(client);
    await invites.warm(client);
    if (config.autoDeployCommands) {
      const n = await registerCommands(config, client.commands);
      console.log(`✅ ${n} commandes slash enregistrées${config.devGuildId ? ' (serveur de test)' : ' (globales)'}`);
    }
  }));
  client.stopScheduler = () => stopScheduler?.();

  client.on(Events.GuildCreate, (g) => {
    console.log(`➕ Ajouté sur ${g.name} (${g.memberCount} membres)`);
    client.ctx.license.status(g.id, g.ownerId); // démarre l'essai gratuit
  });
  client.on(Events.GuildDelete, (g) => console.log(`➖ Retiré de ${g.name || g.id}`));

  /* ----------------------------- Messages ----------------------------- */
  client.on(Events.MessageCreate, live(client, 'messageCreate', async (message) => {
    if (!message.guild) {
      await dms.onDirectMessage(client, message);
      return;
    }
    if (message.system) return;
    if (await honeypot.handleMessage(client, message)) return;
    serverstats.onMessage(client, message);
    if (message.author.bot) {
      await community.onBumpMessage(client, message);
      return;
    }
    if (await protection.onMessage(client, message)) return;
    if (await automod.handleMessage(client, message)) return;
    if (await automation.onChannelRule(client, message)) return;
    await extras.onAfkMessage(client, message);
    if (await community.onCountingMessage(client, message)) return;
    await tickets.onMessage(client, message);
    await levels.handleMessage(client, message);
    economy.onMessage(client, message);
    await custom.handleMessage(client, message);
    await automation.onSticky(client, message);
  }));

  client.on(Events.MessageDelete, live(client, 'messageDelete', async (m) => {
    extras.recordDeleted(m);
    await logs.messageDelete(client, m);
  }));
  client.on(Events.MessageBulkDelete, live(client, 'bulkDelete', (messages, channel) => logs.bulkDelete(client, messages, channel)));
  client.on(Events.MessageUpdate, live(client, 'messageUpdate', async (before, after) => {
    extras.recordEdited(before, after);
    // Une modification peut aussi être une insulte ajoutée après coup : on repasse par l'auto-modération.
    if (after.guild && !after.partial && !after.author?.bot && after.content !== before.content) {
      if (await protection.onMessage(client, after)) return;
      await automod.handleMessage(client, after, { skipSpam: true });
    }
    await logs.messageUpdate(client, before, after);
  }));
  client.on(Events.MessageReactionAdd, live(client, 'reactionAdd', (reaction, user) => (user.bot ? null : community.onReaction(client, reaction))));
  client.on(Events.MessageReactionRemove, live(client, 'reactionRemove', (reaction, user) => (user.bot ? null : community.onReaction(client, reaction))));

  /* ------------------------------ Membres ----------------------------- */
  client.on(Events.GuildMemberAdd, live(client, 'memberAdd', async (member) => {
    serverstats.onMemberAdd(client, member);
    await invites.onMemberAdd(client, member);
    const blocked = await protection.onMemberJoin(client, member);
    if (!blocked) {
      await extras.restoreRoles(client, member);
      await welcome.onMemberAdd(client, member);
      await verification.onMemberAdd(client, member);
      await automation.applyNickname(client, member, { isJoin: true });
    }
    await logs.memberJoin(client, member);
  }));
  client.on(Events.GuildMemberRemove, live(client, 'memberRemove', async (member) => {
    serverstats.onMemberRemove(client, member);
    invites.onMemberRemove(client, member);
    extras.saveRoles(client, member);
    levels.onMemberLeave(client, member);
    verification.onMemberRemove(client, member);
    await welcome.onMemberRemove(client, member);
    await logs.memberLeave(client, member);
  }));
  client.on(Events.GuildMemberUpdate, live(client, 'memberUpdate', async (a, b) => {
    await community.onMemberUpdate(client, a, b);
    if (!a.partial && a.displayName !== b.displayName) await automation.applyNickname(client, b, {});
    await logs.memberUpdate(client, a, b);
  }));
  client.on(Events.GuildBanAdd, live(client, 'banAdd', (b) => logs.ban(client, b, true)));
  client.on(Events.GuildBanRemove, live(client, 'banRemove', (b) => logs.ban(client, b, false)));

  /* ------------------------- Salons, rôles, vocal ---------------------- */
  client.on(Events.ChannelCreate, live(client, 'channelCreate', (c) => logs.channelChange(client, c, true)));
  client.on(Events.ChannelDelete, live(client, 'channelDelete', async (c) => {
    tickets.onChannelDelete(client, c);
    await logs.channelChange(client, c, false);
  }));
  client.on(Events.ChannelUpdate, live(client, 'channelUpdate', (a, b) => logs.channelUpdate(client, a, b)));
  client.on(Events.GuildRoleCreate, live(client, 'roleCreate', (r) => logs.roleChange(client, r, true)));
  client.on(Events.GuildRoleDelete, live(client, 'roleDelete', (r) => logs.roleChange(client, r, false)));
  client.on(Events.GuildRoleUpdate, live(client, 'roleUpdate', (a, b) => logs.roleUpdate(client, a, b)));
  client.on(Events.GuildUpdate, live(client, 'guildUpdate', (a, b) => logs.guildUpdate(client, a, b)));
  client.on(Events.InviteCreate, live(client, 'inviteCreate', (i) => { invites.onInviteCreate(client, i); return logs.inviteChange(client, i, true); }));
  client.on(Events.InviteDelete, live(client, 'inviteDelete', (i) => { invites.onInviteDelete(client, i); return logs.inviteChange(client, i, false); }));
  client.on(Events.ThreadCreate, live(client, 'threadCreate', (t) => logs.threadChange(client, t, true)));
  client.on(Events.ThreadDelete, live(client, 'threadDelete', (t) => logs.threadChange(client, t, false)));
  client.on(Events.VoiceStateUpdate, live(client, 'voice', async (a, b) => {
    await automation.onVoiceState(client, a, b);
    await logs.voiceState(client, a, b);
  }));

  /** Journal d'audit : anti-nuke + expulsions (non couvertes par GuildMemberRemove). */
  client.on(Events.GuildAuditLogEntryCreate, live(client, 'auditEntry', async (entry, guild) => {
    await protection.onAuditEntry(client, entry, guild);
    await appeals.onAuditEntry(client, guild, entry);
    if (entry.action === AuditLogEvent.MemberKick) await logs.kick(client, guild, entry);
  }));

  /* ---------------------------- Interactions -------------------------- */
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;
        if (!interaction.guild) {
          await interaction.reply({ content: 'Les commandes ne fonctionnent que sur un serveur.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (cmd.data.name !== 'licence' && !isAllowed(client, interaction.guild)) {
          await interaction.reply({ content: expiredMessage(client), flags: MessageFlags.Ephemeral });
          return;
        }
        const blocked = commandBlocked(client, interaction, cmd);
        if (blocked) {
          await interaction.reply({ content: `🚫 ${blocked}`, flags: MessageFlags.Ephemeral });
          return;
        }
        if (cmd.module === 'fun') {
          const left = funCooldownLeft(client, interaction);
          if (left) {
            await interaction.reply({ content: `⏳ Patiente ${left} s avant la prochaine commande de divertissement.`, flags: MessageFlags.Ephemeral });
            return;
          }
        }
        await cmd.execute(interaction);
        logs.command(client, interaction).catch(() => {});
        return;
      }
      if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu?.()) {
        const id = interaction.customId || '';
        if (!isAllowed(client, interaction.guild)) {
          await interaction.reply({ content: expiredMessage(client), flags: MessageFlags.Ephemeral });
          return;
        }
        if (id.startsWith('ttt:') && interaction.isButton()) { await funCommands.handleTicTacToe(client, interaction); return; }
        if (await appeals.handleInteraction(client, interaction)) return;
        if (await tickets.handleInteraction(client, interaction)) return;
        if (await verification.handleInteraction(client, interaction)) return;
        if (await rolepanels.handleInteraction(client, interaction)) return;
        if (await voicecontrol.handleInteraction(client, interaction)) return;
        if (await rocketleague.handleInteraction(client, interaction)) return;
        if (await community.handleInteraction(client, interaction)) return;
      }
    } catch (err) {
      console.error('[interaction]', err);
      const payload = { content: '❌ Une erreur est survenue. Réessaie dans un instant.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred) await interaction.editReply({ content: payload.content });
        else if (interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch { /* l'interaction a expiré */ }
    }
  });

  client.on(Events.Error, (err) => console.error('[client]', err));
  client.on(Events.Warn, (msg) => console.warn('[client]', msg));
}

module.exports = { registerEvents, commandBlocked, JOBS, gatedClient, isAllowed, guildOfArgs };
