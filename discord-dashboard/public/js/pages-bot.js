/**
 * Pages « bot » du dashboard : profil du bot sur le serveur, webhooks et messages enregistrés,
 * créateur de serveur (modèles + IA) et historique des modifications.
 */
import { api } from './api.js';
import { state, makeCtx } from './state.js';
import { renderFields, defaultValue } from './form.js';
import {
  h, toast, confirmDialog, loading, emptyState, pager, fmtDate, who, deepClone, icon,
} from './ui.js';

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;
const isAdmin = () => Boolean(state.overview?.isAdmin);
const guildName = () => state.me.guilds.find((g) => g.id === state.guildId)?.name || 'ce serveur';

const head = (iconName, title, desc) => h('div', { class: 'page-head' },
  h('div', null, h('h1', null, h('span', { class: 'ico' }, icon(iconName, 20)), title), h('p', null, desc)));

const adminBanner = () => (isAdmin() ? null
  : h('div', { class: 'banner warn' }, 'Certaines actions de cette page sont réservées aux administrateurs du serveur : elles sont désactivées pour toi.'));

const errBanner = (message, retry) => h('div', { class: 'banner bad' }, h('div', null, message, retry ? [' ', h('button', { class: 'btn btn-sm', onclick: retry }, 'Réessayer')] : null));

/** Lance une action asynchrone en désactivant le bouton et en affichant l'erreur éventuelle. */
const busy = (fn) => async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message, 'bad', 7000); } finally { btn.disabled = false; }
};

function selectEl(options, value, { placeholder, label } = {}) {
  const sel = h('select', { class: 'input', 'aria-label': label });
  if (placeholder !== undefined) sel.append(h('option', { value: '' }, placeholder));
  for (const o of options) sel.append(h('option', { value: o.value }, o.label));
  sel.value = value || '';
  return sel;
}

const textChannels = () => state.meta.channels.filter((c) => c.kind === 'text').map((c) => ({ value: c.id, label: `# ${c.name}` }));

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  reader.readAsDataURL(file);
});

/* ======================================================================== */
/* Profil du bot                                                             */
/* ======================================================================== */
const MAX_IMAGE = 4 * 1024 * 1024;

