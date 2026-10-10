/* Pages « outils » du dashboard : aperçu, classement, sanctions, tickets, envoi de message, sauvegarde, admin. */
import { api } from './api.js';
import { state, makeCtx } from './state.js';
import { renderFields, defaultValue } from './form.js';
import {
  h, toast, confirmDialog, promptDialog, who, fmtDate, fmtNumber, fmtMinutes, fmtUptime, initials,
  loading, emptyState, pager, deepClone,
} from './ui.js';
import { adminLicensesCard, guildStateLabel } from './pages-account.js';

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;

function pageHead(icon, title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, h('span', { class: 'ico' }, icon), title), subtitle && h('p', null, subtitle)),
    actions.length ? h('div', { class: 'field-row' }, actions) : null,
  );
}

/* ---------------------------------------------------------------- */
/* Liste des serveurs                                                */
/* ---------------------------------------------------------------- */
export function guildsPage(root) {
  const { guilds } = state.me;
  root.replaceChildren(
    pageHead('🏠', 'Tes serveurs', 'Choisis le serveur à configurer.',
      h('a', { class: 'btn btn-sm', href: '/auth/login', title: 'Recharger la liste depuis Discord' }, '↻ Actualiser la liste')),
  );
  if (!guilds.length) {
    root.append(h('div', { class: 'card' }, emptyState('🔍', 'Aucun serveur trouvé. Il faut la permission « Gérer le serveur » pour apparaître ici.')));
    return;
  }
  root.append(h('div', { class: 'grid cols-3' }, guilds.map((g) => {
    const icon = g.icon ? h('img', { class: 'guild-ico', src: g.icon, alt: '' }) : h('div', { class: 'guild-ico' }, initials(g.name));
    if (g.botPresent) {
      return h('a', { class: 'guild-card', href: `#/g/${g.id}` }, icon,
        h('div', { class: 'meta' }, h('strong', null, g.name), h('span', null, `${fmtNumber(g.memberCount)} membres`)),
        h('span', { class: 'pill good' }, 'Configurer'));
    }
    return h('a', { class: 'guild-card off', href: g.inviteUrl, target: '_blank', rel: 'noopener' }, icon,
      h('div', { class: 'meta' }, h('strong', null, g.name), h('span', null, 'Le bot n’est pas encore ici')),
      h('span', { class: 'pill' }, 'Inviter'));
  })));
}

