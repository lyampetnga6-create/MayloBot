import { api } from './api.js';

const ERRORS = {
  access_denied: 'Connexion annulée.',
  invalid_state: 'La connexion a expiré. Réessaie.',
  token: 'Discord a refusé la connexion. Vérifie la configuration OAuth2 (URL de redirection).',
  profile: 'Impossible de récupérer ton profil Discord.',
};

const $ = (id) => document.getElementById(id);

const err = new URLSearchParams(location.search).get('error');
if (err) {
  const b = $('error-banner');
  b.textContent = ERRORS[err] || 'Une erreur est survenue pendant la connexion.';
  b.hidden = false;
}

try {
  const pub = await api.get('/api/public');
  document.title = `${pub.botName} — Bot Discord personnalisable`;
  $('brand-name').textContent = pub.botName;
  $('brand-mark').textContent = pub.botName.trim().charAt(0).toUpperCase() || 'B';
  $('mock-name').textContent = pub.botName;
  for (const id of ['cta-invite', 'cta-invite-2']) {
    if (pub.inviteUrl) $(id).href = pub.inviteUrl;
    else $(id).hidden = true;
  }
  if (pub.license?.enabled) {
    const m = /^([\d.,]+\s*[^\s/]*)\s*\/\s*(.+)$/.exec(pub.license.priceLabel);
    $('price-amount').textContent = m ? m[1] : pub.license.priceLabel;
    $('price-unit').textContent = m ? `/ ${m[2]}` : '';
    $('trial-days').textContent = pub.license.trialDays;
    $('pricing').hidden = false;
  }
  if (pub.supportUrl) {
    const a = document.createElement('a');
    a.href = pub.supportUrl;
    a.textContent = 'Serveur de support';
    a.rel = 'noopener';
    $('footer').append(' · ', a);
  }
} catch { /* page statique : on garde les valeurs par défaut */ }

try {
  await api.get('/api/me');
  // Déjà connecté : les boutons mènent directement au dashboard.
  $('nav-login').textContent = 'Ouvrir le dashboard';
  $('nav-login').href = '/dashboard';
  $('cta-dashboard').href = '/dashboard';
  $('cta-dashboard-2').href = '/dashboard';
  $('cta-pricing').href = '/dashboard#/account';
  $('cta-pricing').textContent = 'Voir mon abonnement';
} catch { /* non connecté */ }
