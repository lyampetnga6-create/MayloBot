/* Point d'entrée du dashboard : session, routeur, barre latérale et page de module. */
import { api } from './api.js';
import { state, makeCtx } from './state.js';
import { setSchema, renderFields } from './form.js';
import { h, toast, confirmDialog, loading, deepClone, initials, icon } from './ui.js';
import { MODULE_ICONS } from './icons.js';
import {
  guildsPage, overviewPage, leaderboardPage, casesPage, appealsPage, statsPage, ticketsPage, messagePage, backupPage, adminPage,
} from './pages.js';
import { docsPage } from './pages-docs.js';
import { profilePage, webhooksPage, builderPage, auditPage } from './pages-bot.js';
import { EXTRAS } from './extras.js';
import { inboxPage, refreshUnread, paintBadge } from './pages-dms.js';
import { accountPage, renderNotice } from './pages-account.js';
import { accountsPage, changePasswordDialog } from './pages-accounts.js';

const $ = (id) => document.getElementById(id);
const topbar = $('topbar');
const side = $('side');
const rail = $('rail');
const shell = $('shell');
const main = $('main');
const notice = $('notice');
let licenseOn = false;
let publicInfo = { supportUrl: null, inviteUrl: null };

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;

/* ---------------------------------------------------------------- */
/* Barre du haut                                                     */
/* ---------------------------------------------------------------- */
let botName = 'MonBot';

/** Affiche ou masque la colonne des serveurs et le menu du serveur. */
function layout({ withRail, withSide }) {
  shell.classList.toggle('no-rail', !withRail);
  shell.classList.toggle('no-side', !withSide);
  rail.hidden = !withRail;
  side.hidden = !withSide;
}

function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }
document.addEventListener('click', (e) => { if (!e.target.closest?.('.menu-wrap')) closeMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

function userMenu() {
  const u = state.me.user;
  const item = (iconName, label, attrs) => h(attrs.href ? 'a' : 'button', { class: `menu-item${attrs.danger ? ' danger' : ''}`, ...attrs }, icon(iconName, 17), label);
  const wrap = h('div', { class: 'menu-wrap' });
  const btn = h('button', { class: 'user-btn', 'aria-haspopup': 'true', onclick: (e) => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    closeMenus();
    if (open) return;
    wrap.append(h('div', { class: 'menu', role: 'menu' },
      h('div', { class: 'menu-head' }, h('strong', null, u.name), h('span', null, u.username ? `@${u.username}` : 'Connecté avec Discord')),
      item('grid', 'Mes serveurs', { href: '#/', onclick: closeMenus }),
      licenseOn ? item('creditCard', 'Abonnement', { href: '#/account', onclick: closeMenus }) : null,
      state.me.isOwner ? item('users', 'Comptes', { href: '#/accounts', onclick: closeMenus }) : null,
      state.me.isOwner ? item('wrench', 'Administration du bot', { href: '#/admin', onclick: closeMenus }) : null,
      state.me.account ? item('key', 'Changer mon mot de passe', { onclick: () => { closeMenus(); changePasswordDialog(); } }) : null,
      item('book', 'Documentation', { href: '#/docs', onclick: closeMenus }),
      item('logout', 'Se déconnecter', { danger: true, onclick: logout }),
    ));
  } }, h('img', { src: u.avatar, alt: '' }), h('span', { class: 'hide-sm' }, u.name), icon('chevronDown', 15));
  wrap.append(btn);
  return wrap;
}

function renderTopbar() {
  const hash = location.hash || '#/';
  const link = (href, iconName, label, match) => h('a', { class: `top-link${match ? ' active' : ''}`, href }, icon(iconName, 17), h('span', { class: 'hide-sm' }, label));
  // `replaceChildren(null)` écrirait le texte « null » dans la page : on filtre les entrées vides.
  topbar.replaceChildren(...[
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, botName.charAt(0).toUpperCase()), h('span', null, botName)),
    link('#/docs', 'book', 'Documentation', hash.startsWith('#/docs')),
    licenseOn ? link('#/account', 'creditCard', 'Abonnement', hash.startsWith('#/account')) : null,
    state.me.isOwner ? link('#/accounts', 'users', 'Comptes', hash.startsWith('#/accounts')) : null,
    h('span', { class: 'spacer' }),
    publicInfo.supportUrl ? h('a', { class: 'btn btn-outline btn-sm', href: publicInfo.supportUrl, target: '_blank', rel: 'noopener' }, icon('lifebuoy', 16), h('span', { class: 'hide-sm' }, 'Support')) : null,
    userMenu(),
  ].filter(Boolean));
}

async function logout() {
  try { await api.post('/api/logout'); } catch { /* déjà déconnecté */ }
  location.href = '/';
}

