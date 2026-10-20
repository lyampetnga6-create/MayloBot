'use strict';
/**
 * Panneau de contrôle des vocaux temporaires.
 *
 * Quand le bot crée un vocal, il publie dans le chat de ce vocal un message avec des boutons : verrouiller, cacher, bloquer le chat,
 * couper le micro des invités, autoriser / bloquer / expulser un membre, transférer la propriété, renommer, limite de places,
 * qualité audio, région, invitation, équipes aléatoires, identifiants de match privé, sauvegarde des réglages, fermeture, préréglages.
 *
 * L'état (verrouillé, caché…) est lu directement dans les permissions du salon : rien à synchroniser, rien à perdre au redémarrage.
 * Les composants sont écrits au format brut de l'API Discord (pas de builders) : discord.js les accepte tels quels.
 */
const { EPHEMERAL } = require('../util');
const { hexToInt } = require('../../lib/template');
const rl = require('../../lib/rocketleague');

const ROW_ID = /^tv[ums]?:/;
const BITRATES = [8000, 16000, 32000, 64000, 96000, 128000, 256000, 384000];
const REGIONS = [
  ['auto', 'Automatique (recommandé)'], ['rotterdam', 'Europe (Rotterdam)'], ['us-east', 'États-Unis Est'], ['us-central', 'États-Unis Centre'],
  ['us-south', 'États-Unis Sud'], ['us-west', 'États-Unis Ouest'], ['brazil', 'Brésil'], ['japan', 'Japon'], ['singapore', 'Singapour'],
  ['sydney', 'Sydney'], ['hongkong', 'Hong Kong'], ['india', 'Inde'], ['south-korea', 'Corée du Sud'], ['southafrica', 'Afrique du Sud'], ['russia', 'Russie'],
];
const OWNER_FLAGS = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'MoveMembers', 'MuteMembers'];
const MEMBER_FLAGS = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'ReadMessageHistory'];
const BOT_FLAGS = ['ViewChannel', 'Connect', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageChannels', 'ManageMessages'];
const RENAME_LIMIT = 2; // Discord limite à 2 renommages toutes les 10 minutes par salon
const RENAME_WINDOW = 10 * 60 * 1000;

const renames = new Map(); // channelId -> [horodatages]
const db = (client) => client.ctx.db;
const cfgOf = (client, guildId) => client.ctx.settings.module(guildId, 'tempvoice');
const kvGet = (client, key) => db(client).prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (client, key, value) => db(client).prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
const prefsKey = (guildId, userId) => `tv:prefs:${guildId}:${userId}`;

const getRow = (client, channelId) => db(client).prepare('SELECT * FROM temp_voice WHERE channel_id = ?').get(channelId) || null;
const humansIn = (channel) => [...channel.members.values()].filter((m) => !m.user?.bot);

/* ------------------------------------------------------------------ */
/* Lecture de l'état du salon                                           */
/* ------------------------------------------------------------------ */
const everyoneOverwrite = (channel) => channel.permissionOverwrites.cache.get(channel.guild.id);
const everyoneDenies = (channel, flag) => Boolean(everyoneOverwrite(channel)?.deny.has(flag));
const isMemberOverwrite = (o) => o.type === 1 || o.type === 'member';

function readState(channel, row) {
  const botId = channel.guild.members?.me?.id;
  const members = [...channel.permissionOverwrites.cache.values()].filter((o) => isMemberOverwrite(o) && o.id !== row.owner_id && o.id !== botId);
  return {
    locked: everyoneDenies(channel, 'Connect'),
    hidden: everyoneDenies(channel, 'ViewChannel'),
    chatLocked: everyoneDenies(channel, 'SendMessages'),
    quiet: everyoneDenies(channel, 'Speak'),
    limit: channel.userLimit || 0,
    bitrate: channel.bitrate || 64000,
    region: channel.rtcRegion || null,
    banned: members.filter((o) => o.deny.has('Connect')).map((o) => o.id),
    allowed: members.filter((o) => !o.deny.has('Connect') && o.allow.has('Connect')).map((o) => o.id),
  };
}

const kbps = (bitrate) => `${Math.round(bitrate / 1000)} kbps`;
const regionLabel = (r) => REGIONS.find(([id]) => id === (r || 'auto'))?.[1] || r || 'Automatique';

/* ------------------------------------------------------------------ */
/* Le panneau                                                           */
/* ------------------------------------------------------------------ */
const btn = (id, label, { style = 2, emoji } = {}) => ({ type: 2, style, custom_id: `tv:${id}`, label, ...(emoji ? { emoji: { name: emoji } } : {}) });
const actionRow = (...components) => ({ type: 1, components: components.filter(Boolean) });

function panelPayload(client, guild, channel, row) {
  const cfg = cfgOf(client, guild.id);
  const s = readState(channel, row);
  const color = hexToInt(client.ctx.settings.module(guild.id, 'general').embedColor);
  const here = humansIn(channel).length;

  const embed = {
    color: color || undefined,
    title: 'Panneau de contrôle du vocal',
    description: `Propriétaire : <@${row.owner_id}>\nLes boutons sont réservés au propriétaire et au staff. Les outils Rocket League (équipes, match privé) sont ouverts à tous ceux qui sont dans le vocal.`,
    fields: [
      {
        name: 'État',
        value: [
          s.locked ? '🔒 Verrouillé : personne ne peut entrer' : '🔓 Ouvert',
          s.hidden ? '🙈 Caché des autres membres' : '👁️ Visible',
          s.chatLocked ? '💬 Chat bloqué' : '💬 Chat ouvert',
          s.quiet ? '🔇 Micro des invités coupé' : '🎙️ Micro libre',
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Salon',
        value: [
          `👥 ${here}${s.limit ? ` / ${s.limit}` : ''} dans le vocal`,
          `🔊 ${kbps(s.bitrate)}`,
          `🌍 ${regionLabel(s.region)}`,
          `✅ ${s.allowed.length} autorisé(s) · ⛔ ${s.banned.length} bloqué(s)`,
        ].join('\n'),
        inline: true,
      },
    ],
  };

  const components = [
    actionRow(
      btn('lock', s.locked ? 'Déverrouiller' : 'Verrouiller', { emoji: s.locked ? '🔓' : '🔒', style: s.locked ? 4 : 2 }),
      btn('hide', s.hidden ? 'Afficher' : 'Cacher', { emoji: s.hidden ? '👁️' : '🙈', style: s.hidden ? 4 : 2 }),
      btn('chat', s.chatLocked ? 'Débloquer le chat' : 'Bloquer le chat', { emoji: '💬', style: s.chatLocked ? 4 : 2 }),
      btn('quiet', s.quiet ? 'Rendre la parole' : 'Couper les micros', { emoji: s.quiet ? '🎙️' : '🔇', style: s.quiet ? 4 : 2 }),
      btn('reset', 'Réinitialiser', { emoji: '♻️' }),
    ),
    actionRow(
      btn('permit', 'Autoriser', { emoji: '✅', style: 3 }),
      btn('ban', 'Bloquer', { emoji: '⛔' }),
      btn('kick', 'Expulser', { emoji: '🥾' }),
      btn('transfer', 'Transférer', { emoji: '👑' }),
      btn('claim', 'Réclamer', { emoji: '🏷️' }),
    ),
    actionRow(
      btn('rename', 'Renommer', { emoji: '✏️' }),
      btn('limit', 'Places', { emoji: '👥' }),
      btn('bitrate', 'Qualité audio', { emoji: '🔊' }),
      btn('region', 'Région', { emoji: '🌍' }),
      btn('invite', 'Invitation', { emoji: '🔗' }),
    ),
    actionRow(
      btn('teams', 'Équipes aléatoires', { emoji: '🎲', style: 1 }),
      btn('match', 'Match privé', { emoji: '🚀', style: 1 }),
      cfg.rememberSettings ? btn('save', 'Garder mes réglages', { emoji: '💾' }) : null,
      btn('close', 'Fermer le vocal', { emoji: '🗑️', style: 4 }),
    ),
  ];

  const presets = (cfg.presets || []).filter((p) => p.label).slice(0, 25);
  if (presets.length) {
    components.push(actionRow({
      type: 3,
      custom_id: 'tv:preset',
      placeholder: 'Préréglage de partie (places + nom)',
      options: presets.map((p, i) => ({ label: p.label.slice(0, 100), value: String(i), description: `${p.limit ? `${p.limit} place${p.limit > 1 ? 's' : ''}` : 'Places illimitées'}`.slice(0, 100) })),
    }));
  }
  return { embeds: [embed], components };
}

/** Met à jour le message du panneau (après une action faite dans un message éphémère, un modal ou un événement). */
async function refreshPanel(client, channel) {
  const row = getRow(client, channel.id);
  if (!row?.panel_id) return;
  const message = await channel.messages.fetch(row.panel_id).catch(() => null);
  if (message) await message.edit(panelPayload(client, channel.guild, channel, row)).catch(() => {});
}

/** Publie le panneau dans le chat du vocal et mémorise son identifiant. */
async function postPanel(client, channel, row) {
  try {
    const payload = panelPayload(client, channel.guild, channel, row);
    const message = await channel.send({ content: `Bienvenue <@${row.owner_id}> ! Ton vocal est prêt : utilise les boutons ci-dessous pour le contrôler.`, ...payload, allowedMentions: { users: [row.owner_id] } });
    if (message?.id) db(client).prepare('UPDATE temp_voice SET panel_id = ? WHERE channel_id = ?').run(message.id, channel.id);
    return message;
  } catch {
    return null; // pas de permission d'écrire dans le chat du vocal : le vocal fonctionne quand même
  }
}

/* ------------------------------------------------------------------ */
/* Droits                                                               */
/* ------------------------------------------------------------------ */
function isStaff(client, member, guildId) {
  if (!member) return false;
  if (member.permissions?.has('ManageChannels')) return true;
  const roles = cfgOf(client, guildId).adminRoleIds || [];
  return roles.some((id) => member.roles?.cache?.has(id));
}

const canControl = (client, member, row, guildId) => Boolean(member) && (member.id === row.owner_id || isStaff(client, member, guildId));

/** Permissions réellement détenues par le bot (Discord refuse d'accorder ce qu'on n'a pas soi-même). */
const held = (me, flags) => flags.filter((f) => me?.permissions?.has(f));
const asOptions = (flags, value = true) => Object.fromEntries(flags.map((f) => [f, value]));

/** Permissions du propriétaire à la création du salon (au format de `permissionOverwrites.create`). */
function ownerAllow(me, cfg) {
  return held(me, cfg.nativeControl ? [...OWNER_FLAGS, 'ManageChannels'] : OWNER_FLAGS);
}
const botAllow = (me) => held(me, BOT_FLAGS);

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */
async function grantAccess(channel, member, me) {
  await channel.permissionOverwrites.edit(member, asOptions(held(me, MEMBER_FLAGS)), { reason: 'Vocal temporaire : accès autorisé' });
}

/** Pour qu'un membre déjà présent puisse revenir si le salon est verrouillé ou caché. */
async function keepCurrentMembers(channel, row, me) {
  for (const m of humansIn(channel)) {
    if (m.id === row.owner_id) continue;
    const existing = channel.permissionOverwrites.cache.get(m.id);
    if (existing?.deny.has('Connect')) continue; // un membre bloqué reste bloqué
    await channel.permissionOverwrites.edit(m, asOptions(held(me, ['ViewChannel', 'Connect'])), { reason: 'Vocal temporaire : membre présent' }).catch(() => {});
  }
}

async function toggleEveryone(channel, row, me, flag, others = []) {
  const on = !everyoneDenies(channel, flag);
  if (on && !me.permissions.has(flag)) throw new Error(`Il me manque la permission « ${flag} » : ajoute-la au rôle du bot.`);
  if (on && (flag === 'Connect' || flag === 'ViewChannel')) await keepCurrentMembers(channel, row, me);
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { [flag]: on ? false : null, ...Object.fromEntries(others.map((o) => [o, on ? false : null])) }, { reason: 'Vocal temporaire' });
  return on;
}

async function resetChannel(client, channel, row, me, cfg) {
  const guild = channel.guild;
  await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: null, ViewChannel: null, SendMessages: null, Speak: null }, { reason: 'Vocal temporaire : réinitialisation' });
  for (const o of [...channel.permissionOverwrites.cache.values()]) {
    if (!isMemberOverwrite(o) || o.id === row.owner_id || o.id === me.id) continue;
    await channel.permissionOverwrites.delete(o.id, 'Vocal temporaire : réinitialisation').catch(() => {});
  }
  await channel.setUserLimit(cfg.defaultLimit || 0).catch(() => {});
  await channel.setRTCRegion(null).catch(() => {});
}

