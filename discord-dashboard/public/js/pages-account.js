/**
 * Abonnement : page « Abonnement » (clés, paiement Stripe, activation sur un serveur)
 * et bloc « Licences » de la page d'administration du bot.
 */
import { api } from './api.js';
import { state } from './state.js';
import {
  h, toast, confirmDialog, loading, emptyState, fmtDate, icon,
} from './ui.js';

const DAY = 86400000;
const head = (iconName, title, desc) => h('div', { class: 'page-head' },
  h('div', null, h('h1', null, h('span', { class: 'ico' }, icon(iconName, 20)), title), h('p', null, desc)));

const busy = (fn) => async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message, 'bad', 8000); } finally { btn.disabled = false; }
};

const daysLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / DAY));

/** Texte et couleur de l'état d'un serveur. */
export function guildStateLabel(g) {
  switch (g.state) {
    case 'licensed': return { kind: 'good', text: g.periodEnd ? `Licence active · jusqu’au ${fmtDate(g.periodEnd)}` : 'Licence active' };
    case 'trial': return { kind: 'info', text: `Essai gratuit · encore ${daysLeft(g.trialEndsAt)} jour${daysLeft(g.trialEndsAt) > 1 ? 's' : ''}` };
    case 'free': return { kind: 'good', text: 'Offert' };
    case 'disabled': return { kind: 'good', text: 'Gratuit' };
    default: return { kind: 'bad', text: 'Essai terminé · bot en pause' };
  }
}

const STATUS = {
  active: ['good', 'Active'], trialing: ['info', 'Essai Stripe'], past_due: ['warn', 'Paiement en retard'], canceled: ['bad', 'Résiliée'], revoked: ['bad', 'Révoquée'],
};
const statusPill = (l) => {
  const [kind, text] = (!l.active && ['active', 'trialing', 'past_due'].includes(l.status)) ? ['bad', 'Expirée'] : (STATUS[l.status] || ['', l.status]);
  return h('span', { class: `pill ${kind}` }, text);
};

function copyButton(getText, label = 'Copier') {
  return h('button', { class: 'btn btn-sm', onclick: async (e) => {
    try { await navigator.clipboard.writeText(getText()); toast('Copié'); } catch { toast('Copie impossible : sélectionne le texte à la main.', 'warn'); }
    e.currentTarget.blur();
  } }, label);
}

/** Affiche une clé masquée avec un bouton pour la révéler. */
function keyBox(key, hint) {
  let shown = false;
  const code = h('code', { class: 'keybox' });
  const render = () => { code.textContent = shown ? key : `KEY-••••-••••-••••-${hint || '••••'}`; };
  render();
  return h('div', { class: 'field-row' }, code,
    h('button', { class: 'btn btn-sm', onclick: () => { shown = !shown; render(); } }, 'Afficher / masquer'),
    copyButton(() => key));
}

