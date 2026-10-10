'use strict';
const { MODULES, MODULE_BY_ID, defaultSettings, normalizeModule } = require('./schema');

/**
 * Accès aux réglages d'un serveur. Les réglages sont toujours renvoyés complets et normalisés
 * (valeurs par défaut pour tout ce qui manque), donc le bot peut les lire sans vérifications.
 */
class SettingsStore {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    this.stmtGet = db.prepare('SELECT data FROM guild_settings WHERE guild_id = ?');
    this.stmtSet = db.prepare(`
      INSERT INTO guild_settings (guild_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    this.stmtDel = db.prepare('DELETE FROM guild_settings WHERE guild_id = ?');
  }

  /** Réglages complets d'un serveur (objet partagé : ne pas le modifier directement). */
  get(guildId) {
    let s = this.cache.get(guildId);
    if (s) return s;

    const row = this.stmtGet.get(guildId);
    let stored = {};
    if (row) {
      try { stored = JSON.parse(row.data); } catch { stored = {}; }
    }
    s = defaultSettings();
    for (const mod of MODULES) {
      s[mod.id] = normalizeModule(mod, stored[mod.id], {});
    }
    this.cache.set(guildId, s);
    return s;
  }

  /** Raccourci : get(guildId)[moduleId] */
  module(guildId, moduleId) {
    return this.get(guildId)[moduleId];
  }

  /**
   * Enregistre un module après normalisation avec le contexte du serveur (salons / rôles réels).
   * Renvoie la valeur normalisée réellement stockée.
   */
  saveModule(guildId, moduleId, input, ctx = {}) {
    const mod = MODULE_BY_ID.get(moduleId);
    if (!mod) throw new Error(`Module inconnu : ${moduleId}`);
    const current = this.get(guildId);
    const normalized = normalizeModule(mod, input, ctx, current[moduleId]);
    const next = { ...current, [moduleId]: normalized };
    this.stmtSet.run(guildId, JSON.stringify(next), Date.now());
    this.cache.set(guildId, next);
    return normalized;
  }

  /** Remplace plusieurs modules d'un coup (import). */
  saveMany(guildId, modulesInput, ctx = {}) {
    const current = this.get(guildId);
    const next = { ...current };
    for (const mod of MODULES) {
      if (modulesInput && modulesInput[mod.id] !== undefined) {
        next[mod.id] = normalizeModule(mod, modulesInput[mod.id], ctx, current[mod.id]);
      }
    }
    this.stmtSet.run(guildId, JSON.stringify(next), Date.now());
    this.cache.set(guildId, next);
    return next;
  }

  /** Met à jour une propriété interne (ex. messageId d'un panneau) sans repasser par le formulaire. */
  patchModule(guildId, moduleId, mutator) {
    const current = this.get(guildId);
    const copy = JSON.parse(JSON.stringify(current[moduleId]));
    mutator(copy);
    return this.saveModule(guildId, moduleId, copy, {});
  }

  reset(guildId) {
    this.stmtDel.run(guildId);
    this.cache.delete(guildId);
  }
}

module.exports = { SettingsStore };
