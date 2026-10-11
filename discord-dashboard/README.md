# Bot Discord + Dashboard web (style DraftBot, thème violet et noir)

Un bot Discord **modulaire** et son **dashboard web** pour le configurer, dans un seul projet Node.js.
Les administrateurs se connectent avec Discord, choisissent leur serveur et règlent chaque module depuis le site.

- **35 modules** réglables, plus de **500 options** (liste dans [FEATURES.md](FEATURES.md))
- **84 commandes slash**
- Tickets avec **IA configurable**, **protections** (anti-raid, anti-nuke, verrouillage), **honeypot**, **journaux**
- **Webhooks** et bibliothèque de **messages enregistrés sans limite**
- **Profil du bot propre à chaque serveur** (pseudo, avatar, bannière, bio)
- **Créateur de serveur** : 6 modèles sans IA + génération par IA (rôles, catégories, salons, permissions)
- Dashboard animé violet et noir (fond aurore, grille, particules ; respecte « réduire les animations »)

## Installation en 5 étapes

Prérequis : **Node.js 22.12 ou plus récent**.

### 1. Créer l'application Discord

1. Va sur <https://discord.com/developers/applications> → **New Application**.
2. Onglet **Bot** :
   - **Reset Token** → copie le token (`DISCORD_TOKEN`).
   - Active ces *Privileged Gateway Intents* : **Server Members Intent** et **Message Content Intent**
     (obligatoires, sinon le bot refuse de démarrer).
3. Onglet **OAuth2** :
   - Copie le **Client ID** (`DISCORD_CLIENT_ID`) et le **Client Secret** (`DISCORD_CLIENT_SECRET`).
   - Dans **Redirects**, ajoute `http://localhost:3000/auth/callback` (ou `https://ton-domaine/auth/callback` en ligne).
     L'adresse doit être *exactement* `BASE_URL` + `/auth/callback`.

Les autres intents utilisés (modération, vocal, réactions, invitations) ne sont pas « privilégiés » : rien à activer.

### 2. Configurer le projet

```bash
npm install
cp .env.example .env     # puis remplis .env
npm start
```

Génère le `SESSION_SECRET` avec `openssl rand -hex 32`. **Ne le change plus ensuite** : il sert aussi à chiffrer
les clés d'API IA et les jetons de webhooks stockés en base.

Au démarrage, le bot enregistre ses commandes slash (désactivable avec `AUTO_DEPLOY_COMMANDS=false`, ou à la main avec
`npm run deploy-commands`). Pour tester, mets `DEV_GUILD_ID=<id de ton serveur>` : les commandes apparaissent tout de suite.

### 3. Inviter le bot

Ouvre le dashboard (`http://localhost:3000`), connecte-toi, puis clique sur **Inviter** à côté de ton serveur.
Le lien contient toutes les permissions utiles. Place le rôle du bot **tout en haut** de la liste des rôles du serveur :
il ne peut pas créer, donner ni modérer un rôle situé au-dessus du sien.

### 4. Utiliser

- Dashboard : `BASE_URL` → **Se connecter** → choisir un serveur → régler les modules.
- Sur Discord, `/dashboard` renvoie le lien direct vers ton serveur.
- Accès au serveur : permission **Gérer le serveur** (vérifiée à chaque requête).
- Accès **administrateur** (propriétaire du serveur ou permission Administrateur) pour les sections sensibles :
  module Protection, clé d'API IA, verrouillage, mode raid, salon piège, créateur de serveur.
- Mets ton ID Discord dans `OWNER_IDS` pour accéder à `#/admin` (statut du bot, présence, liste des serveurs).

## Les nouveautés

### Profil du bot par serveur — page « Profil du bot »
Change le pseudo, la bio, l'avatar et la bannière du bot **uniquement sur le serveur ouvert** (profil de membre du bot).
Images PNG, JPEG, GIF ou WebP, 4 Mo maximum chacune. Discord limite la fréquence des changements : si une modification
est refusée, le message d'erreur de Discord s'affiche. Selon les règles de Discord, certaines options de profil de
serveur (bannière, bio) peuvent être soumises à conditions de son côté.

### Tickets avec IA — module « Tickets » + module « Intelligence artificielle »
Panneau avec bouton, sujets, formulaires, catégories, rôles staff, prise en charge, fermeture, transcript.
L'IA peut répondre en premier dans le ticket : personnalité, règles, base de connaissances, mots qui appellent le staff,
nombre de réponses maximum… Tout est réglable dans le module Tickets.
Pour l'activer, ajoute une clé d'API (voir « IA » ci-dessous).

