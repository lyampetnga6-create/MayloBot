/**
 * Panneaux d'actions affichés sous le formulaire de certains modules (IA, protections,
 * honeypot, vérification, tickets). Chaque fonction reçoit `x` :
 *   x.url(path)       URL d'API du serveur courant
 *   x.isAdmin         l'utilisateur est administrateur du serveur
 *   x.saveFirst()     enregistre les modifications en attente (renvoie false en cas d'échec)
 *   x.saved()         réglages enregistrés du module
 *   x.applySaved(s)   remplace les réglages enregistrés et réaffiche le formulaire
 *   x.reloadMeta()    recharge la liste des salons / rôles
 */
import { api } from './api.js';
import { h, toast, confirmDialog, fmtDate } from './ui.js';
import { state } from './state.js';

const panel = (title, ...children) => h('div', { class: 'card' }, h('h3', null, title), ...children);
const linkToast = (text, url) => toast(h('span', null, `${text} `, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord ↗')));

/** Exécute une action en désactivant le bouton pendant l'appel. */
const busy = (fn) => async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message, 'bad', 7000); } finally { btn.disabled = false; }
};

const adminNote = (x) => (x.isAdmin ? null : h('div', { class: 'banner warn' }, 'Cette section est réservée aux administrateurs du serveur : tu peux la consulter, mais pas la modifier.'));

/* -------------------------------- Tickets -------------------------------- */
function tickets(x) {
  return panel('Publier le panneau',
    h('p', { class: 'muted' }, 'Envoie (ou renvoie) le message avec le bouton d’ouverture dans le « salon du panneau ». Tes modifications en attente sont enregistrées d’abord.'),
    h('div', { class: 'field-row' },
      h('button', { class: 'btn btn-primary', onclick: busy(async () => {
        if (!(await x.saveFirst())) return;
        if (!x.saved().panelChannelId) { toast('Choisis d’abord un « salon du panneau » puis enregistre.', 'warn'); return; }
        const r = await api.post(x.url('/actions/ticket-panel'));
        linkToast('Panneau publié.', r.url);
      }) }, '📤 Publier le panneau'),
      h('span', { class: 'muted' }, 'Tu peux aussi utiliser la commande /ticket panel.')));
}

