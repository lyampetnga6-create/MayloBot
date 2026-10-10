'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Guild } = require('discord.js');

const { openDatabase } = require('../src/db');
const {
  LicenseService, LicenseError, generateKey, normalizeKey, verifyStripeSignature, KEY_RE, DAY, GRACE_ACTIVE, GRACE_PAST_DUE,
} = require('../src/lib/license');
const { gatedClient, isAllowed, guildOfArgs } = require('../src/bot/events');

const U = '200000000000000002';
const G1 = '100000000000000001';
const G2 = '100000000000000002';
const SECRET = 'x'.repeat(40);

function make(over = {}) {
  let clock = 1_800_000_000_000;
  const calls = [];
  const cfg = {
    sessionSecret: SECRET, baseUrl: 'https://bot.example', ownerIds: ['900000000000000009'],
    license: {
      enabled: true, trialDays: 7, priceLabel: '9,99 €/mois', freeGuildIds: [], stripeSecretKey: 'sk_test', stripePriceId: 'price_1', stripeWebhookSecret: 'whsec_test', ...over,
    },
  };
  const svc = new LicenseService({
    db: openDatabase(':memory:'), config: cfg, now: () => clock,
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ url: 'https://stripe.test/x', id: 'cs_1' }) }; },
  });
  return { svc, calls, advance: (ms) => { clock += ms; svc.invalidate(); }, now: () => clock, cfg };
}

test('clés : format, unicité et saisie tolérante', () => {
  const keys = new Set(Array.from({ length: 500 }, generateKey));
  assert.equal(keys.size, 500);
  for (const k of keys) assert.match(k, KEY_RE);
  const k = 'KEY-7QX2-M4PD-9RTW-HJ3N';
  assert.equal(normalizeKey(k), k);
  assert.equal(normalizeKey('  key 7qx2 m4pd 9rtw hj3n '), k);
  assert.equal(normalizeKey('7QX2M4PD9RTWHJ3N'), k, 'sans le préfixe');
  assert.equal(normalizeKey('KEY-7QX2-M4PD-9RTW-HJ3N-extra'), null);
  assert.equal(normalizeKey('KEY-7QX2-M4PD-9RTW'), null);
  assert.equal(normalizeKey('KEY-7QX2-M4PD-9RTW-HJ3U'), null, 'U n’existe pas dans l’alphabet');
  assert.equal(normalizeKey('KEY-O0O0-IL1I-0000-0000'), 'KEY-0000-1111-0000-0000', 'O→0, I/L→1');
  assert.equal(normalizeKey(42), null);
  assert.equal(normalizeKey('K'.repeat(100)), null);
  // une clé dont le corps commence par « KEY » saisie sans préfixe ne doit pas être mutilée
  assert.equal(normalizeKey('KEYK-EYKE-YKEY-KEYK'), 'KEY-KEYK-EYKE-YKEY-KEYK');
});

test('signature Stripe : valide, falsifiée, expirée', () => {
  const body = Buffer.from('{"id":"evt_1"}');
  const t = 1_800_000_000;
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.`).update(body).digest('hex');
  const now = t * 1000 + 1000;
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test', { now }), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${sig}`, 'whsec_test', { now }), true, 'plusieurs v1 acceptés');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'autre', { now }), false);
  assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, 'whsec_test', { now }), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test', { now: now + 10 * 60 * 1000 }), false, 'hors tolérance');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=zz`, 'whsec_test', { now }), false);
  assert.equal(verifyStripeSignature(body, '', 'whsec_test', { now }), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, '', { now }), false);
});

test('essai : démarre une fois, dure N jours, puis bloque', () => {
  const { svc, advance } = make();
  const a = svc.status(G1);
  assert.equal(a.state, 'trial');
  assert.equal(a.allowed, true);
  advance(6 * DAY);
  assert.equal(svc.status(G1).state, 'trial');
  assert.equal(svc.status(G2).state, 'trial', 'chaque serveur a son propre essai');
  advance(2 * DAY);
  const b = svc.status(G1);
  assert.equal(b.state, 'expired');
  assert.equal(b.allowed, false);
  assert.equal(svc.status(G2).state, 'trial', 'le 2e serveur a commencé plus tard');
  assert.equal(a.trialEndsAt, b.trialEndsAt, 'l’essai ne repart pas à zéro');
});

