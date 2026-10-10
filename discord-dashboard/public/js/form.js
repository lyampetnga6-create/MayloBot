/**
 * Moteur de formulaires : transforme le schéma (src/schema.js, servi par /api/schema)
 * en interface. Chaque champ modifie directement l'objet « brouillon » qu'on lui donne
 * puis appelle `change()` ; la page décide quand enregistrer.
 */
import { h, deepClone, randomId } from './ui.js';

let SCHEMA = { messageFields: [], variables: {} };
export const setSchema = (s) => { SCHEMA = s; };

/* ------------------------------------------------------------------ */
/* Valeurs par défaut (miroir de schema.js)                            */
/* ------------------------------------------------------------------ */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeDeep(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (isObj(v) && isObj(base[k])) mergeDeep(base[k], v);
    else base[k] = v;
  }
  return base;
}

export function defaultValue(f) {
  switch (f.type) {
    case 'toggle': return !!f.default;
    case 'number': return f.default ?? 0;
    case 'channels': case 'roles': case 'strings': case 'list': return deepClone(f.default ?? []);
    case 'group': return defaultsFor(f.fields);
    case 'message': return mergeDeep(defaultsFor(SCHEMA.messageFields), deepClone(f.default || {}));
    case 'id': return randomId();
    case 'hidden': return '';
    default: return f.default ?? '';
  }
}

export function defaultsFor(fields) {
  const out = {};
  for (const f of fields) if (f.key) out[f.key] = defaultValue(f);
  return out;
}

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */
const KIND_ICON = { text: '#', voice: '🔊', category: '📁', forum: '💬' };

function channelOptions(f, ctx) {
  const kinds = f.kinds || ['text'];
  const all = ctx.meta.channels;
  const options = [];
  if (kinds.length === 1 && kinds[0] === 'category') {
    for (const c of all.filter((x) => x.kind === 'category')) options.push({ value: c.id, label: `📁 ${c.name}` });
    return options;
  }
  const cats = new Map(all.filter((c) => c.kind === 'category').map((c) => [c.id, c]));
  for (const c of all.filter((x) => kinds.includes(x.kind) && !x.parentId)) options.push({ value: c.id, label: `${KIND_ICON[c.kind] || '#'} ${c.name}` });
  for (const cat of cats.values()) {
    for (const c of all.filter((x) => kinds.includes(x.kind) && x.parentId === cat.id)) {
      options.push({ value: c.id, label: `${KIND_ICON[c.kind] || '#'} ${c.name}`, group: cat.name });
    }
  }
  return options;
}

const roleOptions = (ctx) => ctx.meta.roles.filter((r) => !r.managed).map((r) => ({ value: r.id, label: `@${r.name}` }));

/** <select> avec optgroups. `value` est sélectionné après insertion des options. */
function buildSelect(options, value, { placeholder, label, onPick }) {
  const sel = h('select', { class: 'input', 'aria-label': label });
  if (placeholder !== undefined) sel.append(h('option', { value: '' }, placeholder));
  const groups = new Map();
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (o.group) {
      if (!groups.has(o.group)) {
        const g = h('optgroup', { label: o.group });
        groups.set(o.group, g);
        sel.append(g);
      }
      groups.get(o.group).append(opt);
    } else sel.append(opt);
  }
  if (value && !options.some((o) => o.value === value)) sel.append(h('option', { value }, `⚠ Introuvable (${value})`));
  sel.value = value || '';
  sel.addEventListener('change', () => onPick(sel.value));
  return sel;
}

/** Sélection multiple : pastilles retirables + liste déroulante d'ajout. */
function multiPicker(options, selected, { max, onChange, label }) {
  const root = h('div', { class: 'multi' });
  const byValue = new Map(options.map((o) => [o.value, o]));
  const render = () => {
    root.replaceChildren();
    const chips = h('div', { class: 'chips' });
    selected.forEach((id, i) => {
      const o = byValue.get(id);
      chips.append(h('span', { class: 'chip' },
        o ? o.label : `⚠ Introuvable (${id})`,
        h('button', { type: 'button', 'aria-label': 'Retirer', onclick: () => { selected.splice(i, 1); render(); onChange(); } }, '×'),
      ));
    });
    if (selected.length) root.append(chips);
    if (selected.length < max) {
      const sel = buildSelect(options.filter((o) => !selected.includes(o.value)), '', {
        placeholder: selected.length ? '+ Ajouter…' : '+ Choisir…', label,
        onPick: (v) => { if (v) { selected.push(v); render(); onChange(); } },
      });
      root.append(sel);
    }
  };
  render();
  return root;
}

