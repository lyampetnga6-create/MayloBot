'use strict';
/**
 * Abonnements et clés de licence.
 *
 *  - Une clé de licence (KEY-XXXX-XXXX-XXXX-XXXX) est créée quand un paiement Stripe aboutit
 *    (ou à la main par le propriétaire du bot) et peut être activée sur un nombre limité de serveurs.
 *  - Chaque serveur a un essai gratuit, puis le bot se bloque tant qu'aucune licence active n'y est liée.
 *  - Stripe est appelé en HTTPS direct (aucune dépendance) ; les webhooks sont vérifiés par signature HMAC.
 *
 * Aucune règle n'est appliquée si `config.license.enabled` est faux : le bot reste alors 100 % gratuit.
 */
const crypto = require('node:crypto');
const { encrypt, decrypt } = require('./secrets');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // alphabet de Crockford : pas de I, L, O, U
const KEY_RE = /^KEY-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const DAY = 86400000;
const GRACE_ACTIVE = 7 * DAY;   // webhook de renouvellement en retard : on ne coupe pas un client qui paie
const GRACE_PAST_DUE = 3 * DAY; // paiement refusé : 3 jours pour régulariser
const STATUS_TTL = 30000;
const SNOWFLAKE = /^\d{17,20}$/;

class LicenseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Génère une clé aléatoire de 80 bits. */
function generateKey() {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] & 31];
  return `KEY-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

/** Remet une clé saisie par un humain au format canonique, ou renvoie null si elle est invalide. */
function normalizeKey(input) {
  if (typeof input !== 'string') return null;
  let s = input.toUpperCase().replace(/[\s_]+/g, '');
  if (s.length > 40) return null;
  s = s.replace(/-/g, '');
  if (s.length === 19 && s.startsWith('KEY')) s = s.slice(3);
  // Confusions classiques à la saisie (Crockford) : O→0, I/L→1
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 16) return null;
  const key = `KEY-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  return KEY_RE.test(key) ? key : null;
}

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

/** Vérifie l'en-tête `Stripe-Signature` (schéma v1 : HMAC-SHA256 de « horodatage.corps »). */
function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || !header || !rawBody) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  return sigs.some((sig) => {
    if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
    return crypto.timingSafeEqual(expected, Buffer.from(sig, 'hex'));
  });
}