/* ======================================================================== */
/* Page « Abonnement »                                                       */
/* ======================================================================== */
export async function accountPage(root, { paid = false } = {}) {
  root.replaceChildren(head('creditCard', 'Abonnement', 'Ton abonnement, tes clés de licence et tes serveurs.'), loading());
  let d;
  try {
    d = await api.get('/api/account');
  } catch (err) {
    root.replaceChildren(head('creditCard', 'Abonnement', ''), h('div', { class: 'banner bad' }, err.message));
    return;
  }
  const reload = () => accountPage(root);

  if (!d.enabled) {
    root.replaceChildren(head('creditCard', 'Abonnement', 'Ton abonnement, tes clés de licence et tes serveurs.'),
      h('div', { class: 'card' }, emptyState('gift', 'Ce bot est entièrement gratuit : aucun abonnement n’est nécessaire.')));
    return;
  }

  // Juste après un paiement, la clé arrive via Stripe en quelques secondes : on réessaie un peu.
  if (paid && !d.licenses.length && (accountPage.retries || 0) < 12) {
    accountPage.retries = (accountPage.retries || 0) + 1;
    root.replaceChildren(head('creditCard', 'Abonnement', 'Ton abonnement, tes clés de licence et tes serveurs.'),
      h('div', { class: 'banner good' }, icon('checkCircle', 18), 'Paiement reçu ! Ta clé est en cours de création, ça prend quelques secondes…'), loading());
    setTimeout(() => { if (location.hash.startsWith('#/account')) accountPage(root, { paid: true }); }, 2500);
    return;
  }
  accountPage.retries = 0;

  const pageHead = head('creditCard', 'Abonnement', `${d.priceLabel} · 1 clé = 1 serveur · ${d.trialDays} jours d’essai gratuit par serveur`);
  const blocks = [pageHead];
  if (paid && d.licenses.length) blocks.push(h('div', { class: 'banner good' }, icon('checkCircle', 18), 'Merci ! Ton abonnement est actif. Active ta clé sur un serveur ci-dessous.'));

  /* --- S'abonner --- */
  const checkout = h('button', { class: 'btn btn-primary btn-lg', disabled: !d.stripeReady, onclick: busy(async () => {
    const r = await api.post('/api/account/checkout');
    location.href = r.url;
  }) }, `S’abonner — ${d.priceLabel}`);
  blocks.push(h('div', { class: 'card plan-card' },
    h('div', { class: 'plan-price' }, h('strong', null, d.priceLabel), h('span', { class: 'muted' }, 'sans engagement')),
    h('ul', { class: 'plan-list' },
      h('li', null, 'Tous les modules, sans limite : tickets IA, protections, logs, webhooks, créateur de serveur…'),
      h('li', null, `Chaque serveur démarre avec ${d.trialDays} jours d’essai gratuit`),
      h('li', null, 'Une clé de licence = un serveur, déplaçable quand tu veux'),
      h('li', null, 'Résiliation en un clic depuis le portail de paiement')),
    h('div', { class: 'field-row' }, checkout,
      d.stripeReady ? null : h('span', { class: 'muted' }, 'Le paiement n’est pas encore configuré par l’administrateur du bot.'))));

  /* --- Mes clés --- */
  const free = d.guilds.filter((g) => g.state !== 'licensed' && g.state !== 'free');
  blocks.push(h('h3', { class: 'section-title' }, 'Mes clés'));
  if (!d.licenses.length) {
    blocks.push(h('div', { class: 'card' }, emptyState('key', 'Tu n’as pas encore de clé. Elle apparaît ici dès que ton paiement est confirmé (et tu la reçois aussi en message privé).')));
  } else {
    for (const l of d.licenses) {
      const target = h('select', { class: 'input', style: { width: 'auto', maxWidth: '100%' }, 'aria-label': 'Serveur' },
        free.map((g) => h('option', { value: g.id }, g.name)));
      const full = l.guilds.length >= l.maxGuilds;
      blocks.push(h('div', { class: 'card key-card' },
        h('div', { class: 'field-row' }, statusPill(l),
          h('span', { class: 'muted' }, l.periodEnd ? (l.active ? `Prochaine échéance : ${fmtDate(l.periodEnd)}` : `Terminée le ${fmtDate(l.periodEnd)}`) : 'Sans date de fin'),
          l.note ? h('span', { class: 'muted' }, `· ${l.note}`) : null),
        keyBox(l.key, l.keyHint),
        h('div', { class: 'key-guilds' },
          l.guilds.length ? l.guilds.map((g) => h('div', { class: 'wh-row' },
            h('div', { class: 'grow' }, h('strong', null, g.name), h('span', { class: 'muted' }, `activée le ${fmtDate(g.activatedAt)}`)),
            h('button', { class: 'btn btn-sm btn-danger', onclick: busy(async () => {
              if (!(await confirmDialog({ title: `Retirer la clé de « ${g.name} » ?`, text: 'Le bot se mettra en pause sur ce serveur (si son essai est terminé). Tu pourras réutiliser la clé ailleurs.', confirmLabel: 'Retirer', danger: true }))) return;
              await api.del(`/api/guilds/${g.guildId}/license`);
              toast('Clé retirée');
              await reload();
            }) }, 'Retirer'))) : h('p', { class: 'muted' }, 'Cette clé n’est activée sur aucun serveur.')),
        l.active && !full ? h('div', { class: 'field-row' },
          free.length ? [target, h('button', { class: 'btn btn-primary', onclick: busy(async () => {
            await api.post(`/api/guilds/${target.value}/license`, { licenseId: l.id });
            toast('Clé activée. Le bot est actif sur ce serveur.');
            await reload();
          }) }, 'Activer sur ce serveur')] : h('span', { class: 'muted' }, 'Aucun autre serveur où le bot est présent et où tu es administrateur.')) : null,
        l.hasStripe ? h('div', { class: 'field-row' }, h('button', { class: 'btn', onclick: busy(async () => {
          const r = await api.post('/api/account/portal', { licenseId: l.id });
          location.href = r.url;
        }) }, icon('creditCard', 16), 'Factures, carte bancaire, résiliation')) : null));
    }
  }

  /* --- Activer une clé reçue --- */
  const keyInput = h('input', { class: 'input', type: 'text', placeholder: 'KEY-XXXX-XXXX-XXXX-XXXX', autocomplete: 'off', spellcheck: false, 'aria-label': 'Clé de licence' });
  const guildSel = h('select', { class: 'input', style: { width: 'auto', maxWidth: '100%' }, 'aria-label': 'Serveur' },
    d.guilds.filter((g) => g.state !== 'free').map((g) => h('option', { value: g.id }, g.name)));
  blocks.push(h('h3', { class: 'section-title' }, 'Activer une clé'));
  blocks.push(h('div', { class: 'card' },
    h('p', { class: 'muted' }, 'Tu as reçu une clé (achat d’un ami, cadeau…) ? Colle-la ici. Il faut être administrateur du serveur.'),
    h('div', { class: 'field-row' }, keyInput, guildSel, h('button', { class: 'btn btn-primary', disabled: !d.guilds.length, onclick: busy(async () => {
      if (!keyInput.value.trim()) { toast('Colle d’abord une clé.', 'warn'); return; }
      await api.post(`/api/guilds/${guildSel.value}/license`, { key: keyInput.value.trim() });
      toast('Clé activée');
      await reload();
    }) }, 'Activer'))));

  /* --- Mes serveurs --- */
  blocks.push(h('h3', { class: 'section-title' }, 'Mes serveurs'));
  blocks.push(d.guilds.length ? h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Serveur', 'État'].map((t) => h('th', null, t)))),
    h('tbody', null, d.guilds.map((g) => {
      const s = guildStateLabel(g);
      return h('tr', null, h('td', null, h('a', { href: `#/g/${g.id}/overview` }, g.name)), h('td', null, h('span', { class: `pill ${s.kind}` }, s.text)));
    }))))
    : h('div', { class: 'card' }, emptyState('home', 'Le bot n’est encore sur aucun des serveurs que tu gères.')));

  root.replaceChildren(...blocks);
}