function tagInput(list, { max, itemMaxLength, lowercase, placeholder, onChange, label }) {
  const root = h('div', { class: 'tags' });
  const input = h('input', { type: 'text', placeholder: placeholder || 'Écris puis appuie sur Entrée', maxLength: itemMaxLength, 'aria-label': label });
  const add = (raw) => {
    for (const part of String(raw).split(/[\n,]/)) {
      let v = part.trim();
      if (lowercase) v = v.toLowerCase();
      if (v && list.length < max && !list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v.slice(0, itemMaxLength));
    }
    input.value = '';
    render();
    onChange();
  };
  const render = () => {
    root.replaceChildren();
    list.forEach((t, i) => root.append(h('span', { class: 'chip' }, t,
      h('button', { type: 'button', 'aria-label': `Retirer ${t}`, onclick: () => { list.splice(i, 1); render(); onChange(); } }, '×'))));
    root.append(input);
  };
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); render(); onChange(); }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (/[\n,]/.test(text)) { e.preventDefault(); add(text); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  render();
  root.addEventListener('click', () => input.focus());
  return root;
}

const testCond = (cond, obj) => {
  const v = obj[cond.key];
  if ('eq' in cond) return v === cond.eq;
  if ('in' in cond) return cond.in.includes(v);
  return true;
};

const wrap = (f, control) => h('div', { class: 'field' },
  h('label', { class: 'field-label' }, f.label),
  f.description && h('p', { class: 'field-help' }, f.description),
  control,
);

/* ------------------------------------------------------------------ */
/* Rendu récursif                                                      */
/* ------------------------------------------------------------------ */
export function renderFields(fields, obj, ctx, change) {
  const root = h('div', { class: 'fields' });
  const conds = [];
  const refresh = () => { for (const { el, cond } of conds) el.hidden = !testCond(cond, obj); };
  const onChange = () => { refresh(); change(); };

  for (const f of fields) {
    if (f.key && obj[f.key] === undefined) obj[f.key] = defaultValue(f);
    const el = renderField(f, obj, ctx, onChange);
    if (!el) continue;
    if (f.showIf) conds.push({ el, cond: f.showIf });
    root.append(el);
  }
  refresh();
  return root;
}

function renderField(f, obj, ctx, change) {
  const key = f.key;
  switch (f.type) {
    case 'heading':
      return h('div', null, h('h3', { class: 'section-title' }, f.label), f.description && h('p', { class: 'section-desc' }, f.description));

    case 'toggle':
      return h('div', { class: 'field field-inline' },
        h('label', { class: 'field-label' }, f.label),
        h('label', { class: 'switch' },
          h('input', { type: 'checkbox', checked: !!obj[key], 'aria-label': f.label, onchange: (e) => { obj[key] = e.target.checked; change(); } }),
          h('span', { class: 'slider' })),
      );

    case 'text':
      return wrap(f, h('input', {
        class: 'input', type: 'text', value: obj[key], maxLength: f.maxLength, placeholder: f.placeholder, 'aria-label': f.label,
        oninput: (e) => { obj[key] = e.target.value; change(); },
      }));

    case 'textarea':
      return wrap(f, h('textarea', {
        class: 'input', rows: 4, value: obj[key], maxLength: f.maxLength, placeholder: f.placeholder, 'aria-label': f.label,
        oninput: (e) => { obj[key] = e.target.value; change(); },
      }));

    case 'number': {
      const input = h('input', {
        class: 'input', type: 'number', value: obj[key], min: f.min, max: f.max, step: f.float ? '0.1' : '1', 'aria-label': f.label,
        oninput: (e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) { obj[key] = n; change(); } },
        onblur: (e) => {
          let n = e.target.valueAsNumber;
          if (!Number.isFinite(n)) n = f.default ?? 0;
          if (typeof f.min === 'number') n = Math.max(f.min, n);
          if (typeof f.max === 'number') n = Math.min(f.max, n);
          obj[key] = n; e.target.value = n; change();
        },
      });
      return wrap(f, input);
    }

    case 'color': {
      const optional = f.default === '';
      const input = h('input', { type: 'color', value: obj[key] || '#8b5cf6', 'aria-label': f.label });
      const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { obj[key] = ''; sync(); change(); } }, 'Automatique');
      const hex = h('span', { class: 'mono muted' });
      const sync = () => { hex.textContent = obj[key] || 'automatique'; clearBtn.hidden = !optional || !obj[key]; };
      input.addEventListener('input', () => { obj[key] = input.value; sync(); change(); });
      sync();
      return wrap(f, h('div', { class: 'field-row' }, input, hex, clearBtn));
    }

    case 'select':
      return wrap(f, buildSelect(f.options.map(([value, label]) => ({ value, label })), obj[key], {
        label: f.label, onPick: (v) => { obj[key] = v; change(); },
      }));

    case 'channel':
      return wrap(f, buildSelect(channelOptions(f, ctx), obj[key], { placeholder: '— Aucun —', label: f.label, onPick: (v) => { obj[key] = v; change(); } }));

    case 'channels':
      return wrap(f, multiPicker(channelOptions(f, ctx), obj[key], { max: f.max, label: f.label, onChange: change }));

    case 'role':
      return wrap(f, buildSelect(roleOptions(ctx), obj[key], { placeholder: '— Aucun —', label: f.label, onPick: (v) => { obj[key] = v; change(); } }));

    case 'roles':
      return wrap(f, multiPicker(roleOptions(ctx), obj[key], { max: f.max, label: f.label, onChange: change }));

    case 'strings':
      return wrap(f, tagInput(obj[key], { max: f.max, itemMaxLength: f.itemMaxLength, lowercase: f.lowercase, placeholder: f.placeholder, label: f.label, onChange: change }));

    case 'group':
      return renderGroup(f, obj, ctx, change);

    case 'list':
      return renderList(f, obj, ctx, change);

    case 'message':
      return renderMessageEditor(f, obj, ctx, change);

    default:
      return null; // id, hidden…
  }
}

