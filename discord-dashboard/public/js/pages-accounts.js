/**
 * Comptes du dashboard : création et gestion (réservées aux administrateurs) + changement de son propre mot de passe.
 * Seules les personnes qui ont un compte peuvent ouvrir le dashboard.
 */
import { api } from './api.js';
import { state } from './state.js';
import {
  h, toast, confirmDialog, dialog, loading, emptyState, fmtDate, initials, icon,
} from './ui.js';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mot de passe aléatoire lisible (sans 0/O, 1/l/I). */
export function generatePassword(length = 14) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié'); } catch { toast('Copie impossible : sélectionne le texte à la main.', 'warn'); }
}

/** Champ mot de passe avec bouton afficher / masquer. */
function passwordInput({ name, autocomplete, placeholder = '' }) {
  const input = h('input', { class: 'input', type: 'password', name, autocomplete, placeholder, spellcheck: false, autocapitalize: 'off' });
  const eye = h('button', {
    type: 'button', class: 'pw-eye', title: 'Afficher ou masquer', 'aria-label': 'Afficher ou masquer le mot de passe',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 17));
    },
  }, icon('eye', 17));
  return { input, el: h('div', { class: 'pw-wrap' }, input, eye), reveal: () => { input.type = 'text'; eye.replaceChildren(icon('eyeOff', 17)); } };
}

const field = (label, control, help) => h('div', { class: 'field' },
  h('label', { class: 'field-label' }, label), help ? h('p', { class: 'field-help' }, help) : null, control);

