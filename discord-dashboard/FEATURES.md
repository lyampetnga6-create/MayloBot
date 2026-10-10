# Liste des fonctionnalités

Chiffres calculés depuis le code (schéma des modules, liste des commandes), pas estimés.

- **31 modules** réglables depuis le dashboard
- **473 options** réglables (champs de formulaire, sous-champs des listes et groupes inclus ; chaque message personnalisable propose en plus texte, embed, couleur, image, pied de page…)
- **84 commandes slash** (+ 42 sous-commandes, ex. `/ticket claim`, `/ia traduire`) — limite Discord : 100 commandes
- **6 modèles de serveur** + génération par IA
- Messages enregistrés : **illimités**

## Essentiel

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| ⚙️ Général | Apparence des messages du bot, fuseau horaire et commandes autorisées. | 5 |
| 👋 Bienvenue | Accueille (et salue le départ) des membres avec des messages entièrement personnalisables. | 9 |
| 🎭 Rôles automatiques | Donne des rôles aux nouveaux arrivants et rend leurs anciens rôles à ceux qui reviennent. | 6 |
| 🧠 Intelligence artificielle | Choisis le fournisseur d’IA, ta clé d’API et les commandes IA. Sert aussi aux tickets et au créateur de serveur. | 10 |

## Sécurité

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| 🛡️ Auto-modération | Filtre invitations, liens, majuscules, spam, mentions, émojis, mots interdits, pièces jointes… | 44 |
| 🔨 Modération | Sanctions, historique et escalade automatique selon le nombre d’avertissements. | 9 |
| 📜 Journaux | Garde une trace de tout ce qui se passe, avec un salon différent par type d’événement si tu veux. | 31 |
| 🏰 Protection du serveur 🔒 | Anti-raid, anti-nuke, filtre d’arrivée, liens d’arnaque, quarantaine et verrouillage d’urgence. | 45 |
| 🍯 Honeypot (salon piège) | Un salon que personne ne doit utiliser : quiconque y écrit (bot piraté, spammeur) est sanctionné aussitôt. | 13 |
| ✅ Vérification des membres | Les nouveaux restent bloqués tant qu’ils n’ont pas cliqué, résolu un calcul ou répondu à ta question. | 16 |

## Support

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| 🎫 Tickets | Support par salons privés : sujets et formulaires, prise en charge, IA, notes, transcripts… | 84 |
| 💡 Suggestions | Les membres proposent des idées avec /suggestion, la communauté vote, le staff approuve ou refuse. | 14 |

## Communauté

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| 📈 Niveaux & XP | Système d’XP, annonces de niveau et récompenses en rôles. | 23 |
| 🎉 Concours (giveaways) | Concours avec bouton de participation, conditions, entrées bonus et tirage automatique (/concours). | 12 |
| ⭐ Starboard | Les messages qui reçoivent assez d’étoiles sont mis en avant dans un salon dédié. | 8 |
| 🔢 Jeu du comptage | Les membres comptent à tour de rôle : 1, 2, 3… Une erreur et on recommence. | 7 |
| 🎂 Anniversaires | Les membres enregistrent leur date avec /anniversaire, le bot souhaite la fête et donne un rôle pour la journée. | 5 |
| 👍 Réputation | Les membres se donnent des points de réputation avec /rep, avec des rôles à la clé. | 8 |
| 🤫 Confessions anonymes | Les membres envoient un message anonyme avec /confession ; le staff peut retrouver l’auteur en cas d’abus. | 9 |
| 📈 Rappel de bump | Rappelle de « bumper » le serveur (Disboard…) 2 heures après le dernier bump. | 8 |
| 💎 Remerciement des boosts | Un message personnalisé quand quelqu’un booste le serveur. | 4 |

## Fun & économie

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| 🪙 Économie | Monnaie virtuelle : récompense quotidienne, travail, paris, boutique de rôles et d’objets (/solde, /daily, /boutique…). | 21 |
| 🎲 Jeux & divertissement | Commandes amusantes : 8ball, dés, pierre-feuille-ciseaux, morpion, quiz, blagues, câlins… | 3 |

## Automatisation

