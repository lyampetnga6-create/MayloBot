'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, buildMessage, isHttpUrl, safeText, hexToInt } = require('../src/lib/template');
const { msg } = { msg: (content, embed) => ({ content, embed: { enabled: Boolean(embed), title: '', description: '', color: '', thumbnail: '', image: '', author: '', footer: '', timestamp: false, ...embed } }) };

test('render remplace les variables connues et laisse les autres', () => {
  assert.equal(render('Salut {user} sur {server} {inconnue}', { user: '<@1>', server: 'Chez moi' }), 'Salut <@1> sur Chez moi {inconnue}');
  assert.equal(render('', {}), '');
  assert.equal(render(undefined, {}), '');
});

test('render ne réévalue pas les valeurs insérées', () => {
  assert.equal(render('{a}', { a: '{b}', b: 'piège' }), '{b}');
});

test('buildMessage : texte seul, embed seul, vide', () => {
  assert.deepEqual(buildMessage(msg('Coucou {user.name}'), { 'user.name': 'Léa' }), { content: 'Coucou Léa' });

  const p = buildMessage(msg('', { title: 'Bienvenue {user.name}', description: 'x', color: '#00ff00' }), { 'user.name': 'Léa' }, {});
  assert.equal(p.embeds[0].data.title, 'Bienvenue Léa');
  assert.equal(p.embeds[0].data.color, 0x00ff00);

  assert.equal(buildMessage(msg(''), {}), null);
  assert.equal(buildMessage(msg('', { title: '', description: '' }), {}), null, 'un embed vide n’est pas envoyé');
});

test('buildMessage : couleur et pied de page du serveur par défaut', () => {
  const p = buildMessage(msg('', { title: 'T' }), {}, { embedColor: '#112233', footerText: 'Mon serveur' });
  assert.equal(p.embeds[0].data.color, 0x112233);
  assert.equal(p.embeds[0].data.footer.text, 'Mon serveur');
});

test('buildMessage : les images non http(s) sont ignorées et le texte est tronqué', () => {
  const p = buildMessage(msg('x'.repeat(5000), { title: 'T', thumbnail: 'javascript:alert(1)', image: 'https://exemple.fr/a.png' }), {});
  assert.equal(p.content.length, 2000);
  assert.equal(p.embeds[0].data.thumbnail, undefined);
  assert.equal(p.embeds[0].data.image.url, 'https://exemple.fr/a.png');
});

test('aides diverses', () => {
  assert.equal(isHttpUrl('https://a.fr'), true);
  assert.equal(isHttpUrl('ftp://a.fr'), false);
  assert.equal(isHttpUrl('pas une url'), false);
  assert.equal(hexToInt('#ff0000'), 0xff0000);
  assert.equal(hexToInt('nope', 7), 7);
  assert.ok(!safeText('@everyone <@123456789012345678>').includes('@everyone'));
});