/* ------------------------------------------------------------------------ */
/* Mon mot de passe                                                          */
/* ------------------------------------------------------------------------ */
export function changePasswordDialog() {
  return dialog((close) => {
    const cur = passwordInput({ name: 'current', autocomplete: 'current-password' });
    const nxt = passwordInput({ name: 'new', autocomplete: 'new-password', placeholder: '8 caractères minimum' });
    const rep = passwordInput({ name: 'repeat', autocomplete: 'new-password' });
    const err = h('div', { class: 'banner bad', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Changer le mot de passe');
    const form = h('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (nxt.input.value !== rep.input.value) { err.textContent = 'Les deux nouveaux mots de passe ne sont pas identiques.'; err.hidden = false; return; }
      save.disabled = true;
      try {
        await api.post('/api/me/password', { current: cur.input.value, next: nxt.input.value });
        toast('Mot de passe modifié.');
        close(true);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; save.disabled = false; }
    } },
    h('h3', null, 'Changer mon mot de passe'),
    err,
    field('Mot de passe actuel', cur.el),
    field('Nouveau mot de passe', nxt.el),
    field('Répéter le nouveau mot de passe', rep.el),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Annuler'), save));
    setTimeout(() => cur.input.focus(), 0);
    return form;
  });
}

/* ------------------------------------------------------------------------ */
/* Création / modification d'un compte                                       */
/* ------------------------------------------------------------------------ */
function guildChecklist(guilds, selected) {
  const boxes = guilds.map((g) => {
    const cb = h('input', { type: 'checkbox', value: g.id, checked: selected.has(g.id) });
    return { id: g.id, cb, row: h('label', { class: 'check-row' }, cb,
      g.icon ? h('img', { src: g.icon, alt: '' }) : h('span', { class: 'avatar-i' }, initials(g.name)),
      h('span', { class: 'check-name' }, g.name)) };
  });
  // Serveurs déjà attribués mais où le bot n'est plus : on les garde visibles pour pouvoir les retirer.
  const known = new Set(guilds.map((g) => g.id));
  for (const id of selected) {
    if (known.has(id)) continue;
    const cb = h('input', { type: 'checkbox', value: id, checked: true });
    boxes.push({ id, cb, row: h('label', { class: 'check-row' }, cb, h('span', { class: 'avatar-i' }, '?'), h('span', { class: 'check-name muted' }, `Serveur absent (${id})`)) });
  }
  const el = boxes.length
    ? h('div', { class: 'checklist' }, boxes.map((b) => b.row))
    : h('div', { class: 'muted' }, 'Le bot n’est sur aucun serveur pour l’instant.');
  return { el, value: () => boxes.filter((b) => b.cb.checked).map((b) => b.id), setAll: (on) => boxes.forEach((b) => { b.cb.checked = on; }) };
}

function accountDialog({ account, guilds }) {
  const editing = Boolean(account);
  return dialog((close) => {
    const username = h('input', {
      class: 'input', type: 'text', name: 'username', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, maxLength: 32,
      value: account?.username || '', disabled: editing, placeholder: 'ex. marie.dupont',
    });
    const display = h('input', { class: 'input', type: 'text', maxLength: 40, value: account?.displayName || '', placeholder: 'Nom affiché (facultatif)' });
    const role = h('select', { class: 'input' },
      h('option', { value: 'user' }, 'Utilisateur : seulement les serveurs choisis'),
      h('option', { value: 'admin' }, 'Administrateur : tous les serveurs + gestion des comptes'));
    role.value = account?.role || 'user';
    if (account?.self) role.disabled = true;
    const list = guildChecklist(guilds, new Set(account?.guildIds || []));
    const serversField = field('Serveurs accessibles', h('div', null,
      h('div', { class: 'field-row', style: { marginBottom: '8px' } },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => list.setAll(true) }, 'Tout cocher'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => list.setAll(false) }, 'Tout décocher')),
      list.el));
    const syncRole = () => { serversField.hidden = role.value === 'admin'; };
    role.addEventListener('change', syncRole);
    syncRole();

    const pw = passwordInput({ name: 'password', autocomplete: 'new-password', placeholder: editing ? 'Laisser vide pour ne pas changer' : '8 caractères minimum' });
    const gen = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { pw.input.value = generatePassword(); pw.reveal(); } }, icon('refresh', 15), 'Générer');
    const disabled = h('input', { type: 'checkbox', checked: Boolean(account?.disabled), disabled: Boolean(account?.self) });

    const err = h('div', { class: 'banner bad', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, editing ? 'Enregistrer' : 'Créer le compte');
    const form = h('form', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true', onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      save.disabled = true;
      const body = { displayName: display.value, role: role.value, guildIds: list.value() };
      try {
        let saved;
        if (editing) {
          if (pw.input.value) body.password = pw.input.value;
          if (!account.self) body.disabled = disabled.checked;
          saved = (await api.put(`/api/accounts/${account.id}`, body)).account;
          toast('Compte modifié.');
        } else {
          saved = (await api.post('/api/accounts', { ...body, username: username.value.trim(), password: pw.input.value })).account;
        }
        close({ account: saved, password: editing ? null : pw.input.value, passwordChanged: Boolean(body.password) });
      } catch (ex) { err.textContent = ex.message; err.hidden = false; save.disabled = false; }
    } },
    h('h3', null, editing ? `Modifier « ${account.username} »` : 'Créer un compte'),
    err,
    field('Identifiant', username, editing ? 'L’identifiant ne peut pas être changé.' : 'Lettres, chiffres, point, tiret ou underscore. Sert à se connecter.'),
    field('Nom affiché', display),
    field('Mot de passe', h('div', null, pw.el, h('div', { style: { marginTop: '8px' } }, gen)), editing ? 'Remplis ce champ pour réinitialiser le mot de passe : la personne devra se reconnecter.' : 'Tu pourras le copier après la création. Il ne sera plus affichable ensuite.'),
    field('Rôle', role),
    serversField,
    editing && !account.self ? h('label', { class: 'check-row', style: { paddingLeft: '0' } }, disabled, h('span', null, 'Compte désactivé (connexion impossible, sans supprimer le compte)')) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Annuler'), save));
    setTimeout(() => (editing ? display : username).focus(), 0);
    return form;
  });
}

/** Affiche une fois les identifiants du compte créé, avec un bouton pour tout copier. */
function credentialsDialog({ account, password }) {
  const url = `${location.origin}/dashboard`;
  const text = `Dashboard : ${url}\nIdentifiant : ${account.username}\nMot de passe : ${password}`;
  return dialog((close) => h('div', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true' },
    h('h3', null, 'Compte créé'),
    h('p', null, 'Donne ces informations à la personne. Le mot de passe ne sera plus affichable : note-le maintenant (tu pourras toujours en définir un nouveau).'),
    h('div', { class: 'cred' },
      h('div', null, h('span', { class: 'muted' }, 'Adresse'), h('code', { class: 'keybox' }, url)),
      h('div', null, h('span', { class: 'muted' }, 'Identifiant'), h('code', { class: 'keybox' }, account.username)),
      h('div', null, h('span', { class: 'muted' }, 'Mot de passe'), h('code', { class: 'keybox' }, password))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => copyText(text) }, icon('copy', 15), 'Tout copier'),
      h('button', { class: 'btn btn-primary', 'data-autofocus': true, onclick: () => close(true) }, 'Terminé'))));
}

