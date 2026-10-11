/* Utilitaires d'interface : création de DOM sûre (jamais d'innerHTML), toasts, dialogues, formats. */
import { icon } from './icons.js';

export { icon };

/** h('div', { class: 'x', onclick: fn }, enfant1, [enfant2, …]) → HTMLElement */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    // `type` doit être posé avant `value` (input type=range / color…)
    if (attrs.type !== undefined) el.type = attrs.type;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'type' || v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'for') el.setAttribute('for', v);
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

export const clear = (el) => { el.replaceChildren(); return el; };

/* ------------------------------- Toasts -------------------------------- */
let toastBox;
export function toast(message, kind = 'good', ms = 4200) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const el = h('div', { class: `toast ${kind}` }, message);
  toastBox.append(el);
  setTimeout(() => el.remove(), ms);
}

/* ------------------------------ Dialogues ------------------------------ */
function dialog(build) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay' });
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    const box = build(close);
    overlay.append(box);
    document.body.append(overlay);
    box.querySelector('[data-autofocus]')?.focus();
  });
}

export function confirmDialog({ title, text, confirmLabel = 'Confirmer', danger = false }) {
  return dialog((close) => h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
    h('h3', null, title),
    h('p', null, text),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => close(false) }, 'Annuler'),
      h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, 'data-autofocus': true, onclick: () => close(true) }, confirmLabel),
    ),
  )).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', type = 'text', confirmLabel = 'Valider' }) {
  return dialog((close) => {
    const input = h('input', { class: 'input', type, value, 'data-autofocus': true });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
    return h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
      h('h3', null, title),
      h('label', { class: 'field-label' }, label),
      input,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => close(null) }, 'Annuler'),
        h('button', { class: 'btn btn-primary', onclick: () => close(input.value) }, confirmLabel),
      ),
    );
  });
}

/* ------------------------------- Formats -------------------------------- */
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (ms) => (ms ? dtf.format(new Date(ms)) : '—');
export const fmtNumber = (n) => new Intl.NumberFormat('fr-FR').format(n ?? 0);

export function fmtMinutes(min) {
  if (!min) return '—';
  const d = Math.floor(min / 1440);
  const hh = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} j`, hh && `${hh} h`, m && `${m} min`].filter(Boolean).join(' ');
}

export function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const hh = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} j ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`;
}

export const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Avatar rond d'un utilisateur + nom. */
export function who(user) {
  if (!user) return h('span', { class: 'muted' }, '—');
  return h('div', { class: 'who' }, h('img', { src: user.avatar, alt: '', loading: 'lazy' }), h('span', { title: user.username }, user.name));
}

export function loading(text = 'Chargement…') {
  return h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), text));
}

/** État vide : une icône dans une pastille + un texte. */
export function emptyState(iconName, text) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon(iconName, 26)), h('div', null, text));
}

export function pager({ page, pageSize, total }, onPage) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return h('div', { class: 'pager' },
    h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => onPage(page - 1) }, icon('arrowLeft', 15), 'Précédent'),
    h('span', null, `Page ${page} / ${pages}`),
    h('button', { class: 'btn btn-sm', disabled: page >= pages, onclick: () => onPage(page + 1) }, 'Suivant', icon('arrowRight', 15)),
  );
}

export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const deepClone = (v) => JSON.parse(JSON.stringify(v));
