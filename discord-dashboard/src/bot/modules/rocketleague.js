'use strict';
/**
 * Outils pour une communauté Rocket League : recherche de joueurs (/lfg avec boutons et expiration),
 * équipes aléatoires, identifiants de match privé, mode et défi au hasard.
 * Les outils sans état (équipes, match, défi) sont dans lib/rocketleague.js.
 */
const rl = require('../../lib/rocketleague');
const { hexToInt, buildMessage } = require('../../lib/template');
const { EPHEMERAL, getSendable, safeSend } = require('../util');

const PREFIX = 'lfg:';
const MAX_ACTIVE_PER_GUILD = 200;
const NOTE_MAX = 300;
const FORM_ID = 'lfgm:post';
const prefsKey = (guildId, userId) => `lfgprefs:${guildId}:${userId}`;
const cooldown = new Map(); // `${guildId}:${userId}` -> horodatage de la dernière annonce

const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'rocketleague');
const key = (guildId, messageId) => `${PREFIX}${guildId}:${messageId}`;
const save = (client, guildId, messageId, post) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key(guildId, messageId), JSON.stringify(post));
const drop = (client, guildId, messageId) => db(client).prepare('DELETE FROM kv WHERE key = ?').run(key(guildId, messageId));
const read = (client, guildId, messageId) => {
  try { return JSON.parse(db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key(guildId, messageId))?.value || 'null'); } catch { return null; }
};
function listPosts(client, guildId) {
  return db(client).prepare('SELECT key, value FROM kv WHERE key LIKE ?').all(`${PREFIX}${guildId ? `${guildId}:` : ''}%`).map((r) => {
    try {
      const [, gid, mid] = r.key.split(':');
      return { guildId: gid, messageId: mid, post: JSON.parse(r.value) };
    } catch { return null; }
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Recherche de joueurs                                                 */
/* ------------------------------------------------------------------ */
const button = (id, label, style, emoji, disabled = false) => ({ type: 2, style, custom_id: `${PREFIX}${id}`, label, emoji: { name: emoji }, ...(disabled ? { disabled: true } : {}) });

/** Rôle le plus haut du membre parmi une liste de rôles (rang, plateforme…), ou ''. */
function bestRole(member, ids) {
  const roles = (ids || []).map((id) => member?.roles?.cache?.get(id)).filter(Boolean);
  roles.sort((a, b) => (b.position || 0) - (a.position || 0));
  return roles[0]?.name || '';
}

function lfgPayload(client, guild, post, now = Date.now()) {
  const color = hexToInt(client.ctx.settings.module(guild.id, 'general').embedColor);
  const left = Math.max(0, post.places - post.joined.length);
  const state = post.closed ? 'closed' : left === 0 ? 'full' : 'open';
  const players = [`<@${post.owner}>`, ...post.joined.map((id) => `<@${id}>`)];
  const fields = [
    { name: 'Mode', value: post.modeLabel, inline: true },
    { name: 'Places', value: state === 'full' ? 'Complet' : `${left} restante${left > 1 ? 's' : ''} sur ${post.places}`, inline: true },
    { name: post.closed ? 'Fin' : 'Expire', value: `<t:${Math.floor((post.closed ? post.closedAt || now : post.expiresAt) / 1000)}:R>`, inline: true },
  ];
  if (post.rank) fields.push({ name: 'Rang', value: post.rank, inline: true });
  if (post.platform) fields.push({ name: 'Plateforme', value: post.platform, inline: true });
  if (post.age) fields.push({ name: 'Âge', value: `${post.age} ans`, inline: true });
  if (post.voiceId) fields.push({ name: 'Vocal', value: `<#${post.voiceId}>`, inline: true });
  if (post.note) fields.push({ name: 'Note', value: post.note });
  fields.push({ name: 'Joueurs', value: players.join('\n') });

  const title = { open: 'Recherche de joueurs', full: 'Groupe complet', closed: 'Recherche terminée' }[state];
  return {
    embeds: [{ title, color: state === 'closed' ? 0x4b5563 : state === 'full' ? 0x22c55e : color || undefined, fields }],
    components: state === 'closed' ? [] : [{
      type: 1,
      components: [
        button('join', 'Je rejoins', 3, '🎮', state === 'full'),
        button('leave', 'Quitter', 2, '↩️'),
        button('close', 'Fermer', 4, '✖️'),
      ],
    }],
  };
}

async function updateMessage(client, guild, post, messageId, extra = {}) {
  const channel = guild.channels.cache.get(post.channelId);
  if (!channel) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return null;
  await message.edit({ ...lfgPayload(client, guild, post), ...extra }).catch(() => {});
  return message;
}

async function closePost(client, guild, messageId, post, now = Date.now()) {
  post.closed = true;
  post.closedAt = now;
  await updateMessage(client, guild, post, messageId, { content: '' });
  drop(client, guild.id, messageId);
}

/**
 * Publie une recherche de joueurs.
 * @returns {Promise<{url: string, messageId: string}>}
 */
async function createLfg(client, guild, member, { mode, note = '', places, platform = '', rank = '', age = null, fallbackChannel = null, now = Date.now() }) {
  const cfg = cfgOf(client, guild.id);
  const m = rl.resolveMode(mode);
  if (!m) throw new Error('Indique le mode de jeu.');
  const cleanNote = rl.cleanField(note, NOTE_MAX);
  const chosenPlatform = rl.cleanField(platform, 30);
  const chosenRank = rl.cleanField(rank, 30);
  if ([cleanNote, chosenPlatform, chosenRank, m.label].some(rl.hasLink)) throw new Error('Les liens et les invitations ne sont pas autorisés dans une annonce.');
  const years = rl.parseAge(age ?? '');
  const channel = getSendable(guild, cfg.lfgChannelId) || (fallbackChannel && getSendable(guild, fallbackChannel.id));
  if (!channel) throw new Error('Je ne peux pas écrire dans le salon de recherche de joueurs : choisis-le dans le dashboard (module « Outils Rocket League »).');

  const ck = `${guild.id}:${member.id}`;
  const wait = Math.ceil((((cooldown.get(ck) || 0) + cfg.lfgCooldown * 1000) - now) / 1000);
  if (wait > 0) throw new Error(`Patiente encore ${wait} seconde(s) avant de publier une nouvelle recherche.`);

  const all = listPosts(client, guild.id);
  if (all.length >= MAX_ACTIVE_PER_GUILD) throw new Error('Trop de recherches en cours sur ce serveur. Réessaie dans quelques minutes.');
  // Une seule recherche active par joueur : la précédente est fermée
  for (const old of all.filter((p) => p.post.owner === member.id)) await closePost(client, guild, old.messageId, old.post, now);

  const slots = Math.max(1, Math.min(7, Math.trunc(Number(places)) || m.lookFor));
  const post = {
    owner: member.id,
    mode: m.id,
    modeLabel: m.label,
    places: slots,
    joined: [],
    note: cleanNote,
    // Ce que le joueur écrit passe avant ses rôles ; sans rien d'écrit, on lit ses rôles de rang et de plateforme.
    rank: chosenRank || bestRole(member, cfg.rankRoleIds),
    platform: chosenPlatform || bestRole(member, cfg.platformRoleIds),
    age: years || 0,
    voiceId: member.voice?.channelId || '',
    expiresAt: now + cfg.lfgExpireMinutes * 60000,
    channelId: channel.id,
    closed: false,
  };
  const ping = cfg.lfgPingRoleId ? `<@&${cfg.lfgPingRoleId}> ` : '';
  const sent = await channel.send({
    content: `${ping}<@${member.id}> cherche ${slots} joueur${slots > 1 ? 's' : ''} pour du **${m.label}**`,
    ...lfgPayload(client, guild, post, now),
    allowedMentions: { users: [member.id], roles: cfg.lfgPingRoleId ? [cfg.lfgPingRoleId] : [] },
  });
  if (!sent?.id) throw new Error('Discord a refusé le message (permissions manquantes ?).');
  save(client, guild.id, sent.id, post);
  if (cooldown.size > 2000) for (const [k, at] of cooldown) if (now - at > 3600000) cooldown.delete(k);
  cooldown.set(ck, now);
  return { url: sent.url, messageId: sent.id };
}


/* ------------------------------------------------------------------ */
/* Boutique d'objets Rocket League                                      */
/* ------------------------------------------------------------------ */
// Source : la page publique d'un site de suivi (rl.SHOP_URL). Aucun accès officiel n'existe ; la page est lue au plus
// une fois toutes les 10 minutes pour tous les serveurs ensemble, par respect pour le site.
const SHOP_TTL_MS = 10 * 60 * 1000;
const SHOP_FORCE_MIN_MS = 60 * 1000;
const SHOP_MAX_BYTES = 4_000_000;
const SHOP_SEND_COOLDOWN_MS = 30 * 1000;
const SHOP_UA = 'Mozilla/5.0 (compatible; MayloBot/1.0; bot Discord)';
const MAX_SHOP_CHECKS_PER_TICK = 40;
const shopKey = (guildId) => `rlshop:${guildId}`;

let shopFetchImpl = (...args) => fetch(...args);
/** Pour les tests : remplace `fetch` et vide le cache. */
function setShopFetch(fn) { shopFetchImpl = fn || ((...args) => fetch(...args)); shopCache = { at: 0, shop: null }; shopSent.clear(); }
let shopCache = { at: 0, shop: null };
let shopInflight = null;
const shopSent = new Map(); // guildId -> horodatage du dernier envoi manuel

async function downloadShop() {
  let res;
  try {
    res = await shopFetchImpl(rl.SHOP_URL, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': SHOP_UA, accept: 'text/html', 'accept-language': 'en' } });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'Le site de la boutique n’a pas répondu à temps.' : 'Connexion impossible au site de la boutique.');
  }
  if (res.status === 403 || res.status === 429) throw new Error(`Le site de la boutique a bloqué la requête (${res.status}). Réessaie plus tard.`);
  if (!res.ok) throw new Error(`Le site de la boutique a répondu ${res.status}.`);
  return rl.parseShop((await res.text()).slice(0, SHOP_MAX_BYTES));
}

/** La boutique du moment (partagée entre serveurs, mise en cache 10 minutes ; `force` = au plus une fois par minute). */
async function fetchShop({ force = false, now = Date.now() } = {}) {
  const ttl = force ? SHOP_FORCE_MIN_MS : SHOP_TTL_MS;
  if (shopCache.shop && now - shopCache.at < ttl) return shopCache.shop;
  if (!shopInflight) {
    shopInflight = downloadShop().then((shop) => { shopCache = { at: Date.now(), shop }; return shop; }).finally(() => { shopInflight = null; });
  }
  return shopInflight;
}

const readShopState = (client, guildId) => { try { return JSON.parse(db(client).prepare('SELECT value FROM kv WHERE key = ?').get(shopKey(guildId))?.value || 'null') || {}; } catch { return {}; } };
const writeShopState = (client, guildId, patch) => {
  const next = { ...readShopState(client, guildId), ...patch };
  db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(shopKey(guildId), JSON.stringify(next));
  return next;
};

function shopSummary(shop, previousKeys = []) {
  const news = rl.newItems(shop, previousKeys);
  const leaving = rl.leavingItems(shop);
  return { date: shop.date, itemCount: shop.itemCount, newCount: news.length, leavingCount: leaving.length, signature: rl.shopSignature(shop) };
}

/** Le message d'annonce : texte du module + bannière de la boutique + images des objets (par grilles de 4). */
function shopPayload(client, guild, cfg, shop, previousKeys = []) {
  const general = client.ctx.settings.module(guild.id, 'general');
  const news = rl.newItems(shop, previousKeys);
  const leaving = rl.leavingItems(shop);
  const vars = {
    server: guild.name, 'server.icon': guild.iconURL?.({ extension: 'png', size: 256 }) || '', memberCount: String(guild.memberCount || 0),
    date: rl.frDate(shop.date) || new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    count: String(shop.itemCount), newCount: String(news.length), new: rl.itemLines(news, 1400),
    leavingCount: String(leaving.length), leaving: rl.itemLines(leaving, 800), link: rl.SHOP_URL,
  };
  const payload = buildMessage(cfg.message, vars, general) || { content: `🛒 La boutique Rocket League a changé : ${rl.SHOP_URL}` };
  const color = hexToInt(general.embedColor) || undefined;
  const embeds = [...(payload.embeds || [])];
  if (cfg.showBanner && shop.banner) embeds.push({ url: `${rl.SHOP_URL}#banner`, image: { url: shop.banner }, color });
  const images = cfg.itemImages > 0 ? rl.pickImages(shop, previousKeys, Math.min(8, cfg.itemImages)) : [];
  // Des embeds qui ont la même adresse s'affichent en une seule grille d'images (4 au maximum par grille).
  images.forEach((it, i) => embeds.push({ url: `${rl.SHOP_URL}#g${Math.floor(i / 4)}`, image: { url: it.image }, color }));
  const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : '';
  return {
    ...payload,
    content: [ping, payload.content].filter(Boolean).join(' ') || undefined,
    ...(embeds.length ? { embeds } : {}),
    allowedMentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] },
  };
}

/** Publie la boutique dans le salon et la note comme « annoncée ». */
async function postShop(client, guild, cfg, shop, now = Date.now()) {
  const channel = getSendable(guild, cfg.channelId);
  if (!channel) throw new Error('Choisis le salon des annonces (je dois pouvoir y écrire) puis enregistre.');
  const state = readShopState(client, guild.id);
  const sent = await safeSend(channel, shopPayload(client, guild, cfg, shop, state.keys || []));
  if (!sent) throw new Error('Discord a refusé le message (permissions manquantes ? Il faut « Intégrer des liens »).');
  writeShopState(client, guild.id, { announcedSignature: rl.shopSignature(shop), keys: rl.shopKeys(shop), announcedAt: now, date: shop.date, error: '' });
  return { url: sent.url };
}

/** Bouton « Vérifier maintenant » : lit la boutique, sans rien publier. */
async function checkShopNow(client, guild, now = Date.now()) {
  const guildId = guild.id;
  let shop;
  try {
    shop = await fetchShop({ force: true, now });
  } catch (err) {
    writeShopState(client, guildId, { checkedAt: now, error: String(err.message).slice(0, 300) });
    throw err;
  }
  const state = writeShopState(client, guildId, { checkedAt: now, error: '', currentSignature: rl.shopSignature(shop), currentDate: shop.date });
  const summary = shopSummary(shop, state.keys || []);
  const preview = shop.sections.map((sec) => ({
    id: sec.key, title: rl.sectionTitle(sec), count: sec.items.length, derived: sec.derived,
    items: sec.items.slice(0, 12).map((i) => ({ name: i.name, image: i.image, kind: rl.frKind(i.kind), price: rl.frPrice(i.price) })),
  }));
  return { ...summary, changed: Boolean(state.announcedSignature) && state.announcedSignature !== summary.signature, announced: Boolean(state.announcedSignature), preview };
}

/** Bouton « Envoyer le message maintenant » : publie la boutique actuelle, qu'elle ait changé ou non. */
async function sendShopNow(client, guild, cfg, now = Date.now()) {
  const last = shopSent.get(guild.id) || 0;
  if (now - last < SHOP_SEND_COOLDOWN_MS) throw new Error('Patiente quelques secondes avant de renvoyer le message.');
  const shop = await fetchShop({ force: true, now });
  shopSent.set(guild.id, now);
  try {
    const r = await postShop(client, guild, cfg, shop, now);
    return { ...r, ...shopSummary(shop) };
  } catch (err) { shopSent.delete(guild.id); throw err; }
}

/** Passage automatique : annonce quand la boutique change ; le premier passage mémorise l'existant sans rien publier. */
async function checkShop(client, guild, cfg, now = Date.now()) {
  let shop;
  try {
    shop = await fetchShop({ now });
  } catch (err) {
    writeShopState(client, guild.id, { checkedAt: now, error: String(err.message).slice(0, 300) });
    throw err;
  }
  const signature = rl.shopSignature(shop);
  const state = readShopState(client, guild.id);
  writeShopState(client, guild.id, { checkedAt: now, error: '', currentSignature: signature, currentDate: shop.date });
  if (!state.announcedSignature) {
    writeShopState(client, guild.id, { announcedSignature: signature, keys: rl.shopKeys(shop), date: shop.date });
    return { posted: false, initial: true };
  }
  if (state.announcedSignature === signature) return { posted: false, initial: false };
  try {
    await postShop(client, guild, cfg, shop, now);
  } catch (err) {
    writeShopState(client, guild.id, { error: String(err.message).slice(0, 300) });
    throw err;
  }
  return { posted: true, initial: false };
}

function shopStatus(client, guildId) {
  const s = readShopState(client, guildId);
  return { checkedAt: s.checkedAt || 0, error: s.error || '', announcedAt: s.announcedAt || 0, date: s.date || '', initialized: Boolean(s.announcedSignature), pending: Boolean(s.announcedSignature && s.currentSignature && s.announcedSignature !== s.currentSignature) };
}

async function tickShop(client, now = Date.now()) {
  let budget = MAX_SHOP_CHECKS_PER_TICK;
  for (const guild of client.guilds.cache.values()) {
    if (budget <= 0) return;
    const cfg = client.ctx.settings.module(guild.id, 'rlshop');
    if (!cfg.enabled || !cfg.channelId) continue;
    const s = readShopState(client, guild.id);
    if (s.checkedAt && now - s.checkedAt < cfg.intervalMinutes * 60000) continue;
    budget -= 1;
    try { await checkShop(client, guild, cfg, now); } catch (err) { console.warn(`[boutique rocket league] ${guild.id}: ${err.message}`); }
  }
}

/* ------------------------------------------------------------------ */
/* Formulaire /lfg : le joueur écrit lui-même chaque information          */
/* ------------------------------------------------------------------ */
const readPrefs = (client, guildId, userId) => {
  try { return JSON.parse(db(client).prepare('SELECT value FROM kv WHERE key = ?').get(prefsKey(guildId, userId))?.value || '{}') || {}; } catch { return {}; }
};
const savePrefs = (client, guildId, userId, prefs) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(prefsKey(guildId, userId), JSON.stringify(prefs));

const input = (id, label, { placeholder, value = '', required = false, max = 30, paragraph = false } = {}) => ({
  type: 1,
  components: [{ type: 4, custom_id: id, label, style: paragraph ? 2 : 1, required, max_length: max, ...(placeholder ? { placeholder } : {}), ...(value ? { value: String(value).slice(0, max) } : {}) }],
});

/** Le formulaire. Plateforme, rang et âge sont pré-remplis avec la dernière annonce du joueur. */
function lfgForm(last = {}) {
  return {
    custom_id: FORM_ID,
    title: 'Recherche de coéquipiers',
    components: [
      input('mode', 'Mode de jeu', { placeholder: 'Ex. 2v2, 3v3, Rumble, Hoops, Entraînement…', required: true, max: 40 }),
      input('platform', 'Plateforme', { placeholder: 'Ex. PC, PlayStation, Xbox, Switch', required: true, value: last.platform }),
      input('rank', 'Rang', { placeholder: 'Ex. Diamant 2, Champion 1…', required: true, value: last.rank }),
      input('age', 'Âge', { placeholder: 'Ex. 18 (facultatif)', value: last.age || '', max: 3 }),
      input('note', 'Note', { placeholder: 'Ce que tu veux : ambiance, horaires, micro, objectif… (facultatif)', max: NOTE_MAX, paragraph: true }),
    ],
  };
}

/** Secondes à attendre avant de pouvoir publier une nouvelle annonce (0 = tout de suite). */
function cooldownLeft(client, guild, member, now = Date.now()) {
  const cfg = cfgOf(client, guild.id);
  return Math.max(0, Math.ceil((((cooldown.get(`${guild.id}:${member.id}`) || 0) + cfg.lfgCooldown * 1000) - now) / 1000));
}

/** Commande /lfg : ouvre le formulaire (sauf si le joueur doit encore patienter). */
async function openForm(client, interaction) {
  const wait = cooldownLeft(client, interaction.guild, interaction.member);
  if (wait > 0) return interaction.reply({ content: `Patiente encore ${wait} seconde(s) avant de publier une nouvelle recherche.`, flags: EPHEMERAL });
  return interaction.showModal(lfgForm(readPrefs(client, interaction.guild.id, interaction.user.id)));
}

async function submitForm(client, interaction) {
  const field = (name) => { try { return interaction.fields.getTextInputValue(name) || ''; } catch { return ''; } };
  await interaction.deferReply({ flags: EPHEMERAL });
  try {
    const values = { mode: field('mode'), platform: field('platform'), rank: field('rank'), age: field('age'), note: field('note') };
    const r = await createLfg(client, interaction.guild, interaction.member, { ...values, fallbackChannel: interaction.channel });
    savePrefs(client, interaction.guild.id, interaction.user.id, { platform: rl.cleanField(values.platform, 30), rank: rl.cleanField(values.rank, 30), age: rl.parseAge(values.age) || '' });
    return interaction.editReply({ content: `✅ Recherche publiée : ${r.url}` });
  } catch (err) {
    return interaction.editReply({ content: `❌ ${err.message}` });
  }
}

async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (id === FORM_ID && interaction.isModalSubmit?.() && interaction.guild) { await submitForm(client, interaction); return true; }
  if (!id.startsWith(PREFIX) || !interaction.isButton?.() || !interaction.guild) return false;
  const action = id.slice(PREFIX.length);
  const guild = interaction.guild;
  const messageId = interaction.message?.id;
  const post = messageId ? read(client, guild.id, messageId) : null;
  const say = (content) => interaction.reply({ content, flags: EPHEMERAL });
  if (!post || post.closed) {
    await say('Cette recherche est terminée.');
    return true;
  }
  const userId = interaction.user.id;
  const isOwner = userId === post.owner;

  if (action === 'close') {
    if (!isOwner && !interaction.memberPermissions?.has('ManageMessages')) { await say('Seul l’auteur de la recherche peut la fermer.'); return true; }
    await closePost(client, guild, messageId, post);
    await interaction.deferUpdate?.().catch(() => {});
    return true;
  }
  if (post.expiresAt <= Date.now()) {
    await closePost(client, guild, messageId, post);
    await say('Cette recherche a expiré.');
    return true;
  }
  if (action === 'join') {
    if (isOwner) { await say('C’est ta propre recherche : les autres joueurs vont te rejoindre.'); return true; }
    if (post.joined.includes(userId)) { await say('Tu as déjà rejoint ce groupe.'); return true; }
    if (post.joined.length >= post.places) { await say('Ce groupe est déjà complet.'); return true; }
    post.joined.push(userId);
    save(client, guild.id, messageId, post);
    await interaction.update(lfgPayload(client, guild, post));
    if (post.joined.length >= post.places) {
      const team = [post.owner, ...post.joined].map((i) => `<@${i}>`).join(' ');
      await interaction.channel?.send({ content: `✅ Groupe complet : ${team}. Bonne partie !`, allowedMentions: { users: [post.owner, ...post.joined] } }).catch(() => {});
    } else {
      await interaction.channel?.send({ content: `<@${post.owner}> : <@${userId}> a rejoint ton groupe.`, allowedMentions: { users: [post.owner] } }).catch(() => {});
    }
    return true;
  }
  if (action === 'leave') {
    if (isOwner) { await say('Utilise « Fermer » pour annuler ta recherche.'); return true; }
    if (!post.joined.includes(userId)) { await say('Tu n’es pas dans ce groupe.'); return true; }
    post.joined = post.joined.filter((i) => i !== userId);
    save(client, guild.id, messageId, post);
    await interaction.update(lfgPayload(client, guild, post));
    return true;
  }
  await say('Action inconnue.');
  return true;
}

/** Ferme les recherches expirées (message grisé, boutons retirés). */
async function tickLfg(client, now = Date.now()) {
  for (const { guildId, messageId, post } of listPosts(client)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) { drop(client, guildId, messageId); continue; }
    if (post.closed || post.expiresAt <= now) await closePost(client, guild, messageId, post, now);
  }
}

module.exports = {
  setShopFetch, fetchShop, shopPayload, postShop, checkShop, checkShopNow, sendShopNow, shopStatus, tickShop, readShopState,
  cooldown, openForm, lfgForm, cooldownLeft, readPrefs, createLfg, handleInteraction, tickLfg, lfgPayload, listPosts, bestRole, MAX_ACTIVE_PER_GUILD };
