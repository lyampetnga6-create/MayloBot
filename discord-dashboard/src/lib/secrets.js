'use strict';
const crypto = require('node:crypto');

/**
 * Chiffrement des secrets stockés en base (clés d'API IA, jetons de webhooks).
 * AES-256-GCM, clé dérivée de SESSION_SECRET : si ce secret change, les valeurs deviennent illisibles
 * (on les traite alors comme absentes plutôt que de planter).
 */
const keyCache = new Map();
function keyFor(secret) {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.scryptSync(secret, 'bot-dashboard-secrets-v1', 32);
    keyCache.set(secret, k);
  }
  return k;
}

function encrypt(plain, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

function decrypt(blob, secret) {
  try {
    const [v, iv, tag, data] = String(blob).split('.');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
