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
import { h, toast, confirmDialog, fmtDate, icon, who } from './ui.js';
import { state } from './state.js';

const panel = (title, ...children) => h('div', { class: 'card' }, h('h3', null, title), ...children);
const linkToast = (text, url) => toast(h('span', null, `${text} `, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord')));

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
      }) }, icon('upload', 16), 'Publier le panneau'),
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
            toast('Clé enregistrée');
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
          testOut.textContent = r.ok ? `Réponse reçue : « ${r.answer} »` : `Échec : ${r.error}`;
        }) }, icon('flask', 16), 'Tester la connexion'), testOut),
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
        h('strong', null, icon('lock', 17), 'Verrouillage du serveur', st.lockdown ? h('span', { class: 'pill bad' }, 'actif') : null),
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
        }) }, st.lockdown ? [icon('unlock', 16), 'Déverrouiller'] : [icon('lock', 16), 'Verrouiller'])),
      h('div', { class: `action-tile${raidOn ? ' is-on' : ''}` },
        h('strong', null, icon('siren', 17), 'Mode raid', raidOn ? h('span', { class: 'pill bad' }, `jusqu’à ${fmtDate(st.raidModeUntil)}`) : null),
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
        }) }, icon('pin', 15), 'Publier l’avertissement'));
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
        toast('Salon piège créé. Pense à publier l’avertissement.');
      }) }, icon('target', 16), 'Créer un salon piège'),
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
    }) }, icon('upload', 16), 'Publier le panneau'));
}

/* ------------------------------ Flux YouTube / RSS ------------------------------ */
function feeds(x) {
  const box = h('div');
  async function load() {
    let st;
    try { st = await api.get(x.url('/feeds/status')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const feedList = x.saved().feeds || [];
    if (!feedList.length) { box.replaceChildren(h('p', { class: 'muted' }, 'Ajoute un flux puis enregistre : son état s’affichera ici.')); return; }
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Flux', 'État', 'Dernière vérification', ''].map((t) => h('th', null, t)))),
      h('tbody', null, feedList.map((f) => {
        const s = byId.get(f.id);
        const state = !s || !s.checkedAt ? h('span', { class: 'pill' }, 'Pas encore vérifié')
          : s.error ? h('span', { class: 'pill bad', title: s.error }, 'Erreur')
            : h('span', { class: 'pill good' }, 'Fonctionne');
        return h('tr', null,
          h('td', null, f.name || f.url, s?.error ? h('div', { class: 'muted' }, s.error) : null),
          h('td', null, state),
          h('td', { class: 'muted' }, s?.checkedAt ? fmtDate(s.checkedAt) : '—'),
          h('td', { class: 'ta-r' }, h('button', { class: 'btn btn-sm', disabled: !x.isAdmin, onclick: busy(async () => {
            if (!(await x.saveFirst())) return;
            const r = await api.post(x.url(`/actions/feeds-test/${encodeURIComponent(f.id)}`));
            if (r.url) linkToast('Dernière publication envoyée.', r.url); else toast('Dernière publication envoyée.');
            load();
          }) }, icon('send', 14), 'Tester')));
      })))));
  }
  load();
  return panel('État des flux',
    h('p', { class: 'muted' }, 'Le bot vérifie les flux régulièrement. Au premier passage il mémorise les publications existantes sans rien poster, puis annonce uniquement les nouvelles. « Tester » envoie la dernière publication dans le salon choisi.'),
    box);
}

/* ------------------------------ Alertes de lives ------------------------------ */
const PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', tiktok: 'TikTok' };

