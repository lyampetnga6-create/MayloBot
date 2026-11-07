/* Documentation : démarrage rapide, contestations, permissions et variables des messages. */
import { state } from './state.js';
import { h, icon } from './ui.js';

const section = (title, ...children) => h('div', { class: 'card' }, h('h3', null, title), ...children);

export function docsPage(root) {
  const steps = [
    ['Invite le bot', 'Avec le bouton « + » de la colonne de gauche. Donne-lui la permission Administrateur, ou au minimum celles listées plus bas.'],
    ['Choisis ton serveur', 'Clique sur son icône dans la colonne de gauche. Il faut la permission « Gérer le serveur » pour le voir ici.'],
    ['Active les modules utiles', 'Dans le menu, ouvre un module et passe l’interrupteur « Module activé » avant d’enregistrer. La pastille verte indique ceux qui sont actifs.'],
    ['Place le rôle du bot tout en haut', 'Paramètres du serveur, Rôles : le rôle du bot doit être au-dessus de ceux qu’il gère (modération, rôles automatiques, rôles à boutons).'],
  ];
  const perms = ['Gérer les rôles', 'Gérer les salons', 'Expulser des membres', 'Bannir des membres', 'Exclure temporairement des membres',
    'Gérer les messages', 'Voir les logs du serveur', 'Créer des invitations', 'Envoyer des messages et des embeds'];

  const vars = Object.entries(state.schema?.variables || {});

  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, h('span', { class: 'ico' }, icon('book', 20)), 'Documentation'),
      h('p', null, 'Les bases pour configurer le bot, et la liste des variables utilisables dans les messages.'))),
    h('div', { class: 'stack' },
      section('Démarrer en quatre étapes',
        h('ol', { class: 'doc-steps' }, steps.map(([title, text]) => h('li', null, h('div', null, h('strong', null, title), h('span', null, text)))))),

      section('Contestation des sanctions',
        h('p', { class: 'muted' }, 'Quand le module « Contestations » est activé, chaque sanction (bannissement, expulsion, exclusion, avertissement) envoie un message privé au membre avec la raison et un bouton « Contester ».'),
        h('ol', { class: 'doc-steps', style: { marginTop: '14px' } }, [
          ['Le membre explique sa situation', 'Un formulaire s’ouvre dans ses messages privés, avec vos questions supplémentaires si vous en avez ajouté.'],
          ['Un salon privé est créé pour le staff', 'Il contient la sanction, la raison, l’historique du membre et les boutons Accepter, Refuser, Refus définitif et Écrire au membre.'],
          ['La décision est appliquée', 'Accepter lève la sanction (déban, fin d’exclusion, avertissement supprimé) et envoie une invitation à usage unique. Le membre est prévenu en message privé.'],
        ].map(([title, text]) => h('li', null, h('div', null, h('strong', null, title), h('span', null, text))))),
        h('div', { class: 'banner warn', style: { marginTop: '16px', marginBottom: 0 } }, icon('alertTriangle', 18), h('div', null,
          h('strong', null, 'Bannissements et expulsions faits à la main. '),
          'Discord ne permet pas d’écrire à quelqu’un avec qui le bot n’a plus de serveur en commun. Pour que le message de contestation parte à coup sûr, sanctionne avec /ban, /kick ou /timeout : le bot écrit au membre avant d’appliquer la sanction.'))),

      section('Permissions dont le bot a besoin',
        h('div', { class: 'chips' }, perms.map((p) => h('span', { class: 'chip no-x' }, p))),
        h('p', { class: 'hint' }, 'Le plus simple est de lui donner la permission Administrateur. La vue d’ensemble d’un serveur signale celles qui manquent.')),

      section('Variables des messages',
        h('p', { class: 'muted' }, 'Écris-les entre accolades dans un texte ou un embed, par exemple {user} ou {server}. Chaque éditeur de message indique celles qui fonctionnent dans son contexte, et un clic sur une variable l’insère.'),
        h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, h('table', { class: 'var-table' },
          h('thead', null, h('tr', null, h('th', null, 'Variable'), h('th', null, 'Valeur'))),
          h('tbody', null, vars.map(([name, text]) => h('tr', null, h('td', null, h('code', null, `{${name}}`)), h('td', { class: 'muted' }, text))))))),
    ),
  );
}