test('licences désactivées, serveurs offerts et propriétaires du bot : jamais bloqués', () => {
  assert.deepEqual(make({ enabled: false }).svc.status(G1), { state: 'disabled', allowed: true });
  const free = make({ freeGuildIds: [G1] });
  free.svc.status(G1); free.svc.status(G2);
  free.advance(100 * DAY);
  assert.equal(free.svc.status(G1).allowed, true);
  assert.equal(free.svc.status(G2).state, 'expired');
  const own = make();
  own.svc.status(G1, '900000000000000009'); own.svc.status(G2, 'autre');
  own.advance(100 * DAY);
  assert.equal(own.svc.status(G1, '900000000000000009').state, 'free');
  assert.equal(own.svc.status(G2, 'autre').allowed, false);
  assert.equal(make({ trialDays: 0 }).svc.status(G1).allowed, false, 'essai à 0 jour = blocage immédiat');
});

test('activation : 1 clé = 1 serveur, 1 serveur = 1 clé, libération', () => {
  const { svc, advance, now } = make();
  svc.status(G1);
  advance(10 * DAY);
  const a = svc.createLicense({ ownerId: U, periodEnd: now() + 30 * DAY });
  assert.equal(svc.status(G1).allowed, false);
  svc.activate(a.id, G1, U);
  assert.equal(svc.status(G1).state, 'licensed');
  assert.doesNotThrow(() => svc.activate(a.id, G1, U), 'réactiver sur le même serveur est sans effet');
  assert.throws(() => svc.activate(a.id, G2, U), (e) => e instanceof LicenseError && e.status === 409, 'déjà utilisée');
  const b = svc.createLicense({ ownerId: U, periodEnd: now() + 30 * DAY });
  assert.throws(() => svc.activate(b.id, G1, U), (e) => e.status === 409, 'serveur déjà licencié');
  assert.equal(svc.deactivate(G1), true);
  assert.equal(svc.status(G1).allowed, false);
  svc.activate(a.id, G2, U);
  assert.equal(svc.status(G2).state, 'licensed');
  assert.throws(() => svc.activate(9999, G1, U), (e) => e.status === 404);
  assert.deepEqual(svc.guildsOf(a.id).map((g) => g.guildId), [G2]);
});

test('clé : stockée chiffrée, retrouvée par hachage, jamais en clair en base', () => {
  const { svc } = make();
  const { id, key } = svc.createLicense({ ownerId: U, periodEnd: null });
  const row = svc.db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
  assert.ok(!JSON.stringify(row).includes(key));
  assert.equal(svc.getByKey(key).id, id);
  assert.equal(svc.getByKey(key.toLowerCase()).id, id);
  assert.equal(svc.getByKey('KEY-0000-0000-0000-0000'), null);
  assert.equal(svc.listByOwner(U)[0].key, key);
  assert.equal(svc.getById(id).keyHint, key.slice(-4));
  assert.throws(() => svc.createLicense({ ownerId: 'pas-un-id' }), LicenseError);
  assert.equal(svc.getById(id).active, true, 'sans date de fin = illimitée');
});

test('périodes de grâce : renouvellement en retard et paiement refusé', () => {
  const { svc, advance, now } = make();
  svc.status(G1);
  const end = now() + 30 * DAY;
  const { id } = svc.createLicense({ ownerId: U, source: 'stripe', periodEnd: end });
  svc.activate(id, G1, U);
  advance(30 * DAY + GRACE_ACTIVE - 1000);
  assert.equal(svc.status(G1).allowed, true, 'webhook de renouvellement en retard');
  advance(2000);
  assert.equal(svc.status(G1).allowed, false);

  const m = make({ trialDays: 0 });
  m.svc.status(G1);
  const l = m.svc.createLicense({ ownerId: U, source: 'manual', periodEnd: m.now() + DAY });
  m.svc.activate(l.id, G1, U);
  m.advance(DAY + 1000);
  assert.equal(m.svc.status(G1).allowed, false, 'licence manuelle : aucune grâce');

  const p = make({ trialDays: 0 });
  p.svc.status(G1);
  const q = p.svc.createLicense({ ownerId: U, source: 'stripe', status: 'past_due', periodEnd: p.now() });
  p.svc.activate(q.id, G1, U);
  p.advance(GRACE_PAST_DUE - 1000);
  assert.equal(p.svc.status(G1).allowed, true, 'paiement refusé : 3 jours pour régulariser');
  p.advance(2000);
  assert.equal(p.svc.status(G1).allowed, false);
});