export async function profilePage(root) {
  root.replaceChildren(head('idCard', 'Profil du bot', `Pseudo, avatar, bannière et bio du bot — uniquement sur ${guildName()}. Les autres serveurs ne changent pas.`), loading());
  let data;
  try {
    data = await api.get(gurl('/bot-profile'));
  } catch (err) {
    root.replaceChildren(head('idCard', 'Profil du bot', 'Personnalise le bot sur ce serveur.'), errBanner(err.message, () => profilePage(root)));
    return;
  }

  // undefined = inchangé, null = retirer, chaîne = nouvelle image (data-URI)
  const change = { nickname: undefined, bio: undefined, avatar: undefined, banner: undefined };
  const botName = state.meta.bot.name;

  const nick = h('input', { class: 'input', type: 'text', maxLength: 32, value: data.nickname, placeholder: data.globalName, 'aria-label': 'Pseudo sur ce serveur' });
  const bio = h('textarea', { class: 'input', rows: 3, maxLength: 190, value: data.bio, placeholder: 'Quelques mots sur le bot…', 'aria-label': 'Bio' });
  const bioCount = h('span', { class: 'muted' });

  const pvBanner = h('div', { class: 'profile-banner' });
  const pvAvatar = h('div', { class: 'profile-avatar' });
  const pvNick = h('div', { class: 'nick' });
  const pvBio = h('div', { class: 'bio' });
  const preview = () => {
    const av = change.avatar === undefined ? (data.avatar || data.defaultAvatar) : change.avatar || data.defaultAvatar;
    const bn = change.banner === undefined ? data.banner : change.banner;
    pvAvatar.style.backgroundImage = av ? `url("${av}")` : '';
    pvBanner.style.backgroundImage = bn ? `url("${bn}")` : '';
    pvNick.textContent = nick.value.trim() || data.globalName || botName;
    pvBio.textContent = bio.value.trim();
    pvBio.hidden = !bio.value.trim();
    bioCount.textContent = `${bio.value.length}/190`;
  };
  nick.addEventListener('input', preview);
  bio.addEventListener('input', preview);

  function picker(label, key, current, wide) {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', 'aria-label': label });
    const thumb = h('div', { class: `thumb${wide ? ' wide' : ''}` });
    const info = h('div', { class: 'info' });
    const removeBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Retirer');
    const refresh = () => {
      const v = change[key] === undefined ? current : change[key];
      thumb.style.backgroundImage = v ? `url("${v}")` : '';
      const pending = change[key] !== undefined;
      info.replaceChildren(h('strong', null, label),
        pending ? (change[key] === null ? 'Sera retiré à l’enregistrement.' : 'Nouvelle image prête à être enregistrée.') : (current ? 'Image propre à ce serveur.' : 'Aucune image propre à ce serveur : celle du bot est utilisée.'));
      removeBtn.hidden = change[key] === undefined && !current;
      removeBtn.textContent = change[key] === undefined ? 'Retirer' : change[key] === null ? 'Annuler le retrait' : 'Annuler';
      preview();
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast('Format non pris en charge (PNG, JPEG, GIF ou WebP).', 'warn'); return; }
      if (file.size > MAX_IMAGE) { toast('Image trop lourde : 4 Mo maximum.', 'warn'); return; }
      try { change[key] = await readFile(file); refresh(); } catch (err) { toast(err.message, 'bad'); }
    });
    removeBtn.addEventListener('click', () => { change[key] = change[key] === undefined ? null : undefined; refresh(); });
    refresh();
    return h('div', { class: 'field' }, h('div', { class: 'drop' }, thumb, info,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => input.click() }, 'Choisir…'), removeBtn, input));
  }

  const save = h('button', { class: 'btn btn-primary' }, 'Enregistrer sur ce serveur');
  save.addEventListener('click', busy(async () => {
    const body = {};
    if (nick.value.trim() !== data.nickname) body.nickname = nick.value.trim();
    if (bio.value.trim() !== data.bio) body.bio = bio.value.trim();
    if (change.avatar !== undefined) body.avatar = change.avatar;
    if (change.banner !== undefined) body.banner = change.banner;
    if (!Object.keys(body).length) { toast('Rien n’a changé.', 'warn'); return; }
    await api.put(gurl('/bot-profile'), body);
    toast('Profil du bot mis à jour');
    if (body.nickname !== undefined) state.meta.bot.name = body.nickname || data.globalName;
    await profilePage(root);
  }));

  root.replaceChildren(
    head('idCard', 'Profil du bot', `Pseudo, avatar, bannière et bio du bot — uniquement sur ${guildName()}. Les autres serveurs ne changent pas.`),
    h('div', { class: 'split' },
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Pseudo sur ce serveur'), h('p', { class: 'field-help' }, 'Laisse vide pour retrouver le nom habituel du bot.'), nick),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Bio'), bio, h('div', { class: 'hint' }, bioCount)),
        picker('Avatar', 'avatar', data.avatar, false),
        picker('Bannière', 'banner', data.banner, true),
        h('div', { class: 'field-row' }, save),
        h('p', { class: 'hint' }, 'Images : PNG, JPEG, GIF ou WebP, 4 Mo maximum. Discord limite la fréquence des changements d’avatar : si une modification est refusée, le message d’erreur s’affiche ici.')),
      h('div', null, h('div', { class: 'msg-preview-label' }, 'Aperçu'),
        h('div', { class: 'profile-card' }, h('div', { style: { position: 'relative' } }, pvBanner, pvAvatar),
          h('div', { class: 'profile-body' }, pvNick, h('div', { class: 'sub' }, `${data.globalName} · APP`), pvBio)))));
  preview();
}

/* ======================================================================== */
/* Webhooks et messages enregistrés                                          */
/* ======================================================================== */
const SAVED_FIELD = { type: 'message', key: 'message', label: 'Message', variables: ['server', 'server.icon', 'memberCount'] };

export async function webhooksPage(root, tab = 'saved') {
  const view = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const show = (name) => {
    tabs.replaceChildren(
      h('button', { class: `tab${name === 'saved' ? ' active' : ''}`, role: 'tab', onclick: () => show('saved') }, icon('save', 16), 'Messages enregistrés'),
      h('button', { class: `tab${name === 'hooks' ? ' active' : ''}`, role: 'tab', onclick: () => show('hooks') }, icon('link', 16), 'Webhooks'));
    view.replaceChildren(loading());
    (name === 'saved' ? savedTab(view) : hooksTab(view)).catch((err) => view.replaceChildren(errBanner(err.message, () => show(name))));
  };
  root.replaceChildren(head('link', 'Webhooks et messages', 'Garde autant de messages que tu veux, puis envoie-les avec le bot ou par webhook (nom et avatar personnalisables).'), tabs, view);
  show(tab);
}

