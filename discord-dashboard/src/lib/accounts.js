'use strict';
/**
 * Comptes du dashboard : identifiant + mot de passe.
 * Seuls les administrateurs (ou les propriétaires définis dans OWNER_IDS) peuvent en créer ; sans compte, pas d'accès.
 * Les mots de passe sont stockés hachés (scrypt, sel aléatoire) et ne peuvent jamais être relus.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const SNOWFLAKE = /^\d{17,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const ROLES = ['user', 'admin'];
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  if (!expected.length) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

let dummyHash;
/** Faux hachage vérifié quand l'identifiant n'existe pas, pour que la réponse prenne le même temps. */
const getDummyHash = () => { dummyHash ||= hashPassword(crypto.randomBytes(12).toString('hex')); return dummyHash; };

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new AccountError(400, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
  if (password.length > MAX_PASSWORD) throw new AccountError(400, `Le mot de passe est trop long (${MAX_PASSWORD} caractères maximum).`);
}

function cleanGuildIds(ids) {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) throw new AccountError(400, 'Liste de serveurs invalide.');
  const out = [...new Set(ids.map(String))];
  if (out.length > 200 || out.some((id) => !SNOWFLAKE.test(id))) throw new AccountError(400, 'Liste de serveurs invalide.');
  return out;
}

const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);

class AccountService {
  constructor({ db, now = () => Date.now() }) {
    this.db = db;
    this.now = now;
    this.attempts = new Map(); // `${ip}|${identifiant}` → { fails, until }
    this.q = {
      get: db.prepare('SELECT * FROM accounts WHERE id = ?'),
      byName: db.prepare('SELECT * FROM accounts WHERE username = ?'),
      list: db.prepare("SELECT * FROM accounts ORDER BY (role = 'admin') DESC, username COLLATE NOCASE"),
      count: db.prepare('SELECT COUNT(*) AS n FROM accounts'),
      admins: db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled = 0"),
      insert: db.prepare(`INSERT INTO accounts (username, display_name, password_hash, role, guild_ids, disabled, created_by, created_at, pw_changed_at)
        VALUES (?,?,?,?,?,0,?,?,?)`),
      update: db.prepare('UPDATE accounts SET display_name = ?, role = ?, guild_ids = ?, disabled = ? WHERE id = ?'),
      setPassword: db.prepare('UPDATE accounts SET password_hash = ?, pw_changed_at = ? WHERE id = ?'),
      login: db.prepare('UPDATE accounts SET last_login = ? WHERE id = ?'),
      del: db.prepare('DELETE FROM accounts WHERE id = ?'),
      kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
      kvSet: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    };
  }

  static shape(r) {
    if (!r) return null;
    let guildIds = [];
    try { guildIds = JSON.parse(r.guild_ids); } catch { /* base abîmée : aucun serveur */ }
    return {
      id: r.id,
      username: r.username,
      displayName: r.display_name || '',
      role: r.role,
      guildIds: Array.isArray(guildIds) ? guildIds : [],
      disabled: Boolean(r.disabled),
      createdBy: r.created_by || '',
      createdAt: r.created_at,
      lastLogin: r.last_login || null,
      pwChangedAt: r.pw_changed_at,
    };
  }

  /** Version sans donnée interne, destinée à l'interface. */
  static view(a) {
    const { pwChangedAt, ...rest } = a;
    return rest;
  }

  get(id) { return AccountService.shape(this.q.get.get(Number(id) || 0)); }

  list() { return this.q.list.all().map(AccountService.shape); }

  count() { return this.q.count.get().n; }

  activeAdmins() { return this.q.admins.get().n; }