test('Stripe : page de paiement et portail client', async () => {
  const { svc, calls } = make();
  const url = await svc.createCheckout(U);
  assert.equal(url, 'https://stripe.test/x');
  const { url: endpoint, opts } = calls[0];
  assert.equal(endpoint, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(opts.headers.Authorization, 'Bearer sk_test');
  const body = new URLSearchParams(String(opts.body));
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_1');
  assert.equal(body.get('client_reference_id'), U);
  assert.equal(body.get('subscription_data[metadata][discord_user_id]'), U);
  assert.equal(body.get('success_url'), 'https://bot.example/dashboard#/account?paid=1');
  await assert.rejects(() => svc.createCheckout('pas-un-id'), LicenseError);
  await assert.rejects(() => make({ stripeSecretKey: '' }).svc.createCheckout(U), (e) => e.status === 503);
  await assert.rejects(() => svc.createPortal({ stripeCustomerId: null }), LicenseError);
  assert.equal(await svc.createPortal({ stripeCustomerId: 'cus_1' }), 'https://stripe.test/x');
  assert.equal(new URLSearchParams(String(calls.at(-1).opts.body)).get('customer'), 'cus_1');

  const failing = new LicenseService({ db: openDatabase(':memory:'), config: make().cfg, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'No such price' } }) }) });
  await assert.rejects(() => failing.createCheckout(U), (e) => e.status === 502 && /No such price/.test(e.message));
  const down = new LicenseService({ db: openDatabase(':memory:'), config: make().cfg, fetchImpl: async () => { throw new Error('réseau'); } });
  await assert.rejects(() => down.createCheckout(U), (e) => e.status === 502);
});