/* ---------------------------------------------------------------- */
/* Colonne des serveurs                                              */
/* ---------------------------------------------------------------- */
function renderRail() {
  const guilds = state.me.guilds.filter((g) => g.botPresent);
  const item = (g) => h('a', {
    class: `rail-item${g.id === state.guildId ? ' active' : ''}`, href: `#/g/${g.id}/overview`, title: g.name, 'aria-label': g.name,
  }, g.icon ? h('img', { src: g.icon, alt: '' }) : initials(g.name));
  rail.replaceChildren(
    h('a', { class: `rail-item${!state.guildId && ['', '#', '#/'].includes(location.hash) ? ' active' : ''}`, href: '#/', title: 'Mes serveurs', 'aria-label': 'Mes serveurs' }, icon('grid', 20)),
    h('span', { class: 'rail-sep' }),
    ...guilds.map(item),
    h('a', {
      class: 'rail-item add', title: 'Ajouter le bot à un serveur', 'aria-label': 'Ajouter le bot à un serveur',
      href: publicInfo.inviteUrl || '#/', target: publicInfo.inviteUrl ? '_blank' : undefined, rel: 'noopener',
    }, icon('plus', 20)),
  );
}

/* ---------------------------------------------------------------- */
/* Menu du serveur                                                   */
/* ---------------------------------------------------------------- */
const BOT_TOOLS = [
  ['profile', 'idCard', 'Profil du bot'],
  ['webhooks', 'link', 'Webhooks et messages'],
  ['builder', 'package', 'Créateur de serveur'],
];
const TOOLS = [
  ['stats', 'chart', 'Statistiques'],
  ['leaderboard', 'trophy', 'Classement'],
  ['cases', 'gavel', 'Sanctions'],
  ['inbox', 'mail', 'Messages privés'],
  ['appeals-list', 'scale', 'Contestations'],
  ['tickets-list', 'inbox', 'Liste des tickets'],
  ['send', 'send', 'Envoyer un message'],
  ['audit', 'history', 'Historique'],
  ['backup', 'save', 'Sauvegarde'],
];

const isAdmin = () => Boolean(state.overview?.isAdmin);

function renderSide(active) {
  const id = state.guildId;
  const guild = state.me.guilds.find((g) => g.id === id);
  const link = (page, iconName, label, dot, locked) => h('a', { class: `nav-link${active === page ? ' active' : ''}`, href: `#/g/${id}/${page}` },
    h('span', { class: 'ico' }, icon(iconName, 18)), label,
    locked ? h('span', { class: 'lock', title: 'Réservé aux administrateurs' }, icon('lock', 14)) : null,
    !locked && dot !== undefined ? h('span', { class: `state${dot ? ' on' : ''}`, title: dot ? 'Activé' : 'Désactivé' }) : null,
    page === 'inbox' ? h('span', { class: 'nav-badge', id: 'inbox-badge', hidden: !state.unread }, state.unread > 99 ? '99+' : String(state.unread || '')) : null);
  const modLink = (m) => link(m.id, MODULE_ICONS[m.id] || 'circle', m.name, m.toggle ? Boolean(state.settings[m.id][m.toggle]) : undefined, m.adminOnly && !isAdmin());

  const groups = (state.schema.categories || []).map((cat) => {
    const mods = state.schema.modules.filter((m) => m.category === cat.id);
    if (!mods.length) return [];
    return [h('h4', null, cat.name), ...mods.map(modLink)];
  });
  // Modules sans catégorie connue : ne jamais les perdre.
  const known = new Set((state.schema.categories || []).map((c) => c.id));
  const orphans = state.schema.modules.filter((m) => !known.has(m.category));

  side.replaceChildren(
    h('div', { class: 'side-head' },
      guild?.icon ? h('img', { src: guild.icon, alt: '' }) : h('span', { class: 'guild-ico' }, initials(guild?.name || '?')),
      h('div', null, h('strong', { title: guild?.name }, guild?.name || 'Serveur'), h('span', null, 'Configuration du bot'))),
    link('overview', 'layout', 'Vue d’ensemble'),
    ...groups.flat(),
    ...(orphans.length ? [h('h4', null, 'Autres'), ...orphans.map(modLink)] : []),
    h('h4', null, 'Le bot'),
    ...BOT_TOOLS.map(([page, iconName, label]) => link(page, iconName, label)),
    h('h4', null, 'Outils'),
    ...TOOLS.map(([page, iconName, label]) => link(page, iconName, label)),
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
      if (!silent) toast('Modifications enregistrées');
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
          toast(h('span', null, 'Panneau publié. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord')));
          render();
        } catch (e) { toast(e.message, 'bad', 6000); }
      },
    },
  });

  function render() {
    draft = deepClone(saved);
    setDirty(false);

    const head = h('div', { class: 'page-head' },
      h('div', null, h('h1', null, h('span', { class: 'ico' }, icon(MODULE_ICONS[mod.id] || 'circle', 20)), mod.name), h('p', null, mod.description)));

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
  layout({ withRail: true, withSide: false });
  renderRail();
  main.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' },
    h('div', { class: 'big' }, icon('alertCircle', 26)), h('p', null, message),
    guild && !guild.botPresent ? h('a', { class: 'btn btn-primary', href: guild.inviteUrl, target: '_blank', rel: 'noopener' }, 'Inviter le bot sur ce serveur') : null,
    ' ', h('a', { class: 'btn', href: '#/' }, icon('arrowLeft', 15), 'Retour aux serveurs'))));
}