function renderGroup(f, obj, ctx, change) {
  const data = obj[f.key];
  const toggleField = f.fields.find((x) => x.key === 'enabled' && x.type === 'toggle');
  const rest = toggleField ? f.fields.filter((x) => x !== toggleField) : f.fields;

  const body = h('div', { class: 'group-body' }, renderFields(rest, data, ctx, change));
  const sync = () => { if (toggleField) body.classList.toggle('is-off', !data.enabled); };
  const head = h('div', { class: `group-head${rest.length ? '' : ' no-body'}` }, h('span', { class: 'group-title' }, f.label));
  if (toggleField) {
    head.append(h('label', { class: 'switch', title: toggleField.label },
      h('input', { type: 'checkbox', checked: !!data.enabled, 'aria-label': `${f.label} : ${toggleField.label}`, onchange: (e) => { data.enabled = e.target.checked; sync(); change(); } }),
      h('span', { class: 'slider' })));
  }
  sync();
  return h('div', { class: 'group' }, head, rest.length ? body : null);
}

/* --------------------------------- Listes --------------------------------- */
function displayValue(sub, v, ctx) {
  if (v === undefined || v === null || v === '') return '';
  switch (sub?.type) {
    case 'role': return `@${ctx.meta.roles.find((r) => r.id === v)?.name || 'rôle supprimé'}`;
    case 'channel': return `#${ctx.meta.channels.find((c) => c.id === v)?.name || 'salon supprimé'}`;
    case 'select': return sub.options.find((o) => o[0] === v)?.[1] || String(v);
    case 'toggle': return v ? 'oui' : 'non';
    default: return String(v);
  }
}

function summarize(f, item, ctx) {
  if (!f.itemSummary) return 'Élément';
  const text = f.itemSummary.replace(/\{(\w+)\}/g, (_, k) => displayValue(f.fields.find((x) => x.key === k), item[k], ctx));
  return text.replace(/\s+/g, ' ').trim() || 'Nouvel élément';
}

const isEmpty = (v) => v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length);