/** À appeler quand un vocal temporaire disparaît (libère la mémoire du compteur de renommages). */
const forgetChannel = (channelId) => { renames.delete(channelId); };

function canRename(channelId) {
  const now = Date.now();
  const list = (renames.get(channelId) || []).filter((t) => now - t < RENAME_WINDOW);
  renames.set(channelId, list);
  if (list.length >= RENAME_LIMIT) return Math.ceil((RENAME_WINDOW - (now - list[0])) / 60000);
  return 0;
}

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const looksLikeAd = (s) => /(discord\.gg|discord(app)?\.com\/invite|https?:\/\/|www\.)/i.test(s);

async function rename(channel, rawName) {
  const name = cleanName(rawName);
  if (!name) throw new Error('Le nom ne peut pas être vide.');
  if (looksLikeAd(name)) throw new Error('Les liens et les invitations ne sont pas autorisés dans un nom de salon.');
  const wait = canRename(channel.id);
  if (wait) throw new Error(`Discord limite les renommages : réessaie dans ${wait} minute(s).`);
  await channel.setName(name, 'Vocal temporaire : renommé');
  renames.get(channel.id).push(Date.now());
  return name;
}

/** Donne la propriété du vocal à `member` : met à jour la base, les permissions et le panneau. */
async function transferOwner(client, channel, member, { announce = true } = {}) {
  const row = getRow(client, channel.id);
  if (!row) return false;
  const me = channel.guild.members.me;
  const cfg = cfgOf(client, channel.guild.id);
  const oldId = row.owner_id;
  db(client).prepare('UPDATE temp_voice SET owner_id = ? WHERE channel_id = ?').run(member.id, channel.id);
  if (oldId !== member.id) await channel.permissionOverwrites.delete(oldId, 'Vocal temporaire : transfert').catch(() => {});
  await channel.permissionOverwrites.edit(member, asOptions(ownerAllow(me, cfg)), { reason: 'Vocal temporaire : nouveau propriétaire' }).catch(() => {});
  await refreshPanel(client, channel);
  if (announce) await channel.send({ content: `👑 <@${member.id}> est maintenant propriétaire de ce vocal.`, allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

function reply(interaction, content, extra = {}) {
  return interaction.reply({ content, flags: EPHEMERAL, ...extra });
}

const userSelect = (action, placeholder, max = 5) => actionRow({ type: 5, custom_id: `tvu:${action}`, placeholder, min_values: 1, max_values: max });
const stringSelect = (action, placeholder, options) => actionRow({ type: 3, custom_id: `tvs:${action}`, placeholder, options });
const textModal = (action, title, label, value, { min = 1, max = 100, placeholder } = {}) => ({
  custom_id: `tvm:${action}`,
  title,
  components: [{ type: 1, components: [{ type: 4, custom_id: 'value', label, style: 1, min_length: min, max_length: max, required: true, value: String(value ?? '').slice(0, max), ...(placeholder ? { placeholder } : {}) }] }],
});

/* ------------------------------------------------------------------ */
/* Routage des interactions                                             */
/* ------------------------------------------------------------------ */
async function handleInteraction(client, interaction) {
  const id = interaction.customId || '';
  if (!ROW_ID.test(id)) return false;
  if (!interaction.guild) return true;
  const [prefix, action] = id.split(':');
  const guild = interaction.guild;
  const channel = guild.channels.cache.get(interaction.channelId);
  const row = channel ? getRow(client, channel.id) : null;
  if (!row) {
    await reply(interaction, 'Ce vocal temporaire n’existe plus.');
    return true;
  }
  const member = interaction.member;
  const me = guild.members.me;
  const cfg = cfgOf(client, guild.id);
  const inChannel = member?.voice?.channelId === channel.id;
  const owner = canControl(client, member, row, guild.id);

  // Outils ouverts à tous ceux qui sont dans le vocal
  const open = prefix === 'tv' && ['teams', 'match', 'claim'].includes(action);
  if (!open && !owner) {
    await reply(interaction, 'Seul le propriétaire du vocal (ou le staff) peut faire ça.');
    return true;
  }
  if (open && !inChannel) {
    await reply(interaction, 'Rejoins d’abord ce vocal pour utiliser cet outil.');
    return true;
  }

  try {
    if (prefix === 'tv') await onButton(client, interaction, { guild, channel, row, me, cfg, member, action });
    else if (prefix === 'tvu') await onUserSelect(client, interaction, { guild, channel, row, me, cfg, member, action });
    else if (prefix === 'tvs') await onStringSelect(client, interaction, { guild, channel, row, me, cfg, member, action });
    else if (prefix === 'tvm') await onModal(client, interaction, { guild, channel, row, me, cfg, member, action });
  } catch (err) {
    const msg = `❌ ${err.message || 'Action impossible.'}`;
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, flags: EPHEMERAL });
      else await reply(interaction, msg);
    } catch { /* interaction expirée */ }
  }
  return true;
}