/* ------------------------------------------------------------------------ */
/* Page « Comptes »                                                          */
/* ------------------------------------------------------------------------ */
export async function accountsPage(root) {
  if (!state.me.isOwner) {
    root.replaceChildren(h('div', { class: 'card' }, emptyState('lock', 'Réservé aux administrateurs.')));
    return;
  }
  root.replaceChildren(loading());
  let data = await api.get('/api/accounts');

  const reload = async () => { data = await api.get('/api/accounts'); draw(); };
  const guildName = (id) => data.guilds.find((g) => g.id === id)?.name || 'Serveur absent';

  const serversCell = (a) => {
    if (a.role === 'admin') return h('span', { class: 'pill info' }, 'Tous les serveurs');
    if (!a.guildIds.length) return h('span', { class: 'muted' }, 'Aucun serveur');
    const names = a.guildIds.map(guildName);
    return h('span', { title: names.join(', ') }, names.slice(0, 2).join(', '), names.length > 2 ? ` +${names.length - 2}` : '');
  };

  const create = async () => {
    const r = await accountDialog({ account: null, guilds: data.guilds });
    if (!r) return;
    await reload();
    await credentialsDialog(r);
  };
  const edit = async (a) => {
    const r = await accountDialog({ account: a, guilds: data.guilds });
    if (r) await reload();
  };
  const remove = async (a) => {
    const ok = await confirmDialog({
      title: `Supprimer « ${a.username} » ?`,
      text: 'Cette personne ne pourra plus ouvrir le dashboard. Les réglages des serveurs ne changent pas.',
      confirmLabel: 'Supprimer le compte', danger: true,
    });
    if (!ok) return;
    try { await api.del(`/api/accounts/${a.id}`); toast('Compte supprimé.'); await reload(); } catch (e) { toast(e.message, 'bad'); }
  };

  function draw() {
    const rows = data.rows;
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null, h('h1', null, h('span', { class: 'ico' }, icon('users', 20)), 'Comptes'),
          h('p', null, 'Il faut un compte pour ouvrir le dashboard. Seuls les administrateurs peuvent en créer, et chaque compte n’a accès qu’aux serveurs que tu lui attribues.')),
        h('button', { class: 'btn btn-primary', onclick: () => create().catch((e) => toast(e.message, 'bad')) }, icon('userPlus', 16), 'Créer un compte')),
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['Compte', 'Rôle', 'Serveurs', 'Dernière connexion', 'État', ''].map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((a) => h('tr', null,
            h('td', null, h('div', { class: 'who' }, h('span', { class: 'avatar-i' }, initials(a.displayName || a.username)),
              h('div', { class: 'acc-name' }, h('strong', null, a.displayName || a.username), h('span', { class: 'muted' }, `@${a.username}`)),
              a.self ? h('span', { class: 'pill' }, 'Toi') : null)),
            h('td', null, h('span', { class: `pill ${a.role === 'admin' ? 'warn' : ''}` }, a.role === 'admin' ? 'Administrateur' : 'Utilisateur')),
            h('td', null, serversCell(a)),
            h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, a.lastLogin ? fmtDate(a.lastLogin) : 'Jamais'),
            h('td', null, h('span', { class: `pill ${a.disabled ? 'bad' : 'good'}` }, a.disabled ? 'Désactivé' : 'Actif')),
            h('td', { class: 'ta-r' }, h('div', { class: 'field-row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
              h('button', { class: 'btn btn-sm', onclick: () => edit(a) }, icon('pencil', 14), 'Modifier'),
              a.self ? null : h('button', { class: 'btn btn-sm btn-danger', title: 'Supprimer', 'aria-label': `Supprimer ${a.username}`, onclick: () => remove(a) }, icon('trash', 14)))))))))
        : h('div', { class: 'card' }, emptyState('users', 'Aucun compte pour l’instant.')),
    );
  }
  draw();
}