async function savedTab(view) {
  let page = 1;
  let search = '';
  const grid = h('div', { class: 'saved-grid' });
  const pg = h('div');
  const count = h('span', { class: 'muted' });

  async function load() {
    const r = await api.get(gurl(`/saved?page=${page}&search=${encodeURIComponent(search)}`));
    count.textContent = `${r.total} message${r.total > 1 ? 's' : ''}`;
    grid.replaceChildren(...r.rows.map((m) => h('button', { class: 'saved-card spot', onclick: () => editor(m.id) },
      h('strong', null, m.name),
      h('div', { class: 'snippet' }, m.preview || (m.hasEmbed ? '(embed sans titre)' : '(vide)')),
      h('div', { class: 'meta' }, h('span', null, fmtDate(m.updatedAt)), m.hasEmbed ? h('span', { class: 'pill info' }, 'embed') : null))));
    if (!r.rows.length) grid.replaceChildren(h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, emptyState('save', search ? 'Aucun message ne correspond à ta recherche.' : 'Aucun message enregistré. Crée le premier : il n’y a aucune limite.')));
    pg.replaceChildren(pager(r, (p) => { page = p; load().catch((e) => toast(e.message, 'bad')); }) || '');
  }

  let timer;
  const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher un message…', 'aria-label': 'Rechercher', oninput: (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { search = e.target.value.trim(); page = 1; load().catch((err) => toast(err.message, 'bad')); }, 250);
  } });

  function list() {
    view.replaceChildren(
      h('div', { class: 'toolbar' }, searchInput, h('button', { class: 'btn btn-primary', onclick: () => editor(null) }, '＋ Nouveau message'), h('span', { class: 'spacer' }), count),
      grid, pg);
    return load();
  }

  async function editor(id) {
    view.replaceChildren(loading());
    let hooks = [];
    try { hooks = (await api.get(gurl('/webhooks'))).rows; } catch { /* pas bloquant */ }
    let current = id;
    const draft = id ? await api.get(gurl(`/saved/${id}`)) : { name: 'Nouveau message', username: '', avatarUrl: '', message: defaultValue(SAVED_FIELD) };
    delete draft.id;
    let dirty = false;
    const mark = () => { dirty = true; };

    const ctx = makeCtx();
    const form = renderFields([SAVED_FIELD], draft, ctx, mark);
    const name = h('input', { class: 'input', type: 'text', maxLength: 80, value: draft.name, 'aria-label': 'Nom du message', oninput: (e) => { draft.name = e.target.value; mark(); } });
    const username = h('input', { class: 'input', type: 'text', maxLength: 80, value: draft.username, placeholder: 'Nom du webhook par défaut', 'aria-label': 'Nom affiché', oninput: (e) => { draft.username = e.target.value; mark(); } });
    const avatar = h('input', { class: 'input', type: 'url', maxLength: 500, value: draft.avatarUrl, placeholder: 'https://…/image.png', 'aria-label': 'Avatar affiché', oninput: (e) => { draft.avatarUrl = e.target.value; mark(); } });
    const chan = selectEl(textChannels(), '', { placeholder: '— Choisir un salon —', label: 'Salon' });
    const hook = selectEl(hooks.map((w) => ({ value: w.id, label: `${w.name}${w.channelName ? ` (# ${w.channelName})` : ''}` })), '', { placeholder: hooks.length ? '— Choisir un webhook —' : '— Aucun webhook —', label: 'Webhook' });

    const body = () => ({ name: draft.name, message: draft.message, username: draft.username, avatarUrl: draft.avatarUrl });

    async function persist() {
      if (!draft.name.trim()) { toast('Donne un nom à ce message.', 'warn'); return false; }
      const r = current ? await api.put(gurl(`/saved/${current}`), body()) : await api.post(gurl('/saved'), body());
      current = r.id;
      dirty = false;
      return true;
    }

    view.replaceChildren(
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn btn-ghost', onclick: async () => {
          if (dirty && !(await confirmDialog({ title: 'Quitter sans enregistrer ?', text: 'Les modifications de ce message seront perdues.', confirmLabel: 'Quitter', danger: true }))) return;
          view.replaceChildren(loading());
          list().catch((e) => view.replaceChildren(errBanner(e.message)));
        } }, icon('arrowLeft', 15), 'Tous les messages'),
        h('span', { class: 'spacer' }),
        current ? h('button', { class: 'btn', onclick: busy(async () => {
          if (dirty && !(await persist())) return;
          const copy = await api.post(gurl(`/saved/${current}/duplicate`));
          toast(`Dupliqué : « ${copy.name} »`);
          await editor(copy.id);
        }) }, 'Dupliquer') : null,
        current ? h('button', { class: 'btn btn-danger', onclick: busy(async () => {
          if (!(await confirmDialog({ title: 'Supprimer ce message ?', text: `« ${draft.name} » sera supprimé définitivement.`, confirmLabel: 'Supprimer', danger: true }))) return;
          await api.del(gurl(`/saved/${current}`));
          toast('Message supprimé');
          dirty = false;
          view.replaceChildren(loading());
          await list();
        }) }, 'Supprimer') : null,
        h('button', { class: 'btn btn-primary', onclick: busy(async () => {
          const wasNew = !current;
          if (await persist()) { toast('Message enregistré'); if (wasNew) await editor(current); }
        }) }, 'Enregistrer')),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Nom (visible seulement ici)'), name),
        h('div', { class: 'section-title' }, 'Apparence en webhook (facultatif)'),
        h('div', { class: 'split' },
          h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Nom affiché'), username),
          h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Avatar affiché (lien https)'), avatar)),
        h('div', { class: 'section-title' }, 'Contenu'),
        form),
      h('div', { class: 'card' }, h('h3', null, 'Envoyer'),
        h('div', { class: 'split' },
          h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Avec le bot'),
            h('div', { class: 'field-row' }, chan, h('button', { class: 'btn btn-primary', onclick: busy(async () => {
              if (!chan.value) { toast('Choisis un salon.', 'warn'); return; }
              if (!(await persist())) return;
              const r = await api.post(gurl(`/saved/${current}/send`), { channelId: chan.value });
              toast(h('span', null, 'Message envoyé. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir')));
            }) }, 'Envoyer'))),
          h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Par webhook'),
            h('div', { class: 'field-row' }, hook, h('button', { class: 'btn btn-primary', disabled: !hooks.length, onclick: busy(async () => {
              if (!hook.value) { toast('Choisis un webhook.', 'warn'); return; }
              const r = await api.post(gurl(`/webhooks/${hook.value}/send`), { message: draft.message, username: draft.username, avatarUrl: draft.avatarUrl });
              toast(r.url ? h('span', null, 'Message envoyé. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir')) : 'Message envoyé');
            }) }, 'Envoyer')))),
        h('p', { class: 'hint' }, 'Les mentions ne notifient personne dans les messages envoyés d’ici. Variables disponibles : {server}, {server.icon} et {memberCount}.')));
  }

  await list();
}

