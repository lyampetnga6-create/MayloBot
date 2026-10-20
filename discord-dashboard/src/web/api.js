'use strict';
const express = require('express');
const { PermissionFlagsBits } = require('discord.js');

const { MODULES, MODULE_BY_ID, publicSchema, normalizeValue, SNOWFLAKE } = require('../schema');
const { buildMessage } = require('../lib/template');
const { guildMeta, schemaCtx, inviteUrl } = require('./guild');
const { getPresence, savePresence, applyPresence, STATUSES, TYPES } = require('../bot/presence');
const levelsModule = require('../bot/modules/levels');
const tickets = require('../bot/modules/tickets');
const rolepanels = require('../bot/modules/rolepanels');
const { getSendable } = require('../bot/util');
const aiService = require('../bot/modules/ai');
const { AiError } = require('../lib/ai');
const webhooks = require('../bot/modules/webhooks');
const profile = require('../bot/modules/profile');
const builder = require('../bot/modules/server-builder');
const templates = require('../lib/server-templates');
const honeypot = require('../bot/modules/honeypot');
const feeds = require('../bot/modules/feeds');
const streams = require('../bot/modules/streams');
const tiktok = require('../bot/modules/tiktok');
const rocketleague = require('../bot/modules/rocketleague');
const dms = require('../bot/modules/dms');
const invitesModule = require('../bot/modules/invites');
const serverstats = require('../bot/modules/serverstats');
const verification = require('../bot/modules/verification');
const protection = require('../bot/modules/protection');
const { LicenseService, LicenseError } = require('../lib/license');
const { AccountService, AccountError } = require('../lib/accounts');
const { rateLimit } = require('express-rate-limit');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PAGE_SIZE = 25;
const CASE_TYPES = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban'];

/** Permissions dont le bot a besoin, avec leur libellé Discord en français. */
const NEEDED_PERMS = {
  ManageRoles: 'Gérer les rôles',
  ManageChannels: 'Gérer les salons',
  KickMembers: 'Expulser des membres',
  BanMembers: 'Bannir des membres',
  ModerateMembers: 'Exclure temporairement des membres',
  ManageMessages: 'Gérer les messages',
  EmbedLinks: 'Intégrer des liens',
  AttachFiles: 'Joindre des fichiers',
  ManageWebhooks: 'Gérer les webhooks',
  ViewAuditLog: 'Voir les logs du serveur',
  ManageNicknames: 'Gérer les pseudos',
};

const avatarUrl = (id, hash) => (hash
  ? `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`
  : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`);

/** Avatar des comptes (sans Discord) : pastille violette avec l'initiale, en image intégrée. */
const accountAvatar = (name) => {
  const letter = (String(name || '?').trim().charAt(0) || '?').toUpperCase().replace(/[<>&"']/g, '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#8b5cf6"/><text x="32" y="43" font-size="30" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};
const ACCOUNT_ID = /^acc:(\d{1,9})$/;

const iconUrl = (id, hash) => (hash
  ? `https://cdn.discordapp.com/icons/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`
  : null);