### Protections et honeypot — modules « Protection du serveur », « Honeypot », « Vérification »
Anti-raid, anti-nuke (suppressions/créations en masse), liens d'arnaque, quarantaine, verrouillage d'urgence et mode raid
(boutons dans le dashboard ou `/verrouillage`, `/raidmode`). Salon piège : le dashboard le crée en un clic, publie
l'avertissement, et sanctionne quiconque y écrit. Vérification des nouveaux membres par bouton, question ou calcul.

### Webhooks et messages — page « Webhooks et messages »
- **Messages enregistrés** : autant que tu veux, avec recherche et pagination ; éditeur complet (texte + embed + aperçu).
- Envoi **par le bot** ou **par un webhook** avec un nom et un avatar personnalisés.
- Webhooks : création par le bot, ou import de l'URL d'un webhook du serveur (chiffrée en base, jamais réaffichée).
- Les messages envoyés d'ici ne notifient personne (aucune mention).

### Créateur de serveur — page « Créateur de serveur »
- **Modèles** (sans IA) : communauté, gaming, études, créatifs, boutique, minimal.
- **IA** : décris le serveur voulu, l'IA propose un plan (rôles, catégories, salons, accès).
- Tu relis le plan, tu retires ce que tu ne veux pas (✕) ou tu l'édites en JSON, puis tu lances la création.
- Sécurité : le plan est toujours validé par le serveur (quantités bornées, jamais de permission Administrateur,
  rôles décoratifs sans permissions). **Rien n'est supprimé ni modifié** : un élément qui porte déjà le même nom est réutilisé.
- Option « relier au bot » : accueil, journaux, suggestions, tickets et vérification pointent vers les salons créés.

### Historique — page « Historique »
Chaque modification faite depuis le dashboard (qui, quoi, quand) est conservée (2000 dernières entrées par serveur).

## IA : configuration

Deux possibilités, au choix :

1. **Clé par serveur** (recommandé) : dashboard → module *Intelligence artificielle* → choisis le fournisseur, colle la clé
   et clique sur *Tester la connexion*. La clé est chiffrée (AES-256-GCM) et ne s'affiche plus jamais.
2. **Clé globale** : renseigne `AI_PROVIDER` et `AI_API_KEY` dans `.env` ; tous les serveurs qui choisissent
   « Celui du bot » l'utilisent.

Fournisseurs : OpenAI, Anthropic, OpenRouter, Groq, Mistral, Google Gemini, DeepSeek. Les adresses d'API sont fixes pour
éviter qu'un gestionnaire fasse envoyer des requêtes du bot vers une adresse quelconque ; seul le propriétaire du bot peut
fixer une adresse libre (`AI_BASE_URL`). `AI_GUILD_HOURLY_LIMIT` plafonne les requêtes par heure et par serveur.
L'usage de l'IA est facturé par ton fournisseur, pas par ce projet.

## Abonnement payant (clé de licence)

Tu peux faire payer l'accès au bot : **9,99 €/mois**, un essai gratuit par serveur, puis une clé de licence obligatoire.
C'est **désactivé par défaut** (`LICENSE_ENABLED=false` : tout reste gratuit).

**Comment ça marche pour le client**
1. Il invite le bot : le serveur démarre avec 7 jours d'essai (`LICENSE_TRIAL_DAYS`).
2. Il ouvre le dashboard > **Abonnement** > « S'abonner » : paiement sur la page sécurisée Stripe.
3. Dès le paiement, une **clé** `KEY-XXXX-XXXX-XXXX-XXXX` est créée automatiquement : affichée sur la page Abonnement **et envoyée en message privé**.
4. Il l'active sur **un** serveur (page Abonnement, ou `/licence activer`). Il peut la déplacer ailleurs quand il veut (`/licence desactiver`).
5. S'il résilie (via « Factures, carte bancaire, résiliation »), l'accès est coupé à la fin de la période payée. Paiement refusé : 3 jours de grâce.

**Quand l'essai est fini sans licence** : le bot reste sur le serveur mais ne fait plus rien (commandes, modération, logs, tâches planifiées),
répond « essai terminé » aux commandes, et le dashboard passe en lecture seule. Rien n'est supprimé : tout repart dès qu'une clé est activée.