  async create({ username, password, displayName, role = 'user', guildIds = [], createdBy = '' }) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new AccountError(400, 'Identifiant invalide : 3 à 32 caractères (lettres, chiffres, point, tiret, underscore), sans espace.');
    }
    checkPassword(password);
    if (!ROLES.includes(role)) throw new AccountError(400, 'Rôle invalide.');
    const ids = cleanGuildIds(guildIds) || [];
    if (this.q.byName.get(username)) throw new AccountError(409, 'Cet identifiant existe déjà.');
    const hash = await hashPassword(password);
    const now = this.now();
    const info = this.q.insert.run(username, cleanName(displayName), hash, role, JSON.stringify(role === 'admin' ? [] : ids), String(createdBy), now, now);
    return this.get(info.lastInsertRowid);
  }

  /** Modifie un compte. Seuls les champs présents dans `patch` changent. */
  async update(id, patch = {}, { actorId = null } = {}) {
    const cur = this.get(id);
    if (!cur) throw new AccountError(404, 'Compte introuvable.');
    const role = patch.role === undefined ? cur.role : patch.role;
    if (!ROLES.includes(role)) throw new AccountError(400, 'Rôle invalide.');
    const disabled = patch.disabled === undefined ? cur.disabled : Boolean(patch.disabled);
    const guildIds = cleanGuildIds(patch.guildIds) ?? cur.guildIds;
    const displayName = patch.displayName === undefined ? cur.displayName : cleanName(patch.displayName);

    if (actorId !== null && Number(actorId) === cur.id && disabled && !cur.disabled) {
      throw new AccountError(400, 'Tu ne peux pas désactiver ton propre compte.');
    }
    const losesAdmin = cur.role === 'admin' && !cur.disabled && (role !== 'admin' || disabled);
    if (losesAdmin && this.activeAdmins() <= 1) throw new AccountError(400, 'Il doit rester au moins un administrateur actif.');

    let hash = null;
    if (patch.password !== undefined && patch.password !== '') {
      checkPassword(patch.password);
      hash = await hashPassword(patch.password);
    }
    this.q.update.run(displayName, role, JSON.stringify(role === 'admin' ? [] : guildIds), disabled ? 1 : 0, cur.id);
    if (hash) this.q.setPassword.run(hash, this.now(), cur.id);
    return this.get(cur.id);
  }

  remove(id, { actorId = null } = {}) {
    const cur = this.get(id);
    if (!cur) throw new AccountError(404, 'Compte introuvable.');
    if (actorId !== null && Number(actorId) === cur.id) throw new AccountError(400, 'Tu ne peux pas supprimer ton propre compte.');
    if (cur.role === 'admin' && !cur.disabled && this.activeAdmins() <= 1) throw new AccountError(400, 'Il doit rester au moins un administrateur actif.');
    this.q.del.run(cur.id);
  }

  /** Changement de mot de passe par le titulaire du compte. Renvoie la nouvelle empreinte de session. */
  async changeOwnPassword(id, current, next) {
    const row = this.q.get.get(Number(id) || 0);
    if (!row) throw new AccountError(404, 'Compte introuvable.');
    if (typeof current !== 'string' || !(await verifyPassword(current, row.password_hash))) throw new AccountError(403, 'Le mot de passe actuel est incorrect.');
    checkPassword(next);
    const at = Math.max(this.now(), row.pw_changed_at + 1);
    this.q.setPassword.run(await hashPassword(next), at, row.id);
    return at;
  }

  /* ------------------------------ Connexion ------------------------------ */
  #prune(now) {
    if (this.attempts.size < MAX_TRACKED) return;
    for (const [k, v] of this.attempts) if (v.until <= now && v.fails < MAX_FAILS) this.attempts.delete(k);
    if (this.attempts.size >= MAX_TRACKED) this.attempts.clear();
  }

  async authenticate(username, password, ip = '') {
    const now = this.now();
    const name = typeof username === 'string' ? username.trim().slice(0, 64) : '';
    const key = `${ip}|${name.toLowerCase()}`;
    const st = this.attempts.get(key);
    if (st && st.fails >= MAX_FAILS && st.until > now) {
      throw new AccountError(429, `Trop d’essais. Réessaie dans ${Math.ceil((st.until - now) / 60000)} minute(s).`);
    }

    const row = name && typeof password === 'string' && password.length <= MAX_PASSWORD ? this.q.byName.get(name) : null;
    const ok = await verifyPassword(typeof password === 'string' ? password.slice(0, MAX_PASSWORD) : '', row ? row.password_hash : await getDummyHash());
    if (!row || !ok) {
      this.#prune(now);
      const fails = (st && st.until > now ? st.fails : 0) + 1;
      this.attempts.set(key, { fails, until: now + LOCK_MS });
      throw new AccountError(401, 'Identifiant ou mot de passe incorrect.');
    }
    this.attempts.delete(key);
    if (row.disabled) throw new AccountError(403, 'Ce compte est désactivé. Contacte l’administrateur.');
    this.q.login.run(now, row.id);
    return AccountService.shape(row);
  }

  /* --------------------- Administrateur défini par variables --------------------- */
  /**
   * Crée (ou réinitialise) le compte administrateur décrit par ADMIN_USERNAME / ADMIN_PASSWORD.
   * Le compte n'est touché qu'à sa création ou quand ces variables changent : un mot de passe modifié
   * depuis le dashboard n'est donc pas écrasé à chaque redémarrage.
   */
  async seedAdmin(username, password) {
    if (!username || !password) return null;
    const fp = crypto.createHash('sha256').update(`${username}\n${password}`).digest('hex');
    const known = this.q.kvGet.get('admin-seed')?.value;
    const row = this.q.byName.get(username);
    if (!row) {
      await this.create({ username, password, displayName: 'Administrateur', role: 'admin', createdBy: 'env' });
      this.q.kvSet.run('admin-seed', fp);
      return 'created';
    }
    if (known === fp) return 'unchanged';
    checkPassword(password);
    this.q.update.run(row.display_name, 'admin', '[]', 0, row.id);
    this.q.setPassword.run(await hashPassword(password), this.now(), row.id);
    this.q.kvSet.run('admin-seed', fp);
    return 'updated';
  }
}

module.exports = {
  AccountService, AccountError, hashPassword, verifyPassword, USERNAME_RE, MIN_PASSWORD, MAX_PASSWORD, MAX_FAILS, LOCK_MS,
};