/* ---------------------------------------------------------------- */
/* Aperçu d'un serveur                                               */
/* ---------------------------------------------------------------- */
export function overviewPage(root) {
  const o = state.overview;
  const stat = (k, v, href) => h(href ? 'a' : 'div', { class: 'card stat', href, style: href ? { color: 'inherit' } : undefined }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, fmtNumber(v)));

  root.replaceChildren(pageHead('📊', o.name, 'Vue d’ensemble de ton serveur.'));

  if (o.missingPermissions.length) {
    root.append(h('div', { class: 'banner warn' }, h('span', null, '⚠️'), h('div', null,
      h('strong', null, 'Il manque des permissions au bot : '), o.missingPermissions.join(', '),
      '. Certaines fonctions ne marcheront pas tant qu’elles ne lui sont pas accordées (Paramètres du serveur → Rôles).')));
  }

  root.append(h('div', { class: 'grid cols-3' },
    stat('Membres', o.memberCount),
    stat('Salons', o.channelCount),
    stat('Rôles', o.roleCount),
    stat('Avertissements', o.stats.warns, `#/g/${o.id}/cases`),
    stat('Tickets ouverts', o.stats.openTickets, `#/g/${o.id}/tickets`),
    stat('Membres classés', o.stats.rankedMembers, `#/g/${o.id}/leaderboard`),
  ));

  root.append(h('h3', { class: 'section-title', style: { marginTop: '32px' } }, 'Raccourcis'));
  root.append(h('div', { class: 'grid cols-3' }, [
    ['profile', '🎭', 'Profil du bot', 'Pseudo, avatar et bannière sur ce serveur.'],
    ['webhooks', '🪝', 'Webhooks et messages', 'Messages enregistrés sans limite.'],
    ['builder', '🧱', 'Créateur de serveur', 'Rôles et salons par modèle ou par IA.'],
  ].map(([page, icon, name, text]) => h('a', { class: 'card module-card spot', href: `#/g/${o.id}/${page}`, style: { color: 'inherit' } },
    h('div', { class: 'name' }, h('span', null, icon), name), h('p', null, text)))));

  const enabledMap = new Map(o.modules.map((m) => [m.id, m.enabled]));
  const card = (mod) => {
    const hasToggle = Boolean(mod.toggle);
    const on = enabledMap.get(mod.id);
    const locked = mod.adminOnly && !o.isAdmin;
    const statusPill = h('span', { class: `pill ${on ? 'good' : ''}` }, on ? 'Actif' : 'Inactif');

    const toggle = hasToggle ? h('label', { class: 'switch', title: locked ? 'Réservé aux administrateurs' : on ? 'Désactiver' : 'Activer' },
      h('input', {
        type: 'checkbox', checked: Boolean(on), disabled: locked, 'aria-label': `Activer ${mod.name}`,
        onchange: async (e) => {
          const next = e.target.checked;
          try {
            const res = await api.put(gurl(`/settings/${mod.id}`), { [mod.toggle]: next });
            state.settings[mod.id] = res.settings;
            enabledMap.set(mod.id, next);
            statusPill.textContent = next ? 'Actif' : 'Inactif';
            statusPill.className = `pill ${next ? 'good' : ''}`;
            toast(`${mod.name} ${next ? 'activé' : 'désactivé'}.`);
          } catch (err) {
            e.target.checked = !next;
            toast(err.message, 'bad');
          }
        },
      }), h('span', { class: 'slider' })) : null;

    return h('div', { class: 'card module-card spot' },
      h('div', { class: 'top' }, h('div', { class: 'name' }, h('span', null, mod.icon), mod.name), toggle),
      h('p', null, mod.description),
      h('div', { class: 'foot' }, hasToggle ? statusPill : h('span', { class: 'pill info' }, 'Toujours actif'),
        h('a', { class: 'btn btn-sm', href: `#/g/${o.id}/${mod.id}` }, locked ? 'Consulter →' : 'Configurer →')),
    );
  };

  const known = new Set((state.schema.categories || []).map((c) => c.id));
  const sections = [...(state.schema.categories || []), { id: '_other', name: 'Autres' }];
  for (const cat of sections) {
    const mods = state.schema.modules.filter((m) => (cat.id === '_other' ? !known.has(m.category) : m.category === cat.id));
    if (!mods.length) continue;
    root.append(h('h3', { class: 'section-title', style: { marginTop: '32px' } }, cat.name), h('div', { class: 'grid cols-3' }, mods.map(card)));
  }
}

/* ---------------------------------------------------------------- */
/* Classement                                                        */
/* ---------------------------------------------------------------- */
export async function leaderboardPage(root, page = 1) {
  root.replaceChildren(loading());
  const data = await api.get(gurl(`/leaderboard?page=${page}`));
  const enabled = state.settings.levels.enabled;

  const reload = () => leaderboardPage(root, page);
  const resetAll = h('button', {
    class: 'btn btn-danger btn-sm',
    onclick: async () => {
      const ok = await confirmDialog({ title: 'Réinitialiser tout le classement ?', text: 'L’XP et les niveaux de TOUS les membres seront remis à zéro. Cette action est définitive.', confirmLabel: 'Tout réinitialiser', danger: true });
      if (!ok) return;
      await api.del(gurl('/levels'), { confirm: true });
      toast('Classement réinitialisé.');
      leaderboardPage(root, 1);
    },
  }, 'Réinitialiser tout');

  root.replaceChildren(pageHead('🏆', 'Classement', `${fmtNumber(data.total)} membre(s) classé(s).`, data.total ? resetAll : null));
  if (!enabled) root.append(h('div', { class: 'banner info' }, h('span', null, 'ℹ️'), h('div', null, 'Le module « Niveaux & XP » est désactivé : plus personne ne gagne d’XP. ', h('a', { href: `#/g/${state.guildId}/levels` }, 'L’activer →'))));
  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('🌱', 'Personne n’a encore gagné d’XP.'))); return; }

  const rows = data.rows.map((r) => h('tr', null,
    h('td', null, h('strong', null, `#${r.rank}`)),
    h('td', null, who(r.user)),
    h('td', null, h('span', { class: 'pill info' }, `Niveau ${r.level}`)),
    h('td', null, fmtNumber(r.xp)),
    h('td', null, fmtNumber(r.messages)),
    h('td', { class: 'ta-r' },
      h('button', {
        class: 'btn btn-sm', onclick: async () => {
          const v = await promptDialog({ title: `XP de ${r.user.name}`, label: 'Nouvelle valeur d’XP', value: String(r.xp), type: 'number' });
          if (v === null || v === '' || !Number.isFinite(Number(v))) return;
          try { await api.put(gurl(`/levels/${r.userId}`), { xp: Number(v) }); toast('XP mis à jour.'); reload(); } catch (e) { toast(e.message, 'bad'); }
        },
      }, 'Modifier XP'),
      ' ',
      h('button', {
        class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!await confirmDialog({ title: `Réinitialiser ${r.user.name} ?`, text: 'Son XP et son niveau seront remis à zéro.', confirmLabel: 'Réinitialiser', danger: true })) return;
          await api.del(gurl(`/levels/${r.userId}`));
          toast('Membre réinitialisé.');
          reload();
        },
      }, 'Reset'),
    ),
  ));
  root.append(
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Rang', 'Membre', 'Niveau', 'XP', 'Messages', ''].map((t) => h('th', null, t)))),
      h('tbody', null, rows))),
    ...[pager(data, (p) => leaderboardPage(root, p))].filter(Boolean),
  );
}

