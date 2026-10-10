/* Point d'entrée du dashboard : session, routeur, barre latérale et page de module. */
import { api } from './api.js';
import { state, makeCtx } from './state.js';
import { setSchema, renderFields } from './form.js';
import { h, toast, confirmDialog, loading, deepClone, initials } from './ui.js';
import {
  guildsPage, overviewPage, leaderboardPage, casesPage, ticketsPage, messagePage, backupPage, adminPage,
} from './pages.js';
import { profilePage, webhooksPage, builderPage, auditPage } from './pages-bot.js';
import { EXTRAS } from './extras.js';
import { accountPage, renderNotice } from './pages-account.js';

const $ = (id) => document.getElementById(id);
const topbar = $('topbar');
const side = $('side');
const shell = $('shell');
const main = $('main');
const notice = $('notice');
let licenseOn = false;

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;

/* ---------------------------------------------------------------- */
/* Barre du haut                                                     */
/* ---------------------------------------------------------------- */
let botName = 'MonBot';

function renderTopbar() {
  const u = state.me.user;
  const guild = state.me.guilds.find((g) => g.id === state.guildId);
  // `replaceChildren(null)` écrirait le texte « null » dans la page : on filtre les entrées vides.
  topbar.replaceChildren(...[
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, botName.charAt(0).toUpperCase()), h('span', null, botName)),
    guild ? h('div', { class: 'crumb' }, '›',
      guild.icon ? h('img', { src: guild.icon, alt: '' }) : null,
      h('strong', null, guild.name),
      h('a', { href: '#/', class: 'btn btn-ghost btn-sm' }, 'Changer')) : null,
    h('span', { class: 'spacer' }),
    licenseOn ? h('a', { class: 'btn btn-sm', href: '#/account', title: 'Abonnement' }, '💳', h('span', { class: 'hide-sm' }, ' Abonnement')) : null,
    state.me.isOwner ? h('a', { class: 'btn btn-sm', href: '#/admin', title: 'Administration du bot' }, '🛠️', h('span', { class: 'hide-sm' }, ' Admin')) : null,
    h('div', { class: 'user-chip' }, h('span', null, u.name), h('img', { src: u.avatar, alt: '' }),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Se déconnecter', onclick: logout }, 'Déconnexion')),
  ].filter(Boolean));
}

async function logout() {
  try { await api.post('/api/logout'); } catch { /* déjà déconnecté */ }
  location.href = '/';
}

/* ---------------------------------------------------------------- */
/* Barre latérale                                                    */
/* ---------------------------------------------------------------- */
const BOT_TOOLS = [
  ['profile', '🎭', 'Profil du bot'],
  ['webhooks', '🪝', 'Webhooks et messages'],
  ['builder', '🧱', 'Créateur de serveur'],
];
const TOOLS = [
  ['leaderboard', '🏆', 'Classement'],
  ['cases', '⚖️', 'Sanctions'],
  ['tickets-list', '🎟️', 'Liste des tickets'],
  ['send', '✉️', 'Envoyer un message'],
  ['audit', '🕘', 'Historique'],
  ['backup', '💾', 'Sauvegarde'],
];

const isAdmin = () => Boolean(state.overview?.isAdmin);

function renderSide(active) {
  const id = state.guildId;
  const link = (page, icon, label, dot, locked) => h('a', { class: `nav-link${active === page ? ' active' : ''}`, href: `#/g/${id}/${page}` },
    h('span', { class: 'ico' }, icon), label,
    locked ? h('span', { class: 'lock', title: 'Réservé aux administrateurs' }, '🔒') : null,
    !locked && dot !== undefined ? h('span', { class: `state${dot ? ' on' : ''}`, title: dot ? 'Activé' : 'Désactivé' }) : null);

  const groups = (state.schema.categories || []).map((cat) => {
    const mods = state.schema.modules.filter((m) => m.category === cat.id);
    if (!mods.length) return [];
    return [h('h4', null, cat.name),
      ...mods.map((m) => link(m.id, m.icon, m.name, m.toggle ? Boolean(state.settings[m.id][m.toggle]) : undefined, m.adminOnly && !isAdmin()))];
  });
  // Modules sans catégorie connue : ne jamais les perdre.
  const known = new Set((state.schema.categories || []).map((c) => c.id));
  const orphans = state.schema.modules.filter((m) => !known.has(m.category));

  side.replaceChildren(
    h('h4', null, 'Serveur'),
    link('overview', '📊', 'Vue d’ensemble'),
    ...groups.flat(),
    ...(orphans.length ? [h('h4', null, 'Autres'), ...orphans.map((m) => link(m.id, m.icon, m.name, m.toggle ? Boolean(state.settings[m.id][m.toggle]) : undefined))] : []),
    h('h4', null, 'Le bot'),
    ...BOT_TOOLS.map(([page, icon, label]) => link(page, icon, label)),
    h('h4', null, 'Outils'),
    ...TOOLS.map(([page, icon, label]) => link(page, icon, label)),
  );
}