/* ----------------------------------- IA ---------------------------------- */
function ai(x) {
  const box = h('div');
  const keyInput = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Colle ta clé d’API ici', 'aria-label': 'Clé d’API' });
  const testOut = h('div', { class: 'hint' });

  async function load() {
    let st;
    try { st = await api.get(x.url('/ai/status')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const sourceLabel = { guild: 'clé de ce serveur', global: 'clé du bot (variable d’environnement)' }[st.source] || null;
    const dot = st.ready ? 'on' : 'warn';
    box.replaceChildren(
      h('div', { class: 'status-line' }, h('span', { class: `status-dot ${dot}` }),
        st.ready ? `IA prête — ${sourceLabel || 'clé configurée'}${st.model ? `, modèle ${st.model}` : ''}` : 'IA non configurée : ajoute une clé d’API ci-dessous.'),
      h('p', { class: 'hint' }, st.enabled ? 'Le module est activé.' : 'Le module est désactivé : l’IA ne répondra nulle part (le créateur de serveur reste utilisable si une clé est configurée).'),
      h('div', { class: 'field', style: { marginTop: '16px' } },
        h('label', { class: 'field-label' }, 'Clé d’API de ce serveur'),
        h('p', { class: 'field-help' }, 'Elle est chiffrée avant d’être stockée et ne s’affiche plus jamais ensuite. Compatible avec les API de type OpenAI et Anthropic (voir le README pour choisir le fournisseur).'),
        h('div', { class: 'field-row' }, keyInput,
          h('button', { class: 'btn btn-primary', disabled: !x.isAdmin, onclick: busy(async () => {
            const key = keyInput.value.trim();
            if (key.length < 8) { toast('La clé semble trop courte.', 'warn'); return; }
            await api.put(x.url('/ai/key'), { key });
            keyInput.value = '';
            toast('Clé enregistrée ✓');
            await load();
          }) }, st.guildKeySet ? 'Remplacer la clé' : 'Enregistrer la clé'),
          st.guildKeySet ? h('button', { class: 'btn btn-danger', disabled: !x.isAdmin, onclick: busy(async () => {
            if (!(await confirmDialog({ title: 'Supprimer la clé ?', text: 'L’IA sera désactivée ici, sauf si le bot possède une clé globale.', confirmLabel: 'Supprimer', danger: true }))) return;
            await api.del(x.url('/ai/key'));
            toast('Clé supprimée');
            await load();
          }) }, 'Supprimer') : null)),
      h('div', { class: 'field-row' },
        h('button', { class: 'btn', disabled: !st.ready, onclick: busy(async () => {
          testOut.textContent = 'Test en cours…';
          const r = await api.post(x.url('/ai/test'));
          testOut.textContent = r.ok ? `✅ Réponse reçue : « ${r.answer} »` : `❌ ${r.error}`;
        }) }, '🧪 Tester la connexion'), testOut),
    );
  }
  load();
  return panel('Connexion à l’IA', adminNote(x), box);
}

/* ------------------------------ Protections ------------------------------- */
function protection(x) {
  const box = h('div');
  const RAID_CHOICES = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 heure'], [180, '3 heures'], [720, '12 heures'], [1440, '24 heures']];
  const minutes = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Durée du mode raid' }, RAID_CHOICES.map(([v, l]) => h('option', { value: v }, l)));
  minutes.value = '60';

  async function load() {
    let st;
    try { st = await api.get(x.url('/security/state')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const raidOn = st.raidModeUntil && st.raidModeUntil > Date.now();
    box.replaceChildren(h('div', { class: 'big-actions' },
      h('div', { class: `action-tile${st.lockdown ? ' is-on' : ''}` },
        h('strong', null, '🔒 Verrouillage du serveur', st.lockdown ? h('span', { class: 'pill bad' }, 'actif') : null),
        h('p', null, 'Empêche tout le monde (sauf le staff) d’écrire dans les salons. Un seul clic pour tout rouvrir ensuite.'),
        h('button', { class: `btn ${st.lockdown ? 'btn-primary' : 'btn-danger'}`, disabled: !x.isAdmin, onclick: busy(async () => {
          const on = !st.lockdown;
          if (!(await confirmDialog({
            title: on ? 'Verrouiller le serveur ?' : 'Déverrouiller le serveur ?',
            text: on ? 'Les membres ne pourront plus écrire dans les salons textuels tant que tu ne l’auras pas annulé.' : 'Les permissions d’écriture seront rétablies comme avant le verrouillage.',
            confirmLabel: on ? 'Verrouiller' : 'Déverrouiller', danger: on,
          }))) return;
          const r = await api.post(x.url('/actions/lockdown'), { on });
          toast(`${on ? 'Serveur verrouillé' : 'Serveur déverrouillé'} (${r.changed} salon${r.changed > 1 ? 's' : ''}).`);
          await load();
        }) }, st.lockdown ? '🔓 Déverrouiller' : '🔒 Verrouiller')),
      h('div', { class: `action-tile${raidOn ? ' is-on' : ''}` },
        h('strong', null, '🚨 Mode raid', raidOn ? h('span', { class: 'pill bad' }, `jusqu’à ${fmtDate(st.raidModeUntil)}`) : null),
        h('p', null, 'Durcit temporairement les règles : seuils plus bas pour le spam et les arrivées en masse.'),
        raidOn ? null : minutes,
        h('button', { class: `btn ${raidOn ? 'btn-primary' : 'btn-danger'}`, disabled: !x.isAdmin, onclick: busy(async () => {
          await api.post(x.url('/actions/raidmode'), { minutes: raidOn ? 0 : Number(minutes.value) });
          toast(raidOn ? 'Mode raid désactivé' : 'Mode raid activé');
          await load();
        }) }, raidOn ? 'Désactiver' : 'Activer'))));
  }
  load();
  return panel('Actions d’urgence', adminNote(x), h('p', { class: 'muted' }, 'Ces boutons agissent tout de suite, sans passer par la barre d’enregistrement.'), box);
}

/* -------------------------------- Honeypot -------------------------------- */
function honeypot(x) {
  const list = h('div');
  const render = () => {
    const ids = x.saved().channelIds || [];
    list.replaceChildren(...(ids.length ? ids : []).map((id) => {
      const ch = state.meta.channels.find((c) => c.id === id);
      return h('div', { class: 'wh-row' },
        h('div', { class: 'grow' }, h('strong', null, ch ? `# ${ch.name}` : 'Salon supprimé'), h('span', { class: 'muted' }, id)),
        h('button', { class: 'btn btn-sm', disabled: !ch, onclick: busy(async () => {
          if (!(await x.saveFirst())) return;
          const r = await api.post(x.url('/actions/honeypot-warning'), { channelId: id });
          linkToast('Avertissement publié.', r.url);
        }) }, '📌 Publier l’avertissement'));
    }));
    if (!ids.length) list.append(h('div', { class: 'list-empty' }, 'Aucun salon piège pour l’instant. Crée-en un avec le bouton ci-dessus.'));
  };
  render();
  return panel('Salons pièges',
    h('p', { class: 'muted' }, 'Un salon piège est visible mais ne doit jamais servir : quiconque y écrit est sanctionné selon tes réglages. L’avertissement épinglé explique aux vrais membres de ne rien y poster.'),
    h('div', { class: 'field-row', style: { marginBottom: '14px' } },
      h('button', { class: 'btn btn-primary', disabled: !x.isAdmin, onclick: busy(async () => {
        const r = await api.post(x.url('/actions/honeypot-create'));
        await x.reloadMeta();
        x.applySaved(r.settings);
        toast('Salon piège créé ✓ Pense à publier l’avertissement.');
      }) }, '🍯 Créer un salon piège'),
      x.isAdmin ? null : h('span', { class: 'muted' }, 'Réservé aux administrateurs.')),
    list);
}

/* ------------------------------ Vérification ------------------------------ */
function verification(x) {
  return panel('Publier le panneau',
    h('p', { class: 'muted' }, 'Envoie le message de vérification avec son bouton dans le salon choisi. Tes modifications en attente sont enregistrées d’abord.'),
    h('button', { class: 'btn btn-primary', onclick: busy(async () => {
      if (!(await x.saveFirst())) return;
      const r = await api.post(x.url('/actions/verification-panel'));
      linkToast('Panneau de vérification publié.', r.url);
    }) }, '📤 Publier le panneau'));
}

export const EXTRAS = { tickets, ai, protection, honeypot, verification };
