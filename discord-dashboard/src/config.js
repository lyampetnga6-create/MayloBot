'use strict';
require('dotenv').config({ quiet: true });

const env = process.env;

const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

const config = {
  token: env.DISCORD_TOKEN || '',
  clientId: env.DISCORD_CLIENT_ID || '',
  clientSecret: env.DISCORD_CLIENT_SECRET || '',
  baseUrl,
  port: Number(env.PORT) || 3000,
  sessionSecret: env.SESSION_SECRET || '',
  // Compte administrateur du dashboard, créé (ou réinitialisé) au démarrage si ces deux variables sont remplies.
  adminUsername: (env.ADMIN_USERNAME || '').trim(),
  adminPassword: env.ADMIN_PASSWORD || '',
  ownerIds: (env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  botName: env.BOT_NAME || 'MonBot',
  devGuildId: env.DEV_GUILD_ID || '',
  autoDeployCommands: env.AUTO_DEPLOY_COMMANDS !== 'false',
  trustProxy: env.TRUST_PROXY || '',
  dbPath: env.DB_PATH || './data/bot.db',
  supportUrl: env.SUPPORT_URL || '',
  // IA « par défaut » du bot (optionnelle). Chaque serveur peut aussi utiliser sa propre clé depuis le dashboard.
  ai: {
    provider: (env.AI_PROVIDER || 'openai').toLowerCase(),
    apiKey: env.AI_API_KEY || '',
    baseUrl: env.AI_BASE_URL || '',
    model: env.AI_MODEL || '',
    guildHourlyLimit: Number(env.AI_GUILD_HOURLY_LIMIT) || 60,
  },
  // Alertes de lives et de vidéos (optionnel). Twitch et Kick exigent une application gratuite ; YouTube n'a besoin de rien.
  streams: {
    twitchClientId: env.TWITCH_CLIENT_ID || '',
    twitchClientSecret: env.TWITCH_CLIENT_SECRET || '',
    kickClientId: env.KICK_CLIENT_ID || '',
    kickClientSecret: env.KICK_CLIENT_SECRET || '',
  },
  // Instance RSSHub utilisée pour les vidéos TikTok (héberge la tienne pour plus de fiabilité).
  rsshubUrl: env.RSSHUB_URL || 'https://rsshub.app',
  // Abonnement payant (clé de licence). Désactivé par défaut : le bot est alors entièrement gratuit.
  license: {
    enabled: env.LICENSE_ENABLED === 'true',
    trialDays: env.LICENSE_TRIAL_DAYS === undefined || env.LICENSE_TRIAL_DAYS === '' ? 7 : Math.max(0, Number(env.LICENSE_TRIAL_DAYS) || 0),
    priceLabel: env.LICENSE_PRICE_LABEL || '9,99 €/mois',
    freeGuildIds: (env.LICENSE_FREE_GUILD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    stripePriceId: env.STRIPE_PRICE_ID || '',
  },
};
config.redirectUri = `${baseUrl}/auth/callback`;
config.secureCookies = baseUrl.startsWith('https://');

/** Vérifie la configuration et renvoie la liste des problèmes (en français). */
function validate(cfg = config) {
  const problems = [];
  if (!cfg.token) problems.push('DISCORD_TOKEN manquant (onglet « Bot » du portail développeur).');
  if (!cfg.clientId) problems.push('DISCORD_CLIENT_ID manquant (onglet « OAuth2 »).');
  if (!cfg.clientSecret) problems.push('DISCORD_CLIENT_SECRET manquant (onglet « OAuth2 »).');
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 24) {
    problems.push('SESSION_SECRET manquant ou trop court (24 caractères minimum, tape `openssl rand -hex 32`).');
  }
  return problems;
}

module.exports = { config, validate };
