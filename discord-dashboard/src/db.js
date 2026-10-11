'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/**
 * Ouvre (et migre) la base SQLite. `file` peut être ':memory:' pour les tests.
 */
/** Ajoute une colonne si elle n'existe pas encore (migration légère). */
function addColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id   TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      mod_id     TEXT NOT NULL,
      type       TEXT NOT NULL,
      reason     TEXT NOT NULL DEFAULT '',
      duration   INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cases_guild_user ON cases (guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_cases_guild_time ON cases (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS levels (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      xp       INTEGER NOT NULL DEFAULT 0,
      level    INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_levels_rank ON levels (guild_id, xp DESC);

    CREATE TABLE IF NOT EXISTS tickets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      number     INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      topic      TEXT NOT NULL DEFAULT '',
      reason     TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      created_at INTEGER NOT NULL,
      closed_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets (guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expires INTEGER NOT NULL
    );

    -- Bibliothèque de messages (illimitée) et webhooks
    CREATE TABLE IF NOT EXISTS saved_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_guild ON saved_messages (guild_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS webhooks (
      id         TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      token      TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_guild ON webhooks (guild_id);

    -- Abonnements / licences
    CREATE TABLE IF NOT EXISTS licenses (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash               TEXT NOT NULL UNIQUE,
      key_enc                TEXT NOT NULL,
      owner_id               TEXT NOT NULL,
      source                 TEXT NOT NULL DEFAULT 'stripe',
      status                 TEXT NOT NULL DEFAULT 'active',
      period_end             INTEGER,
      max_guilds             INTEGER NOT NULL DEFAULT 1,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT UNIQUE,
      note                   TEXT NOT NULL DEFAULT '',
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_licenses_owner ON licenses (owner_id);
    CREATE TABLE IF NOT EXISTS license_guilds (
      guild_id     TEXT PRIMARY KEY,
      license_id   INTEGER NOT NULL,
      activated_by TEXT NOT NULL,
      activated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_license_guilds_license ON license_guilds (license_id);
    CREATE TABLE IF NOT EXISTS trials (
      guild_id   TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stripe_events (
      id          TEXT PRIMARY KEY,
      received_at INTEGER NOT NULL
    );

    -- Historique des modifications faites depuis le dashboard
    CREATE TABLE IF NOT EXISTS audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit (guild_id, id DESC);

    -- Communauté
    CREATE TABLE IF NOT EXISTS giveaways (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT,
      prize       TEXT NOT NULL,
      winners     INTEGER NOT NULL DEFAULT 1,
      host_id     TEXT NOT NULL,
      ends_at     INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      required_role TEXT,
      min_level   INTEGER NOT NULL DEFAULT 0,
      winner_ids  TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_giveaways_due ON giveaways (status, ends_at);
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL,
      user_id     TEXT NOT NULL,
      PRIMARY KEY (giveaway_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS polls (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      question   TEXT NOT NULL,
      options    TEXT NOT NULL,
      multi      INTEGER NOT NULL DEFAULT 0,
      ends_at    INTEGER,
      status     TEXT NOT NULL DEFAULT 'open',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_polls_due ON polls (status, ends_at);
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      option  INTEGER NOT NULL,
      PRIMARY KEY (poll_id, user_id, option)
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      author_id  TEXT NOT NULL,
      content    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open',
      reason     TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_guild ON suggestions (guild_id, id DESC);
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id INTEGER NOT NULL,
      user_id       TEXT NOT NULL,
      vote          INTEGER NOT NULL,
      PRIMARY KEY (suggestion_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS starboard (
      guild_id        TEXT NOT NULL,
      message_id      TEXT NOT NULL,
      channel_id      TEXT NOT NULL,
      star_message_id TEXT,
      stars           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS counting (
      guild_id  TEXT PRIMARY KEY,
      current   INTEGER NOT NULL DEFAULT 0,
      last_user TEXT,
      highscore INTEGER NOT NULL DEFAULT 0,
      total     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS birthdays (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      day      INTEGER NOT NULL,
      month    INTEGER NOT NULL,
      year     INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS economy (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      balance    INTEGER NOT NULL DEFAULT 0,
      last_daily INTEGER NOT NULL DEFAULT 0,
      streak     INTEGER NOT NULL DEFAULT 0,
      last_work  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_economy_rank ON economy (guild_id, balance DESC);
    CREATE TABLE IF NOT EXISTS inventory (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      item_id  TEXT NOT NULL,
      qty      INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS reputation (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      points   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS rep_log (
      guild_id TEXT NOT NULL,
      from_id  TEXT NOT NULL,
      to_id    TEXT NOT NULL,
      at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rep_log ON rep_log (guild_id, from_id, at);

    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      guild_id   TEXT,
      channel_id TEXT,
      text       TEXT NOT NULL,
      due_at     INTEGER NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (due_at);

    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      mod_id     TEXT NOT NULL,
      note       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS temp_bans (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      unban_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_temp_bans_due ON temp_bans (unban_at);

    CREATE TABLE IF NOT EXISTS afk (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      reason   TEXT NOT NULL DEFAULT '',
      since    INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS member_roles (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      roles    TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sticky (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      counter    INTEGER NOT NULL DEFAULT 0,
      last_at    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS temp_voice (
      channel_id TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      owner_id   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appeals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id        TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      case_id         INTEGER NOT NULL,
      type            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      final           INTEGER NOT NULL DEFAULT 0,
      channel_id      TEXT NOT NULL DEFAULT '',
      message_id      TEXT,
      answers         TEXT NOT NULL DEFAULT '[]',
      created_at      INTEGER NOT NULL,
      decided_at      INTEGER,
      decided_by      TEXT,
      decision_reason TEXT NOT NULL DEFAULT '',
      close_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_appeals_guild ON appeals (guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_appeals_case ON appeals (guild_id, case_id);
    CREATE INDEX IF NOT EXISTS idx_appeals_close ON appeals (close_at);

    CREATE TABLE IF NOT EXISTS invite_joins (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      inviter_id TEXT,
      code       TEXT NOT NULL DEFAULT '',
      joined_at  INTEGER NOT NULL,
      left_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins (guild_id, inviter_id);
    CREATE INDEX IF NOT EXISTS idx_invite_joins_user ON invite_joins (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS daily_stats (
      guild_id TEXT NOT NULL,
      day      TEXT NOT NULL,
      joins    INTEGER NOT NULL DEFAULT 0,
      leaves   INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day)
    );
    CREATE TABLE IF NOT EXISTS channel_stats (
      guild_id   TEXT NOT NULL,
      day        TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      messages   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day, channel_id)
    );

    CREATE TABLE IF NOT EXISTS pending_verification (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // Colonnes ajoutées après la première version (bases existantes).
  addColumn(db, 'tickets', 'ai_replies', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'tickets', 'ai_paused', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'tickets', 'staff_replied', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'tickets', 'last_activity', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'tickets', 'answers', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'tickets', 'rating', 'INTEGER');
  addColumn(db, 'tickets', 'close_reason', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'tickets', 'closed_by', 'TEXT');
  addColumn(db, 'tickets', 'warned', 'INTEGER NOT NULL DEFAULT 0');

  return db;
}

module.exports = { openDatabase, addColumn };