/* ======================================================================== */
/* Bloc « Licences » de la page d'administration                             */
/* ======================================================================== */
export async function adminLicensesCard() {
  const box = h('div', { class: 'card', style: { marginTop: '16px' } }, loading());
  const reload = async () => {
    let d;
    try { d = await api.get('/api/admin/licenses'); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }

    const owner = h('input', { class: 'input', type: 'text', placeholder: 'Identifiant Discord du client', inputmode: 'numeric', 'aria-label': 'Identifiant Discord', style: { flex: '1 1 220px', width: 'auto' } });
    const days = h('input', { class: 'input', type: 'number', min: 1, max: 3650, placeholder: 'Jours (vide = illimitée)', 'aria-label': 'Durée en jours', style: { flex: '0 1 210px', width: 'auto' } });
    const note = h('input', { class: 'input', type: 'text', maxlength: 200, placeholder: 'Note (facultatif)', 'aria-label': 'Note', style: { flex: '1 1 200px', width: 'auto' } });
    const created = h('div');

    const checks = [
      [d.enabled, 'Licences activées (LICENSE_ENABLED=true)'],
      [d.stripeReady, 'Stripe : clé secrète et prix configurés'],
      [d.webhookReady, 'Stripe : secret du webhook configuré'],
    ];

    box.replaceChildren(
      h('h3', { style: { marginTop: 0 } }, 'Abonnements et licences'),
      h('div', { class: 'checklist' }, checks.map(([ok, text]) => h('div', { class: 'status-line' }, h('span', { class: `status-dot ${ok ? 'on' : 'warn'}` }), text))),
      h('h4', { style: { margin: '18px 0 6px' } }, 'Offrir ou créer une clé'),
      h('div', { class: 'field-row' }, owner, days, note, h('button', { class: 'btn btn-primary', onclick: busy(async () => {
        const r = await api.post('/api/admin/licenses', { ownerId: owner.value.trim(), days: days.value ? Number(days.value) : null, note: note.value.trim() });
        created.replaceChildren(h('div', { class: 'banner good' }, h('div', null, 'Clé créée (copie-la maintenant, elle n’est plus affichée ici ensuite) : ', h('code', { class: 'keybox' }, r.key), ' ', copyButton(() => r.key))));
        owner.value = ''; days.value = ''; note.value = '';
        await reload2();
      }) }, 'Créer')),
      created,
      h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, d.rows.length ? h('table', null,
        h('thead', null, h('tr', null, ['Client', 'État', 'Fin', 'Serveurs', 'Origine', ''].map((t) => h('th', null, t)))),
        h('tbody', null, d.rows.map((l) => h('tr', null,
          h('td', null, h('span', { class: 'mono' }, l.id), ' · ', h('span', { class: 'mono muted' }, `…${l.keyHint}`)),
          h('td', null, statusPill(l)),
          h('td', null, l.periodEnd ? fmtDate(l.periodEnd) : '∞'),
          h('td', null, l.guilds.length ? l.guilds.map((g) => g.name).join(', ') : h('span', { class: 'muted' }, '—')),
          h('td', null, l.source === 'stripe' ? 'Stripe' : `Manuelle${l.note ? ` · ${l.note}` : ''}`),
          h('td', { class: 'ta-r' }, l.status !== 'revoked' ? h('button', { class: 'btn btn-sm btn-danger', onclick: busy(async () => {
            if (!(await confirmDialog({ title: 'Révoquer cette licence ?', text: 'Le ou les serveurs concernés perdent l’accès tout de suite. Pour un abonnement Stripe, pense aussi à le résilier (et rembourser) dans Stripe.', confirmLabel: 'Révoquer', danger: true }))) return;
            await api.post(`/api/admin/licenses/${l.id}/revoke`);
            toast('Licence révoquée');
            await reload2();
          }) }, 'Révoquer') : null)))))
        : emptyState('key', 'Aucune licence pour l’instant.')));
  };
  const reload2 = reload;
  await reload();
  return box;
}

/** Bandeau affiché sous la barre du haut pendant l'essai ou quand il est terminé. */
export function renderNotice(el) {
  const lic = state.overview?.license;
  if (!state.guildId || !lic?.enabled || lic.state === 'licensed' || lic.state === 'free' || lic.state === 'disabled') { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false;
  el.className = `notice ${lic.allowed ? 'info' : 'bad'}`;
  const left = lic.trialEndsAt ? daysLeft(lic.trialEndsAt) : 0;
  el.replaceChildren(
    h('span', null, icon(lic.allowed ? 'clock' : 'lock', 16), lic.allowed
      ? `Essai gratuit : encore ${left} jour${left > 1 ? 's' : ''} sur ce serveur.`
      : 'L’essai gratuit est terminé : le bot est en pause sur ce serveur et la configuration est en lecture seule.'),
    h('a', { class: 'btn btn-sm btn-primary', href: '#/account' }, lic.allowed ? 'S’abonner' : 'Activer une clé'));
}
