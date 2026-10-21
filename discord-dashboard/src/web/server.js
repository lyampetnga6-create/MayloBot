'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const { SqliteSessionStore } = require('./store');
const { createApiRouter, HttpError } = require('./api');
const { SNOWFLAKE } = require('../schema');

const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;
const SEVEN_DAYS = 7 * 86400000;

function parseTrustProxy(v) {
  if (!v) return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** Construit l'application Express (sans l'écouter). */
function createWebApp({ client, db, settings, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.trustProxy));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  /* ------------------------------ Webhook Stripe ------------------------------ */
  // Doit lire le corps BRUT (la signature porte sur les octets exacts) : donc avant tout analyseur JSON, et sans session.
  const stripeLimiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post('/stripe/webhook', stripeLimiter, express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    const license = client.ctx?.license;
    if (!license || !config.license.stripeWebhookSecret) return res.status(404).json({ error: 'Webhook non configuré.' });
    try {
      const result = license.handleWebhook(req.body, req.get('stripe-signature'));
      if (result && !/^ignoré|déjà/.test(result)) console.log(`[stripe] ${result}`);
      return res.json({ received: true });
    } catch (err) {
      if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
      console.error('[stripe]', err);
      return res.status(500).json({ error: 'Erreur interne.' }); // Stripe réessaiera
    }
  });

  app.use(session({
    name: 'sid',
    secret: config.sessionSecret,
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: SEVEN_DAYS },
  }));

  /* --------------- Connexion Discord (réservée aux propriétaires du bot) --------------- */
  // Les autres personnes se connectent avec un compte (identifiant + mot de passe) : voir POST /api/login.
  const authLimiter = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

  app.get('/auth/login', authLimiter, (req, res) => {
    if (!config.clientId || !config.clientSecret) return res.status(500).send('OAuth2 non configuré (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).');
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
      prompt: 'none',
    });
    req.session.save(() => res.redirect(`https://discord.com/oauth2/authorize?${params}`));
  });

  app.get('/auth/callback', authLimiter, async (req, res, next) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect('/?error=access_denied');
      if (!code || typeof code !== 'string' || !state || state !== req.session.oauthState) return res.redirect('/?error=invalid_state');

      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
        }),
      });
      if (!tokenRes.ok) return res.redirect('/?error=token');
      const { access_token: accessToken } = await tokenRes.json();

      const headers = { Authorization: `Bearer ${accessToken}` };
      const [userRes, guildsRes] = await Promise.all([
        fetch(`${DISCORD_API}/users/@me`, { headers }),
        fetch(`${DISCORD_API}/users/@me/guilds`, { headers }),
      ]);
      if (!userRes.ok || !guildsRes.ok) return res.redirect('/?error=profile');
      const user = await userRes.json();
      // Sans compte, pas d'accès : seule la connexion Discord des propriétaires du bot reste possible.
      if (!config.ownerIds.includes(user.id)) return res.redirect('/dashboard?error=owner_only');
      const guilds = await guildsRes.json();

      // On ne garde que ce qui est utile : l'identité et les serveurs où l'on peut gérer (le jeton n'est PAS conservé).
      const manageable = guilds
        .filter((g) => g.owner || (BigInt(g.permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n)
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
      const slimUser = { id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar };

      return req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = slimUser;
        req.session.guilds = manageable;
        return req.session.save(() => res.redirect('/dashboard'));
      });
    } catch (err) {
      return next(err);
    }
  });

  /* ----------------------------------- API ----------------------------------- */
  const apiLimiter = rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
  const origin = new URL(config.baseUrl).origin;

  // Protection CSRF : les requêtes qui modifient des données doivent porter l'en-tête maison
  // (impossible à envoyer depuis un autre site sans autorisation CORS) et venir de notre origine.
  const csrfGuard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const fromOrigin = req.get('origin');
    if (req.get('x-dashboard') !== '1' || (fromOrigin && fromOrigin !== origin)) {
      return res.status(403).json({ error: 'Requête refusée (protection CSRF).' });
    }
    return next();
  };

  // Corps JSON : 1 Mo partout, sauf l'envoi d'images du profil du bot (connecté seulement, ~8 Mo de fichier en base64).
  const smallJson = express.json({ limit: '1mb' });
  const bigJson = express.json({ limit: '12mb' });
  const jsonBody = (req, res, next) => (req.session?.user && req.method === 'PUT' && /^\/guilds\/\d+\/bot-profile$/.test(req.path) ? bigJson : smallJson)(req, res, next);

  app.use('/api', apiLimiter, csrfGuard, jsonBody, createApiRouter({ client, db, settings, config }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable.' }));

  /* ------------------------------- Pages statiques ------------------------------- */
  app.use(express.static(path.join(__dirname, '..', '..', 'public'), { extensions: ['html'], maxAge: 0 }));

  /* --------------------------------- Erreurs --------------------------------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
    console.error('[web]', err);
    if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Erreur interne du serveur.' });
    return res.status(500).send('Erreur interne du serveur.');
  });

  return app;
}

function startWebServer(deps) {
  const app = createWebApp(deps);
  return new Promise((resolve, reject) => {
    const server = app.listen(deps.config.port, () => {
      console.log(`🌐 Dashboard : ${deps.config.baseUrl}  (port ${deps.config.port})`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { createWebApp, startWebServer, SNOWFLAKE };