/* ---------------------------------------------------------------- */
/* Routeur                                                           */
/* ---------------------------------------------------------------- */
async function route() {
  const seg = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  state.currentHash = location.hash || '#/';
  state.isDirty = () => false;
  state.cleanup?.();
  state.cleanup = null;
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
      layout({ withRail: true, withSide: true });
      renderRail();
      renderSide(page);
      if (page !== 'inbox') refreshUnread();

      const mod = state.schema.modules.find((m) => m.id === page);
      if (mod) return modulePage(main, mod);
      switch (page) {
        case 'overview': return overviewPage(main);
        case 'leaderboard': return await leaderboardPage(main);
        case 'cases': return await casesPage(main);
        case 'inbox': return await inboxPage(main);
        case 'appeals-list': return await appealsPage(main);
        case 'stats': return await statsPage(main);
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
    layout({ withRail: true, withSide: false });
    renderRail();
    if (seg[0] === 'docs') return docsPage(main);
    if (seg[0] === 'admin') return await adminPage(main);
    if (seg[0] === 'accounts') return await accountsPage(main);
    if (seg[0]?.split('?')[0] === 'account') {
      state.overview = null; // le bandeau d'essai ne concerne que les pages d'un serveur
      return await accountPage(main, { paid: /[?&]paid=1/.test(seg[0]) });
    }
    return guildsPage(main);
  } catch (err) {
    if (err.status === 401) { location.reload(); return undefined; }
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
const LOGIN_ERRORS = {
  owner_only: 'Ce compte Discord n’a pas d’accès. Connecte-toi avec ton identifiant et ton mot de passe.',
  access_denied: 'Connexion Discord annulée.',
  invalid_state: 'La connexion a expiré. Réessaie.',
  token: 'Discord a refusé la connexion.',
  profile: 'Impossible de récupérer ton profil Discord.',
};

function showLogin(name) {
  topbar.replaceChildren(h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark' }, name.charAt(0).toUpperCase()), h('span', null, name)));
  layout({ withRail: false, withSide: false });

  const username = h('input', { class: 'input', type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: false, required: true });
  const password = h('input', { class: 'input', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const eye = h('button', {
    type: 'button', class: 'pw-eye', title: 'Afficher ou masquer', 'aria-label': 'Afficher ou masquer le mot de passe',
    onclick: () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 17));
    },
  }, icon('eye', 17));
  const urlError = LOGIN_ERRORS[new URLSearchParams(location.search).get('error')];
  const error = h('div', { class: 'banner bad', role: 'alert', hidden: !urlError }, urlError || '');
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Se connecter');

  const form = h('form', { class: 'card login', onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      await api.post('/api/login', { username: username.value.trim(), password: password.value });
      location.replace('/dashboard');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      password.value = '';
      password.focus();
      submit.disabled = false;
    }
  } },
  h('div', { class: 'login-ico' }, icon('lock', 22)),
  h('h2', null, 'Connexion'),
  h('p', { class: 'sub' }, 'Le dashboard est réservé aux personnes qui ont un compte. Les comptes sont créés par l’administrateur.'),
  publicInfo.needsSetup ? h('div', { class: 'banner warn' }, 'Aucun compte n’existe encore. Dans Railway, onglet Variables, ajoute ADMIN_USERNAME et ADMIN_PASSWORD (8 caractères minimum), puis attends le redémarrage.') : null,
  error,
  h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'login-user' }, 'Identifiant'), Object.assign(username, { id: 'login-user' })),
  h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'login-pass' }, 'Mot de passe'), h('div', { class: 'pw-wrap' }, Object.assign(password, { id: 'login-pass' }), eye)),
  submit,
  publicInfo.discordLogin ? h('div', { class: 'login-alt' }, 'Propriétaire du bot ? ', h('a', { href: '/auth/login' }, 'Connexion avec Discord')) : null);

  main.replaceChildren(form);
  username.focus();
}

(async function boot() {
  main.replaceChildren(loading());
  try {
    const pub = await api.get('/api/public');
    botName = pub.botName;
    publicInfo = { supportUrl: pub.supportUrl || null, inviteUrl: pub.inviteUrl || null, discordLogin: Boolean(pub.discordLogin), needsSetup: Boolean(pub.needsSetup) };
    licenseOn = Boolean(pub.license?.enabled);
    document.title = `Dashboard — ${botName}`;
  } catch { /* on garde le nom par défaut */ }

  try {
    state.me = await api.get('/api/me');
  } catch (err) {
    if (err.status === 401) return showLogin(botName);
    main.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'big' }, icon('alertTriangle', 26)), err.message)));
    return undefined;
  }
  state.schema = await api.get('/api/schema');
  setSchema(state.schema);
  return route();
}());
