# Bot Discord + Dashboard web (style DraftBot, thème violet et noir)

Un bot Discord **modulaire** et son **dashboard web** pour le configurer, dans un seul projet Node.js.
Les administrateurs se connectent avec Discord, choisissent leur serveur et règlent chaque module depuis le site.

- **42 modules** réglables, plus de **500 options** (liste dans [FEATURES.md](FEATURES.md))
- **94 commandes slash**
- Tickets avec **IA configurable**, **protections** (anti-raid, anti-nuke, verrouillage), **honeypot**, **journaux**
- **Webhooks** et bibliothèque de **messages enregistrés sans limite**
- **Profil du bot propre à chaque serveur** (pseudo, avatar, bannière, bio)
- **Créateur de serveur** : 7 modèles sans IA (dont un serveur Valorant complet) + génération par IA (rôles, catégories, salons, permissions)
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

- Dashboard : `BASE_URL/dashboard` → **Se connecter** avec un identifiant et un mot de passe → choisir un serveur → régler les modules.
- Sur Discord, `/dashboard` renvoie le lien direct vers ton serveur.

#### Comptes : sans compte, pas d'accès
Personne ne peut ouvrir le dashboard sans compte, et **seuls les administrateurs peuvent créer des comptes**.
- **Premier compte** : ajoute `ADMIN_USERNAME` et `ADMIN_PASSWORD` (8 caractères minimum) dans les variables. Le compte administrateur est créé au démarrage.
  Pour réinitialiser son mot de passe, change la valeur de `ADMIN_PASSWORD` : il est remis à cette valeur au redémarrage suivant
  (un mot de passe changé depuis le dashboard n'est pas écrasé tant que la variable ne change pas).
- **Page « Comptes »** (menu en haut) : crée un compte (identifiant + mot de passe, avec un bouton « Générer »), choisis les serveurs
  auxquels il a accès, modifie-le, désactive-le ou supprime-le. Un compte désactivé, supprimé ou dont le mot de passe est
  réinitialisé perd sa session immédiatement.
- Rôles : **Utilisateur** (seulement les serveurs cochés, toutes les sections de ces serveurs) ou **Administrateur** (tous les serveurs + gestion des comptes + page Admin du bot).
- Chacun peut changer son mot de passe (menu du profil → « Changer mon mot de passe »).
- Les mots de passe sont stockés hachés (scrypt) ; après 5 échecs, la connexion est bloquée 10 minutes pour cet identifiant depuis cette adresse.
- Les `OWNER_IDS` (ID Discord) peuvent aussi entrer avec le lien « Connexion avec Discord » : c'est la seule connexion Discord qui reste, pour ne jamais être enfermé dehors.
  Les autres personnes qui se connectaient autrefois avec Discord n'ont plus accès tant qu'elles n'ont pas de compte.
- Sans `ADMIN_USERNAME` / `ADMIN_PASSWORD` ni `OWNER_IDS`, personne ne peut se connecter : la page de connexion l'indique.

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
- **Modèles** (sans IA) : communauté, gaming, **Valorant**, études, créatifs, boutique, minimal.
- **Modèle Valorant** : 40 rôles (staff, coach, créateur, capitaine, VIP, 10 rangs de Non classé à Radiant, 3 plateformes, 5 rôles en jeu — Duelliste, Initiateur, Contrôleur, Sentinelle, Flex —, 4 modes, 5 régions, 4 rôles de notification), 13 catégories et 76 salons
  (informations, actus du jeu, TikTok et lives, communauté, recherche de mates par mode, progression avec forum d'analyse de VODs, compétition, concours, salons par rang, vocaux par mode, support, staff).
  Le salon « choisis-tes-rôles » reçoit 6 panneaux à boutons (rang, plateforme, rôle en jeu, modes, région, notifications).
- **IA** : décris le serveur voulu, l'IA propose un plan (rôles, catégories, salons, accès).
- Tu relis le plan, tu retires ce que tu ne veux pas (✕) ou tu l'édites en JSON, puis tu lances la création.
- Sécurité : le plan est toujours validé par le serveur (quantités bornées, jamais de permission Administrateur,
  rôles décoratifs sans permissions). **Rien n'est supprimé ni modifié** : un élément qui porte déjà le même nom est réutilisé.
- Option « relier au bot » : accueil, journaux, suggestions, tickets, vérification, les deux modules TikTok et les panneaux de rôles pointent vers les salons créés,
  et le rôle de base est donné automatiquement aux nouveaux arrivants (sinon les salons « membres » leur resteraient invisibles). Les modules TikTok restent désactivés tant que tu n'as pas renseigné ton compte.

### Historique — page « Historique »
Chaque modification faite depuis le dashboard (qui, quoi, quand) est conservée (2000 dernières entrées par serveur).

## Catégorie « Valorant » du dashboard

Le module **Mates & outils Valorant** regroupe `/mate` (recherche de mates), `/equipes`, `/agent`, `/map`, `/compo` et `/defi` (détails plus bas).

## Rôles réaction (module « Rôles réaction », catégorie Automatisation)

Les membres cliquent sur un émoji **sous un message** pour recevoir un rôle, et retirent l'émoji pour le perdre.
- Dans le dashboard : **Rôles réaction → Créer un message à réactions**. Choisis le salon, ajoute des paires **émoji + rôle** (20 au maximum, limite de Discord), puis clique sur **Publier**.
- Deux façons de l'utiliser : **le bot publie son propre message** (titre, texte, couleur… personnalisables ; la variable `{roles}` affiche la liste « émoji → rôle »), ou tu colles l'**ID d'un message déjà publié** dans ce salon (clic droit sur le message → « Copier l'identifiant du message », mode développeur activé) et le bot ajoute les émojis dessous sans toucher au texte.
- L'émoji s'écrit tel quel (🥇), avec le nom d'un émoji du serveur entre deux-points (`:diamant:`, c'est le plus pratique pour tes émojis de rank) ou sous sa forme complète `<:nom:id>`.
- Trois modes : **normal** (ajouter l'émoji donne le rôle, le retirer l'enlève), **un seul rôle à la fois** (choisir un autre émoji change de rôle et retire l'ancienne réaction), **ajout seulement** (retirer l'émoji ne retire pas le rôle).
- Si tu changes la liste puis cliques sur **Mettre à jour**, le bot met le message à jour et retire les anciens émojis qu'il avait ajoutés.
- Le rôle du bot doit être **au-dessus** des rôles à donner dans la liste des rôles du serveur, et il a besoin des permissions « Ajouter des réactions » et « Gérer les rôles » (« Gérer les messages » en plus pour le mode « un seul rôle », pour retirer l'ancienne réaction). Un message clair s'affiche si un émoji est introuvable, utilisé deux fois ou si un rôle est trop haut.
- Ce module est différent de **Rôles à boutons**, qui reste disponible.

## Créer des émojis en une commande (module « Émojis du serveur »)

Dans Discord, tape **`/emojis creer`** et décris l'image, par exemple `logo Radiant Valorant`. Le bot cherche sur Internet, te montre jusqu'à 4 résultats numérotés, tu cliques sur le bon : il enlève le fond, recadre sur le dessin, met l'image en **128 × 128** et crée l'émoji. Les autres commandes : **`/emojis ajouter`** (image jointe ou lien), **`/emojis supprimer`** et **`/emojis liste`** (places utilisées). Il faut la permission « Gérer les expressions » pour s'en servir, et le module doit être activé. La page du module dans le dashboard affiche l'état (clés, permission, places) et la liste des émojis avec un bouton pour les supprimer.

**Deux clés gratuites à mettre dans Railway > Variables** (jamais dans le code ni dans un message) :

| Variable | À quoi elle sert | Où l'obtenir |
|---|---|---|
| `BRAVE_API_KEY` | chercher les images (`/emojis creer`) | brave.com/search/api, formule gratuite (environ 2 000 recherches par mois ; le site peut demander une carte bancaire pour vérification) |
| `REMOVEBG_API_KEY` | fond transparent de qualité sur n'importe quelle image | remove.bg/api, 50 images gratuites par mois |

Sans la clé `REMOVEBG_API_KEY`, le bot sait quand même rendre transparent le **fond uni** (blanc, noir…) d'un PNG ; pour un JPG ou un fond compliqué il faut la clé. Sans `BRAVE_API_KEY`, la recherche est désactivée mais `/emojis ajouter` marche. Redémarre le service Railway après avoir ajouté une variable.
Ajoute aussi la permission « Gérer les expressions » au rôle du bot (ou réinvite le bot depuis le dashboard : le lien l'inclut désormais).
**À savoir** : les images trouvées sur Internet appartiennent à leurs auteurs ; la recherche peut proposer une image qui n'est pas la bonne, d'où le choix par boutons. L'ancienne commande `/emoji` (agrandir un émoji) existe toujours.

## Vocaux personnels et outils Valorant

**Module « Vocaux temporaires »** : un membre rejoint un salon « ➕ Créer », le bot lui crée son vocal et poste un **panneau de contrôle** dans le chat de ce vocal.
Le propriétaire (et le staff) peut : verrouiller, cacher, **bloquer le chat**, couper les micros, autoriser / bloquer / expulser un membre, transférer ou réclamer le vocal,
renommer (2 fois / 10 min, liens refusés), limiter les places, choisir la qualité audio et la région, inviter, réinitialiser, **garder ses réglages** pour la prochaine fois, fermer.
Tout le monde dans le vocal peut lancer des **équipes aléatoires** (attaque / défense) ou tirer une **carte au hasard**. Un menu de **préréglages** (Compétitif, Premier, Duo…) applique nom et places en un clic.
Plusieurs salons « Créer » possibles (un par mode), règles de la catégorie copiées, suppression retardée réglable, transfert automatique si le propriétaire part.

**Module « Mates & outils Valorant »** : `/mate` publie une recherche de mates (rang et plateforme lus sur les rôles si le joueur ne les écrit pas, bouton « Je rejoins », expiration automatique, un seul post actif par joueur). **Il remplace l'ancienne commande `/lfg`.**
**`/mate` est disponible dès l'installation, dans n'importe quel salon, sans activer le module.** La commande ouvre un **formulaire** : le joueur écrit lui-même le mode (obligatoire : compétitif, premier, non classé, spike rush, scrim, un mode perso…), son rang et son rôle / ses agents (obligatoires, texte libre), son âge (facultatif, 13 à 99) et une note (facultatif, 300 caractères, pas de liens). Rang, agents et âge sont pré-remplis avec sa dernière annonce. Le mode est reconnu (« ranked », « unrated », « swiftplay », « duo »…) pour fixer le nombre de mates cherchés (4 pour une équipe de 5, 1 pour un duo) ; un mode inconnu est gardé tel quel avec 1 place. Si un salon de recherche est choisi dans le module, l'annonce y est publiée ; sinon elle est publiée dans le salon où la commande est tapée. Les réglages de l'ancien module (salon, rôle à mentionner, durée…) sont repris automatiquement.
Autres commandes (module à activer) : **`/equipes`** (attaque et défense tirées au sort avec les joueurs de ton vocal), **`/agent`** (agent au hasard, avec un rôle au choix), **`/map`** (carte au hasard), **`/compo`** (composition de 5 agents : un Duelliste, un Initiateur, un Contrôleur, une Sentinelle et un cinquième libre) et **`/defi`** (défi au hasard).
La liste des 28 agents et des 12 cartes est dans `src/lib/valorant.js` : quand Riot en ajoute un, il suffit d'ajouter une ligne.

Le bot a besoin des permissions **Parler** et **Couper le micro des membres** : si le bot est déjà sur ton serveur, ré-invite-le avec le lien du dashboard ou donne-lui ces deux permissions.

## TikTok : tes vidéos et tes lives (deux modules séparés)

Deux modules indépendants, catégorie Communauté. Chacun a son salon, son rôle à mentionner et son message personnalisable.

| Module | Ce qu'il fait | Réglages |
| --- | --- | --- |
| **TikTok · Nouvelles vidéos** | Une annonce à chaque nouvelle vidéo que tu postes | ton @, salon, rôle, fréquence (10 min par défaut), message |
| **TikTok · Lives** | Une annonce quand tu lances un live | ton @, salon, rôle, fréquence (2 min par défaut), délai entre deux annonces, message |

Pour les utiliser : active le module, renseigne ton @ (ou le lien de ton profil) et le salon, enregistre, puis clique sur **Tester**.
Le premier passage mémorise tes vidéos existantes sans rien publier. Une vidéo de plus de 3 jours n'est jamais annoncée, et au plus 3 annonces partent par vérification.
Variables des messages : `{account}`, `{author}`, `{title}`, `{link}`, `{cover}` (image de la vidéo), `{avatar}`, `{platform}` pour les vidéos ; `{streamer}`, `{title}`, `{game}`, `{url}`, `{platform}`, `{viewers}`, `{maxViewers}`, `{totalViewers}`, `{duration}`, `{avatar}`, `{cover}` pour les lives.

**Un rendu complet, et tout est modifiable** : tous les messages du bot (accueil, tickets, lives, vidéos…) acceptent maintenant du texte, un embed avec **champs** (Streamer, Spectateurs max, Plateforme…, sur la même ligne ou non), une image de l'auteur, un titre cliquable et jusqu'à 5 **boutons-liens** (« Regarder sur TikTok »). Les modèles par défaut des lives et des vidéos sont déjà construits comme ça ; tu peux tout changer, ajouter ou supprimer dans le dashboard (aperçu en direct à côté). Un champ dont la valeur est vide n'est pas affiché (ex. « Total spectateurs » quand la plateforme ne le donne pas). Les messages qui ont déjà leurs propres boutons (tickets, vérification, panneaux de rôles) gardent les leurs.

**Pendant et après le live** : à chaque vérification (2 min par défaut), le bot met à jour l'annonce (spectateurs, titre, jeu, image) si quelque chose a changé. Quand le live est vu « hors ligne » deux fois de suite (pour ignorer une micro-coupure), il termine : au choix transforme l'annonce en récapitulatif (« Le live de X est terminé » avec spectateurs max, plateforme, durée), envoie un nouveau message, ou ne fait rien. Le maximum de spectateurs est le plus haut relevé aux vérifications (un pic entre deux vérifications peut échapper) ; le total de spectateurs n'existe que si la plateforme le fournit. Option « Mentionner @everyone » disponible pour les lives et les vidéos.

**À savoir** : TikTok n'offre aucun accès officiel pour cela, donc le bot passe par des sources publiques non officielles, qui peuvent être bloquées ou changer sans prévenir :
- Vidéos : le service public tikwm.com, puis une instance RSSHub en secours (`RSSHUB_URL`, par défaut `rsshub.app` ; si tu héberges la tienne, elle passe en premier).
- Lives : l'API web de TikTok, puis la page de ton profil en secours.
Depuis un hébergeur comme Railway, TikTok bloque parfois les requêtes. Le dashboard affiche alors l'erreur exacte, et rien n'est annoncé par erreur. Si ça arrive (erreur 403) :
- **Annonce à la main, toujours possible** : `/tiktok video lien:<lien de ta vidéo>` (titre repris de TikTok, ou donné par toi) et `/tiktok live` (titre facultatif). Même message, même salon, même rôle que l'automatique, et la vidéo n'est pas annoncée deux fois. Commande réservée à « Gérer le serveur ».
- **Flux RSS personnalisé** : champ « Flux RSS de tes vidéos » du module (`{account}` est remplacé par ton compte), essayé avant les autres sources. Utile si tu as un RSSHub à toi ou un service qui fabrique un flux RSS d'un compte TikTok.

## Alertes de lives et de vidéos (autres plateformes)

Module « **Alertes de lives** » (Twitch, Kick, YouTube) et module « **Vidéos YouTube, TikTok et RSS** ». Pour ton propre TikTok, utilise les deux modules ci-dessus.

| Plateforme | Lives | Nouvelles vidéos | Ce qu'il faut |
| --- | --- | --- | --- |
| YouTube | oui | oui | rien |
| Twitch | oui | non | application gratuite (ci-dessous) |
| Kick | oui | non | application gratuite (ci-dessous) |

**Twitch** : va sur dev.twitch.tv/console, « Register Your Application » (catégorie « Application Integration », type « Confidential », adresse de redirection `http://localhost`), puis recopie l'identifiant et génère un secret. Dans Railway, onglet **Variables**, ajoute `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`.

**Kick** : dans ton compte Kick, Paramètres puis « Developer », crée une application et ajoute `KICK_CLIENT_ID` et `KICK_CLIENT_SECRET` dans Railway.

Le premier passage mémorise l'état sans rien publier, ensuite chaque nouveau direct envoie une seule alerte (avec un délai minimum réglable entre deux alertes du même streamer). Le bouton « Tester » du dashboard envoie l'alerte tout de suite si le streamer est en direct.

## Messagerie privée (MP dans le dashboard)

Module « **Messagerie privée** » (catégorie Support, réservé aux administrateurs) et page « **Messages privés** » du dashboard.

- Un membre écrit en privé au bot : le message apparaît dans la page, avec une pastille « non lus » dans le menu.
- Tu réponds depuis la page : le bot envoie ta réponse en message privé. Le bouton « Nouveau » permet d'écrire le premier à un membre du serveur.
- Le bot répond automatiquement au premier message (« transmis à l'équipe de … », modifiable, au plus une fois toutes les 12 h) pour que le membre sache que l'équipe le lit. Garde-le activé.
- Option : un salon d'alerte où le bot signale un nouveau message. Option : suppression automatique après N jours (90 par défaut).
- Chaque serveur ne voit que les conversations de ses propres membres. Seuls les messages écrits au bot et tes réponses sont conservés (pas les autres MP du bot, comme les contestations).
- Limites : le bot ne peut écrire qu'à un membre qui partage un serveur avec lui et qui accepte les messages privés. La page se rafraîchit toute seule toutes les quelques secondes (pas de temps réel instantané). Pas d'envoi de fichiers depuis le dashboard, mais les pièces jointes reçues s'affichent.
- Aucune intention supplémentaire à activer dans le portail Discord.

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
4. Onglet **Variables** : `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` (longue suite au hasard), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `OWNER_IDS`, `BOT_NAME`, `DB_PATH=/data/bot.db`, `TRUST_PROXY=1`.
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
à `src/bot/commands/index.js`. Discord autorise **100 commandes** au maximum (il en reste 8). Relance, ou `npm run deploy-commands`.

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