async function repaint(client, interaction, ctx) {
  const fresh = getRow(client, ctx.channel.id) || ctx.row;
  await interaction.update(panelPayload(client, ctx.guild, ctx.channel, fresh));
}

async function onButton(client, interaction, ctx) {
  const { guild, channel, row, me, cfg, member, action } = ctx;
  switch (action) {
    case 'lock': await toggleEveryone(channel, row, me, 'Connect'); return repaint(client, interaction, ctx);
    case 'hide': await toggleEveryone(channel, row, me, 'ViewChannel'); return repaint(client, interaction, ctx);
    case 'chat': await toggleEveryone(channel, row, me, 'SendMessages'); return repaint(client, interaction, ctx);
    case 'quiet': await toggleEveryone(channel, row, me, 'Speak'); return repaint(client, interaction, ctx);
    case 'reset':
      await resetChannel(client, channel, row, me, cfg);
      return repaint(client, interaction, ctx);

    case 'permit': return reply(interaction, 'Choisis les membres à autoriser (ils peuvent entrer même si le vocal est verrouillé ou caché) :', { components: [userSelect('permit', 'Membres à autoriser')] });
    case 'ban': return reply(interaction, 'Choisis les membres à bloquer (ils sont expulsés et ne peuvent plus revenir) :', { components: [userSelect('ban', 'Membres à bloquer')] });
    case 'kick': return reply(interaction, 'Choisis les membres à expulser du vocal :', { components: [userSelect('kick', 'Membres à expulser')] });
    case 'transfer': return reply(interaction, 'Choisis le nouveau propriétaire (il doit être dans le vocal) :', { components: [userSelect('transfer', 'Nouveau propriétaire', 1)] });

    case 'claim': {
      const ownerHere = channel.members.has(row.owner_id);
      if (ownerHere && member.id !== row.owner_id) return reply(interaction, 'Le propriétaire est encore dans le vocal : demande-lui de te transférer le salon.');
      if (member.id === row.owner_id) return reply(interaction, 'Tu es déjà le propriétaire.');
      await transferOwner(client, channel, member, { announce: false });
      return interaction.reply({ content: `👑 <@${member.id}> a réclamé ce vocal (le propriétaire était parti).`, allowedMentions: { parse: [] } });
    }

    case 'rename': return interaction.showModal(textModal('rename', 'Renommer le vocal', 'Nouveau nom', channel.name));
    case 'limit': return interaction.showModal(textModal('limit', 'Nombre de places', 'Places (0 = illimité, maximum 99)', channel.userLimit || 0, { max: 2 }));
    case 'bitrate': {
      const max = guild.maximumBitrate || 96000;
      const options = BITRATES.filter((b) => b <= max).map((b) => ({ label: kbps(b), value: String(b), ...(b === 64000 ? { description: 'Valeur par défaut de Discord' } : {}) }));
      return reply(interaction, 'Choisis la qualité audio (plus haut = meilleur son, un peu plus de données) :', { components: [stringSelect('bitrate', 'Qualité audio', options)] });
    }
    case 'region':
      return reply(interaction, 'Choisis la région des serveurs vocaux (utile si le son est haché pour un membre) :', { components: [stringSelect('region', 'Région vocale', REGIONS.map(([value, label]) => ({ label, value })))] });

    case 'invite': {
      const invite = await channel.createInvite({ maxAge: 3600, maxUses: 10, unique: true, reason: 'Vocal temporaire : invitation' });
      return reply(interaction, `🔗 Invitation valable 1 heure (10 utilisations) : ${invite.url}`);
    }

    case 'teams': {
      const players = humansIn(channel);
      if (players.length < 2) return reply(interaction, 'Il faut au moins 2 joueurs dans le vocal pour former des équipes.');
      const { blue, orange } = rl.splitTeams(players.map((m) => m.id));
      const list = (ids) => ids.map((i) => `<@${i}>`).join('\n') || '—';
      return interaction.reply({
        embeds: [{ title: 'Équipes tirées au sort', color: 0x5865f2, fields: [{ name: '🔵 Équipe bleue', value: list(blue), inline: true }, { name: '🟠 Équipe orange', value: list(orange), inline: true }] }],
        allowedMentions: { parse: [] },
      });
    }
    case 'match': {
      const { name, password } = rl.matchCredentials();
      return interaction.reply({
        embeds: [{ title: 'Match privé', description: 'Dans Rocket League : Jouer, Match privé, Créer un match privé, puis recopie ces informations.', color: 0x5865f2, fields: [{ name: 'Nom du match', value: `\`${name}\``, inline: true }, { name: 'Mot de passe', value: `\`${password}\``, inline: true }] }],
        allowedMentions: { parse: [] },
      });
    }

    case 'save': {
      if (!cfg.rememberSettings) return reply(interaction, 'La sauvegarde des réglages est désactivée sur ce serveur.');
      const s = readState(channel, row);
      kvSet(client, prefsKey(guild.id, row.owner_id), JSON.stringify({
        name: channel.name, limit: s.limit, bitrate: s.bitrate, region: s.region, locked: s.locked, hidden: s.hidden, chatLocked: s.chatLocked, quiet: s.quiet,
      }));
      return reply(interaction, '💾 Réglages gardés : ils seront appliqués à ton prochain vocal (nom, places, qualité, région, verrouillage…).');
    }

    case 'close': {
      await reply(interaction, 'Vocal fermé.');
      db(client).prepare('DELETE FROM temp_voice WHERE channel_id = ?').run(channel.id);
      forgetChannel(channel.id);
      await channel.delete('Vocal temporaire fermé par son propriétaire').catch(() => {});
      return undefined;
    }

    case 'preset': {
      const preset = (cfg.presets || []).filter((p) => p.label).slice(0, 25)[Number(interaction.values?.[0])];
      if (!preset) return reply(interaction, 'Ce préréglage n’existe plus.');
      if (preset.limit >= 0) await channel.setUserLimit(Math.max(0, Math.min(99, preset.limit))).catch(() => {});
      if (preset.name) {
        const { render } = require('../../lib/template');
        try { await rename(channel, render(preset.name, { 'user.name': member.displayName, count: '' })); } catch { /* limite de renommage : on garde le nom */ }
      }
      return repaint(client, interaction, ctx);
    }
    default: return reply(interaction, 'Action inconnue.');
  }
}