function renderList(f, obj, ctx, change) {
  const items = obj[f.key];
  const opened = new WeakSet();
  const root = h('div', { class: 'field' },
    h('label', { class: 'field-label' }, f.label),
    f.description && h('p', { class: 'field-help' }, f.description));
  const list = h('div', { class: 'list' });
  root.append(list);

  const render = () => {
    list.replaceChildren();
    if (!items.length) list.append(h('div', { class: 'list-empty' }, 'Rien ici pour l’instant.'));

    items.forEach((item, i) => {
      const title = h('span', { class: 'list-item-title' });
      const warn = h('span', { class: 'pill warn', title: 'Des champs obligatoires sont vides : cet élément sera ignoré à l’enregistrement.' }, 'incomplet');
      const refreshHead = () => {
        title.textContent = summarize(f, item, ctx);
        warn.hidden = !(f.required || []).some((k) => isEmpty(item[k]));
      };

      const card = h('div', { class: `list-item${opened.has(item) ? ' open' : ''}` });
      const head = h('div', { class: 'list-item-head', onclick: (e) => {
        if (e.target.closest('button')) return;
        card.classList.toggle('open');
        if (card.classList.contains('open')) opened.add(item);
      } },
      h('span', { class: 'chev' }, '▸'), title, warn, h('span', { class: 'spacer' }));

      if (f.panelActions === 'rolepanel') {
        head.append(h('button', { class: 'btn btn-sm', type: 'button', title: 'Enregistre puis publie (ou met à jour) le message dans Discord',
          onclick: (e) => { e.stopPropagation(); ctx.actions?.publishRolePanel(item); } }, item.messageId ? '↻ Mettre à jour sur Discord' : '📤 Publier'));
      }
      head.append(
        h('button', { class: 'icon-btn', type: 'button', title: 'Monter', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); change(); } }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Descendre', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); change(); } }, '↓'),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Supprimer', onclick: () => { items.splice(i, 1); render(); change(); } }, '✕'),
      );

      const body = h('div', { class: 'list-item-body' }, renderFields(f.fields, item, ctx, () => { refreshHead(); change(); }));
      refreshHead();
      card.append(head, body);
      list.append(card);
    });

    const max = f.max ?? 25;
    list.append(h('button', {
      class: 'btn btn-sm list-add', type: 'button', disabled: items.length >= max,
      title: items.length >= max ? `Maximum : ${max}` : '',
      onclick: () => {
        const item = defaultsFor(f.fields);
        items.push(item);
        opened.add(item);
        render();
        change();
      },
    }, `＋ ${f.addLabel || 'Ajouter'}`, h('span', { class: 'muted' }, ` (${items.length}/${max})`)));
  };
  render();
  return root;
}

/* ------------------------- Éditeur de message ------------------------- */
function renderMessageEditor(f, obj, ctx, change) {
  const m = obj[f.key];
  const contentField = SCHEMA.messageFields.find((x) => x.key === 'content');
  const embedField = SCHEMA.messageFields.find((x) => x.key === 'embed');
  const enabledField = embedField.fields.find((x) => x.key === 'enabled');
  const embedRest = embedField.fields.filter((x) => x.key !== 'enabled');

  const previewBox = h('div');
  const update = () => { previewBox.replaceChildren(renderPreview(m, ctx)); };
  const onChange = () => { update(); change(); };

  let lastFocus = null;
  const form = h('div', { class: 'msg-form' });
  form.addEventListener('focusin', (e) => { if (e.target.matches('input[type=text], textarea')) lastFocus = e.target; });

  form.append(renderFields([contentField], m, ctx, onChange));

  const vars = (f.variables || []).filter((v) => SCHEMA.variables[v]);
  if (vars.length) {
    form.append(h('div', { class: 'msg-vars' }, h('span', { class: 'lbl' }, 'Variables :'),
      vars.map((v) => h('button', {
        class: 'var-chip', type: 'button', title: SCHEMA.variables[v],
        onclick: () => {
          const target = lastFocus && form.contains(lastFocus) ? lastFocus : form.querySelector('textarea');
          if (!target) return;
          const s = target.selectionStart ?? target.value.length;
          const e = target.selectionEnd ?? s;
          target.setRangeText(`{${v}}`, s, e, 'end');
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.focus();
        },
      }, `{${v}}`))));
  }

  const embedBox = h('div', { class: 'msg-embed-box', hidden: !m.embed.enabled }, renderFields(embedRest, m.embed, ctx, onChange));
  form.append(renderFields([enabledField], m.embed, ctx, () => { embedBox.hidden = !m.embed.enabled; onChange(); }), embedBox);

  update();
  return h('div', { class: 'field' },
    h('label', { class: 'field-label' }, f.label),
    h('div', { class: 'msg-editor' }, form,
      h('div', { class: 'msg-preview-wrap' }, h('div', { class: 'msg-preview-label' }, 'Aperçu'), previewBox)),
  );
}

