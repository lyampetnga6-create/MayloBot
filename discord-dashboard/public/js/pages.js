/* Pages « outils » du dashboard : aperçu, classement, sanctions, tickets, envoi de message, sauvegarde, admin. */
import { api } from './api.js';
import { state, makeCtx } from './state.js';
import { renderFields, defaultValue } from './form.js';
import {
  h, toast, confirmDialog, promptDialog, who, fmtDate, fmtNumber, fmtMinutes, fmtUptime, initials,
  loading, emptyState, pager, deepClone, icon,
} from './ui.js';
import { MODULE_ICONS } from './icons.js';
import { adminLicensesCard, guildStateLabel } from './pages-account.js';

const gurl = (path = '') => `/api/guilds/${state.guildId}${path}`;

function pageHead(iconName, title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, h('span', { class: 'ico' }, icon(iconName, 20)), title), subtitle && h('p', null, subtitle)),
    actions.length ? h('div', { class: 'field-row' }, actions) : null,
  );
}

/* ---------------------------------------------------------------- */
/* Liste des serveurs                                                */
/* ---------------------------------------------------------------- */
export function guildsPage(root) {
  const { guilds } = state.me;
  root.replaceChildren(
    pageHead('grid', 'Tes serveurs', 'Choisis le serveur à configurer.',
      state.me.account ? null : h('a', { class: 'btn btn-sm', href: '/auth/login', title: 'Recharger la liste depuis Discord' }, icon('refresh', 15), 'Actualiser la liste')),
  );
  if (!guilds.length) {
    root.append(h('div', { class: 'card' }, emptyState('search', state.me.account
      ? 'Aucun serveur n’est attribué à ce compte. Demande à un administrateur de t’en donner l’accès.'
      : 'Aucun serveur trouvé. Il faut la permission « Gérer le serveur » pour apparaître ici.')));
    return;
  }
  root.append(h('div', { class: 'grid cols-3' }, guilds.map((g) => {
    const avatar = g.icon ? h('img', { class: 'guild-ico', src: g.icon, alt: '' }) : h('div', { class: 'guild-ico' }, initials(g.name));
    if (g.botPresent) {
      return h('a', { class: 'guild-card', href: `#/g/${g.id}` }, avatar,
        h('div', { class: 'meta' }, h('strong', null, g.name), h('span', null, `${fmtNumber(g.memberCount)} membres`)),
        h('span', { class: 'pill good' }, 'Configurer'));
    }
    return h('a', { class: 'guild-card off', href: g.inviteUrl, target: '_blank', rel: 'noopener' }, avatar,
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

  root.replaceChildren(pageHead('layout', o.name, 'Vue d’ensemble de ton serveur.'));

  if (o.missingPermissions.length) {
    root.append(h('div', { class: 'banner warn' }, icon('alertTriangle', 18), h('div', null,
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
    ['profile', 'idCard', 'Profil du bot', 'Pseudo, avatar et bannière sur ce serveur.'],
    ['webhooks', 'link', 'Webhooks et messages', 'Messages enregistrés sans limite.'],
    ['builder', 'package', 'Créateur de serveur', 'Rôles et salons par modèle ou par IA.'],
  ].map(([page, iconName, name, text]) => h('a', { class: 'card module-card', href: `#/g/${o.id}/${page}`, style: { color: 'inherit' } },
    h('div', { class: 'name' }, icon(iconName, 20), name), h('p', null, text)))));

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

    return h('div', { class: 'card module-card' },
      h('div', { class: 'top' }, h('div', { class: 'name' }, icon(MODULE_ICONS[mod.id] || 'circle', 20), mod.name), toggle),
      h('p', null, mod.description),
      h('div', { class: 'foot' }, hasToggle ? statusPill : h('span', { class: 'pill info' }, 'Toujours actif'),
        h('a', { class: 'btn btn-sm', href: `#/g/${o.id}/${mod.id}` }, locked ? 'Consulter' : 'Configurer', icon('chevronRight', 14))),
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

  root.replaceChildren(pageHead('trophy', 'Classement', `${fmtNumber(data.total)} membre(s) classé(s).`, data.total ? resetAll : null));
  if (!enabled) root.append(h('div', { class: 'banner info' }, icon('info', 18), h('div', null, 'Le module « Niveaux & XP » est désactivé : plus personne ne gagne d’XP. ', h('a', { href: `#/g/${state.guildId}/levels` }, 'L’activer'))));
  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('trophy', 'Personne n’a encore gagné d’XP.'))); return; }

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

  root.replaceChildren(pageHead('gavel', 'Sanctions', 'Historique des avertissements et sanctions. Les sanctions se donnent avec les commandes /warn, /timeout, /kick, /ban.'), toolbar, loading());
  const data = await api.get(gurl(`/cases?${qs}`));
  root.replaceChildren(root.children[0], toolbar);

  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('check', 'Aucun dossier.'))); return; }
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
          }, icon('trash', 16))),
        );
      })))),
    ...[pager(data, (p) => casesPage(root, { ...filters, page: p }))].filter(Boolean),
  );
}