class LicenseService {
  /**
   * @param {{db, config, fetchImpl?: Function, now?: () => number}} deps
   */
  constructor({ db, config, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
    this.db = db;
    this.config = config;
    this.cfg = config.license || { enabled: false, trialDays: 7, freeGuildIds: [] };
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.onCreate = null; // appelé avec { id, key, ownerId } quand un paiement Stripe crée une licence
  }

  get enabled() { return Boolean(this.cfg.enabled); }

  get stripeReady() { return Boolean(this.cfg.stripeSecretKey && this.cfg.stripePriceId); }

  get secret() { return this.config.sessionSecret; }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  /* ----------------------------- Lecture ----------------------------- */

  /** Une licence donne-t-elle accès en ce moment ? */
  isLicenseActive(lic, now = this.now()) {
    if (!lic) return false;
    if (lic.status === 'active' || lic.status === 'trialing') {
      if (lic.periodEnd == null) return true;
      return now < lic.periodEnd + (lic.source === 'stripe' ? GRACE_ACTIVE : 0);
    }
    if (lic.status === 'past_due') return lic.periodEnd != null && now < lic.periodEnd + GRACE_PAST_DUE;
    return false;
  }

  rowToLicense(r, { withKey = false } = {}) {
    if (!r) return null;
    const out = {
      id: r.id, ownerId: r.owner_id, source: r.source, status: r.status, periodEnd: r.period_end, maxGuilds: r.max_guilds,
      hasStripe: Boolean(r.stripe_customer_id), note: r.note, createdAt: r.created_at, updatedAt: r.updated_at,
      stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id,
    };
    out.active = this.isLicenseActive(out);
    if (withKey) out.key = decrypt(r.key_enc, this.secret) || '';
    out.keyHint = (decrypt(r.key_enc, this.secret) || '').slice(-4);
    return out;
  }

  getById(id, opts) {
    return this.rowToLicense(this.db.prepare('SELECT * FROM licenses WHERE id = ?').get(Number(id) || 0), opts);
  }

  getByKey(key) {
    const k = normalizeKey(key);
    if (!k) return null;
    return this.rowToLicense(this.db.prepare('SELECT * FROM licenses WHERE key_hash = ?').get(hashKey(k)));
  }

  listByOwner(ownerId) {
    return this.db.prepare('SELECT * FROM licenses WHERE owner_id = ? ORDER BY id DESC').all(ownerId).map((r) => this.rowToLicense(r, { withKey: true }));
  }

  listAll(limit = 200) {
    return this.db.prepare('SELECT * FROM licenses ORDER BY id DESC LIMIT ?').all(limit).map((r) => this.rowToLicense(r));
  }

  guildsOf(licenseId) {
    return this.db.prepare('SELECT guild_id, activated_by, activated_at FROM license_guilds WHERE license_id = ? ORDER BY activated_at').all(licenseId)
      .map((r) => ({ guildId: r.guild_id, activatedBy: r.activated_by, activatedAt: r.activated_at }));
  }

  licenseOfGuild(guildId) {
    const link = this.db.prepare('SELECT license_id FROM license_guilds WHERE guild_id = ?').get(guildId);
    return link ? this.getById(link.license_id) : null;
  }

  /**
   * État d'un serveur : { state: 'disabled'|'free'|'licensed'|'trial'|'expired', allowed, trialEndsAt?, periodEnd?, licenseId? }
   * @param {string} guildId
   * @param {string} [ownerId] propriétaire du serveur (exempté s'il est propriétaire du bot)
   */
  status(guildId, ownerId) {
    if (!this.enabled) return { state: 'disabled', allowed: true };
    const t = this.now();
    const hit = this.cache.get(guildId);
    if (hit && t - hit.at < STATUS_TTL) return hit.value;

    // L'essai démarre à la première fois qu'on voit le serveur, même s'il a déjà une licence :
    // un abonnement résilié ne redonne donc jamais un nouvel essai.
    let started = this.db.prepare('SELECT started_at FROM trials WHERE guild_id = ?').get(guildId)?.started_at;
    if (!started) {
      started = t;
      this.db.prepare('INSERT OR IGNORE INTO trials (guild_id, started_at) VALUES (?, ?)').run(guildId, started);
    }

    let value;
    if (this.cfg.freeGuildIds.includes(guildId) || (ownerId && (this.config.ownerIds || []).includes(ownerId))) {
      value = { state: 'free', allowed: true };
    } else {
      const lic = this.licenseOfGuild(guildId);
      if (lic && this.isLicenseActive(lic, t)) {
        value = { state: 'licensed', allowed: true, periodEnd: lic.periodEnd, licenseId: lic.id };
      } else {
        const trialEndsAt = started + this.cfg.trialDays * DAY;
        value = t < trialEndsAt
          ? { state: 'trial', allowed: true, trialEndsAt }
          : { state: 'expired', allowed: false, trialEndsAt, hadLicense: Boolean(lic), licenseId: lic?.id };
      }
    }
    this.cache.set(guildId, { at: t, value });
    return value;
  }

  /* ----------------------------- Écriture ----------------------------- */

  /** Crée une licence et renvoie { id, key } (la clé n'est stockée que chiffrée). */
  createLicense({
    ownerId, source = 'manual', status = 'active', periodEnd = null, maxGuilds = 1, stripeCustomerId = null, stripeSubscriptionId = null, note = '',
  }) {
    if (!SNOWFLAKE.test(String(ownerId))) throw new LicenseError('Identifiant Discord du propriétaire invalide.');
    const now = this.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = generateKey();
      try {
        const info = this.db.prepare(`INSERT INTO licenses
          (key_hash, key_enc, owner_id, source, status, period_end, max_guilds, stripe_customer_id, stripe_subscription_id, note, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(hashKey(key), encrypt(key, this.secret), String(ownerId), source, status, periodEnd, Math.max(1, Math.min(50, Math.trunc(maxGuilds) || 1)),
            stripeCustomerId, stripeSubscriptionId, String(note).slice(0, 200), now, now);
        const created = { id: Number(info.lastInsertRowid), key };
        this.invalidate();
        if (source === 'stripe' && this.onCreate) {
          Promise.resolve(this.onCreate({ ...created, ownerId: String(ownerId) })).catch(() => {});
        }
        return created;
      } catch (err) {
        if (/key_hash/.test(err.message)) continue; // collision (quasi impossible) : on retente
        throw err;
      }
    }
    throw new LicenseError('Impossible de générer une clé, réessaie.', 500);
  }

  /** Lie une licence à un serveur. Un serveur n'a qu'une licence ; une licence a un nombre de serveurs limité. */
  activate(licenseId, guildId, userId) {
    const lic = this.getById(licenseId);
    if (!lic) throw new LicenseError('Clé inconnue.', 404);
    if (!this.isLicenseActive(lic)) throw new LicenseError('Cette clé n’est plus active (abonnement terminé ou résilié).', 402);
    const current = this.db.prepare('SELECT license_id FROM license_guilds WHERE guild_id = ?').get(guildId);
    if (current?.license_id === lic.id) return lic;
    if (current) throw new LicenseError('Ce serveur a déjà une autre clé : désactive-la d’abord.', 409);
    const used = this.guildsOf(lic.id).length;
    if (used >= lic.maxGuilds) {
      throw new LicenseError(`Cette clé est déjà utilisée sur ${used} serveur${used > 1 ? 's' : ''} (maximum ${lic.maxGuilds}). Désactive-la sur un autre serveur d’abord.`, 409);
    }
    this.db.prepare('INSERT INTO license_guilds (guild_id, license_id, activated_by, activated_at) VALUES (?,?,?,?)').run(guildId, lic.id, userId, this.now());
    this.invalidate(guildId);
    return lic;
  }

  deactivate(guildId) {
    const info = this.db.prepare('DELETE FROM license_guilds WHERE guild_id = ?').run(guildId);
    this.invalidate(guildId);
    return info.changes > 0;
  }

  /** Coupe une licence (remboursement, abus…) et libère ses serveurs. */
  revoke(licenseId) {
    const lic = this.getById(licenseId);
    if (!lic) return false;
    this.db.prepare("UPDATE licenses SET status = 'revoked', updated_at = ? WHERE id = ?").run(this.now(), lic.id);
    this.invalidate();
    return true;
  }

  /* ------------------------------- Stripe ------------------------------- */

  async stripeRequest(path, params) {
    if (!this.cfg.stripeSecretKey) throw new LicenseError('Stripe n’est pas configuré sur ce bot.', 503);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
    let res;
    try {
      res = await this.fetch(`https://api.stripe.com/v1/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new LicenseError('Impossible de joindre Stripe. Réessaie dans un instant.', 502);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new LicenseError(`Stripe a refusé la demande : ${data?.error?.message || res.status}`, 502);
    return data;
  }

  /** Crée une page de paiement Stripe pour l'abonnement mensuel et renvoie son URL. */
  async createCheckout(discordUserId) {
    if (!this.stripeReady) throw new LicenseError('Le paiement n’est pas encore configuré (STRIPE_SECRET_KEY et STRIPE_PRICE_ID).', 503);
    if (!SNOWFLAKE.test(String(discordUserId))) throw new LicenseError('Utilisateur invalide.');
    const base = this.config.baseUrl;
    const data = await this.stripeRequest('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': this.cfg.stripePriceId,
      'line_items[0][quantity]': 1,
      client_reference_id: discordUserId,
      'metadata[discord_user_id]': discordUserId,
      'subscription_data[metadata][discord_user_id]': discordUserId,
      allow_promotion_codes: 'true',
      success_url: `${base}/dashboard#/account?paid=1`,
      cancel_url: `${base}/dashboard#/account`,
    });
    if (!data.url) throw new LicenseError('Stripe n’a pas renvoyé de lien de paiement.', 502);
    return data.url;
  }

  /** Page Stripe où le client gère sa carte, ses factures et sa résiliation. */
  async createPortal(license) {
    if (!license?.stripeCustomerId) throw new LicenseError('Cette clé n’a pas d’abonnement Stripe.', 400);
    const data = await this.stripeRequest('billing_portal/sessions', { customer: license.stripeCustomerId, return_url: `${this.config.baseUrl}/dashboard#/account` });
    if (!data.url) throw new LicenseError('Stripe n’a pas renvoyé de lien.', 502);
    return data.url;
  }

  /** Statut Stripe d'un abonnement → statut interne. */
  static mapStatus(stripeStatus) {
    if (stripeStatus === 'active' || stripeStatus === 'trialing') return stripeStatus;
    if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
    return 'canceled'; // canceled, incomplete_expired, incomplete, paused…
  }

  /** Fin de période : ancien format (`current_period_end`) ou nouveau (dans les lignes de l'abonnement). */
  static periodEndOf(sub) {
    const sec = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    return Number.isFinite(Number(sec)) && sec ? Number(sec) * 1000 : null;
  }

  upsertFromSubscription(sub) {
    if (!sub?.id) return 'ignoré';
    const status = LicenseService.mapStatus(sub.status);
    const periodEnd = LicenseService.periodEndOf(sub);
    const row = this.db.prepare('SELECT id, status FROM licenses WHERE stripe_subscription_id = ?').get(sub.id);
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null;
    if (row?.status === 'revoked') return `licence ${row.id} révoquée : ignoré`; // une révocation manuelle n'est jamais annulée par Stripe
    if (row) {
      this.db.prepare('UPDATE licenses SET status = ?, period_end = COALESCE(?, period_end), stripe_customer_id = COALESCE(?, stripe_customer_id), updated_at = ? WHERE id = ?')
        .run(status, periodEnd, customer, this.now(), row.id);
      this.invalidate();
      return `licence ${row.id} mise à jour (${status})`;
    }
    const owner = sub.metadata?.discord_user_id;
    if (!SNOWFLAKE.test(String(owner || ''))) return 'abonnement sans utilisateur Discord : ignoré';
    const created = this.createLicense({
      ownerId: owner, source: 'stripe', status, periodEnd, stripeCustomerId: customer, stripeSubscriptionId: sub.id,
    });
    return `licence ${created.id} créée`;
  }

  /** Traite un événement Stripe déjà vérifié. Idempotent : un même événement n'est jamais appliqué deux fois. */
  handleStripeEvent(event) {
    if (!event?.id || !event.type) return 'événement invalide';
    const seen = this.db.prepare('INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)').run(event.id, this.now());
    if (seen.changes === 0) return 'déjà traité';
    this.db.prepare('DELETE FROM stripe_events WHERE received_at < ?').run(this.now() - 60 * DAY);
    const obj = event.data?.object || {};

    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription' || !obj.subscription) return 'pas un abonnement';
        const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id;
        if (this.db.prepare('SELECT 1 FROM licenses WHERE stripe_subscription_id = ?').get(subId)) return 'licence déjà créée';
        const owner = obj.client_reference_id || obj.metadata?.discord_user_id;
        if (!SNOWFLAKE.test(String(owner || ''))) return 'paiement sans utilisateur Discord : ignoré';
        // La date de fin exacte arrive avec l'événement « customer.subscription.* » ; en attendant, un mois de marge.
        const created = this.createLicense({
          ownerId: owner, source: 'stripe', status: 'active', periodEnd: this.now() + 35 * DAY,
          stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id || null, stripeSubscriptionId: subId,
        });
        return `licence ${created.id} créée`;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.upsertFromSubscription(obj);
      case 'customer.subscription.deleted':
        return this.upsertFromSubscription({ ...obj, status: 'canceled' });
      default:
        return `ignoré (${event.type})`;
    }
  }

  /** Point d'entrée du webhook : vérifie la signature puis traite l'événement. Lève LicenseError si la signature est mauvaise. */
  handleWebhook(rawBody, signatureHeader) {
    if (!verifyStripeSignature(rawBody, signatureHeader, this.cfg.stripeWebhookSecret, { now: this.now() })) {
      throw new LicenseError('Signature invalide.', 400);
    }
    let event;
    try { event = JSON.parse(Buffer.from(rawBody).toString('utf8')); } catch { throw new LicenseError('JSON invalide.', 400); }
    return this.handleStripeEvent(event);
  }
}

module.exports = {
  LicenseService, LicenseError, generateKey, normalizeKey, hashKey, verifyStripeSignature, KEY_RE, DAY, GRACE_ACTIVE, GRACE_PAST_DUE,
};