/* ---------------------------------------------------------------- */
/* Sanctions                                                         */
/* ---------------------------------------------------------------- */
const CASE_LABELS = { warn: ['Avertissement', 'warn'], timeout: ['Exclusion', 'warn'], untimeout: ['Fin d’exclusion', 'good'], kick: ['Expulsion', 'bad'], ban: ['Ban', 'bad'], unban: ['Déban', 'good'] };

export async function casesPage(root, filters = { type: '', user: '', page: 1 }) {
  const qs = new URLSearchParams({ page: filters.page });
  if (filters.type) qs.set('type', filters.type);
  if (filters.user) qs.set('user', filters.user);

  const typeSel = h('select', { class: 'input', 'aria-label': 'Type', onchange: () => casesPage(root, { ...filters, type: typeSel.value, page: 1 }) },
    h('option', { value: '' }, 'Tous les types'), Object.entries(CASE_LABELS).map(([v, [l]]) => h('option', { value: v }, l)));
  typeSel.value = filters.type;
  const userIn = h('input', {
    class: 'input', type: 'text', placeholder: 'ID d’un membre…', value: filters.user, 'aria-label': 'ID du membre',
    onkeydown: (e) => { if (e.key === 'Enter') casesPage(root, { ...filters, user: userIn.value.trim(), page: 1 }); },
  });
  const toolbar = h('div', { class: 'toolbar' }, typeSel, userIn,
    h('button', { class: 'btn btn-sm', onclick: () => casesPage(root, { ...filters, user: userIn.value.trim(), page: 1 }) }, 'Filtrer'));

  root.replaceChildren(pageHead('⚖️', 'Sanctions', 'Historique des avertissements et sanctions. Les sanctions se donnent avec les commandes /warn, /timeout, /kick, /ban.'), toolbar, loading());
  const data = await api.get(gurl(`/cases?${qs}`));
  root.replaceChildren(root.children[0], toolbar);

  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('✨', 'Aucun dossier.'))); return; }
  root.append(
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['#', 'Type', 'Membre', 'Modérateur', 'Raison', 'Date', ''].map((t) => h('th', null, t)))),
      h('tbody', null, data.rows.map((c) => {
        const [label, kind] = CASE_LABELS[c.type] || [c.type, ''];
        return h('tr', null,
          h('td', null, h('span', { class: 'mono muted' }, c.id)),
          h('td', null, h('span', { class: `pill ${kind}` }, label), c.duration ? h('span', { class: 'muted' }, ` ${fmtMinutes(c.duration)}`) : null),
          h('td', null, who(c.user)),
          h('td', null, who(c.moderator)),
          h('td', { style: { maxWidth: '280px' } }, c.reason || h('span', { class: 'muted' }, '—')),
          h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, fmtDate(c.createdAt)),
          h('td', { class: 'ta-r' }, h('button', {
            class: 'icon-btn danger', title: 'Supprimer ce dossier', onclick: async () => {
              if (!await confirmDialog({ title: `Supprimer le dossier #${c.id} ?`, text: 'Il disparaîtra de l’historique (et ne comptera plus pour l’escalade).', confirmLabel: 'Supprimer', danger: true })) return;
              await api.del(gurl(`/cases/${c.id}`));
              toast('Dossier supprimé.');
              casesPage(root, filters);
            },
          }, '🗑')),
        );
      })))),
    ...[pager(data, (p) => casesPage(root, { ...filters, page: p }))].filter(Boolean),
  );
}