/* ---------------------------------------------------------------- */
/* Page d'un module (formulaire généré depuis le schéma)             */
/* ---------------------------------------------------------------- */
function modulePage(root, mod) {
  let saved = state.settings[mod.id];
  let draft = deepClone(saved);
  let dirty = false;
  let saving = false;

  const bar = h('div', { class: 'savebar', role: 'region', 'aria-label': 'Enregistrement' });
  const saveBtn = h('button', { class: 'btn btn-primary', onclick: () => save() }, 'Enregistrer');
  const cancelBtn = h('button', { class: 'btn btn-ghost', onclick: () => { render(); } }, 'Annuler');
  bar.append(h('span', { class: 'msg' }, h('span', { class: 'dotwarn' }), 'Modifications non enregistrées'), cancelBtn, saveBtn);

  const setDirty = (v) => {
    dirty = v;
    bar.classList.toggle('show', v);
    state.isDirty = () => dirty;
  };
  const markDirty = () => { if (!dirty) setDirty(true); };

  async function save({ silent = false } = {}) {
    if (saving) return false;
    saving = true;
    saveBtn.disabled = true;
    try {
      const res = await api.put(gurl(`/settings/${mod.id}`), draft);
      saved = res.settings;
      state.settings[mod.id] = saved;
      const same = JSON.stringify(saved) === JSON.stringify(draft);
      setDirty(false);
      if (!same) render(); // valeurs corrigées par le serveur (listes nettoyées, identifiants…)
      if (!silent) toast('Modifications enregistrées ✓');
      (res.warnings || []).forEach((w) => toast(w, 'warn', 8000));
      renderSide(mod.id);
      return true;
    } catch (err) {
      toast(err.message, 'bad', 6000);
      return false;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  const ctx = makeCtx({
    actions: {
      async publishRolePanel(item) {
        if (dirty && !(await save({ silent: true }))) return;
        try {
          const r = await api.post(gurl(`/actions/role-panel/${item.id}`));
          state.settings.rolepanels = r.settings;
          saved = r.settings;
          toast(h('span', null, 'Panneau publié. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord ↗')));
          render();
        } catch (e) { toast(e.message, 'bad', 6000); }
      },
    },
  });

  function render() {
    draft = deepClone(saved);
    setDirty(false);

    const head = h('div', { class: 'page-head' },
      h('div', null, h('h1', null, h('span', { class: 'ico' }, mod.icon), mod.name), h('p', null, mod.description)));

    if (mod.toggle) {
      head.append(h('label', { class: 'field-row', style: { cursor: 'pointer' } },
        h('span', { class: 'muted' }, 'Module activé'),
        h('span', { class: 'switch' },
          h('input', { type: 'checkbox', checked: Boolean(draft[mod.toggle]), 'aria-label': `Activer ${mod.name}`, onchange: (e) => { draft[mod.toggle] = e.target.checked; markDirty(); } }),
          h('span', { class: 'slider' }))));
    }

    const fields = mod.fields.filter((f) => f.key !== mod.toggle);
    const card = h('div', { class: 'card' }, renderFields(fields, draft, ctx, markDirty));
    root.replaceChildren(head, card);

    if (mod.adminOnly && !isAdmin()) root.insertBefore(h('div', { class: 'banner warn' }, `Le module « ${mod.name} » est réservé aux administrateurs du serveur : tu peux le consulter, mais pas l’enregistrer.`), card);
    const extra = mod.extras && EXTRAS[mod.extras];
    if (extra) root.append(extra(extrasApi));
    root.append(bar);
  }

  const extrasApi = {
    url: gurl,
    get isAdmin() { return isAdmin(); },
    saved: () => saved,
    saveFirst: async () => (!dirty || save({ silent: true })),
    applySaved(next) { state.settings[mod.id] = next; saved = next; render(); },
    async reloadMeta() { state.meta = await api.get(gurl('/meta')); ctx.meta = state.meta; },
  };

  render();
}

/* ---------------------------------------------------------------- */
/* Chargement d'un serveur                                           */
/* ---------------------------------------------------------------- */
async function loadGuild(id, { fresh = false } = {}) {
  if (state.guildId === id && state.meta && state.settings && !fresh) return;
  const [overview, meta, settings] = await Promise.all([
    api.get(`/api/guilds/${id}`), api.get(`/api/guilds/${id}/meta`), api.get(`/api/guilds/${id}/settings`),
  ]);
  state.guildId = id;
  state.overview = overview;
  state.meta = meta;
  state.settings = settings;
}

function showError(message, guild) {
  side.hidden = true;
  shell.classList.add('no-side');
  main.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' },
    h('div', { class: 'big' }, '😕'), h('p', null, message),
    guild && !guild.botPresent ? h('a', { class: 'btn btn-primary', href: guild.inviteUrl, target: '_blank', rel: 'noopener' }, 'Inviter le bot sur ce serveur') : null,
    ' ', h('a', { class: 'btn', href: '#/' }, '← Retour aux serveurs'))));
}

