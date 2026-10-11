/** État partagé du dashboard (un seul objet, modifié par app.js et lu par pages.js). */
export const state = {
  me: null,          // { user, isOwner, guilds, ready }
  schema: null,      // { modules, variables, messageFields }
  guildId: null,
  overview: null,    // résumé du serveur courant
  meta: null,        // salons / rôles / bot
  settings: null,    // réglages de tous les modules du serveur courant
  isDirty: () => false, // remplacé par la page de module ouverte
  currentHash: '#/',
};

/** Contexte passé au moteur de formulaires. */
export function makeCtx(extra = {}) {
  return {
    me: state.me,
    meta: state.meta,
    schema: state.schema,
    getGeneral: () => state.settings?.general || {},
    ...extra,
  };
}