/* ---------------------------------------------------------------- */
/* Tickets                                                           */
/* ---------------------------------------------------------------- */
export async function ticketsPage(root) {
  root.replaceChildren(loading());
  const data = await api.get(gurl('/tickets'));
  root.replaceChildren(pageHead('🎟️', 'Tickets', 'Les 100 derniers tickets. La configuration se trouve dans « Tickets » (menu de gauche).',
    h('a', { class: 'btn btn-sm', href: `#/g/${state.guildId}/tickets` }, '⚙️ Configurer')));
  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('📭', 'Aucun ticket pour l’instant.'))); return; }

  root.append(h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['N°', 'Statut', 'Membre', 'Sujet', 'Pris en charge', 'Ouvert le'].map((t) => h('th', null, t)))),
    h('tbody', null, data.rows.map((t) => h('tr', null,
      h('td', null, h('strong', null, `#${t.number}`)),
      h('td', null, h('span', { class: `pill ${t.status === 'open' ? 'good' : ''}` }, t.status === 'open' ? 'Ouvert' : 'Fermé')),
      h('td', null, who(t.user)),
      h('td', null, t.topic || h('span', { class: 'muted' }, '—'), t.reason ? h('div', { class: 'muted', style: { fontSize: '12px', maxWidth: '260px' } }, t.reason) : null),
      h('td', null, t.claimedBy ? who(t.claimedBy) : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'muted', style: { whiteSpace: 'nowrap' } }, fmtDate(t.createdAt)),
    ))))));
}

/* ---------------------------------------------------------------- */
/* Envoyer un message                                                */
/* ---------------------------------------------------------------- */
export function messagePage(root) {
  const draft = {
    channelId: '',
    message: defaultValue({ type: 'message', default: { embed: { enabled: true, title: 'Annonce', description: 'Écris ton message ici…' } } }),
  };
  const ctx = makeCtx();
  const channelField = { type: 'channel', key: 'channelId', label: 'Salon de destination', kinds: ['text'] };
  const messageField = { type: 'message', key: 'message', label: 'Message', variables: ['server', 'memberCount'] };

  const send = h('button', { class: 'btn btn-primary', onclick: async () => {
    if (!draft.channelId) { toast('Choisis un salon.', 'warn'); return; }
    send.disabled = true;
    try {
      const r = await api.post(gurl('/messages'), draft);
      toast(h('span', null, 'Message envoyé. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord ↗')));
    } catch (e) { toast(e.message, 'bad'); } finally { send.disabled = false; }
  } }, '📤 Envoyer');

  root.replaceChildren(
    pageHead('✉️', 'Envoyer un message', 'Publie un message ou un embed dans un salon, avec le même éditeur que partout ailleurs.'),
    h('div', { class: 'card' }, renderFields([channelField, messageField], draft, ctx, () => {}), h('div', { class: 'field-row' }, send)),
  );
}