test('webhook Stripe : paiement → clé, renouvellement, impayé, résiliation, idempotence', async () => {
  const { svc, now, advance } = make();
  const created = [];
  svc.onCreate = (info) => created.push(info);
  const nowSec = Math.floor(now() / 1000);
  const checkout = (id) => ({ id, type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: U } } });

  assert.match(svc.handleStripeEvent(checkout('evt_1')), /créée/);
  assert.equal(created.length, 1);
  assert.equal(created[0].ownerId, U);
  assert.match(created[0].key, KEY_RE);
  assert.equal(svc.handleStripeEvent(checkout('evt_1')), 'déjà traité', 'même événement rejoué');
  assert.equal(svc.handleStripeEvent(checkout('evt_2')), 'licence déjà créée', 'même abonnement, autre événement');
  assert.equal(svc.listByOwner(U).length, 1);

  svc.status(G1);
  const lic = svc.listByOwner(U)[0];
  assert.equal(lic.status, 'active');
  assert.equal(lic.stripeCustomerId, 'cus_1');
  svc.activate(lic.id, G1, U);

  // ancien format de l'API
  svc.handleStripeEvent({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: nowSec + 31 * 86400 } } });
  assert.equal(svc.getById(lic.id).periodEnd, (nowSec + 31 * 86400) * 1000);
  // nouveau format (« basil ») : la fin de période est dans les lignes
  svc.handleStripeEvent({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [{ current_period_end: nowSec + 62 * 86400 }] } } } });
  assert.equal(svc.getById(lic.id).periodEnd, (nowSec + 62 * 86400) * 1000);

  svc.handleStripeEvent({ id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', customer: 'cus_1' } } });
  assert.equal(svc.getById(lic.id).status, 'past_due');
  assert.equal(svc.getById(lic.id).periodEnd, (nowSec + 62 * 86400) * 1000, 'la date de fin est conservée');

  svc.handleStripeEvent({ id: 'evt_6', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: nowSec + 90 * 86400 } } });
  assert.equal(svc.status(G1).state, 'licensed');

  svc.handleStripeEvent({ id: 'evt_7', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', current_period_end: nowSec - 10 } } });
  assert.equal(svc.getById(lic.id).status, 'canceled');
  advance(10 * DAY);
  assert.equal(svc.status(G1).allowed, false, 'résiliation = accès coupé (essai déjà consommé)');

  // abonnement créé avant l'événement de paiement (ordre des webhooks non garanti)
  const m = make();
  m.svc.handleStripeEvent({ id: 'a', type: 'customer.subscription.created', data: { object: { id: 'sub_9', status: 'active', customer: 'cus_9', metadata: { discord_user_id: U }, current_period_end: 2_000_000_000 } } });
  assert.equal(m.svc.listByOwner(U).length, 1);
  assert.equal(m.svc.handleStripeEvent({ id: 'b', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_9', client_reference_id: U } } }), 'licence déjà créée');
  assert.equal(m.svc.listByOwner(U).length, 1);

  // cas à ignorer sans planter
  assert.match(svc.handleStripeEvent({ id: 'c', type: 'checkout.session.completed', data: { object: { mode: 'payment' } } }), /pas un abonnement/);
  assert.match(svc.handleStripeEvent({ id: 'd', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_x' } } }), /sans utilisateur/);
  assert.match(svc.handleStripeEvent({ id: 'e', type: 'invoice.paid', data: { object: {} } }), /ignoré/);
  assert.equal(svc.handleStripeEvent({}), 'événement invalide');
});

test('une licence révoquée à la main n’est pas réactivée par Stripe', () => {
  const { svc, advance } = make();
  svc.handleStripeEvent({ id: '1', type: 'customer.subscription.created', data: { object: { id: 'sub_r', status: 'active', metadata: { discord_user_id: U }, current_period_end: 2_000_000_000 } } });
  const lic = svc.listByOwner(U)[0];
  svc.status(G1);
  advance(10 * DAY);
  svc.activate(lic.id, G1, U);
  assert.equal(svc.status(G1).allowed, true);
  assert.equal(svc.revoke(lic.id), true);
  assert.equal(svc.status(G1).allowed, false);
  svc.handleStripeEvent({ id: '2', type: 'customer.subscription.updated', data: { object: { id: 'sub_r', status: 'active', current_period_end: 2_100_000_000 } } });
  assert.equal(svc.getById(lic.id).status, 'revoked');
  assert.equal(svc.revoke(9999), false);
});

test('handleWebhook : signature obligatoire, corps vérifié', () => {
  const { svc, now } = make();
  const body = Buffer.from(JSON.stringify({ id: 'evt_w', type: 'invoice.paid', data: { object: {} } }));
  const t = Math.floor(now() / 1000);
  const sign = (b, secret = 'whsec_test') => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(b).digest('hex')}`;
  assert.match(svc.handleWebhook(body, sign(body)), /ignoré/);
  assert.throws(() => svc.handleWebhook(body, sign(body, 'mauvais')), (e) => e instanceof LicenseError && e.status === 400);
  assert.throws(() => svc.handleWebhook(Buffer.from(body + ' '), sign(body)), LicenseError, 'corps modifié');
  assert.throws(() => svc.handleWebhook(body, undefined), LicenseError);
  const junk = Buffer.from('pas du json');
  assert.throws(() => svc.handleWebhook(junk, sign(junk)), /JSON invalide/);
});

test('blocage du bot : événements, tâches périodiques et serveurs partiels', () => {
  const { svc, advance } = make();
  svc.status(G1); svc.status(G2);
  const guilds = new Map();
  const mk = (id, ownerId = 'o') => Object.assign(new Guild(), { id, ownerId });
  const g1 = mk(G1); const g2 = mk(G2);
  guilds.set(G1, g1); guilds.set(G2, g2);
  const cache = Object.assign(new Map(guilds), { filter(fn) { return Object.assign(new Map([...this].filter(([, v]) => fn(v))), { values: Map.prototype.values }); } });
  const client = { ctx: { license: svc }, guilds: { cache }, isReady: () => true, tag: 'bot', say() { return this.tag; } };

  assert.equal(guildOfArgs([{ guild: g1 }]), g1);
  assert.equal(guildOfArgs([{ message: { guild: g2 } }]), g2, 'réaction');
  assert.equal(guildOfArgs([{ channel: { guild: g1 } }]), g1);
  assert.equal(guildOfArgs([g2, g1]), g2, 'serveur passé directement');
  assert.equal(guildOfArgs([{}, null, undefined]), null);

  assert.equal(isAllowed(client, g1), true);
  assert.equal(isAllowed(client, null), true, 'messages privés');
  advance(8 * DAY);
  assert.equal(isAllowed(client, g1), false);
  assert.equal(isAllowed(client, { id: G1 }), false, 'serveur partiel (invitation) résolu via le cache');

  const lic = svc.createLicense({ ownerId: U, periodEnd: null });
  svc.activate(lic.id, G2, U);
  const view = gatedClient(client);
  assert.deepEqual([...view.guilds.cache.keys()], [G2], 'les tâches périodiques ne voient que les serveurs autorisés');
  assert.equal(view.ctx, client.ctx);
  assert.equal(view.say(), 'bot', 'les méthodes restent utilisables');

  const off = make({ enabled: false });
  const free = { ctx: { license: off.svc }, guilds: { cache } };
  assert.equal(gatedClient(free), free, 'licences désactivées : client inchangé');
});