/* ---------------------------------------------------------------- */
/* Routeur                                                           */
/* ---------------------------------------------------------------- */
async function route() {
  const seg = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  state.currentHash = location.hash || '#/';
  state.isDirty = () => false;
  window.scrollTo(0, 0);
  main.replaceChildren(loading());
  renderTopbar();
  renderNotice(notice);

  try {
    if (seg[0] === 'g' && seg[1]) {
      const id = seg[1];
      const page = seg[2] || 'overview';
      const known = state.me.guilds.find((g) => g.id === id);
      if (!known) return showError('Tu n’as pas accès à ce serveur (il faut la permission « Gérer le serveur »).');
      if (!known.botPresent) return showError('Le bot n’est pas encore sur ce serveur.', known);

      try {
        await loadGuild(id, { fresh: page === 'overview' });
      } catch (err) {
        state.guildId = null;
        return showError(err.message, known);
      }
      renderTopbar();
      renderNotice(notice);
      shell.classList.remove('no-side');
      side.hidden = false;
      renderSide(page);

      const mod = state.schema.modules.find((m) => m.id === page);
      if (mod) return modulePage(main, mod);
      switch (page) {
        case 'overview': return overviewPage(main);
        case 'leaderboard': return await leaderboardPage(main);
        case 'cases': return await casesPage(main);
        case 'tickets-list': return await ticketsPage(main);
        case 'send': return messagePage(main);
        case 'backup': return backupPage(main);
        case 'profile': return await profilePage(main);
        case 'webhooks': return await webhooksPage(main);
        case 'builder': return await builderPage(main);
        case 'audit': return await auditPage(main);
        default: return showError('Page introuvable.');
      }
    }

    state.guildId = null;
    renderTopbar();
    renderNotice(notice);
    shell.classList.add('no-side');
    side.hidden = true;
    if (seg[0] === 'admin') return await adminPage(main);
    if (seg[0]?.split('?')[0] === 'account') {
      state.overview = null; // le bandeau d'essai ne concerne que les pages d'un serveur
      return await accountPage(main, { paid: /[?&]paid=1/.test(seg[0]) });
    }
    return guildsPage(main);
  } catch (err) {
    if (err.status === 401) { location.href = '/auth/login'; return undefined; }
    console.error(err);
    return showError(err.message || 'Une erreur est survenue.');
  }
}

let revertingHash = false;
window.addEventListener('hashchange', async () => {
  if (revertingHash) { revertingHash = false; return; }
  if (state.isDirty()) {
    const leave = await confirmDialog({ title: 'Modifications non enregistrées', text: 'Si tu quittes cette page, tes changements seront perdus.', confirmLabel: 'Quitter sans enregistrer', danger: true });
    if (!leave) {
      revertingHash = true;
      location.hash = state.currentHash;
      return;
    }
  }
  route();
});

window.addEventListener('beforeunload', (e) => {
  if (state.isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------------------------------------------------------- */
/* Démarrage                                                         */
/* ---------------------------------------------------------------- */
function showLogin(name) {
  topbar.replaceChildren(h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark' }, name.charAt(0).toUpperCase()), h('span', null, name)));
  side.hidden = true;
  shell.classList.add('no-side');
  main.replaceChildren(h('div', { class: 'card', style: { maxWidth: '460px', margin: '60px auto', textAlign: 'center' } },
    h('div', { style: { fontSize: '40px' } }, '🔐'),
    h('h2', null, 'Connecte-toi pour continuer'),
    h('p', { class: 'muted' }, 'Le dashboard utilise ton compte Discord pour savoir quels serveurs tu peux gérer. Nous ne conservons pas ton jeton Discord.'),
    h('a', { class: 'btn btn-primary btn-lg', href: '/auth/login' }, 'Se connecter avec Discord')));
}

(async function boot() {
  main.replaceChildren(loading());
  try {
    const pub = await api.get('/api/public');
    botName = pub.botName;
    licenseOn = Boolean(pub.license?.enabled);
    document.title = `Dashboard — ${botName}`;
  } catch { /* on garde le nom par défaut */ }

  try {
    state.me = await api.get('/api/me');
  } catch (err) {
    if (err.status === 401) return showLogin(botName);
    main.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, '⚠️'), err.message)));
    return undefined;
  }
  state.schema = await api.get('/api/schema');
  setSchema(state.schema);
  return route();
}());