**Mise en place (une fois)**
1. Crée un compte sur [stripe.com](https://stripe.com) (commence en mode test).
2. *Catalogue de produits* > crée un produit « Bot » avec un **prix récurrent mensuel de 9,99 €** : copie l'identifiant `price_...` dans `STRIPE_PRICE_ID`.
3. *Développeurs > Clés API* : copie la clé secrète dans `STRIPE_SECRET_KEY`.
4. *Développeurs > Webhooks* > ajoute l'endpoint `https://TON-DOMAINE/stripe/webhook` avec les événements
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copie le « secret de signature » `whsec_...` dans `STRIPE_WEBHOOK_SECRET`.
5. *Paramètres > Facturation > Portail client* : active-le (c'est lui qui permet de changer de carte et de résilier).
6. Mets `LICENSE_ENABLED=true`, `BASE_URL` en **https** public (Stripe doit pouvoir joindre le webhook), redémarre.
7. Teste en mode test avec la carte `4242 4242 4242 4242`, puis passe Stripe en mode réel (remplace les 3 valeurs par celles du mode réel).

La page **Admin** du dashboard (propriétaires du bot) affiche l'état de cette configuration, la liste des licences, permet d'**offrir une clé**
(durée libre) ou de **révoquer** une licence. Pour un remboursement : rembourse et résilie dans Stripe, puis révoque la clé ici si tu veux couper tout de suite.

**À savoir**
- Les serveurs déjà présents quand tu actives les licences reçoivent eux aussi 7 jours d'essai, à partir de ce moment.
- Les clés sont stockées chiffrées (comme les clés d'API IA) : ne change pas `SESSION_SECRET` après coup.
- Vendre un service t'oblige à des mentions légales, des CGV, une politique de confidentialité (RGPD) et, selon ta situation, à gérer la TVA
  (Stripe Tax peut t'aider). Ce projet ne remplace pas ces démarches.
- Ce système a été vérifié par des tests automatisés (clés, signature des webhooks, essai, grâce, blocage) mais **pas** contre un vrai compte Stripe : fais un paiement de test complet avant d'ouvrir.

## Mise en ligne

- Héberge-le sur un VPS (ou tout hébergeur Node avec disque persistant : la base SQLite est dans `data/`).
- Place-le derrière un reverse proxy **HTTPS** (Caddy, nginx…) et mets :
  `BASE_URL=https://dashboard.mondomaine.fr` et `TRUST_PROXY=1`.
- Ajoute l'URL de callback correspondante dans le portail développeur.
- Lance-le avec un gestionnaire de processus (`pm2 start src/index.js --name bot`, systemd, Docker…).
- Sauvegarde le dossier `data/` régulièrement.

## Héberger sur Railway (sans serveur à gérer)

1. Mets le projet sur GitHub (dépôt **privé**). Ne mets jamais le fichier `.env`, ni `node_modules`, ni `data` : le `.gitignore` fourni les exclut.
2. Sur [railway.com](https://railway.com), connecte-toi avec GitHub, puis **New Project > Deploy from GitHub repo** et choisis ton dépôt.
3. Ajoute un **volume** (disque persistant) au service, point de montage `/data`. Sans lui, la base est effacée à chaque redémarrage.
4. Onglet **Variables** : `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` (longue suite au hasard), `OWNER_IDS`, `BOT_NAME`, `DB_PATH=/data/bot.db`, `TRUST_PROXY=1`.
5. Onglet **Settings > Networking > Generate Domain** : Railway te donne une adresse https (`xxx.up.railway.app`).
6. Ajoute la variable `BASE_URL=https://xxx.up.railway.app` (sans `/` à la fin), puis redéploie.
7. Dans le portail développeur Discord (OAuth2 > Redirects), ajoute `https://xxx.up.railway.app/auth/callback`.
8. Ouvre `https://xxx.up.railway.app/dashboard`.

Railway fournit lui-même la variable `PORT` : ne la définis pas.

## Personnaliser

### Ajouter ou modifier une option (sans toucher au front)

Tout passe par **`src/schema.js`** et **`src/defs/*.js`** : c'est la source unique des réglages. Ajoute un champ :

```js
t.toggle('pingOnJoin', 'Mentionner le membre à son arrivée', true),
```

Le formulaire apparaît tout seul dans le dashboard, la valeur est validée côté serveur, et tu la lis dans le bot :

```js
const cfg = client.ctx.settings.module(guild.id, 'welcome');
if (cfg.pingOnJoin) { /* … */ }
```

Types de champs : `toggle`, `text`, `textarea`, `number`, `color`, `select`, `channel(s)`, `role(s)`, `strings`,
`list` (liste éditable), `group`, `message` (contenu + embed + aperçu), `heading`.

### Ajouter un module

Ajoute un objet dans un fichier de `src/defs/` (`id`, `name`, `icon`, `description`, `category`, `fields`).
Il apparaît dans le menu du dashboard. Branche ensuite sa logique dans `src/bot/modules/` et ses événements dans
`src/bot/events.js`. Option `adminOnly: true` pour le réserver aux administrateurs ; `extras: '…'` pour afficher un
panneau d'actions sous le formulaire (voir `public/js/extras.js`).

### Ajouter une commande slash

Crée un fichier dans `src/bot/commands/` qui exporte une liste d'objets `{ data, category, module?, execute }`, puis ajoute-le
à `src/bot/commands/index.js`. Discord autorise **100 commandes** au maximum (il en reste 17). Relance, ou `npm run deploy-commands`.

### Variables dans les messages

`{user}` `{user.name}` `{user.id}` `{user.avatar}` `{user.created}` `{server}` `{server.icon}` `{memberCount}` et, selon le
module : `{level}` `{xp}` `{number}` `{topic}` `{reason}` `{channel}` `{count}` `{seconds}` `{staff}` `{prize}` `{winners}`
`{host}` `{id}` `{content}` `{stars}` `{link}` `{age}` `{rating}` `{coins}` `{boosts}`.

### Changer les couleurs du dashboard

Toutes les couleurs sont des variables CSS en haut de `public/css/style.css` (`--accent`, `--bg`, `--panel`…).
Le fond animé est dans `public/js/fx.js` (particules) et la section « Fond animé » du CSS.

## Structure

```
src/
  index.js            démarrage (web + bot)
  config.js           variables d'environnement
  schema.js           modules et options (source unique) ; defs/ = modules supplémentaires
  settings.js         lecture / écriture des réglages
  db.js               SQLite
  bot/                client, événements, tâches planifiées, commandes, modules
  web/                serveur Express, OAuth2, API REST
  lib/                messages, niveaux, IA, chiffrement, modèles de serveur, jeux, licences (Stripe)
public/               site (landing + dashboard, sans build)
tests/                tests unitaires (node --test)
```

## Tests

```bash
npm test
```

## Sécurité

Token OAuth non stocké, session en base, cookies `HttpOnly` (+ `Secure` en HTTPS), CSP stricte via helmet (aucun script
externe, polices système), limitation de débit, protection CSRF (en-tête personnalisé + vérification d'origine),
permissions revérifiées à chaque appel d'API, sections sensibles réservées aux administrateurs, clés d'API et jetons de
webhooks chiffrés (jamais renvoyés au navigateur), messages envoyés sans mentions, plans de serveur validés avant création.
Ne publie jamais ton `.env`.

## Limites à connaître

- Ce projet a été vérifié avec des tests unitaires, des simulations du bot et de l'API, et un navigateur sur une API simulée.
  Il n'a **pas** été testé contre un vrai serveur Discord ni un vrai fournisseur d'IA : fais un premier essai sur un serveur de test.
- Les parties de morpion et les cooldowns sont en mémoire : ils sont perdus au redémarrage.
- Discord impose ses propres limites (fréquence des changements d'avatar, 100 commandes, 250 salons par serveur…).

## Dépannage

- **« Used disallowed intents »** : active *Server Members* et *Message Content* dans l'onglet Bot.
- **`redirect_uri` invalide à la connexion** : l'URL dans le portail doit être identique à `BASE_URL/auth/callback`.
- **Le serveur n'apparaît pas / « Inviter »** : il faut la permission *Gérer le serveur* et que le bot y soit présent.
- **Le bot n'attribue pas un rôle / ne crée pas les salons** : son rôle doit être au-dessus des rôles visés, avec les permissions nécessaires.
- **Commandes slash absentes** : renseigne `DEV_GUILD_ID` pour un test immédiat ; les globales peuvent prendre du temps.
- **« IA non configurée »** : ajoute une clé d'API dans le module *Intelligence artificielle*, puis teste la connexion.
- **Le profil du bot est refusé** : Discord limite les changements ; réessaie plus tard et vérifie la taille et le format de l'image.
