'use strict';
const session = require('express-session');

const DAY = 86400000;

/** Stockage des sessions dans SQLite (survit aux redémarrages, sans dépendance supplémentaire). */
class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.stmtGet = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.stmtSet = db.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
    this.stmtDel = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.stmtTouch = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.stmtClean = db.prepare('DELETE FROM sessions WHERE expires <= ?');
    this.stmtClean.run(Date.now());
    this.timer = setInterval(() => this.stmtClean.run(Date.now()), 3600000);
    this.timer.unref();
  }

  static expiryOf(sess) {
    const exp = sess?.cookie?.expires;
    return exp ? new Date(exp).getTime() : Date.now() + DAY;
  }

  get(sid, cb) {
    try {
      const row = this.stmtGet.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.stmtSet.run(sid, JSON.stringify(sess), SqliteSessionStore.expiryOf(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.stmtTouch.run(SqliteSessionStore.expiryOf(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmtDel.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}

module.exports = { SqliteSessionStore };