function streams(x) {
  const box = h('div');
  const keys = h('div');
  async function load() {
    let st;
    try { st = await api.get(x.url('/streams/status')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }

    const need = (ok, name, vars) => h('div', { class: 'status-line' }, h('span', { class: `status-dot ${ok ? 'on' : 'warn'}` }),
      ok ? `${name} : prêt` : `${name} : à configurer (variables ${vars} dans Railway, onglet Variables)`);
    keys.replaceChildren(need(st.credentials.twitch, 'Twitch', 'TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET'), need(st.credentials.kick, 'Kick', 'KICK_CLIENT_ID et KICK_CLIENT_SECRET'),
      h('div', { class: 'status-line' }, h('span', { class: 'status-dot on' }), 'YouTube : aucune clé nécessaire'),
      h('div', { class: 'status-line' }, h('span', { class: 'status-dot warn' }), 'TikTok : expérimental, TikTok peut bloquer la vérification'));

    const list = x.saved().streamers || [];
    if (!list.length) { box.replaceChildren(h('p', { class: 'muted' }, 'Ajoute un streamer puis enregistre : son état s’affichera ici.')); return; }
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Streamer', 'État', 'Dernière vérification', ''].map((t) => h('th', null, t)))),
      h('tbody', null, list.map((f) => {
        const s = byId.get(f.id);
        const state = !s || !s.checkedAt ? h('span', { class: 'pill' }, 'Pas encore vérifié')
          : s.error ? h('span', { class: 'pill bad', title: s.error }, 'Erreur')
            : s.live ? h('span', { class: 'pill good' }, 'En direct')
              : h('span', { class: 'pill' }, 'Hors ligne');
        return h('tr', null,
          h('td', null, `${PLATFORM_NAMES[f.platform] || f.platform} · ${f.handle}`, s?.error ? h('div', { class: 'muted' }, s.error) : null),
          h('td', null, state),
          h('td', { class: 'muted' }, s?.checkedAt ? fmtDate(s.checkedAt) : '—'),
          h('td', { class: 'ta-r' }, h('button', { class: 'btn btn-sm', disabled: !x.isAdmin, onclick: busy(async () => {
            if (!(await x.saveFirst())) return;
            const r = await api.post(x.url(`/actions/streams-test/${encodeURIComponent(f.id)}`));
            if (!r.live) toast('Ce streamer n’est pas en direct pour l’instant : rien n’a été envoyé.', 'warn', 6000);
            else linkToast('Alerte envoyée.', r.url);
            load();
          }) }, icon('send', 14), 'Tester')));
      })))));
  }
  load();
  return panel('Plateformes et état',
    h('p', { class: 'muted' }, 'Le bot vérifie chaque streamer régulièrement. Au premier passage il note simplement son état, puis il envoie une alerte à chaque nouveau direct. « Tester » envoie l’alerte tout de suite si le streamer est en direct.'),
    keys, box);
}

/* ----------------------------- Messagerie privée ----------------------------- */
function dms(x) {
  return panel('Lire et répondre',
    h('p', { class: 'muted' }, 'Quand le module est activé, les messages que les membres envoient au bot en privé arrivent dans la page « Messages privés ». Tu peux aussi écrire le premier à un membre depuis cette page. Le bot doit partager un serveur avec le membre, et le membre doit accepter les messages privés.'),
    h('a', { class: 'btn btn-primary', href: `#/g/${state.guildId}/inbox` }, icon('mail', 16), 'Ouvrir les messages privés'));
}

/* -------------------------------- Invitations -------------------------------- */
function invites(x) {
  const box = h('div');
  (async () => {
    try {
      const { rows } = await api.get(x.url('/invites'));
      box.replaceChildren(rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['#', 'Membre', 'Actives', 'Total', 'Parties'].map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((r, i) => h('tr', null,
            h('td', { class: 'muted' }, i + 1), h('td', null, who(r.user)), h('td', null, h('strong', null, r.active)), h('td', null, r.total), h('td', { class: 'muted' }, r.left))))))
        : h('p', { class: 'muted' }, 'Personne n’a encore invité de membre depuis l’activation du module.'));
    } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); }
  })();
  return panel('Classement des inviteurs',
    h('p', { class: 'muted' }, 'Le bot a besoin de la permission « Gérer le serveur » pour voir quelle invitation a été utilisée. Seules les arrivées après l’activation sont comptées. Commandes : /invitations membre et /invitations classement.'),
    box);
}

/* ------------------------- TikTok : vidéos et lives ------------------------- */
const TIKTOK_NOTE = 'TikTok ne propose pas d’accès officiel pour cela : le bot passe par des sources publiques non officielles. Elles peuvent être bloquées ou changer sans prévenir, surtout depuis un hébergeur (erreur 403). Utilise « Tester » pour vérifier que ça marche chez toi.';
const TIKTOK_FALLBACK = {
  videos: 'Si c’est bloqué : colle l’adresse d’un flux RSS dans le champ « Flux RSS de tes vidéos », ou annonce toi-même chaque vidéo avec la commande /tiktok video (colle le lien, le reste est automatique).',
  live: 'Si c’est bloqué : annonce ton live toi-même avec la commande /tiktok live (titre facultatif).',
};

