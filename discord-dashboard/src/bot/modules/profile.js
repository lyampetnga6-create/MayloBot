'use strict';
/**
 * Profil du bot propre à UN serveur : pseudo, photo de profil, bannière et bio.
 * Utilise PATCH /guilds/{id}/members/@me : seul ce serveur est modifié, le profil global du bot reste intact.
 */
const { Routes } = require('discord.js');

class ProfileError extends Error {}

const MAX_BYTES = 8 * 1024 * 1024;
const DATA_URI = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Vérifie qu'une image en data-URI est bien une image du bon format et pas trop lourde. */
function checkImage(dataUri, label) {
  const m = DATA_URI.exec(String(dataUri || ''));
  if (!m) throw new ProfileError(`${label} : format non pris en charge (PNG, JPG, GIF ou WebP).`);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw new ProfileError(`${label} : fichier trop lourd (8 Mo maximum).`);
  const head = buf.subarray(0, 12);
  const ok = {
    png: head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47,
    jpeg: head[0] === 0xff && head[1] === 0xd8,
    gif: head.subarray(0, 3).toString('latin1') === 'GIF',
    webp: head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP',
  }[m[1]];
  if (!ok) throw new ProfileError(`${label} : le fichier ne correspond pas à son format.`);
  return dataUri;
}

const cdn = (kind, guildId, hash) => (hash
  ? `https://cdn.discordapp.com/guilds/${guildId}/users/@me/${kind}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=256`
  : null);

/** Profil actuellement visible sur ce serveur. */
async function getProfile(client, guild) {
  const me = await client.rest.get(Routes.guildMember(guild.id, client.user.id));
  // Pour l'URL CDN des images propres au serveur, l'identifiant du bot est requis.
  const id = client.user.id;
  const asset = (kind, hash) => (hash
    ? `https://cdn.discordapp.com/guilds/${guild.id}/users/${id}/${kind}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=256`
    : null);
  return {
    nickname: me.nick || '',
    bio: me.bio || '',
    avatar: asset('avatars', me.avatar),
    banner: asset('banners', me.banner),
    defaultAvatar: client.user.displayAvatarURL({ size: 256, extension: 'png' }),
    globalName: client.user.username,
  };
}

/**
 * Applique des modifications. Seuls les champs présents sont touchés.
 * @param {object} changes { nickname?, bio?, avatar? (data-URI ou null = retirer), banner? }
 */
async function updateProfile(client, guild, changes) {
  const body = {};
  if (changes.nickname !== undefined) {
    const nick = String(changes.nickname || '').trim();
    if (nick.length > 32) throw new ProfileError('Le pseudo fait 32 caractères maximum.');
    body.nick = nick || null;
  }
  if (changes.bio !== undefined) {
    const bio = String(changes.bio || '').trim();
    if (bio.length > 190) throw new ProfileError('La bio fait 190 caractères maximum.');
    body.bio = bio || null;
  }
  if (changes.avatar !== undefined) body.avatar = changes.avatar === null ? null : checkImage(changes.avatar, 'Photo de profil');
  if (changes.banner !== undefined) body.banner = changes.banner === null ? null : checkImage(changes.banner, 'Bannière');
  if (!Object.keys(body).length) throw new ProfileError('Rien à modifier.');

  try {
    await client.rest.patch(Routes.guildMember(guild.id, '@me'), { body, reason: 'Profil du bot modifié depuis le dashboard' });
  } catch (err) {
    const code = err?.code ?? err?.rawError?.code;
    if (code === 50013) throw new ProfileError('Il me manque la permission « Changer le pseudo » pour modifier mon profil ici.');
    if (code === 50035) throw new ProfileError(`Discord a refusé ces valeurs : ${err.message}`);
    if (err?.status === 429) throw new ProfileError('Trop de modifications d’avatar d’affilée : Discord limite ce changement. Réessaie dans quelques minutes.');
    throw new ProfileError(`Discord a refusé la modification : ${err.message}`);
  }
  return getProfile(client, guild);
}

module.exports = { ProfileError, checkImage, getProfile, updateProfile, cdn };
