/** Messagerie privée : conversations avec les membres, comme sur Discord, depuis le dashboard. */
import { api } from './api.js';
import { state } from './state.js';
import { h, toast, confirmDialog, loading, emptyState, icon } from './ui.js';

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const hhmm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => {
  const now = Date.now();
  if (sameDay(ts, now)) return 'Aujourd’hui';
  if (sameDay(ts, now - 86400000)) return 'Hier';
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};
const short = (ts) => (sameDay(ts, Date.now()) ? hhmm(ts) : new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
const safeUrl = (u) => (/^https:\/\//.test(String(u)) ? u : null);

/* ----------------------- Pastille « non lus » du menu ----------------------- */
export async function refreshUnread() {
  if (!state.guildId || !state.overview?.isAdmin || !state.settings?.dms?.enabled) { state.unread = 0; paintBadge(); return; }
  try { state.unread = (await api.get(gurl('/dms/unread'))).unread; } catch { /* hors ligne : on garde l'ancienne valeur */ }
  paintBadge();
}
export function paintBadge() {
  const el = document.getElementById('inbox-badge');
  if (!el) return;
  el.textContent = state.unread > 99 ? '99+' : String(state.unread || '');
  el.hidden = !state.unread;
}

/* --------------------------------- Page --------------------------------- */
export async function inboxPage(root) {
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, h('span', { class: 'ico' }, icon('mail', 20)), 'Messages privés'),
      h('p', null, 'Les messages que les membres envoient au bot arrivent ici. Tes réponses partent en message privé depuis le bot.')),
    h('a', { class: 'btn btn-sm', href: `#/g/${state.guildId}/dms` }, icon('sliders', 15), 'Configurer'));

  if (!state.overview?.isAdmin) {
    root.replaceChildren(head, h('div', { class: 'card' }, emptyState('lock', 'La messagerie est réservée aux administrateurs du serveur.')));
    return;
  }
  root.replaceChildren(head, loading());

  let threads = [];
  let enabled = true;
  let selected = null;       // identifiant du membre ouvert
  let selectedUser = null;
  let messages = [];
  let authors = {};
  let lastId = 0;
  let sending = false;
  let search = '';
  const timers = [];

  const banner = h('div');
  const listItems = h('div', { class: 'dm-items' });
  const chat = h('section', { class: 'dm-chat' });
  const searchIn = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher une conversation', oninput: (e) => { search = e.target.value.toLowerCase(); renderList(); } });
  const newPanel = h('div', { class: 'dm-new', hidden: true });
  const wrap = h('div', { class: 'dm' },
    h('aside', { class: 'dm-list' },
      h('div', { class: 'dm-list-head' }, searchIn,
        h('button', { class: 'btn btn-primary btn-sm', title: 'Écrire à un membre', onclick: () => toggleNew() }, icon('plus', 15), 'Nouveau')),
      newPanel, listItems),
    chat);

  root.replaceChildren(head, banner, wrap);

  const cleanup = () => timers.forEach((t) => clearInterval(t));
  state.cleanup = cleanup;
  const alive = () => { if (!wrap.isConnected) { cleanup(); return false; } return true; };

  /* ------------------------------ Liste ------------------------------ */
  function renderBanner() {
    banner.replaceChildren(enabled ? '' : h('div', { class: 'banner info' }, icon('info', 18),
      h('div', null, 'La messagerie est désactivée : le bot ne garde plus les nouveaux messages. ', h('a', { href: `#/g/${state.guildId}/dms` }, 'L’activer'))));
  }

  function renderList() {
    const rows = threads.filter((t) => !search || `${t.user?.name} ${t.user?.username}`.toLowerCase().includes(search));
    listItems.replaceChildren(...(rows.length ? rows.map((t) => h('button', {
      class: `dm-item${t.userId === selected ? ' active' : ''}${t.unread ? ' unread' : ''}`, onclick: () => openThread(t.userId, t.user),
    },
    h('img', { class: 'dm-av', src: t.user?.avatar, alt: '', loading: 'lazy' }),
    h('div', { class: 'dm-item-body' },
      h('div', { class: 'dm-item-top' }, h('strong', null, t.user?.name || 'Membre'), h('span', { class: 'muted' }, short(t.lastAt))),
      h('div', { class: 'dm-item-bot' }, h('span', { class: 'dm-prev' }, `${t.lastDir === 'out' ? 'Toi : ' : ''}${t.preview}`), t.unread ? h('span', { class: 'dm-count' }, t.unread > 99 ? '99+' : t.unread) : null))))
      : [h('div', { class: 'dm-empty muted' }, threads.length ? 'Aucune conversation ne correspond.' : 'Aucune conversation pour l’instant. Quand un membre écrira au bot, elle apparaîtra ici.')]));
  }

  async function loadThreads() {
    const data = await api.get(gurl('/dms/threads'));
    if (!alive()) return;
    threads = data.rows;
    enabled = data.enabled;
    state.unread = threads.reduce((n, t) => n + t.unread, 0);
    paintBadge();
    renderBanner();
    renderList();
  }

  /* ---------------------------- Nouveau message ---------------------------- */
  let searchTimer = 0;
  function toggleNew(force) {
    const show = force ?? newPanel.hidden;
    newPanel.hidden = !show;
    if (!show) return;
    const results = h('div', { class: 'dm-results' });
    const input = h('input', {
      class: 'input', placeholder: 'Nom du membre (2 lettres minimum)', 'aria-label': 'Chercher un membre',
      oninput: (e) => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (q.length < 2) { results.replaceChildren(); return; }
        searchTimer = setTimeout(async () => {
          try {
            const { rows } = await api.get(gurl(`/dms/members?q=${encodeURIComponent(q)}`));
            results.replaceChildren(...(rows.length ? rows.map((m) => h('button', { class: 'dm-item', onclick: () => { toggleNew(false); openThread(m.id, m); } },
              h('img', { class: 'dm-av', src: m.avatar, alt: '' }), h('div', { class: 'dm-item-body' }, h('strong', null, m.name), h('div', { class: 'muted' }, `@${m.username}`))))
              : [h('div', { class: 'dm-empty muted' }, 'Aucun membre trouvé.')]));
          } catch (err) { toast(err.message, 'bad'); }
        }, 300);
      },
    });
    newPanel.replaceChildren(input, results);
    input.focus();
  }

  /* ------------------------------ Conversation ------------------------------ */
  const msgBox = h('div', { class: 'dm-msgs', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'input dm-input', rows: 1, maxlength: 2000, placeholder: 'Écrire un message', 'aria-label': 'Message',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
    oninput: () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; },
  });
  const sendBtn = h('button', { class: 'btn btn-primary', onclick: () => send() }, icon('send', 16), 'Envoyer');

  const authorName = (m) => (m.direction === 'in' ? selectedUser?.name || 'Membre'
    : !m.authorId ? 'Réponse automatique' : m.authorId === state.me?.user?.id ? 'Toi' : authors[m.authorId]?.name || 'Équipe');

  function bubble(m) {
    const atts = (m.attachments || []).map((a) => {
      const url = safeUrl(a.url);
      if (!url) return null;
      return /^image\//.test(a.type)
        ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, h('img', { class: 'dm-img', src: url, alt: a.name, loading: 'lazy' }))
        : h('a', { class: 'dm-file', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('paperclip', 14), a.name);
    });
    return h('div', { class: `dm-msg ${m.direction}` },
      h('div', { class: 'dm-meta' }, h('span', null, authorName(m)), h('span', { class: 'muted' }, hhmm(m.createdAt))),
      m.content ? h('div', { class: 'dm-text' }, m.content) : null, ...atts);
  }

  function renderMessages(stick = true) {
    const nearBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight < 80;
    const nodes = [];
    let prev = 0;
    for (const m of messages) {
      if (!prev || !sameDay(prev, m.createdAt)) nodes.push(h('div', { class: 'dm-day' }, dayLabel(m.createdAt)));
      nodes.push(bubble(m));
      prev = m.createdAt;
    }
    msgBox.replaceChildren(...(nodes.length ? nodes : [h('div', { class: 'dm-empty muted' }, 'Aucun message. Écris le premier ci-dessous.')]));
    if (stick || nearBottom) msgBox.scrollTop = msgBox.scrollHeight;
  }

  function renderChat() {
    if (!selected) {
      wrap.classList.remove('chat-open');
      chat.replaceChildren(h('div', { class: 'dm-none' }, emptyState('mail', 'Choisis une conversation, ou clique sur « Nouveau » pour écrire à un membre.')));
      return;
    }
    wrap.classList.add('chat-open');
    chat.replaceChildren(
      h('div', { class: 'dm-chat-head' },
        h('button', { class: 'icon-btn dm-back', title: 'Retour à la liste', onclick: () => { selected = null; renderChat(); renderList(); } }, icon('arrowLeft', 18)),
        h('img', { class: 'dm-av', src: selectedUser?.avatar, alt: '' }),
        h('div', { class: 'dm-who' }, h('strong', null, selectedUser?.name || 'Membre'), h('span', { class: 'muted' }, selectedUser?.username ? `@${selectedUser.username}` : '')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn danger', title: 'Supprimer cette conversation', onclick: removeThread }, icon('trash', 16))),
      msgBox,
      h('div', { class: 'dm-composer' }, input, sendBtn));
  }

  async function openThread(userId, userObj) {
    selected = userId;
    selectedUser = userObj || threads.find((t) => t.userId === userId)?.user || null;
    messages = []; authors = {}; lastId = 0;
    input.value = ''; input.style.height = 'auto';
    renderChat(); renderList();
    msgBox.replaceChildren(loading());
    try {
      const data = await api.get(gurl(`/dms/threads/${userId}/messages`));
      if (selected !== userId) return;
      selectedUser = data.user || selectedUser;
      authors = data.authors || {};
      messages = data.rows;
      lastId = messages.length ? messages[messages.length - 1].id : 0;
      renderChat(); renderMessages(true);
      await api.post(gurl(`/dms/threads/${userId}/read`));
      const t = threads.find((x) => x.userId === userId);
      if (t) { t.unread = 0; renderList(); }
      state.unread = threads.reduce((n, x) => n + x.unread, 0);
      paintBadge();
      if (window.matchMedia('(min-width: 801px)').matches) input.focus();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function pollMessages() {
    if (!alive() || !selected || document.hidden) return;
    const userId = selected;
    try {
      const data = await api.get(gurl(`/dms/threads/${userId}/messages?after=${lastId}`));
      if (selected !== userId || !data.rows.length) return;
      Object.assign(authors, data.authors || {});
      const fresh = data.rows.filter((r) => !messages.some((m) => m.id === r.id));
      if (!fresh.length) return;
      messages.push(...fresh);
      lastId = messages[messages.length - 1].id;
      renderMessages(false);
      if (fresh.some((m) => m.direction === 'in')) api.post(gurl(`/dms/threads/${userId}/read`)).catch(() => {});
    } catch { /* coupure réseau passagère */ }
  }

  async function send() {
    const content = input.value.trim();
    if (!selected || !content || sending) return;
    sending = true; sendBtn.disabled = true;
    try {
      const r = await api.post(gurl('/dms/send'), { userId: selected, content });
      input.value = ''; input.style.height = 'auto';
      if (r.message && !messages.some((m) => m.id === r.message.id)) {
        messages.push(r.message);
        lastId = Math.max(lastId, r.message.id);
        renderMessages(true);
      }
      loadThreads().catch(() => {});
    } catch (err) {
      toast(err.message, 'bad', 7000);
    } finally { sending = false; sendBtn.disabled = false; input.focus(); }
  }

  async function removeThread() {
    if (!await confirmDialog({ title: 'Supprimer cette conversation ?', text: 'Les messages seront effacés du dashboard (le membre les garde dans ses MP Discord).', confirmLabel: 'Supprimer', danger: true })) return;
    try {
      await api.del(gurl(`/dms/threads/${selected}`));
      selected = null;
      renderChat();
      await loadThreads();
      toast('Conversation supprimée.');
    } catch (err) { toast(err.message, 'bad'); }
  }

  renderChat();
  try { await loadThreads(); } catch (err) { root.replaceChildren(head, h('div', { class: 'banner bad' }, err.message)); return; }
  timers.push(setInterval(() => { if (alive() && !document.hidden) loadThreads().catch(() => {}); }, 8000));
  timers.push(setInterval(pollMessages, 3500));
}