| Module | Ce qu’il fait | Options |
| --- | --- | --- |
| 🔘 Rôles à boutons | Messages avec boutons pour que les membres choisissent leurs rôles. | 12 |
| 💬 Commandes perso | Crée tes propres commandes à préfixe et des réponses automatiques. | 15 |
| 🔊 Vocaux temporaires | Un membre rejoint un salon « créer », le bot lui crée son salon vocal personnel (supprimé quand il est vide). | 8 |
| 🔢 Salons compteurs | Renomme des salons avec des statistiques en direct (membres, boosts…), toutes les 10 minutes. | 5 |
| 📐 Règles de salon | Réactions automatiques, fils auto, publication des annonces, suppression différée, salons « images seulement »… | 12 |
| ⏰ Messages programmés | Envoie un message à intervalle régulier ou chaque jour à heure fixe. | 10 |
| 📌 Messages collants | Un message qui reste toujours en bas d’un salon (le bot le renvoie après quelques messages). | 6 |
| 🏷️ Pseudos | Nettoie les pseudos : caractères qui font remonter en haut de la liste, mots interdits, format imposé à l’arrivée. | 11 |

🔒 = réservé aux administrateurs du serveur.

## Fonctions du dashboard (hors modules)

- **Profil du bot** par serveur : pseudo, bio, avatar, bannière
- **Webhooks** : création, import, suppression, envoi avec nom et avatar personnalisés
- **Messages enregistrés** : bibliothèque sans limite, recherche, duplication, envoi par le bot ou par webhook
- **Créateur de serveur** : 6 modèles, génération par IA, aperçu éditable, création suivie en direct
- **Actions d’urgence** : verrouillage du serveur, mode raid
- **Salon piège** créé en un clic + avertissement publié
- **Historique** des modifications
- Classement des niveaux (édition), sanctions, liste des tickets, envoi de messages, export / import de la configuration, page Admin du propriétaire

## Commandes slash

**Utilitaire (21)** : `/ping` `/help` `/dashboard` `/avatar` `/userinfo` `/serverinfo` `/annonce` `/dire` `/envoyer-message` `/rappel` `/afk` `/roleinfo` `/channelinfo` `/membres` `/banniere` `/snipe` `/calc` `/timestamp` `/emoji` `/botinfo` `/uptime`

**Modération (20)** : `/ban` `/unban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/unwarn` `/clearwarns` `/purge` `/slowmode` `/lock` `/unlock` `/pseudo` `/tempban` `/softban` `/role` `/nuke` `/note` `/historique`

**Niveaux (2)** : `/rank` `/leaderboard`

**Tickets (1)** : `/ticket`

**Sécurité (4)** : `/verrouillage` `/raidmode` `/quarantaine` `/liberer`

**Communauté (7)** : `/suggestion` `/concours` `/sondage` `/anniversaire` `/rep` `/confession` `/comptage`

**Économie (10)** : `/solde` `/daily` `/travailler` `/donner` `/parier` `/machine` `/boutique` `/acheter` `/inventaire` `/riches`

**Divertissement (17)** : `/8ball` `/pileouface` `/des` `/pfc` `/choisir` `/ship` `/noter` `/blague` `/fait` `/calin` `/quiz` `/morpion` `/inverser` `/retourner` `/moquer` `/applaudir` `/morse`

**Intelligence artificielle (1)** : `/ia`

## Ajouts « maison »

Quelques idées ajoutées en plus de ce qui existe chez DraftBot : confessions anonymes, réputation, vérification par calcul ou question, honeypot, quarantaine, mode raid, salons vocaux temporaires, salons compteurs, messages collants, règles par salon, messages programmés, rappel de bump, `/snipe` (dernier message supprimé), sauvegarde et restauration des rôles au retour d’un membre, créateur de serveur par IA, assistant IA dans les tickets avec FAQ et passage au staff.

## Abonnement (optionnel)

- Essai gratuit par serveur, puis clé de licence `KEY-XXXX-XXXX-XXXX-XXXX` (1 clé = 1 serveur)
- Paiement Stripe automatique (9,99 €/mois), clé envoyée en message privé, coupure à la résiliation
- Commande `/licence statut | activer | desactiver`, page « Abonnement » du dashboard, gestion des licences pour le propriétaire du bot