/* ------------------------------- Aperçu ------------------------------- */
const TOKEN = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|(?<![\w])_[^_\n]+?_(?![\w])|~~[^~\n]+?~~|`[^`\n]+?`|<@&\d+>|<@!?\d+>|<#\d+>|https?:\/\/[^\s<]+)/g;

function inline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(h('strong', null, inline(t.slice(2, -2))));
    else if (t.startsWith('__')) out.push(h('u', null, inline(t.slice(2, -2))));
    else if (t.startsWith('~~')) out.push(h('s', null, inline(t.slice(2, -2))));
    else if (t.startsWith('*') || t.startsWith('_')) out.push(h('em', null, inline(t.slice(1, -1))));
    else if (t.startsWith('`')) out.push(h('code', null, t.slice(1, -1)));
    else if (t.startsWith('<@&')) out.push(h('span', { class: 'dc-mention' }, '@Rôle'));
    else if (t.startsWith('<@')) out.push(h('span', { class: 'dc-mention' }, '@Utilisateur'));
    else if (t.startsWith('<#')) out.push(h('span', { class: 'dc-mention' }, '#général'));
    else out.push(h('a', { href: t, target: '_blank', rel: 'noopener noreferrer', style: { color: '#00a8fc' } }, t));
    last = m.index + t.length;
  }
  out.push(text.slice(last));
  return out.filter((x) => x !== '');
}

function sampleVars(ctx) {
  return {
    user: '<@1>', 'user.name': 'Utilisateur', 'user.id': '123456789012345678', 'user.avatar': ctx.me?.user?.avatar || '',
    'user.created': 'il y a 3 ans', server: ctx.meta.guildName, 'server.icon': ctx.meta.guildIcon || '',
    memberCount: String(ctx.meta.memberCount), level: '5', xp: '1 250', number: '0042', topic: 'Support',
    reason: 'J’ai besoin d’aide', channel: '<#1>',
    count: '42', seconds: '30', staff: '<@2>', prize: 'Nitro 1 mois', winners: '<@1>', host: '<@2>', id: '17',
    content: 'Un message d’exemple', stars: '5', link: 'https://discord.com/channels/…', age: '24',
    rating: '5/5', coins: '250', boosts: String(ctx.meta.boosts ?? 3),
  };
}

const safeUrl = (u) => (/^https:\/\//i.test(u) ? u : '');

export function renderPreview(m, ctx) {
  const S = sampleVars(ctx);
  const sub = (s) => (s || '').replace(/\{([\w.]+)\}/g, (w, k) => (k in S ? S[k] : w));
  const general = ctx.getGeneral?.() || {};

  const main = h('div', { class: 'dc-main' },
    h('div', null, h('span', { class: 'dc-name' }, ctx.meta.bot.name), h('span', { class: 'dc-tag' }, 'APP'), h('span', { class: 'dc-time' }, 'Aujourd’hui à 12:00')),
    h('div', { class: 'dc-content' }, inline(sub(m.content))),
  );

  const e = m.embed;
  if (e?.enabled) {
    const title = sub(e.title);
    const desc = sub(e.description);
    const author = sub(e.author);
    const thumb = safeUrl(sub(e.thumbnail));
    const image = safeUrl(sub(e.image));
    const footer = sub(e.footer) || general.footerText || '';
    if (title || desc || author || thumb || image) {
      main.append(h('div', { class: 'dc-embed', style: { borderLeftColor: e.color || general.embedColor || '#8b5cf6' } },
        author && h('div', { class: 'dc-embed-author' }, author),
        h('div', { class: 'dc-embed-grid' },
          h('div', null,
            title && h('div', { class: 'dc-embed-title' }, inline(title)),
            desc && h('div', { class: 'dc-embed-desc' }, inline(desc))),
          thumb && h('img', { class: 'dc-embed-thumb', src: thumb, alt: '' })),
        image && h('img', { class: 'dc-embed-image', src: image, alt: '' }),
        (footer || e.timestamp) && h('div', { class: 'dc-embed-footer' }, [footer, e.timestamp ? 'Aujourd’hui à 12:00' : ''].filter(Boolean).join(' • ')),
      ));
    }
  }
  if (!m.content?.trim() && !(e?.enabled && (e.title || e.description))) {
    main.append(h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Message vide : rien ne sera envoyé.'));
  }

  return h('div', { class: 'dc' }, h('div', { class: 'dc-row' }, h('div', { class: 'dc-avatar', style: { backgroundImage: `url("${ctx.meta.bot.avatar}")` } }), main));
}