/* ---------------------------------------------------------------- */
/* Sauvegarde                                                        */
/* ---------------------------------------------------------------- */
export function backupPage(root) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let json;
    try { json = JSON.parse(await f.text()); } catch { toast('Ce fichier n’est pas un JSON valide.', 'bad'); return; }
    const ok = await confirmDialog({
      title: 'Importer cette configuration ?',
      text: 'Les modules présents dans le fichier remplaceront ceux de ce serveur. Les salons et rôles qui n’existent pas ici seront ignorés.',
      confirmLabel: 'Importer', danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.post(gurl('/import'), json);
      state.settings = r.settings;
      toast(`Configuration importée (${r.applied.length} module(s)).`);
    } catch (e) { toast(e.message, 'bad'); }
  });

  root.replaceChildren(
    pageHead('💾', 'Sauvegarde', 'Exporte toute la configuration de ce serveur, ou importe-la sur un autre.'),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Exporter'),
        h('p', { class: 'muted' }, 'Télécharge un fichier JSON contenant tous tes réglages (sans les données de membres : XP, sanctions, tickets).'),
        h('a', { class: 'btn btn-primary', href: gurl('/export'), download: `config-${state.guildId}.json` }, '⬇ Télécharger la configuration')),
      h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Importer'),
        h('p', { class: 'muted' }, 'Charge un fichier exporté depuis ce dashboard. Les réglages sont validés avant d’être appliqués.'),
        h('button', { class: 'btn', onclick: () => file.click() }, '⬆ Choisir un fichier…'), file),
    ),
  );
}

/* ---------------------------------------------------------------- */
/* Administration du bot (propriétaires)                             */
/* ---------------------------------------------------------------- */
export async function adminPage(root) {
  if (!state.me.isOwner) { root.replaceChildren(h('div', { class: 'card' }, emptyState('🔒', 'Réservé aux propriétaires du bot (variable OWNER_IDS).'))); return; }
  root.replaceChildren(loading());
  const d = await api.get('/api/admin/overview');
  const p = deepClone(d.presence);

  const STATUS = { online: 'En ligne', idle: 'Absent', dnd: 'Ne pas déranger', invisible: 'Invisible' };
  const TYPE = { playing: 'Joue à', watching: 'Regarde', listening: 'Écoute', competing: 'Participe à', custom: 'Statut personnalisé' };
  const sel = (key, labels) => {
    const s = h('select', { class: 'input', onchange: () => { p[key] = s.value; } }, Object.entries(labels).map(([v, l]) => h('option', { value: v }, l)));
    s.value = p[key];
    return s;
  };
  const text = h('input', { class: 'input', type: 'text', maxLength: 128, value: p.text, oninput: () => { p.text = text.value; } });

  root.replaceChildren(
    pageHead('🛠️', 'Administration du bot', 'Réglages globaux (tous serveurs confondus).'),
    h('div', { class: 'grid cols-3' },
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, 'Serveurs'), h('div', { class: 'v' }, fmtNumber(d.guilds.length))),
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, 'En ligne depuis'), h('div', { class: 'v' }, fmtUptime(d.uptime))),
      h('div', { class: 'card stat' }, h('div', { class: 'k' }, 'Latence · mémoire'), h('div', { class: 'v' }, `${d.ping} ms · ${d.memory} Mo`)),
    ),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('h3', { style: { marginTop: 0 } }, 'Présence du bot'),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Statut'), sel('status', STATUS)),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Activité'), sel('type', TYPE)),
      h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Texte'), h('p', { class: 'field-help' }, 'Variables : {servers} (nombre de serveurs), {members} (nombre de membres au total).'), text),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        try { await api.put('/api/admin/presence', p); toast('Présence mise à jour.'); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Appliquer')),
    ...(d.licenseEnabled ? [await adminLicensesCard()] : []),
    h('h3', { class: 'section-title', style: { marginTop: '28px' } }, 'Serveurs'),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, (d.licenseEnabled ? ['Serveur', 'Membres', 'Abonnement', ''] : ['Serveur', 'Membres', '']).map((t) => h('th', null, t)))),
      h('tbody', null, d.guilds.map((g) => h('tr', null,
        h('td', null, h('div', { class: 'who' }, g.icon ? h('img', { src: g.icon, alt: '' }) : null, h('span', null, g.name))),
        h('td', null, fmtNumber(g.memberCount)),
        d.licenseEnabled ? h('td', null, h('span', { class: `pill ${guildStateLabel({ state: g.license }).kind}` }, { licensed: 'Licence', trial: 'Essai', expired: 'Terminé', free: 'Offert' }[g.license] || g.license)) : null,
        h('td', { class: 'ta-r' }, h('span', { class: 'mono muted' }, g.id)),
      ))))),
  );
}