async function targets(guild, interaction) {
  const out = [];
  for (const id of interaction.values || []) {
    const m = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (m) out.push(m);
  }
  return out;
}

async function onUserSelect(client, interaction, ctx) {
  const { guild, channel, row, me, cfg, member, action } = ctx;
  const picked = await targets(guild, interaction);
  const lines = [];
  for (const m of picked) {
    const tag = `<@${m.id}>`;
    if (m.user.bot) { lines.push(`${tag} : c’est un bot.`); continue; }
    if (action === 'permit') {
      await grantAccess(channel, m, me);
      lines.push(`✅ ${tag} autorisé.`);
      continue;
    }
    if (m.id === member.id) { lines.push('Tu ne peux pas faire ça sur toi-même.'); continue; }
    if (m.id === row.owner_id) { lines.push(`${tag} est le propriétaire.`); continue; }
    if (isStaff(client, m, guild.id) && action !== 'transfer') { lines.push(`${tag} fait partie du staff.`); continue; }
    if (action === 'ban') {
      await channel.permissionOverwrites.edit(m, { Connect: false, ViewChannel: false }, { reason: 'Vocal temporaire : membre bloqué' });
      if (m.voice?.channelId === channel.id) await m.voice.disconnect('Bloqué du vocal temporaire').catch(() => {});
      lines.push(`⛔ ${tag} bloqué.`);
    } else if (action === 'kick') {
      if (m.voice?.channelId !== channel.id) { lines.push(`${tag} n’est pas dans le vocal.`); continue; }
      await m.voice.disconnect('Expulsé du vocal temporaire');
      lines.push(`🥾 ${tag} expulsé.`);
    } else if (action === 'transfer') {
      if (m.voice?.channelId !== channel.id) { lines.push(`${tag} doit être dans le vocal pour devenir propriétaire.`); continue; }
      await transferOwner(client, channel, m);
      lines.push(`👑 ${tag} est maintenant propriétaire.`);
    }
  }
  await interaction.update({ content: lines.join('\n') || 'Personne n’a été trouvé.', components: [], allowedMentions: { parse: [] } });
  await refreshPanel(client, channel);
}