function createApiRouter({ client, db, settings, config }) {
  const router = express.Router();

  /* ------------------------------ Aides ------------------------------ */
  const accounts = client.ctx?.accounts || new AccountService({ db });
  /** Exécute une opération sur les comptes en transformant ses erreurs métier en erreurs HTTP. */
  const acct = async (fn) => {
    try { return await fn(); } catch (err) { throw err instanceof AccountError ? new HttpError(err.status, err.message) : err; }
  };
  const isBotOwner = (req) => (req.account ? req.account.role === 'admin' : config.ownerIds.includes(req.session.user.id));

  /**
   * Pas de compte, pas d'accès : la session doit venir d'un compte actif, ou d'un propriétaire du bot (OWNER_IDS).
   * Un compte supprimé, désactivé ou dont le mot de passe a changé perd immédiatement sa session.
   */
  const requireAuth = (req, res, next) => {
    const sess = req.session;
    if (!sess?.user) return res.status(401).json({ error: 'Non connecté.' });
    if (sess.accountId) {
      const acc = accounts.get(sess.accountId);
      if (acc && !acc.disabled && acc.pwChangedAt === sess.pwv) {
        req.account = acc;
        return next();
      }
    } else if (config.ownerIds.includes(sess.user.id)) {
      return next();
    }
    return sess.destroy(() => {
      res.clearCookie('sid');
      res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
    });
  };

  const requireOwner = (req, res, next) => {
    if (!isBotOwner(req)) return res.status(403).json({ error: 'Réservé aux administrateurs du bot.' });
    return next();
  };

  /** Serveurs visibles par la session : ceux du compte, ou ceux que le propriétaire Discord peut gérer. */
  const sessionGuilds = (req) => {
    if (!req.account) return req.session.guilds || [];
    const a = req.account;
    const ids = a.role === 'admin' ? [...client.guilds.cache.keys()] : a.guildIds;
    return ids.map((id) => {
      const g = client.guilds.cache.get(id);
      return { id, name: g ? g.name : `Serveur ${id}`, icon: g?.icon || null };
    });
  };

  const guildAccess = async (req, res, next) => {
    if (!client.isReady()) return res.status(503).json({ error: 'Le bot démarre, réessaie dans quelques secondes.' });
    const { guildId } = req.params;
    if (!SNOWFLAKE.test(guildId)) return res.status(400).json({ error: 'Identifiant de serveur invalide.' });
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Le bot n’est pas sur ce serveur.' });

    if (req.account) {
      // Compte du dashboard : l'administrateur voit tous les serveurs, les autres seulement ceux qui leur sont attribués.
      if (req.account.role !== 'admin' && !req.account.guildIds.includes(guildId)) {
        return res.status(403).json({ error: 'Ce compte n’a pas accès à ce serveur.' });
      }
      req.guild = guild;
      req.isAdmin = true;
      return next();
    }

    // Les droits sont vérifiés en direct auprès de Discord (via le bot), pas à partir d'une liste périmée.
    const userId = req.session.user.id;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const allowed = userId === guild.ownerId || (member && member.permissions.has(PermissionFlagsBits.ManageGuild));
    if (!allowed) return res.status(403).json({ error: 'Il faut la permission « Gérer le serveur » pour configurer ce serveur.' });

    req.guild = guild;
    req.isAdmin = userId === guild.ownerId || Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
    return next();
  };

  /** Certaines actions (protections, clé d'IA, créateur de serveur) exigent d'être administrateur du serveur. */
  const requireAdmin = (req, res, next) => {
    if (!req.isAdmin) return res.status(403).json({ error: 'Cette action est réservée aux administrateurs du serveur.' });
    return next();
  };

  /** Historique des modifications faites depuis le dashboard. */
  const record = (req, action, detail = '') => {
    try {
      db.prepare('INSERT INTO audit (guild_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
        .run(req.guild.id, req.session.user.id, action, String(detail).slice(0, 300), Date.now());
      db.prepare('DELETE FROM audit WHERE guild_id = ? AND id NOT IN (SELECT id FROM audit WHERE guild_id = ? ORDER BY id DESC LIMIT 2000)').run(req.guild.id, req.guild.id);
    } catch (err) {
      console.warn('[audit]', err.message);
    }
  };

  async function resolveUsers(ids) {
    const all = [...new Set(ids)];
    const unique = all.filter((id) => SNOWFLAKE.test(id)).slice(0, 60);
    const out = {};
    for (const id of all.filter((i) => ACCOUNT_ID.test(i)).slice(0, 60)) {
      const a = accounts.get(ACCOUNT_ID.exec(id)[1]);
      const name = a ? (a.displayName || a.username) : 'Compte supprimé';
      out[id] = { id, name, username: a ? a.username : id, avatar: accountAvatar(name) };
    }
    await Promise.all(unique.map(async (id) => {
      const u = client.users.cache.get(id) || await client.users.fetch(id).catch(() => null);
      out[id] = u
        ? { id, name: u.globalName || u.username, username: u.username, avatar: u.displayAvatarURL({ size: 64, extension: 'png' }) }
        : { id, name: 'Utilisateur inconnu', username: id, avatar: avatarUrl(id, null) };
    }));
    return out;
  }

  const countQuery = (sql, ...args) => db.prepare(sql).get(...args).n;

  /* ----------------------------- Abonnement ----------------------------- */
  const license = client.ctx?.license || new LicenseService({ db, config });
  /** Exécute une opération sur les licences en transformant ses erreurs métier en erreurs HTTP. */
  const lic = async (fn) => {
    try { return await fn(); } catch (err) { throw err instanceof LicenseError ? new HttpError(err.status, err.message) : err; }
  };
  const guildLabel = (id) => client.guilds.cache.get(id)?.name || 'Serveur inconnu';
  const publicLicense = (l, { withKey = false } = {}) => ({
    id: l.id, status: l.status, active: l.active, periodEnd: l.periodEnd, maxGuilds: l.maxGuilds, source: l.source, hasStripe: l.hasStripe,
    keyHint: l.keyHint, createdAt: l.createdAt, note: l.note || '',
    ...(withKey ? { key: l.key } : {}),
    guilds: license.guildsOf(l.id).map((g) => ({ guildId: g.guildId, name: guildLabel(g.guildId), activatedAt: g.activatedAt })),
  });

  /* ------------------------------ Public ----------------------------- */
  router.get('/public', (req, res) => {
    res.json({
      botName: config.botName,
      inviteUrl: config.clientId ? inviteUrl(config.clientId) : null,
      supportUrl: config.supportUrl || null,
      discordLogin: Boolean(config.clientId && config.clientSecret && config.ownerIds.length),
      needsSetup: !accounts.activeAdmins() && !config.ownerIds.length,
      license: { enabled: license.enabled, priceLabel: config.license.priceLabel, trialDays: config.license.trialDays },
    });
  });

  /* ------------------------------ Session ---------------------------- */
  router.get('/me', requireAuth, (req, res) => {
    const u = req.session.user;
    const guilds = sessionGuilds(req).map((g) => {
      const live = client.guilds.cache.get(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: iconUrl(g.id, g.icon),
        botPresent: Boolean(live),
        memberCount: live ? live.memberCount : null,
        inviteUrl: live ? null : inviteUrl(config.clientId, g.id),
      };
    }).sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));

    const a = req.account;
    res.json({
      user: a
        ? { id: u.id, name: a.displayName || a.username, username: a.username, avatar: accountAvatar(a.displayName || a.username) }
        : { id: u.id, name: u.global_name || u.username, username: u.username, avatar: avatarUrl(u.id, u.avatar) },
      account: a ? { id: a.id, username: a.username, role: a.role } : null,
      isOwner: isBotOwner(req),
      ready: client.isReady(),
      guilds,
    });
  });

  /* ------------------------- Connexion par compte ------------------------- */
  const loginLimiter = rateLimit({
    windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    const acc = await acct(() => accounts.authenticate(req.body?.username, req.body?.password, req.ip));
    // Nouvelle session à chaque connexion (évite la fixation de session).
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: `acc:${acc.id}`, username: acc.username, global_name: acc.displayName || acc.username, avatar: null };
      req.session.accountId = acc.id;
      req.session.pwv = acc.pwChangedAt;
      return req.session.save((saveErr) => (saveErr ? next(saveErr) : res.json({ ok: true })));
    });
  });

  router.post('/me/password', requireAuth, async (req, res) => {
    if (!req.account) throw new HttpError(400, 'Ce compte Discord n’a pas de mot de passe.');
    const { current, next } = req.body || {};
    req.session.pwv = await acct(() => accounts.changeOwnPassword(req.account.id, current, next));
    await new Promise((resolve, reject) => { req.session.save((e) => (e ? reject(e) : resolve())); });
    res.json({ ok: true });
  });

  router.post('/logout', requireAuth, (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('sid');
      return res.json({ ok: true });
    });
  });

  router.get('/schema', requireAuth, (req, res) => res.json(publicSchema()));

  /* --- Mon abonnement (niveau compte) --- */
  router.get('/account', requireAuth, (req, res) => {
    const u = req.session.user;
    res.json({
      enabled: license.enabled,
      priceLabel: config.license.priceLabel,
      trialDays: config.license.trialDays,
      stripeReady: license.stripeReady,
      licenses: license.enabled ? license.listByOwner(u.id).map((l) => publicLicense(l, { withKey: true })) : [],
      guilds: sessionGuilds(req).filter((g) => client.guilds.cache.has(g.id)).map((g) => {
        const live = client.guilds.cache.get(g.id);
        const st = license.status(g.id, live.ownerId);
        return { id: g.id, name: g.name, state: st.state, allowed: st.allowed, trialEndsAt: st.trialEndsAt || null, periodEnd: st.periodEnd || null };
      }),
    });
  });

  router.post('/account/checkout', requireAuth, async (req, res) => {
    if (!license.enabled) throw new HttpError(400, 'Les abonnements ne sont pas activés sur ce bot.');
    res.json({ url: await lic(() => license.createCheckout(req.session.user.id)) });
  });

  router.post('/account/portal', requireAuth, async (req, res) => {
    const l = license.getById(req.body?.licenseId);
    if (!l || l.ownerId !== req.session.user.id) throw new HttpError(404, 'Licence introuvable.');
    res.json({ url: await lic(() => license.createPortal(l)) });
  });

  /* ------------------------------ Serveur ---------------------------- */
  const guildRouter = express.Router({ mergeParams: true });
  router.use('/guilds/:guildId', requireAuth, guildAccess, guildRouter);

  /* --- Licence du serveur (accessible même quand l'essai est terminé) --- */
  const guildLicenseView = (req) => {
    const st = license.status(req.guild.id, req.guild.ownerId);
    const l = license.licenseOfGuild(req.guild.id);
    return {
      enabled: license.enabled, priceLabel: config.license.priceLabel, ...st,
      license: l ? { id: l.id, status: l.status, active: l.active, periodEnd: l.periodEnd, keyHint: l.keyHint, mine: l.ownerId === req.session.user.id } : null,
    };
  };

  guildRouter.get('/license', (req, res) => res.json(guildLicenseView(req)));

  guildRouter.post('/license', requireAdmin, async (req, res) => {
    if (!license.enabled) throw new HttpError(400, 'Les abonnements ne sont pas activés sur ce bot.');
    const { key, licenseId } = req.body || {};
    let target;
    if (key) {
      target = license.getByKey(String(key));
      if (!target) throw new HttpError(404, 'Clé introuvable. Vérifie-la (format KEY-XXXX-XXXX-XXXX-XXXX).');
    } else {
      target = license.getById(licenseId);
      // Sans la clé, on ne peut utiliser que ses propres licences.
      if (!target || target.ownerId !== req.session.user.id) throw new HttpError(404, 'Licence introuvable.');
    }
    await lic(() => license.activate(target.id, req.guild.id, req.session.user.id));
    record(req, 'license', 'Licence activée sur ce serveur');
    res.json(guildLicenseView(req));
  });

  guildRouter.delete('/license', requireAdmin, (req, res) => {
    if (!license.deactivate(req.guild.id)) throw new HttpError(404, 'Aucune licence n’est activée sur ce serveur.');
    record(req, 'license', 'Licence retirée de ce serveur');
    res.json(guildLicenseView(req));
  });

  // Essai terminé et pas de licence : le dashboard reste consultable mais plus rien ne peut être modifié.
  guildRouter.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const st = license.status(req.guild.id, req.guild.ownerId);
    if (st.allowed) return next();
    return res.status(402).json({ error: 'L’essai gratuit de ce serveur est terminé : active une clé de licence (page « Abonnement ») pour modifier la configuration.', code: 'license_required' });
  });

  guildRouter.get('/', (req, res) => {
    const g = req.guild;
    const s = settings.get(g.id);
    const me = g.members.me;
    const missing = Object.entries(NEEDED_PERMS)
      .filter(([flag]) => me && !me.permissions.has(PermissionFlagsBits[flag]))
      .map(([, label]) => label);

    res.json({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 128, extension: 'png' }),
      memberCount: g.memberCount,
      channelCount: g.channels.cache.size,
      roleCount: g.roles.cache.size - 1,
      missingPermissions: missing,
      isAdmin: req.isAdmin,
      license: (({ state, allowed, trialEndsAt, periodEnd }) => ({ enabled: license.enabled, state, allowed, trialEndsAt: trialEndsAt || null, periodEnd: periodEnd || null }))(license.status(g.id, g.ownerId)),
      stats: {
        cases: countQuery('SELECT COUNT(*) AS n FROM cases WHERE guild_id = ?', g.id),
        warns: countQuery("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND type = 'warn'", g.id),
        openTickets: countQuery("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'", g.id),
        totalTickets: countQuery('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ?', g.id),
        rankedMembers: countQuery('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?', g.id),
      },
      modules: MODULES.filter((m) => m.toggle).map((m) => ({ id: m.id, enabled: Boolean(s[m.id][m.toggle]) })),
    });
  });

  guildRouter.get('/meta', (req, res) => {
    const g = req.guild;
    res.json({
      ...guildMeta(g),
      guildName: g.name,
      memberCount: g.memberCount,
      guildIcon: g.iconURL({ size: 128, extension: 'png' }),
      bot: { name: g.members.me?.displayName || client.user.username, avatar: client.user.displayAvatarURL({ size: 64, extension: 'png' }) },
    });
  });

  /* --- Réglages --- */
  guildRouter.get('/settings', (req, res) => res.json(settings.get(req.guild.id)));

  guildRouter.put('/settings/:moduleId', async (req, res) => {
    const mod = MODULE_BY_ID.get(req.params.moduleId);
    if (!mod) throw new HttpError(404, 'Module inconnu.');
    if (mod.adminOnly && !req.isAdmin) throw new HttpError(403, `Le module « ${mod.name} » est réservé aux administrateurs du serveur.`);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Corps de requête invalide.');

    const saved = settings.saveModule(req.guild.id, mod.id, req.body, schemaCtx(req.guild));
    record(req, 'settings', `Module « ${mod.name} » modifié`);
    res.json({ settings: saved, warnings: [] });
  });

  guildRouter.get('/export', (req, res) => {
    const data = JSON.parse(JSON.stringify(settings.get(req.guild.id)));
    for (const p of data.rolepanels.panels) p.messageId = '';
    res.setHeader('Content-Disposition', `attachment; filename="config-${req.guild.id}.json"`);
    res.json({ version: 1, exportedAt: new Date().toISOString(), guildName: req.guild.name, settings: data });
  });

  guildRouter.post('/import', (req, res) => {
    const incoming = req.body?.settings;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new HttpError(400, 'Fichier de configuration invalide.');
    const skipped = [];
    const allowed = {};
    for (const m of MODULES) {
      if (incoming[m.id] === undefined) continue;
      if (m.adminOnly && !req.isAdmin) { skipped.push(m.name); continue; }
      allowed[m.id] = incoming[m.id];
    }
    const applied = Object.keys(allowed);
    if (!applied.length) throw new HttpError(400, 'Aucun module importable dans ce fichier.');
    const next = settings.saveMany(req.guild.id, allowed, schemaCtx(req.guild));
    record(req, 'import', `${applied.length} module(s) importé(s)`);
    res.json({ settings: next, applied, skipped });
  });

  /* --- Niveaux --- */
  guildRouter.get('/leaderboard', async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const rows = db.prepare('SELECT user_id, xp, level, messages FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?')
      .all(req.guild.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const users = await resolveUsers(rows.map((r) => r.user_id));
    res.json({
      page,
      pageSize: PAGE_SIZE,
      total: countQuery('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?', req.guild.id),
      rows: rows.map((r, i) => ({ rank: (page - 1) * PAGE_SIZE + i + 1, userId: r.user_id, xp: r.xp, level: r.level, messages: r.messages, user: users[r.user_id] })),
    });
  });

  guildRouter.put('/levels/:userId', async (req, res) => {
    const { userId } = req.params;
    const xp = Number(req.body?.xp);
    if (!SNOWFLAKE.test(userId) || !Number.isFinite(xp) || xp < 0 || xp > 100000000) throw new HttpError(400, 'Valeur d’XP invalide.');
    const row = await levelsModule.setXp(client, req.guild, userId, xp);
    res.json({ xp: row.xp, level: row.level });
  });

  guildRouter.delete('/levels/:userId', (req, res) => {
    if (!SNOWFLAKE.test(req.params.userId)) throw new HttpError(400, 'Identifiant invalide.');
    db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(req.guild.id, req.params.userId);
    res.json({ ok: true });
  });

  guildRouter.delete('/levels', (req, res) => {
    if (req.body?.confirm !== true) throw new HttpError(400, 'Confirmation manquante.');
    const r = db.prepare('DELETE FROM levels WHERE guild_id = ?').run(req.guild.id);
    res.json({ ok: true, deleted: r.changes });
  });

  /* --- Sanctions --- */
  guildRouter.get('/cases', async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const where = ['guild_id = ?'];
    const args = [req.guild.id];
    if (CASE_TYPES.includes(req.query.type)) { where.push('type = ?'); args.push(req.query.type); }
    if (SNOWFLAKE.test(String(req.query.user || ''))) { where.push('user_id = ?'); args.push(req.query.user); }
    const clause = where.join(' AND ');

    const rows = db.prepare(`SELECT * FROM cases WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const users = await resolveUsers(rows.flatMap((r) => [r.user_id, r.mod_id]));
    res.json({
      page,
      pageSize: PAGE_SIZE,
      total: countQuery(`SELECT COUNT(*) AS n FROM cases WHERE ${clause}`, ...args),
      rows: rows.map((r) => ({
        id: r.id, type: r.type, reason: r.reason, duration: r.duration, createdAt: r.created_at, user: users[r.user_id], moderator: users[r.mod_id],
      })),
    });
  });

  guildRouter.delete('/cases/:id', (req, res) => {
    const r = db.prepare('DELETE FROM cases WHERE id = ? AND guild_id = ?').run(Number(req.params.id) || 0, req.guild.id);
    if (!r.changes) throw new HttpError(404, 'Dossier introuvable.');
    res.json({ ok: true });
  });

  /* --- Contestations --- */
  guildRouter.get('/appeals', async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const where = ['guild_id = ?'];
    const args = [req.guild.id];
    if (['open', 'accepted', 'refused'].includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
    const clause = where.join(' AND ');
    const rows = db.prepare(`SELECT * FROM appeals WHERE ${clause} ORDER BY (status = 'open') DESC, id DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const users = await resolveUsers(rows.flatMap((r) => [r.user_id, r.decided_by].filter(Boolean)));
    const stat = (status) => countQuery('SELECT COUNT(*) AS n FROM appeals WHERE guild_id = ? AND status = ?', req.guild.id, status);
    res.json({
      page,
      pageSize: PAGE_SIZE,
      total: countQuery(`SELECT COUNT(*) AS n FROM appeals WHERE ${clause}`, ...args),
      stats: { open: stat('open'), accepted: stat('accepted'), refused: stat('refused') },
      rows: rows.map((r) => {
        let answers = [];
        try { answers = JSON.parse(r.answers || '[]'); } catch { /* ligne abîmée */ }
        return {
          id: r.id, type: r.type, status: r.status, final: Boolean(r.final), caseId: r.case_id, answers,
          channelId: r.channel_id && req.guild.channels.cache.has(r.channel_id) ? r.channel_id : '',
          createdAt: r.created_at, decidedAt: r.decided_at, reason: r.decision_reason,
          user: users[r.user_id], decidedBy: r.decided_by ? users[r.decided_by] : null,
        };
      }),
    });
  });

  /* --- Messagerie privée --- */
  const dmSendAt = new Map();
  const dmUser = (req) => {
    const id = String(req.params.userId || '');
    if (!SNOWFLAKE.test(id)) throw new HttpError(400, 'Identifiant invalide.');
    return id;
  };

  guildRouter.get('/dms/unread', requireAdmin, (req, res) => res.json({ unread: dms.unreadTotal(client, req.guild.id) }));

  guildRouter.get('/dms/threads', requireAdmin, async (req, res) => {
    const rows = dms.listThreads(client, req.guild.id);
    const users = await resolveUsers(rows.map((r) => r.userId));
    res.json({ enabled: settings.module(req.guild.id, 'dms').enabled, rows: rows.map((r) => ({ ...r, user: users[r.userId] })) });
  });

  guildRouter.get('/dms/threads/:userId/messages', requireAdmin, async (req, res) => {
    const userId = dmUser(req);
    const after = Number.parseInt(req.query.after, 10) || 0;
    const before = Number.parseInt(req.query.before, 10) || 0;
    const rows = dms.getMessages(client, req.guild.id, userId, { after, before });
    const staffIds = rows.map((r) => r.authorId).filter(Boolean);
    const users = await resolveUsers([userId, ...staffIds]);
    res.json({ user: users[userId], authors: Object.fromEntries(staffIds.map((id) => [id, users[id]])), rows });
  });

  guildRouter.post('/dms/threads/:userId/read', requireAdmin, (req, res) => {
    dms.markRead(client, req.guild.id, dmUser(req));
    res.json({ ok: true });
  });

  guildRouter.delete('/dms/threads/:userId', requireAdmin, (req, res) => {
    const userId = dmUser(req);
    dms.deleteThread(client, req.guild.id, userId);
    record(req, 'dms', `Conversation supprimée (${userId})`);
    res.json({ ok: true });
  });

  guildRouter.get('/dms/members', requireAdmin, async (req, res) => {
    res.json({ rows: await dms.searchMembers(req.guild, req.query.q) });
  });

  guildRouter.post('/dms/send', requireAdmin, async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!SNOWFLAKE.test(userId)) throw new HttpError(400, 'Choisis un membre.');
    const key = `${req.guild.id}:${req.session.user.id}`;
    if (Date.now() - (dmSendAt.get(key) || 0) < 700) throw new HttpError(429, 'Doucement : attends une seconde entre deux messages.');
    dmSendAt.set(key, Date.now());
    if (dmSendAt.size > 2000) dmSendAt.clear();
    try {
      const r = await dms.sendFromDashboard(client, req.guild, req.session.user.id, userId, req.body?.content);
      record(req, 'dms', `Message privé envoyé (${userId})`);
      res.json({ ok: true, message: r.message });
    } catch (err) {
      if (err instanceof dms.DmError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });

  /* --- Flux YouTube / RSS --- */
  guildRouter.get('/feeds/status', (req, res) => {
    res.json({ rows: feeds.statuses(client, req.guild.id, settings.module(req.guild.id, 'feeds').feeds) });
  });

  guildRouter.post('/actions/feeds-test/:feedId', requireAdmin, async (req, res) => {
    const feed = settings.module(req.guild.id, 'feeds').feeds.find((f) => f.id === req.params.feedId);
    if (!feed) throw new HttpError(404, 'Flux introuvable : enregistre d’abord tes modifications.');
    try {
      const sent = await feeds.testFeed(client, req.guild, feed);
      record(req, 'feeds', `Test du flux ${feed.name || feed.url}`);
      res.json({ ok: true, url: sent?.url || '' });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  /* --- Alertes de lives --- */
  guildRouter.get('/streams/status', (req, res) => {
    res.json({ rows: streams.statuses(client, req.guild.id, settings.module(req.guild.id, 'streams').streamers), credentials: streams.credentials(client) });
  });

  guildRouter.post('/actions/streams-test/:id', requireAdmin, async (req, res) => {
    const item = settings.module(req.guild.id, 'streams').streamers.find((s) => s.id === req.params.id);
    if (!item) throw new HttpError(404, 'Streamer introuvable : enregistre d’abord tes modifications.');
    try {
      const r = await streams.testStreamer(client, req.guild, item);
      record(req, 'streams', `Test de l’alerte ${item.platform} ${item.handle}`);
      res.json({ ok: true, ...r });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  /* --- TikTok : vidéos et lives (deux modules séparés) --- */
  guildRouter.get('/tiktok/status', (req, res) => {
    res.json({
      videos: tiktok.videoStatus(client, req.guild.id),
      live: tiktok.liveStatus(client, req.guild.id, settings.module(req.guild.id, 'tiktoklive')),
    });
  });

  guildRouter.post('/actions/tiktokvideos-test', requireAdmin, async (req, res) => {
    const cfg = settings.module(req.guild.id, 'tiktokvideos');
    try {
      const r = await tiktok.testVideo(client, req.guild, cfg);
      record(req, 'tiktok', 'Test de l’annonce de vidéo TikTok');
      res.json({ ok: true, ...r });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  /* --- Boutique Rocket League --- */
  guildRouter.get('/rlshop/status', (req, res) => res.json(rocketleague.shopStatus(client, req.guild.id)));

  guildRouter.post('/actions/rlshop-check', requireAdmin, async (req, res) => {
    try {
      const r = await rocketleague.checkShopNow(client, req.guild);
      record(req, 'rlshop', 'Vérification de la boutique Rocket League');
      res.json({ ok: true, ...r });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/actions/rlshop-send', requireAdmin, async (req, res) => {
    const cfg = settings.module(req.guild.id, 'rlshop');
    try {
      const r = await rocketleague.sendShopNow(client, req.guild, cfg);
      record(req, 'rlshop', 'Envoi de la boutique Rocket League');
      res.json({ ok: true, ...r });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/actions/tiktoklive-test', requireAdmin, async (req, res) => {
    const cfg = settings.module(req.guild.id, 'tiktoklive');
    try {
      const r = await tiktok.testLive(client, req.guild, cfg);
      record(req, 'tiktok', 'Test de l’annonce de live TikTok');
      res.json({ ok: true, ...r });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  /* --- Invitations --- */
  guildRouter.get('/invites', async (req, res) => {
    const rows = invitesModule.leaderboard(client, req.guild.id, 15);
    const users = await resolveUsers(rows.map((r) => r.userId));
    res.json({ rows: rows.map((r) => ({ ...r, user: users[r.userId] })) });
  });

  /* --- Statistiques --- */
  guildRouter.get('/stats', (req, res) => {
    const report = serverstats.report(client, req.guild.id, req.query.days);
    res.json({
      ...report,
      memberCount: req.guild.memberCount,
      channels: report.channels.map((c) => ({ ...c, name: req.guild.channels.cache.get(c.channelId)?.name || '' })),
    });
  });

  /* --- Tickets --- */
  guildRouter.get('/tickets', async (req, res) => {
    const rows = db.prepare("SELECT * FROM tickets WHERE guild_id = ? ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100").all(req.guild.id);
    const users = await resolveUsers(rows.flatMap((r) => [r.user_id, r.claimed_by].filter(Boolean)));
    res.json({
      rows: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, topic: r.topic, reason: r.reason, channelId: r.channel_id,
        channelExists: req.guild.channels.cache.has(r.channel_id), createdAt: r.created_at, closedAt: r.closed_at,
        user: users[r.user_id], claimedBy: r.claimed_by ? users[r.claimed_by] : null,
      })),
    });
  });

  /* --- Actions --- */
  guildRouter.post('/actions/ticket-panel', async (req, res) => {
    try {
      const sent = await tickets.publishPanel(client, req.guild);
      record(req, 'tickets', 'Panneau de tickets publié');
      res.json({ ok: true, url: sent.url });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/actions/role-panel/:panelId', async (req, res) => {
    try {
      const sent = await rolepanels.publish(client, req.guild, req.params.panelId);
      res.json({ ok: true, url: sent.url, settings: settings.get(req.guild.id).rolepanels });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/messages', async (req, res) => {
    const g = req.guild;
    const ctx = schemaCtx(g);
    const channelId = String(req.body?.channelId || '');
    const ch = ctx.channels.get(channelId);
    if (!ch || ch.kind !== 'text') throw new HttpError(400, 'Choisis un salon textuel.');

    const msg = normalizeValue({ type: 'message' }, req.body?.message, ctx);
    const payload = buildMessage(msg, { server: g.name, 'server.icon': g.iconURL() || '', memberCount: String(g.memberCount) }, settings.get(g.id).general);
    if (!payload) throw new HttpError(400, 'Le message est vide.');

    const target = getSendable(g, channelId);
    if (!target) throw new HttpError(400, 'Je ne peux pas écrire dans ce salon (permissions manquantes).');
    payload.allowedMentions = { parse: ['users', 'roles'] };
    const sent = await target.send(payload).catch((err) => { throw new HttpError(400, `Discord a refusé le message : ${err.message}`); });
    res.json({ ok: true, url: sent.url });
  });

  /* ---------------------------- Historique -------------------------- */
  guildRouter.get('/audit', async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const rows = db.prepare('SELECT * FROM audit WHERE guild_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(req.guild.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const users = await resolveUsers(rows.map((r) => r.user_id));
    res.json({
      page, pageSize: PAGE_SIZE,
      total: countQuery('SELECT COUNT(*) AS n FROM audit WHERE guild_id = ?', req.guild.id),
      rows: rows.map((r) => ({ id: r.id, action: r.action, detail: r.detail, createdAt: r.created_at, user: users[r.user_id] })),
    });
  });

  /* ---------------------------- Profil du bot ------------------------ */
  guildRouter.get('/bot-profile', async (req, res) => {
    try {
      res.json(await profile.getProfile(client, req.guild));
    } catch (err) {
      throw new HttpError(502, `Impossible de lire le profil : ${err.message}`);
    }
  });

  guildRouter.put('/bot-profile', async (req, res) => {
    const b = req.body || {};
    const changes = {};
    for (const key of ['nickname', 'bio', 'avatar', 'banner']) if (b[key] !== undefined) changes[key] = b[key];
    try {
      const result = await profile.updateProfile(client, req.guild, changes);
      record(req, 'bot-profile', `Profil du bot : ${Object.keys(changes).join(', ')}`);
      res.json(result);
    } catch (err) {
      if (err instanceof profile.ProfileError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  /* ---------------------------------- IA ----------------------------- */
  guildRouter.get('/ai/status', (req, res) => res.json(aiService.status(client, req.guild.id)));

  guildRouter.put('/ai/key', requireAdmin, (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'Clé d’API invalide.');
    aiService.setGuildKey(client, req.guild.id, key);
    record(req, 'ai-key', 'Clé d’API IA enregistrée');
    res.json(aiService.status(client, req.guild.id));
  });

  guildRouter.delete('/ai/key', requireAdmin, (req, res) => {
    aiService.clearGuildKey(client, req.guild.id);
    record(req, 'ai-key', 'Clé d’API IA supprimée');
    res.json(aiService.status(client, req.guild.id));
  });

  const aiTestLimiter = new Map();
  guildRouter.post('/ai/test', async (req, res) => {
    const last = aiTestLimiter.get(req.guild.id) || 0;
    if (Date.now() - last < 5000) throw new HttpError(429, 'Patiente quelques secondes entre deux tests.');
    aiTestLimiter.set(req.guild.id, Date.now());
    try {
      const answer = await aiService.ask(client, req.guild.id, {
        system: 'Réponds en une courte phrase en français.', messages: [{ role: 'user', content: 'Dis simplement que la connexion fonctionne.' }], maxTokens: 60, force: true,
      });
      res.json({ ok: true, answer: String(answer).slice(0, 300) });
    } catch (err) {
      if (err instanceof AiError) return res.json({ ok: false, error: err.message });
      throw err;
    }
    return undefined;
  });

  /* -------------------- Webhooks & messages enregistrés -------------- */
  const wrapWebhook = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof webhooks.WebhookError) throw new HttpError(400, err.message);
      throw err;
    }
  };

  guildRouter.get('/webhooks', (req, res) => res.json({ rows: webhooks.listWebhooks(client, req.guild.id) }));

  guildRouter.post('/webhooks', async (req, res) => {
    const out = await wrapWebhook(() => webhooks.createWebhook(client, req.guild, req.session.user.id, String(req.body?.channelId || ''), req.body?.name));
    record(req, 'webhook', `Webhook « ${out.name} » créé`);
    res.json(out);
  });

  guildRouter.post('/webhooks/import', async (req, res) => {
    const out = await wrapWebhook(() => webhooks.importWebhook(client, req.guild, req.session.user.id, req.body?.url));
    record(req, 'webhook', `Webhook « ${out.name} » importé`);
    res.json(out);
  });

  guildRouter.delete('/webhooks/:id', async (req, res) => {
    if (!(await webhooks.deleteWebhook(client, req.guild.id, req.params.id))) throw new HttpError(404, 'Webhook introuvable.');
    record(req, 'webhook', 'Webhook supprimé');
    res.json({ ok: true });
  });

  const webhookSendLimiter = new Map();
  guildRouter.post('/webhooks/:id/send', async (req, res) => {
    const key = `${req.guild.id}:${req.session.user.id}`;
    const hits = (webhookSendLimiter.get(key) || []).filter((t) => Date.now() - t < 60000);
    if (hits.length >= 20) throw new HttpError(429, 'Trop d’envois : 20 par minute maximum.');
    hits.push(Date.now());
    webhookSendLimiter.set(key, hits);
    const b = req.body || {};
    const out = await wrapWebhook(() => webhooks.sendViaWebhook(client, req.guild, req.params.id, { saved: b.saved, message: b.message, username: b.username, avatarUrl: b.avatarUrl }));
    record(req, 'webhook-send', 'Message envoyé par webhook');
    res.json({ ok: true, ...out });
  });

  guildRouter.get('/saved', (req, res) => {
    res.json(webhooks.listSaved(db, req.guild.id, { search: String(req.query.search || '').slice(0, 80), page: Math.max(1, Number.parseInt(req.query.page, 10) || 1) }));
  });
  guildRouter.get('/saved/:id', (req, res) => {
    const row = webhooks.getSaved(db, req.guild.id, req.params.id);
    if (!row) throw new HttpError(404, 'Message introuvable.');
    res.json(row);
  });
  guildRouter.post('/saved', (req, res) => {
    const row = webhooks.createSaved(db, req.guild.id, req.session.user.id, req.body?.name, req.body);
    record(req, 'saved-message', `Message « ${row.name} » enregistré`);
    res.json(row);
  });
  guildRouter.put('/saved/:id', (req, res) => {
    const row = webhooks.updateSaved(db, req.guild.id, req.params.id, req.body?.name, req.body);
    if (!row) throw new HttpError(404, 'Message introuvable.');
    res.json(row);
  });
  guildRouter.delete('/saved/:id', (req, res) => {
    if (!webhooks.deleteSaved(db, req.guild.id, req.params.id)) throw new HttpError(404, 'Message introuvable.');
    record(req, 'saved-message', 'Message supprimé');
    res.json({ ok: true });
  });
  guildRouter.post('/saved/:id/duplicate', (req, res) => {
    const row = webhooks.duplicateSaved(db, req.guild.id, req.session.user.id, req.params.id);
    if (!row) throw new HttpError(404, 'Message introuvable.');
    res.json(row);
  });
  guildRouter.post('/saved/:id/send', async (req, res) => {
    const row = webhooks.getSaved(db, req.guild.id, req.params.id);
    if (!row) throw new HttpError(404, 'Message introuvable.');
    const target = getSendable(req.guild, String(req.body?.channelId || ''));
    if (!target) throw new HttpError(400, 'Choisis un salon où je peux écrire.');
    const g = req.guild;
    const payload = buildMessage(row.message, { server: g.name, 'server.icon': g.iconURL() || '', memberCount: String(g.memberCount) }, settings.get(g.id).general);
    if (!payload) throw new HttpError(400, 'Le message est vide.');
    const sent = await target.send({ ...payload, allowedMentions: { parse: [] } }).catch((err) => { throw new HttpError(400, `Discord a refusé le message : ${err.message}`); });
    record(req, 'saved-message', `« ${row.name} » envoyé`);
    res.json({ ok: true, url: sent.url });
  });

  /* ------------------------- Créateur de serveur --------------------- */
  guildRouter.get('/builder/templates', (req, res) => res.json({ templates: templates.listTemplates() }));
  guildRouter.get('/builder/templates/:id', (req, res) => {
    const t = templates.getTemplate(req.params.id);
    if (!t) throw new HttpError(404, 'Modèle introuvable.');
    res.json({ plan: t.plan, summary: templates.summarize(t.plan), warnings: t.warnings });
  });
  guildRouter.post('/builder/validate', requireAdmin, (req, res) => {
    const { plan, warnings } = templates.validatePlan(req.body?.plan);
    res.json({ plan, summary: templates.summarize(plan), warnings });
  });
  guildRouter.post('/builder/generate', requireAdmin, async (req, res) => {
    try {
      const { plan, warnings } = await builder.generatePlan(client, req.guild, req.body?.description, { notes: req.body?.notes });
      record(req, 'builder', 'Plan de serveur généré par l’IA');
      res.json({ plan, summary: templates.summarize(plan), warnings });
    } catch (err) {
      if (err instanceof AiError) throw new HttpError(400, err.message);
      throw err;
    }
  });
  guildRouter.post('/builder/apply', requireAdmin, (req, res) => {
    const { plan } = templates.validatePlan(req.body?.plan);
    const sum = templates.summarize(plan);
    if (!sum.roles && !sum.channels) throw new HttpError(400, 'Le plan est vide.');
    try {
      const job = builder.startApply(client, req.guild, plan, { wire: req.body?.wire === true });
      record(req, 'builder', `Création lancée : ${sum.roles} rôle(s), ${sum.categories} catégorie(s), ${sum.channels} salon(s)`);
      res.json({ job });
    } catch (err) {
      throw new HttpError(409, err.message);
    }
  });
  guildRouter.get('/builder/status', (req, res) => res.json({ job: builder.publicJob(builder.getJob(req.guild.id)) }));

  /* ------------------------- Actions de sécurité --------------------- */
  guildRouter.get('/security/state', (req, res) => res.json({
    lockdown: protection.isLockedDown(client, req.guild.id),
    raidModeUntil: protection.raidModeUntil(client, req.guild.id),
  }));

  guildRouter.post('/actions/lockdown', requireAdmin, async (req, res) => {
    const on = req.body?.on === true;
    if (on && protection.isLockedDown(client, req.guild.id)) throw new HttpError(409, 'Le serveur est déjà verrouillé.');
    const n = await protection.lockdown(client, req.guild, on, `Dashboard (${req.session.user.username})`);
    record(req, 'lockdown', on ? `Serveur verrouillé (${n} salons)` : `Serveur déverrouillé (${n} salons)`);
    res.json({ ok: true, changed: n, lockdown: protection.isLockedDown(client, req.guild.id) });
  });

  guildRouter.post('/actions/raidmode', requireAdmin, (req, res) => {
    const minutes = Math.min(1440, Math.max(0, Math.trunc(Number(req.body?.minutes) || 0)));
    protection.setRaidMode(client, req.guild.id, minutes);
    record(req, 'raidmode', minutes ? `Mode raid pour ${minutes} min` : 'Mode raid désactivé');
    res.json({ ok: true, raidModeUntil: protection.raidModeUntil(client, req.guild.id) });
  });

  guildRouter.post('/actions/honeypot-create', requireAdmin, async (req, res) => {
    try {
      const ch = await honeypot.createTrapChannel(client, req.guild);
      record(req, 'honeypot', `Salon piège créé (#${ch.name})`);
      res.json({ ok: true, channelId: ch.id, settings: settings.module(req.guild.id, 'honeypot') });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/actions/honeypot-warning', async (req, res) => {
    const id = String(req.body?.channelId || '');
    if (!settings.module(req.guild.id, 'honeypot').channelIds.includes(id)) throw new HttpError(400, 'Ce salon n’est pas un salon piège.');
    try {
      const sent = await honeypot.publishWarning(client, req.guild, id);
      res.json({ ok: true, url: sent.url });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  guildRouter.post('/actions/verification-panel', async (req, res) => {
    try {
      const sent = await verification.publishPanel(client, req.guild);
      record(req, 'verification', 'Panneau de vérification publié');
      res.json({ ok: true, url: sent.url });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  });

  /* --------------------------- Gestion des comptes --------------------------- */
  const listAccounts = (req) => accounts.list().map((a) => ({ ...AccountService.view(a), self: a.id === (req.account?.id ?? null) }));

  router.get('/accounts', requireAuth, requireOwner, (req, res) => {
    res.json({
      rows: listAccounts(req),
      guilds: [...client.guilds.cache.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount, icon: g.iconURL({ size: 64, extension: 'png' }) })),
    });
  });

  router.post('/accounts', requireAuth, requireOwner, async (req, res) => {
    const b = req.body || {};
    const created = await acct(() => accounts.create({
      username: b.username, password: b.password, displayName: b.displayName, role: b.role, guildIds: b.guildIds,
      createdBy: req.account ? `acc:${req.account.id}` : req.session.user.id,
    }));
    console.log(`[comptes] « ${created.username} » créé (${created.role})`);
    res.json({ account: AccountService.view(created) });
  });

  router.put('/accounts/:id', requireAuth, requireOwner, async (req, res) => {
    const b = req.body || {};
    const updated = await acct(() => accounts.update(req.params.id, {
      displayName: b.displayName, role: b.role, guildIds: b.guildIds, disabled: b.disabled, password: b.password,
    }, { actorId: req.account?.id ?? null }));
    console.log(`[comptes] « ${updated.username} » modifié`);
    res.json({ account: AccountService.view(updated) });
  });

  router.delete('/accounts/:id', requireAuth, requireOwner, async (req, res) => {
    const cur = accounts.get(req.params.id);
    await acct(() => accounts.remove(req.params.id, { actorId: req.account?.id ?? null }));
    console.log(`[comptes] « ${cur?.username} » supprimé`);
    res.json({ ok: true });
  });

  /* ------------------------------ Admin ------------------------------ */
  router.get('/admin/overview', requireAuth, requireOwner, (req, res) => {
    res.json({
      presence: getPresence(db),
      licenseEnabled: license.enabled,
      statuses: STATUSES,
      types: TYPES,
      uptime: Math.round(process.uptime()),
      ping: Math.round(client.ws.ping),
      memory: Math.round(process.memoryUsage().rss / 1048576),
      guilds: [...client.guilds.cache.values()]
        .sort((a, b) => b.memberCount - a.memberCount)
        .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount, icon: g.iconURL({ size: 64, extension: 'png' }), license: license.status(g.id, g.ownerId).state })),
    });
  });

  /* --- Licences (propriétaires du bot) --- */
  router.get('/admin/licenses', requireAuth, requireOwner, (req, res) => {
    res.json({
      enabled: license.enabled,
      stripeReady: license.stripeReady,
      webhookReady: Boolean(config.license.stripeWebhookSecret),
      rows: license.listAll().map((l) => publicLicense(l)),
    });
  });

  router.post('/admin/licenses', requireAuth, requireOwner, async (req, res) => {
    const { ownerId, days, maxGuilds, note } = req.body || {};
    const d = days === null || days === '' || days === undefined ? null : Number(days);
    if (d !== null && (!Number.isFinite(d) || d < 1 || d > 3650)) throw new HttpError(400, 'Durée invalide (1 à 3650 jours, ou vide pour illimitée).');
    const created = await lic(async () => license.createLicense({
      ownerId: String(ownerId || ''), source: 'manual', periodEnd: d === null ? null : Date.now() + d * 86400000,
      maxGuilds: Number(maxGuilds) || 1, note: String(note || ''),
    }));
    res.json({ id: created.id, key: created.key });
  });

  router.post('/admin/licenses/:id/revoke', requireAuth, requireOwner, (req, res) => {
    if (!license.revoke(Number(req.params.id))) throw new HttpError(404, 'Licence introuvable.');
    res.json({ ok: true });
  });

  router.delete('/admin/licenses/:id/guilds/:guildId', requireAuth, requireOwner, (req, res) => {
    const l = license.licenseOfGuild(req.params.guildId);
    if (!l || l.id !== Number(req.params.id)) throw new HttpError(404, 'Ce serveur n’utilise pas cette licence.');
    license.deactivate(req.params.guildId);
    res.json({ ok: true });
  });

  router.put('/admin/presence', requireAuth, requireOwner, (req, res) => {
    const saved = savePresence(db, req.body || {});
    applyPresence(client);
    res.json({ presence: saved });
  });

  return router;
}

module.exports = { createApiRouter, HttpError, avatarUrl, iconUrl };