async function hooksTab(view) {
  const listBox = h('div');
  async function load() {
    const { rows } = await api.get(gurl('/webhooks'));
    listBox.replaceChildren(...(rows.length ? rows.map((w) => h('div', { class: 'wh-row' },
      icon('link', 20),
      h('div', { class: 'grow' }, h('strong', null, w.name), h('span', { class: 'muted' }, `${w.channelName ? `# ${w.channelName}` : 'salon supprimé'} · ajouté le ${fmtDate(w.createdAt)}`)),
      h('button', { class: 'btn btn-sm btn-danger', onclick: busy(async () => {
        if (!(await confirmDialog({ title: 'Supprimer ce webhook ?', text: `« ${w.name} » sera supprimé sur Discord.`, confirmLabel: 'Supprimer', danger: true }))) return;
        await api.del(gurl(`/webhooks/${w.id}`));
        toast('Webhook supprimé');
        await load();
      }) }, 'Supprimer'))) : [h('div', { class: 'list-empty' }, 'Aucun webhook. Crée-en un ci-dessous ou importe celui d’un salon.')]));
  }

  const chan = selectEl(textChannels(), '', { placeholder: '— Salon —', label: 'Salon du webhook' });
  const name = h('input', { class: 'input', type: 'text', maxLength: 80, placeholder: 'Nom du webhook', 'aria-label': 'Nom du webhook', style: { maxWidth: '260px' } });
  const url = h('input', { class: 'input', type: 'url', placeholder: 'https://discord.com/api/webhooks/…', 'aria-label': 'URL du webhook' });

  view.replaceChildren(
    h('div', { class: 'card' }, h('h3', null, 'Webhooks de ce serveur'), listBox),
    h('div', { class: 'split', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h3', null, 'Créer un webhook'),
        h('p', { class: 'hint' }, 'Le bot crée le webhook dans le salon choisi (il lui faut la permission « Gérer les webhooks »).'),
        h('div', { class: 'field-row', style: { marginTop: '12px' } }, chan, name,
          h('button', { class: 'btn btn-primary', onclick: busy(async () => {
            if (!chan.value) { toast('Choisis un salon.', 'warn'); return; }
            await api.post(gurl('/webhooks'), { channelId: chan.value, name: name.value.trim() || undefined });
            name.value = '';
            toast('Webhook créé');
            await load();
          }) }, 'Créer'))),
      h('div', { class: 'card' }, h('h3', null, 'Importer un webhook existant'),
        h('p', { class: 'hint' }, 'Colle l’URL d’un webhook de CE serveur. Elle est chiffrée avant d’être stockée et ne s’affiche plus ensuite.'),
        h('div', { class: 'field-row', style: { marginTop: '12px' } }, h('div', { style: { flex: 1, minWidth: '200px' } }, url),
          h('button', { class: 'btn', onclick: busy(async () => {
            if (!url.value.trim()) { toast('Colle une URL de webhook.', 'warn'); return; }
            await api.post(gurl('/webhooks/import'), { url: url.value.trim() });
            url.value = '';
            toast('Webhook importé');
            await load();
          }) }, 'Importer')))));
  await load();
}

/* ======================================================================== */
/* Créateur de serveur                                                       */
/* ======================================================================== */
const CH_ICON = { text: 'hash', voice: 'volume', announcement: 'megaphone', forum: 'message', stage: 'mic' };
const TPL_ICONS = { communaute: 'users', gaming: 'gamepad', etude: 'book', creatif: 'sparkles', boutique: 'coins', minimal: 'layout' };
const ACCESS_LABEL = { public: 'public', readonly: 'lecture seule', members: 'membres', staff: 'staff' };
const PRESET_LABEL = { none: '', helper: 'helper', moderator: 'modérateur', manager: 'gestionnaire' };
const PURPOSE_LABEL = { welcome: 'accueil', rules: 'règlement', logs: 'journaux', tickets: 'tickets', suggestions: 'suggestions', verification: 'vérification', announcements: 'annonces', general: 'général' };

export async function builderPage(root) {
  const header = head('package', 'Créateur de serveur', 'Crée rôles, catégories et salons d’un coup — depuis un modèle ou une description. Rien n’est supprimé ni modifié : seul ce qui manque est ajouté.');
  const stage = h('div', { class: 'stack' });
  root.replaceChildren(...[header, adminBanner(), stage].filter(Boolean));

  let plan = null;
  let warnings = [];
  let wire = true;
  const planBox = h('div');
  const jobBox = h('div');
  let polling = false;

  /* ---- Choix de la source ---- */
  const templatesBox = h('div', { class: 'tpl-grid' });
  const aiBox = h('div');
  const sourceBody = h('div');
  const sourceTabs = h('div', { class: 'tabs', role: 'tablist' });
  const showSource = (name) => {
    sourceTabs.replaceChildren(
      h('button', { class: `tab${name === 'tpl' ? ' active' : ''}`, onclick: () => showSource('tpl') }, icon('package', 16), 'Modèles prêts à l’emploi'),
      h('button', { class: `tab${name === 'ai' ? ' active' : ''}`, onclick: () => showSource('ai') }, icon('sparkles', 16), 'Décrire avec l’IA'));
    sourceBody.replaceChildren(name === 'tpl' ? templatesBox : aiBox);
  };

  let activeTpl = null;
  async function pickTemplate(id) {
    try {
      const r = await api.get(gurl(`/builder/templates/${id}`));
      activeTpl = id;
      setPlan(r.plan, r.warnings);
      renderTemplates();
    } catch (err) { toast(err.message, 'bad'); }
  }
  let tplList = [];
  function renderTemplates() {
    templatesBox.replaceChildren(...tplList.map((t) => h('button', { class: `tpl${activeTpl === t.id ? ' active' : ''}`, onclick: () => pickTemplate(t.id) },
      h('span', { class: 'ico' }, icon(TPL_ICONS[t.id] || 'package', 24)), h('strong', null, t.name), h('p', null, t.description),
      h('div', { class: 'counts' }, h('span', { class: 'pill' }, `${t.summary.roles} rôles`), h('span', { class: 'pill' }, `${t.summary.categories} catégories`), h('span', { class: 'pill' }, `${t.summary.channels} salons`)))));
  }

  function buildAiBox(st) {
    const desc = h('textarea', { class: 'input', rows: 5, maxLength: 1500, placeholder: 'Ex : un serveur pour une communauté de photographes amateurs, avec un coin critique de photos, des défis hebdomadaires et un espace pour le matériel…', 'aria-label': 'Description du serveur' });
    const notes = h('input', { class: 'input', type: 'text', maxLength: 300, placeholder: 'Contraintes (facultatif) : pas de salons vocaux, ton décontracté…', 'aria-label': 'Contraintes' });
    aiBox.replaceChildren(...[
      st.ready ? null : h('div', { class: 'banner warn' }, h('div', null, 'L’IA n’est pas configurée. ', h('a', { href: `#/g/${state.guildId}/ai` }, 'Ajoute une clé d’API dans le module « IA »'), ' pour utiliser cette option. Les modèles fonctionnent sans IA.')),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Décris le serveur que tu veux'), desc),
        h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Contraintes'), notes),
        h('div', { class: 'field-row' },
          h('button', { class: 'btn btn-primary', disabled: !st.ready || !isAdmin(), onclick: busy(async () => {
            if (desc.value.trim().length < 15) { toast('Décris ton serveur en une phrase au moins.', 'warn'); return; }
            planBox.replaceChildren(loading('L’IA prépare ton plan…'));
            try {
              const r = await api.post(gurl('/builder/generate'), { description: desc.value.trim(), notes: notes.value.trim() });
              activeTpl = null;
              renderTemplates();
              setPlan(r.plan, r.warnings);
            } catch (err) { planBox.replaceChildren(); throw err; }
          }) }, icon('sparkles', 16), 'Générer le plan'),
          h('span', { class: 'muted' }, 'Tu pourras tout relire et retirer ce que tu ne veux pas avant la création.'))),
    ].filter(Boolean));
  }

  /* ---- Aperçu du plan ---- */
  function setPlan(p, w = []) {
    plan = deepClone(p);
    warnings = w;
    renderPlan();
    planBox.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function renderPlan() {
    if (!plan) { planBox.replaceChildren(); return; }
    const channels = plan.categories.reduce((n, c) => n + c.channels.length, 0);
    const json = h('textarea', { class: 'input', rows: 14, spellcheck: false, style: { fontFamily: 'var(--mono)', fontSize: '12.5px' }, 'aria-label': 'Plan au format JSON' });
    json.value = JSON.stringify(plan, null, 2);

    const tree = h('div', { class: 'plan' },
      plan.roles.length ? h('div', { class: 'plan-cat' }, h('div', { class: 'plan-cat-name' }, 'Rôles'),
        h('div', { style: { marginTop: '6px' } }, plan.roles.map((r, i) => h('span', { class: 'role-chip' },
          h('span', { class: 'dot', style: { background: r.color || '#99aab5' } }), r.name,
          r.preset !== 'none' ? h('span', { class: 'pill info' }, PRESET_LABEL[r.preset] || r.preset) : null,
          h('button', { class: 'icon-btn danger', style: { width: '20px', height: '20px' }, title: 'Retirer ce rôle', 'aria-label': `Retirer ${r.name}`, onclick: () => { plan.roles.splice(i, 1); renderPlan(); } }, icon('x', 13)))))) : null,
      ...plan.categories.map((c, ci) => h('div', { class: 'plan-cat' },
        h('div', { class: 'plan-cat-name' }, icon('folder', 15), c.name, h('span', { class: 'pill' }, ACCESS_LABEL[c.access] || c.access),
          h('button', { class: 'icon-btn danger', style: { width: '20px', height: '20px' }, title: 'Retirer la catégorie', 'aria-label': `Retirer ${c.name}`, onclick: () => { plan.categories.splice(ci, 1); renderPlan(); } }, icon('x', 13))),
        ...c.channels.map((ch, chi) => h('div', { class: 'plan-ch' },
          h('span', { class: 'kind' }, icon(CH_ICON[ch.type] || 'hash', 15)), h('span', null, ch.name),
          ch.access !== c.access ? h('span', { class: 'pill' }, ACCESS_LABEL[ch.access] || ch.access) : null,
          ch.purpose ? h('span', { class: 'pill info', title: 'Sera relié au module correspondant si tu coches l’option ci-dessous' }, PURPOSE_LABEL[ch.purpose] || ch.purpose) : null,
          ch.topic ? h('span', { class: 'topic' }, ch.topic) : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'icon-btn danger', style: { width: '22px', height: '22px' }, title: 'Retirer le salon', 'aria-label': `Retirer ${ch.name}`, onclick: () => { c.channels.splice(chi, 1); renderPlan(); } }, icon('x', 13)))))));

    const wireBox = h('input', { type: 'checkbox', checked: wire, 'aria-label': 'Relier les salons au bot', onchange: (e) => { wire = e.target.checked; } });
    planBox.replaceChildren(h('div', { class: 'card' },
      h('h3', null, plan.name ? `Plan : ${plan.name}` : 'Plan du serveur'),
      h('p', { class: 'muted' }, `${plan.roles.length} rôle${plan.roles.length > 1 ? 's' : ''}, ${plan.categories.length} catégorie${plan.categories.length > 1 ? 's' : ''}, ${channels} salon${channels > 1 ? 's' : ''}. Retire ce que tu ne veux pas avec la croix.`),
      warnings.length ? h('div', { class: 'banner info' }, h('div', null, h('strong', null, 'Ajustements automatiques :'), h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, warnings.slice(0, 12).map((w) => h('li', null, w))))) : null,
      tree,
      h('details', { style: { marginTop: '14px' } }, h('summary', { class: 'muted', style: { cursor: 'pointer' } }, 'Avancé : modifier le plan en JSON'),
        h('div', { style: { marginTop: '10px' } }, json,
          h('div', { class: 'field-row', style: { marginTop: '8px' } }, h('button', { class: 'btn btn-sm', onclick: busy(async () => {
            let parsed;
            try { parsed = JSON.parse(json.value); } catch { toast('JSON invalide.', 'warn'); return; }
            const r = await api.post(gurl('/builder/validate'), { plan: parsed });
            setPlan(r.plan, r.warnings);
          }) }, 'Valider ce JSON'), h('span', { class: 'hint' }, 'Le serveur nettoie et borne le plan avant toute création.')))),
      h('div', { class: 'section-title' }, 'Création'),
      h('label', { class: 'field-row', style: { cursor: 'pointer', marginBottom: '14px' } }, wireBox,
        h('span', null, 'Relier les salons au bot (accueil, journaux, suggestions, tickets, vérification)')),
      h('div', { class: 'field-row' },
        h('button', { class: 'btn btn-primary btn-lg', disabled: !isAdmin() || (!plan.roles.length && !channels), onclick: busy(async () => {
          if (!(await confirmDialog({
            title: 'Créer ces éléments sur le serveur ?',
            text: `${plan.roles.length} rôle(s), ${plan.categories.length} catégorie(s) et ${channels} salon(s) seront créés dans ${guildName()}. Ce qui existe déjà (même nom) est conservé, rien n’est supprimé.`,
            confirmLabel: 'Lancer la création',
          }))) return;
          const r = await api.post(gurl('/builder/apply'), { plan, wire });
          toast('Création lancée');
          showJob(r.job);
          poll();
        }) }, icon('rocket', 17), 'Créer sur le serveur'),
        isAdmin() ? null : h('span', { class: 'muted' }, 'Réservé aux administrateurs.'))));
  }

  /* ---- Suivi de la création ---- */
  function showJob(job) {
    if (!job) { jobBox.replaceChildren(); return; }
    const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
    const done = job.status !== 'running';
    const bar = h('div', { class: `progress${done ? ' done' : ''}` }, h('i', { style: { width: `${job.status === 'done' ? 100 : pct}%` } }));
    const log = h('div', { class: 'joblog' }, job.log.map((l) => h('div', { class: l.startsWith('❌') ? 'err' : l.startsWith('✅') ? 'ok' : '' }, l.replace(/^(❌|✅)\s*/u, ''))));
    jobBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'field-row', style: { justifyContent: 'space-between', marginBottom: '10px' } },
        h('h3', { style: { margin: 0 } }, { running: 'Création en cours', done: 'Création terminée', failed: 'Création interrompue' }[job.status] || 'Création'),
        h('span', { class: `pill ${job.status === 'done' ? 'good' : job.status === 'failed' ? 'bad' : 'info'}` }, { running: 'en cours', done: 'terminée', failed: 'échec' }[job.status] || job.status)),
      bar, h('p', { class: 'hint' }, `${job.done}/${job.total} étapes`), log));
    log.scrollTop = log.scrollHeight;
  }

  async function refreshAfterJob() {
    try {
      const [meta, settings] = await Promise.all([api.get(gurl('/meta')), api.get(gurl('/settings'))]);
      state.meta = meta;
      state.settings = settings;
    } catch { /* la page se rechargera au prochain affichage */ }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      for (;;) {
        const { job } = await api.get(gurl('/builder/status'));
        if (!root.isConnected) return;
        showJob(job);
        if (!job || job.status !== 'running') {
          if (job?.status === 'done') { toast('Serveur créé'); await refreshAfterJob(); }
          if (job?.status === 'failed') toast(job.error || 'La création a échoué.', 'bad', 9000);
          return;
        }
        await new Promise((r) => { setTimeout(r, 1500); });
      }
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      polling = false;
    }
  }

  stage.append(sourceTabs, sourceBody, planBox, jobBox);
  showSource('tpl');
  try {
    const [tpls, st, cur] = await Promise.all([
      api.get(gurl('/builder/templates')), api.get(gurl('/ai/status')), api.get(gurl('/builder/status')),
    ]);
    tplList = tpls.templates;
    renderTemplates();
    buildAiBox(st);
    if (cur.job) { showJob(cur.job); if (cur.job.status === 'running') poll(); }
  } catch (err) {
    stage.replaceChildren(errBanner(err.message, () => builderPage(root)));
  }
}