/* ---------------------------------------------------------------- */
/* Contestations                                                     */
/* ---------------------------------------------------------------- */
const APPEAL_TYPES = { ban: 'Bannissement', kick: 'Expulsion', timeout: 'Exclusion', warn: 'Avertissement' };
const APPEAL_STATUS = { open: ['En cours', 'info'], accepted: ['Acceptée', 'good'], refused: ['Refusée', 'bad'] };
const APPEAL_FILTERS = [['', 'Toutes'], ['open', 'En cours'], ['accepted', 'Acceptées'], ['refused', 'Refusées']];

export async function appealsPage(root, filters = { status: '', page: 1 }) {
  const qs = new URLSearchParams({ page: filters.page });
  if (filters.status) qs.set('status', filters.status);
  const head = pageHead('scale', 'Contestations', 'Les demandes des membres sanctionnés. Le staff accepte ou refuse depuis le salon privé créé sur Discord.',
    h('a', { class: 'btn btn-sm', href: `#/g/${state.guildId}/appeals` }, icon('sliders', 15), 'Configurer'));
  root.replaceChildren(head, loading());
  const data = await api.get(gurl(`/appeals?${qs}`));

  const tabs = h('div', { class: 'tabs', role: 'tablist' }, APPEAL_FILTERS.map(([value, label]) => h('button', {
    class: `tab${filters.status === value ? ' active' : ''}`, role: 'tab', onclick: () => appealsPage(root, { status: value, page: 1 }),
  }, label)));
  const stat = (k, v) => h('div', { class: 'card stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, fmtNumber(v)));

  root.replaceChildren(head);
  if (!state.settings.appeals?.enabled) {
    root.append(h('div', { class: 'banner info' }, icon('info', 18), h('div', null, 'Le module « Contestations » est désactivé : les membres sanctionnés ne reçoivent pas le bouton pour contester. ',
      h('a', { href: `#/g/${state.guildId}/appeals` }, 'L’activer'))));
  }
  root.append(h('div', { class: 'stat-row' }, stat('En cours', data.stats.open), stat('Acceptées', data.stats.accepted), stat('Refusées', data.stats.refused)), tabs);

  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('scale', 'Aucune contestation pour l’instant.'))); return; }
  root.append(...data.rows.map((a) => {
    const [label, kind] = APPEAL_STATUS[a.status] || [a.status, ''];
    const open = a.channelId ? h('a', {
      class: 'btn btn-sm', href: `https://discord.com/channels/${state.guildId}/${a.channelId}`, target: '_blank', rel: 'noopener',
    }, 'Ouvrir le salon', icon('external', 14)) : null;
    return h('div', { class: 'appeal' },
      h('div', { class: 'appeal-head' }, who(a.user),
        h('span', { class: 'pill' }, APPEAL_TYPES[a.type] || a.type),
        h('span', { class: `pill ${kind}` }, label + (a.final ? ' (définitif)' : '')),
        h('span', { class: 'muted' }, fmtDate(a.createdAt)),
        h('span', { class: 'spacer' }), open),
      h('div', { class: 'appeal-body' },
        ...a.answers.map((x) => h('div', null, h('div', { class: 'appeal-q' }, x.question), h('div', { class: 'appeal-a' }, x.answer || '—'))),
        a.decidedAt ? h('div', null, h('div', { class: 'appeal-q' }, `Décision de ${a.decidedBy?.name || 'un membre du staff'} · ${fmtDate(a.decidedAt)}`),
          h('div', { class: 'appeal-a' }, a.reason || 'Aucun motif.')) : null),
    );
  }), ...[pager(data, (p) => appealsPage(root, { ...filters, page: p }))].filter(Boolean));
}

/* ---------------------------------------------------------------- */
/* Statistiques                                                      */
/* ---------------------------------------------------------------- */
const STAT_PERIODS = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours']];
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Histogramme en CSS : une colonne par jour, une ou plusieurs séries. */
function barChart(series, keys, colors) {
  const max = Math.max(1, ...series.flatMap((d) => keys.map((k) => d[k])));
  const cols = series.map((d) => h('div', { class: 'bar-col', title: `${dayLabel(d.day)} : ${keys.map((k) => `${d[k]}`).join(' / ')}` },
    h('div', { class: 'bar-stack' }, keys.map((k, i) => h('div', { class: `bar bar-${colors[i]}`, style: { height: `${Math.max(d[k] ? 3 : 0, (d[k] / max) * 100)}%` } })))));
  const first = series[0]?.day;
  const last = series[series.length - 1]?.day;
  return h('div', { class: 'chart' },
    h('div', { class: 'chart-bars', role: 'img', 'aria-label': 'Histogramme par jour' }, cols),
    h('div', { class: 'chart-axis' }, h('span', null, first ? dayLabel(first) : ''), h('span', null, `max ${fmtNumber(max)}`), h('span', null, last ? dayLabel(last) : '')));
}

