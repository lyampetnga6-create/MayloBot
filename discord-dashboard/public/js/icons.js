/**
 * Icônes du dashboard : petits SVG au trait (24 × 24), construits en DOM sans innerHTML.
 * icon('shield') → <svg class="i">…</svg>. Une icône inconnue renvoie un cercle discret.
 *
 * Un élément = un tracé (chaîne), ou ['c', cx, cy, r] / ['r', x, y, w, h, rx] pour un cercle / rectangle.
 */
const SHIELD = 'M12 3 4.5 6v5.5c0 4.5 3 8.2 7.5 9.5 4.5-1.3 7.5-5 7.5-9.5V6z';

const PATHS = {
  /* navigation */
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
  grid: [['r', 3, 3, 7, 7, 1.5], ['r', 14, 3, 7, 7, 1.5], ['r', 3, 14, 7, 7, 1.5], ['r', 14, 14, 7, 7, 1.5]],
  layout: [['r', 3, 3, 7, 9, 1.5], ['r', 14, 3, 7, 5, 1.5], ['r', 14, 12, 7, 9, 1.5], ['r', 3, 16, 7, 5, 1.5]],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 6 6 6-6 6'],
  arrowLeft: ['M19 12H5', 'm12 19-7-7 7-7'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  arrowUp: ['M12 19V5', 'm5 12 7-7 7 7'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  dots: [['c', 12, 5, 1], ['c', 12, 12, 1], ['c', 12, 19, 1]],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  search: [['c', 11, 11, 7], 'm20 20-3.5-3.5'],
  lock: [['r', 4, 11, 16, 10, 2], 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: [['r', 4, 11, 16, 10, 2], 'M8 11V7a4 4 0 0 1 7.5-2'],
  book: ['M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20'],
  lifebuoy: [['c', 12, 12, 9], ['c', 12, 12, 4], 'm5.6 5.6 3.2 3.2', 'm15.2 15.2 3.2 3.2', 'm18.4 5.6-3.2 3.2', 'm8.8 15.2-3.2 3.2'],
  creditCard: [['r', 2, 5, 20, 14, 2], 'M2 10h20', 'M6 15h4'],
  wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.6-.6-.6-2.6z'],
  radio: [['c', 12, 12, 2], 'M16.2 7.8a6 6 0 0 1 0 8.4', 'M7.8 16.2a6 6 0 0 1 0-8.4', 'M19 5a10 10 0 0 1 0 14', 'M5 19a10 10 0 0 1 0-14'],
  paperclip: ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  rss: ['M4 11a9 9 0 0 1 9 9', 'M4 4a16 16 0 0 1 16 16', ['c', 5, 19, 1]],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  key: [['c', 8, 15, 4], 'm11 12 9-9', 'm17 6 3 3', 'm14 9 2 2'],

  /* actions */
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'm6 7 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13', 'M9 7V4h6v3'],
  pencil: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'm14 6 4 4'],
  copy: [['r', 9, 9, 12, 12, 2], 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  refresh: ['M20 11a8 8 0 0 0-14.5-3.5L3 10', 'M3 4v6h6', 'M4 13a8 8 0 0 0 14.5 3.5L21 14', 'M21 20v-6h-6'],
  save: ['M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8 3v5h8', 'M8 21v-7h8v7'],
  download: ['M12 4v12', 'm7 11 5 5 5-5', 'M4 20h16'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M4 20h16'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  eye: ['M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z', ['c', 12, 12, 3]],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-3.1 3.9', 'M6.6 6.7A16 16 0 0 0 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.2-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  flask: ['M9 3h6', 'M10 3v6l-5.5 10a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3', 'M7.5 15h9'],
  rocket: ['M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2', 'm9 15-3-3a22 22 0 0 1 5-8c3-2 7-1.5 9-1.5 0 2 .5 6-1.5 9a22 22 0 0 1-8 5z', ['c', 15, 9, 1.5]],
  siren: ['M7 18v-6a5 5 0 0 1 10 0v6', 'M5 21h14', 'M12 3v1.5', 'M3.5 7 5 8', 'M20.5 7 19 8'],
  pin: ['M12 17v5', 'M9 3h6l-1 6 3 3v2H7v-2l3-3z'],

  /* états */
  info: [['c', 12, 12, 9], 'M12 11v5', 'M12 7.5v.01'],
  alertTriangle: ['M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17v.01'],
  alertCircle: [['c', 12, 12, 9], 'M12 7.5v5', 'M12 16v.01'],
  checkCircle: [['c', 12, 12, 9], 'm8 12.5 3 3 5-6'],
  clock: [['c', 12, 12, 9], 'M12 7v5l3 2'],
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  inbox: ['m3 13 3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M3 13h5l1 3h6l1-3h5'],
  mail: [['r', 3, 5, 18, 14, 2], 'm3 7 9 6 9-6'],
  folder: ['M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  package: ['M12 3 3 7.5v9L12 21l9-4.5v-9z', 'm3 7.5 9 4.5 9-4.5', 'M12 12v9'],
  circle: [['c', 12, 12, 3]],

  /* membres */
  user: [['c', 12, 8, 4], 'M4 21a8 8 0 0 1 16 0'],
  users: [['c', 9, 8, 3.5], 'M2.5 20a6.5 6.5 0 0 1 13 0', ['c', 17, 9, 2.5], 'M18 14a5 5 0 0 1 3.5 5'],
  userPlus: [['c', 9, 8, 4], 'M2 21a7 7 0 0 1 14 0', 'M19 8v6', 'M16 11h6'],
  userCheck: [['c', 9, 8, 4], 'M2 21a7 7 0 0 1 14 0', 'm16 11 2 2 4-4'],
  idCard: [['r', 3, 4, 18, 16, 2], ['c', 9, 11, 2.5], 'M5.5 17a4 4 0 0 1 7 0', 'M15 9h3', 'M15 13h3'],
  bot: [['r', 4, 8, 16, 12, 3], 'M12 8V5', ['c', 12, 4, 1], 'M8.5 13.5v.01', 'M15.5 13.5v.01', 'M9.5 17h5'],

  /* modules */
  sliders: ['M4 6h4', 'M12 6h8', 'M4 12h10', 'M18 12h2', 'M4 18h2', 'M10 18h10', ['c', 10, 6, 2], ['c', 16, 12, 2], ['c', 8, 18, 2]],
  tag: ['M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', ['c', 7.5, 7.5, 1]],
  shield: [SHIELD],
  shieldCheck: [SHIELD, 'm9 12 2 2 4-4'],
  shieldAlert: [SHIELD, 'M12 8.5v4', 'M12 15.5v.01'],
  gavel: ['m13 4 7 7-3 3-7-7z', 'm10.5 12.5-6 6', 'M3.5 21h9'],
  chart: ['M5 20v-6', 'M12 20V5', 'M19 20V10', 'M3 20h18'],
  ticket: ['M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z', 'M13 5v2', 'M13 11v2', 'M13 17v2'],
  circleDot: [['c', 12, 12, 9], ['c', 12, 12, 3]],
  message: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
  scroll: ['M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4', 'M19 17V5a2 2 0 0 0-2-2H4', 'M15 8h-5', 'M15 12h-5'],
  sparkles: ['M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
  target: [['c', 12, 12, 9], ['c', 12, 12, 5], ['c', 12, 12, 1]],
  lightbulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  trophy: ['M8 4h8v6a4 4 0 0 1-8 0z', 'M8 6H5a1 1 0 0 0-1 1 4 4 0 0 0 4 4', 'M16 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4', 'M12 14v4', 'M8 21h8', 'M10 18h4'],
  scale: ['M12 3v18', 'M7 21h10', 'M5 7h14', 'm5 7-3 7a3.5 3.5 0 0 0 6 0z', 'm19 7-3 7a3.5 3.5 0 0 0 6 0z'],
  gift: [['r', 3, 8, 18, 4, 1], 'M12 8v13', 'M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8', 'M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5'],
  star: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'],
  hash: ['M5 9h15', 'M4 15h15', 'M10 3 8 21', 'M16 3l-2 18'],
  cake: ['M4 21h16', 'M5 21v-7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v7', 'M5 17c2 0 2-1.5 3.5-1.5S11 17 12 17s2-1.5 3.5-1.5S17 17 19 17', 'M12 13V9', 'M12 4c1 1.2 1 2.2 0 3-1-.8-1-1.8 0-3z'],
  thumbsUp: ['M7 10v11H3V10z', 'm7 10 4-7a2 2 0 0 1 2 2v4h6.3a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7'],
  megaphone: ['M3 11v3a1 1 0 0 0 1 1h3l8 4V6L7 10H4a1 1 0 0 0-1 1z', 'M18.5 9a4 4 0 0 1 0 6'],
  gem: ['M6 4h12l4 5-10 12L2 9z', 'M2 9h20', 'm9 4-2 5 5 12', 'm15 4 2 5-5 12'],
  coins: [['c', 12, 12, 9], 'M14.5 9.2A3 3 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 1.6 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-2.5-1.2', 'M12 6v2', 'M12 16v2'],
  gamepad: ['M6 11h4', 'M8 9v4', 'M15 12h.01', 'M18 10h.01', 'M17.3 5H6.7a4 4 0 0 0-3.9 3.2l-1.5 7A2.5 2.5 0 0 0 5.7 17.5L8 15h8l2.3 2.5a2.5 2.5 0 0 0 4.4-2.3l-1.5-7A4 4 0 0 0 17.3 5z'],
  volume: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 6a9 9 0 0 1 0 12'],
  mic: ['M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  ruler: [['r', 2, 8, 20, 8, 1.5], 'M6 8v3', 'M10 8v4', 'M14 8v3', 'M18 8v4'],
  alarm: [['c', 12, 13, 8], 'M12 9v4l2.5 2', 'M5 3 2 6', 'm22 6-3-3'],
  type: ['M4 7V5h16v2', 'M12 5v14', 'M9 19h6'],
};

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** icon('shield') → <svg class="i"> ; size en pixels (18 par défaut). */
export function icon(name, size = 18) {
  const svg = svgEl('svg', {
    class: `i i-${name}`, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  });
  for (const part of PATHS[name] || PATHS.circle) {
    if (typeof part === 'string') svg.append(svgEl('path', { d: part }));
    else if (part[0] === 'c') svg.append(svgEl('circle', { cx: part[1], cy: part[2], r: part[3] }));
    else svg.append(svgEl('rect', { x: part[1], y: part[2], width: part[3], height: part[4], rx: part[5] || 0 }));
  }
  return svg;
}

export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(PATHS, name);
export const ICON_NAMES = Object.keys(PATHS);

/** Icône de chaque module (clé = identifiant du module dans le schéma). */
export const MODULE_ICONS = {
  general: 'sliders', welcome: 'userPlus', autorole: 'tag',
  automod: 'shield', moderation: 'gavel', protection: 'shieldAlert', honeypot: 'target', verification: 'userCheck', logs: 'scroll',
  tickets: 'ticket', suggestions: 'lightbulb', appeals: 'scale',
  levels: 'chart', giveaways: 'gift', starboard: 'star', counting: 'hash', birthdays: 'cake', reputation: 'thumbsUp',
  confessions: 'eyeOff', bump: 'megaphone', boosts: 'gem',
  economy: 'coins', fun: 'gamepad', ai: 'sparkles',
  rolepanels: 'circleDot', commands: 'message', tempvoice: 'volume', counters: 'activity', channelrules: 'ruler',
  dms: 'mail', feeds: 'rss', streams: 'radio', invites: 'link', serverstats: 'chart', automessages: 'alarm', sticky: 'pin', nickname: 'type',
};