async function onStringSelect(client, interaction, ctx) {
  const { guild, channel, action } = ctx;
  const value = interaction.values?.[0];
  if (action === 'bitrate') {
    const bitrate = Number(value);
    if (!BITRATES.includes(bitrate) || bitrate > (guild.maximumBitrate || 96000)) throw new Error('Cette qualité n’est pas disponible sur ce serveur.');
    await channel.setBitrate(bitrate, 'Vocal temporaire : qualité audio');
    await interaction.update({ content: `🔊 Qualité audio réglée sur ${kbps(bitrate)}.`, components: [] });
  } else if (action === 'region') {
    const region = REGIONS.find(([id]) => id === value);
    if (!region) throw new Error('Région inconnue.');
    await channel.setRTCRegion(value === 'auto' ? null : value, 'Vocal temporaire : région');
    await interaction.update({ content: `🌍 Région réglée sur : ${region[1]}.`, components: [] });
  }
  await refreshPanel(client, channel);
}

async function onModal(client, interaction, ctx) {
  const { channel, action } = ctx;
  const value = interaction.fields.getTextInputValue('value');
  if (action === 'rename') {
    const name = await rename(channel, value);
    await reply(interaction, `✏️ Vocal renommé : **${name}**.`);
  } else if (action === 'limit') {
    const n = Number(String(value).trim());
    if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error('Indique un nombre entier entre 0 et 99 (0 = illimité).');
    await channel.setUserLimit(n, 'Vocal temporaire : places');
    await reply(interaction, n ? `👥 Le vocal est limité à ${n} place${n > 1 ? 's' : ''}.` : '👥 Nombre de places illimité.');
  }
  await refreshPanel(client, channel);
}

/* ------------------------------------------------------------------ */
/* Réglages mémorisés                                                   */
/* ------------------------------------------------------------------ */
function readPrefs(client, guildId, userId) {
  try {
    const p = JSON.parse(kvGet(client, prefsKey(guildId, userId)) || 'null');
    return p && typeof p === 'object' ? p : null;
  } catch { return null; }
}

module.exports = {
  handleInteraction, panelPayload, postPanel, refreshPanel, transferOwner, readPrefs, readState,
  ownerAllow, botAllow, getRow, humansIn, canControl, isStaff, rename, cleanName, looksLikeAd, forgetChannel,
  BITRATES, REGIONS, RENAME_LIMIT,
};