function tiktokPanel(x, kind) {
  const box = h('div');
  const isLive = kind === 'live';
  async function load() {
    let st;
    try { st = (await api.get(x.url('/tiktok/status')))[kind]; } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const cfg = x.saved();
    const configured = Boolean(cfg.account && cfg.channelId);
    let dot = 'warn'; let text;
    if (!configured) text = 'Renseigne ton compte et le salon, puis enregistre.';
    else if (!cfg.enabled) text = 'Module désactivé.';
    else if (!st.checkedAt) text = 'Pas encore vérifié : la première vérification arrive dans quelques minutes.';
    else if (st.error) text = `Dernière vérification en erreur : ${st.error}${/\b(403|429)\b/.test(st.error) ? ` Les sites bloquent souvent les serveurs d’hébergement : ${isLive ? 'annonce ton live avec /tiktok live' : 'annonce chaque vidéo avec /tiktok video lien:…'} (ça marche toujours).` : ''}`;
    else {
      dot = 'on';
      text = isLive
        ? (st.live ? `En direct maintenant${st.title ? ` : ${st.title}` : ''}` : 'Hors ligne pour l’instant')
        : (st.initialized ? 'Surveillance active : les nouvelles vidéos seront annoncées.' : 'Première vérification en cours.');
    }
    box.replaceChildren(
      h('div', { class: 'status-line' }, h('span', { class: `status-dot ${dot}` }), text),
      st.checkedAt ? h('p', { class: 'muted' }, `Dernière vérification : ${fmtDate(st.checkedAt)}`) : null,
      h('button', { class: 'btn btn-sm', disabled: !x.isAdmin || !configured, onclick: busy(async () => {
        if (!(await x.saveFirst())) return;
        const r = await api.post(x.url(`/actions/tiktok${isLive ? 'live' : 'videos'}-test`));
        if (isLive && !r.live) toast('Tu n’es pas en direct pour l’instant : rien n’a été envoyé.', 'warn', 6000);
        else if (r.url) linkToast(isLive ? 'Alerte envoyée.' : 'Dernière vidéo envoyée.', r.url);
        else toast('Message envoyé.');
        load();
      }) }, icon('send', 14), isLive ? 'Tester l’alerte' : 'Tester avec ma dernière vidéo'));
  }
  load();
  return panel('État',
    h('p', { class: 'muted' }, isLive
      ? 'Le bot surveille ton compte et envoie une seule annonce par live. Au premier passage il note simplement ton état. « Tester » envoie l’annonce tout de suite si tu es en direct.'
      : 'Au premier passage le bot mémorise tes vidéos existantes sans rien publier, puis annonce chaque nouvelle vidéo. « Tester » envoie ta dernière vidéo dans le salon choisi.'),
    h('p', { class: 'muted' }, TIKTOK_NOTE),
    h('p', { class: 'muted' }, TIKTOK_FALLBACK[kind]),
    box);
}
const tiktokvideos = (x) => tiktokPanel(x, 'videos');
const tiktoklive = (x) => tiktokPanel(x, 'live');

/* ------------------------- Boutique Rocket League ------------------------- */
function rlshop(x) {
  const box = h('div');
  const preview = h('div');
  const note = 'Il n’existe pas d’accès officiel à la boutique Rocket League : le bot lit la page publique du site itemshop.gg, au plus une fois toutes les 10 minutes. Si le site change ou bloque le bot, une erreur claire s’affiche ici et rien n’est annoncé.';

  function renderPreview(r) {
    if (!r) { preview.replaceChildren(); return; }
    const secs = r.preview;
    preview.replaceChildren(
      h('p', { class: 'muted' }, `${r.itemCount} objets · ${r.newCount} nouveauté${r.newCount > 1 ? 's' : ''} · ${r.leavingCount} en dernier jour${r.announced ? (r.changed ? ' · différente de la dernière annonce' : ' · identique à la dernière annonce') : ''}`),
      ...secs.map((s) => h('div', { class: 'rlshop-sec' },
        h('h4', null, `${s.title} `, h('span', { class: 'muted' }, String(s.count))),
        h('div', { class: 'rlshop-grid' }, s.items.map((i) => h('figure', { class: 'rlshop-item', title: `${i.name}${i.kind ? ` · ${i.kind}` : ''}${i.price ? ` · ${i.price}` : ''}` },
          h('img', { src: i.image, alt: i.name, loading: 'lazy', referrerpolicy: 'no-referrer' }),
          h('figcaption', null, h('strong', null, i.name), h('span', null, i.price || '')))),
        s.count > s.items.length ? h('span', { class: 'muted' }, `+ ${s.count - s.items.length} autres`) : null))));
  }

  async function load() {
    let st;
    try { st = await api.get(x.url('/rlshop/status')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const cfg = x.saved();
    const configured = Boolean(cfg.channelId);
    let dot = 'warn'; let text;
    if (!configured) text = 'Choisis le salon des annonces, puis enregistre.';
    else if (st.error) text = `Dernière vérification en erreur : ${st.error}`;
    else if (!cfg.enabled) text = 'Module désactivé : les boutons ci-dessous fonctionnent quand même.';
    else if (!st.checkedAt) text = 'Pas encore vérifié : la première vérification arrive dans quelques minutes.';
    else { dot = 'on'; text = st.initialized ? 'Surveillance active : la boutique sera annoncée dès qu’elle change.' : 'Première vérification en cours.'; }
    box.replaceChildren(
      h('div', { class: 'status-line' }, h('span', { class: `status-dot ${dot}` }), text),
      st.checkedAt ? h('p', { class: 'muted' }, `Dernière vérification : ${fmtDate(st.checkedAt)}${st.announcedAt ? ` · dernière annonce : ${fmtDate(st.announcedAt)}` : ''}`) : null,
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-sm', disabled: !x.isAdmin, onclick: busy(async () => {
          const r = await api.post(x.url('/actions/rlshop-check'));
          renderPreview(r);
          toast(r.announced && r.changed ? 'La boutique a changé depuis la dernière annonce.' : 'Boutique lue.');
          load();
        }) }, icon('refresh', 14), 'Vérifier la boutique maintenant'),
        h('button', { class: 'btn btn-sm btn-primary', disabled: !x.isAdmin || !configured, onclick: busy(async () => {
          if (!(await x.saveFirst())) return;
          const r = await api.post(x.url('/actions/rlshop-send'));
          if (r.url) linkToast('Boutique envoyée.', r.url); else toast('Message envoyé.');
          load();
        }) }, icon('send', 14), 'Envoyer le message maintenant')));
  }
  load();
  return panel('État et actions',
    h('p', { class: 'muted' }, 'Le premier passage mémorise la boutique actuelle sans rien publier ; ensuite, une annonce part à chaque changement. « Envoyer le message maintenant » publie la boutique actuelle tout de suite, même si elle n’a pas changé.'),
    h('p', { class: 'muted' }, note),
    box, preview);
}