export async function statsPage(root, days = 30) {
  const head = pageHead('chart', 'Statistiques', 'Arrivées, départs et messages du serveur. Seuls des compteurs sont enregistrés, jamais le contenu des messages.');
  root.replaceChildren(head, loading());
  const data = await api.get(gurl(`/stats?days=${days}`));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, STAT_PERIODS.map(([value, label]) => h('button', {
    class: `tab${days === value ? ' active' : ''}`, role: 'tab', onclick: () => statsPage(root, value),
  }, label)));
  const stat = (k, v, sign) => h('div', { class: 'card stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, `${sign && v > 0 ? '+' : ''}${fmtNumber(v)}`));

  root.replaceChildren(head);
  if (state.settings.serverstats && !state.settings.serverstats.enabled) {
    root.append(h('div', { class: 'banner info' }, icon('info', 18), h('div', null, 'Le module « Statistiques du serveur » est désactivé : plus rien n’est compté. ',
      h('a', { href: `#/g/${state.guildId}/serverstats` }, 'L’activer'))));
  }
  const empty = data.totals.joins + data.totals.leaves + data.totals.messages === 0;
  root.append(
    tabs,
    h('div', { class: 'stat-row cols-4' },
      stat('Membres', data.memberCount), stat('Arrivées', data.totals.joins), stat('Départs', data.totals.leaves), stat('Messages', data.totals.messages)),
  );
  if (empty) root.append(h('div', { class: 'card' }, emptyState('chart', 'Pas encore de données : les compteurs se remplissent à partir de l’activation du module.')));
  else {
    root.append(
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h3', null, 'Arrivées et départs'),
          h('div', { class: 'legend' }, h('span', { class: 'dot dot-accent' }), 'Arrivées', h('span', { class: 'dot dot-muted' }), 'Départs',
            h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `Solde : ${data.totals.net > 0 ? '+' : ''}${data.totals.net}`)),
          barChart(data.series, ['joins', 'leaves'], ['accent', 'muted'])),
        h('div', { class: 'card' }, h('h3', null, 'Messages par jour'),
          h('div', { class: 'legend' }, h('span', { class: 'dot dot-accent' }), `${fmtNumber(Math.round(data.totals.messages / data.days))} en moyenne par jour`),
          barChart(data.series, ['messages'], ['accent']))),
      h('div', { class: 'card' }, h('h3', null, 'Salons les plus actifs'),
        data.channels.length
          ? h('div', { class: 'rank' }, data.channels.map((c, i) => h('div', { class: 'rank-row' },
            h('span', { class: 'rank-n' }, i + 1),
            h('span', { class: 'rank-name' }, c.name ? `# ${c.name}` : 'Salon supprimé'),
            h('div', { class: 'rank-bar' }, h('div', { style: { width: `${(c.messages / data.channels[0].messages) * 100}%` } })),
            h('span', { class: 'muted rank-v' }, fmtNumber(c.messages)))))
          : h('p', { class: 'muted' }, 'Aucun message compté sur la période.')),
    );
  }
}

/* ---------------------------------------------------------------- */
/* Tickets                                                           */
/* ---------------------------------------------------------------- */
export async function ticketsPage(root) {
  root.replaceChildren(loading());
  const data = await api.get(gurl('/tickets'));
  root.replaceChildren(pageHead('inbox', 'Tickets', 'Les 100 derniers tickets. La configuration se trouve dans « Tickets » (menu de gauche).',
    h('a', { class: 'btn btn-sm', href: `#/g/${state.guildId}/tickets` }, icon('sliders', 15), 'Configurer')));
  if (!data.rows.length) { root.append(h('div', { class: 'card' }, emptyState('inbox', 'Aucun ticket pour l’instant.'))); return; }

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
      toast(h('span', null, 'Message envoyé. ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Voir sur Discord')));
    } catch (e) { toast(e.message, 'bad'); } finally { send.disabled = false; }
  } }, icon('send', 16), 'Envoyer');

  root.replaceChildren(
    pageHead('send', 'Envoyer un message', 'Publie un message ou un embed dans un salon, avec le même éditeur que partout ailleurs.'),
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
    pageHead('save', 'Sauvegarde', 'Exporte toute la configuration de ce serveur, ou importe-la sur un autre.'),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Exporter'),
        h('p', { class: 'muted' }, 'Télécharge un fichier JSON contenant tous tes réglages (sans les données de membres : XP, sanctions, tickets).'),
        h('a', { class: 'btn btn-primary', href: gurl('/export'), download: `config-${state.guildId}.json` }, icon('download', 16), 'Télécharger la configuration')),
      h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, 'Importer'),
        h('p', { class: 'muted' }, 'Charge un fichier exporté depuis ce dashboard. Les réglages sont validés avant d’être appliqués.'),
        h('button', { class: 'btn', onclick: () => file.click() }, icon('upload', 16), 'Choisir un fichier…'), file),
    ),
  );
}

/* ---------------------------------------------------------------- */
/* Administration du bot (propriétaires)                             */
/* ---------------------------------------------------------------- */
export async function adminPage(root) {
  if (!state.me.isOwner) { root.replaceChildren(h('div', { class: 'card' }, emptyState('lock', 'Réservé aux administrateurs du bot.'))); return; }
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
    pageHead('wrench', 'Administration du bot', 'Réglages globaux (tous serveurs confondus).'),
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