/* ======================================================================== */
/* Historique des modifications                                              */
/* ======================================================================== */
const ACTION_LABEL = {
  settings: ['Réglages', 'info'], import: ['Import', 'info'], tickets: ['Tickets', 'info'], 'bot-profile': ['Profil du bot', 'info'],
  'ai-key': ['Clé IA', 'warn'], webhook: ['Webhook', 'info'], 'webhook-send': ['Envoi webhook', 'info'], 'saved-message': ['Message', 'info'],
  builder: ['Créateur', 'warn'], lockdown: ['Verrouillage', 'bad'], raidmode: ['Mode raid', 'bad'], honeypot: ['Honeypot', 'info'], verification: ['Vérification', 'info'],
};

export async function auditPage(root) {
  let page = 1;
  const box = h('div');
  root.replaceChildren(head('history', 'Historique', 'Qui a modifié quoi depuis le dashboard (les 2000 dernières actions sont conservées).'), box);
  async function load() {
    box.replaceChildren(loading());
    const r = await api.get(gurl(`/audit?page=${page}`));
    if (!r.rows.length) { box.replaceChildren(h('div', { class: 'card' }, emptyState('history', 'Aucune modification enregistrée pour l’instant.'))); return; }
    box.replaceChildren(
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Date', 'Qui', 'Type', 'Détail'].map((t) => h('th', null, t)))),
        h('tbody', null, r.rows.map((row) => {
          const [label, kind] = ACTION_LABEL[row.action] || [row.action, ''];
          return h('tr', null, h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, fmtDate(row.createdAt)), h('td', null, who(row.user)),
            h('td', null, h('span', { class: `pill ${kind}` }, label)), h('td', null, row.detail));
        })))),
      pager(r, (p) => { page = p; load().catch((e) => box.replaceChildren(errBanner(e.message))); }));
  }
  try { await load(); } catch (err) { box.replaceChildren(errBanner(err.message, () => load())); }
}