/* ----------------------------- Émojis du serveur ----------------------------- */
function emojis(x) {
  const box = h('div');
  const grid = h('div');

  async function load() {
    let r;
    try { r = await api.get(x.url('/emojis')); } catch (err) { box.replaceChildren(h('div', { class: 'banner bad' }, err.message)); return; }
    const st = r.status;
    const line = (ok, label, help) => h('li', { class: 'check-line' }, h('span', { class: `status-dot ${ok ? 'on' : 'warn'}` }), h('span', null, h('strong', null, label), ' ', h('span', { class: 'muted' }, help)));
    box.replaceChildren(h('ul', { class: 'check-list' },
      line(st.canManage, 'Permission « Gérer les expressions »', st.canManage ? 'accordée au bot.' : 'manquante : ajoute-la au rôle du bot (Paramètres du serveur > Rôles), ou réinvite le bot depuis le dashboard.'),
      line(st.search, 'Recherche d’images', st.search ? 'activée.' : 'clé BRAVE_API_KEY absente dans Railway : /emojis creer ne peut pas chercher. /emojis ajouter marche sans clé.'),
      line(st.background, 'Fond transparent de qualité', st.background ? 'activé (remove.bg).' : 'clé REMOVEBG_API_KEY absente : seuls les PNG à fond uni perdent leur fond.')),
    h('p', { class: 'muted' }, `Places utilisées : ${st.staticUsed} sur ${st.limit} émojis classiques, ${st.animatedUsed} sur ${st.limit} animés.`));
    if (!r.emojis.length) { grid.replaceChildren(h('p', { class: 'muted' }, 'Aucun émoji personnalisé pour l’instant. Utilise /emojis creer dans Discord.')); return; }
    grid.replaceChildren(h('div', { class: 'emoji-grid' }, r.emojis.map((e) => h('figure', { class: 'emoji-item' },
      h('img', { src: e.url, alt: e.name, loading: 'lazy', referrerpolicy: 'no-referrer' }),
      h('figcaption', null, `:${e.name}:`),
      h('button', { class: 'btn btn-sm btn-ghost', title: `Supprimer :${e.name}:`, 'aria-label': `Supprimer :${e.name}:`, disabled: !x.isAdmin || !st.canManage, onclick: busy(async () => {
        if (!(await confirmDialog({ title: `Supprimer :${e.name}: ?`, text: 'L’émoji disparaît du serveur, partout où il est utilisé.', confirmLabel: 'Supprimer', danger: true }))) return;
        await api.del(x.url(`/emojis/${e.id}`));
        toast('Émoji supprimé.');
        load();
      }) }, icon('trash', 14))))));
  }
  load();
  return panel('Utilisation et émojis',
    h('p', { class: 'muted' }, 'Dans Discord, tape /emojis creer et décris l’image, par exemple « logo Diamant 2 Rocket League ». Le bot propose quelques résultats, tu cliques sur le bon, et il crée l’émoji en 128 × 128 avec un fond transparent. /emojis ajouter fait la même chose avec une image jointe ou un lien. Il faut la permission « Gérer les expressions » pour utiliser ces commandes.'),
    h('p', { class: 'muted' }, 'Les images trouvées sur Internet appartiennent à leurs auteurs : utilise-les avec discernement.'),
    box, grid);
}

export const EXTRAS = { tickets, ai, protection, honeypot, verification, feeds, streams, tiktokvideos, tiktoklive, rlshop, emojis, invites, dms };
