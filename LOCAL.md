# Développer Le classeur en local

## Le bon projet

Le dépôt contient plusieurs projets sur des branches différentes. `main` contient l'atelier du jeu SPAM ; **`wikimasters` contient Le classeur**, le suivi de collection WikiMasters. La branche locale `wikimasters` suit `origin/wikimasters`.

## Lancer sous Windows (PowerShell)

Prérequis : **Node.js 22.13 ou supérieur** (22.17.0 utilisé pour la première vérification). Aucun `npm install` et aucune compilation ne sont nécessaires.

Depuis le dossier `atelier` :

```powershell
git branch --show-current
# La branche doit être wikimasters.
$env:FAUX_JEU = '1'
node dev/server.mjs
```

Ouvrir <http://localhost:8788/>. Choisir « Créer mon classeur », utiliser le code d'invitation **`dev`**, puis conserver le lien personnel obtenu. Arrêter le serveur avec `Ctrl+C`.

Le mode `FAUX_JEU=1` simule le service du jeu pour développer. Il ne récupère pas ta vraie collection. Un nouveau classeur est vide ; les tests d'interface créent leurs propres comptes et cartes de démonstration. Le serveur ne lance les synchronisations planifiées que si on ajoute `--cron`.

Sur la branche `dev-jcd`, Réglages propose de synchroniser les souhaits de toutes les collections ou de choisir dans chaque collection. Passer d'un mode à l'autre conserve les cases individuelles. Pour que les traitements différés continuent automatiquement en local, utiliser `node dev/server.mjs --cron` (toujours avec `FAUX_JEU=1` pour les essais). Le bouton « Synchroniser les souhaits maintenant » dans Réglages ou dans un album permet aussi de lancer une passe ; une minute minimum entre deux passes.

Les données locales persistent dans `dev/local.sqlite` (ignoré par Git). Elles sont indépendantes de l'hébergement de ton ami. L'interface charge Vue depuis cdnjs et les polices depuis Google Fonts : prévoir une connexion Internet pour l'ouvrir normalement. Le test d'interface utilise une copie locale de Vue.

Pour libérer le port si nécessaire, choisir un autre port avant de lancer le serveur :

```powershell
$env:PORT = '8789'
node dev/server.mjs
```

## Où modifier le projet

| Chemin | Rôle |
| --- | --- |
| `site/public/index.html` | Document HTML, chargement de Vue et des ressources |
| `site/public/assets/app.js` | Interface Vue 3, rendue par des fonctions `h()`, navigation et appels API |
| `site/public/assets/app.css` | Styles ordinateur et téléphone |
| `site/public/assets/match.js`, `propose.js` | Rapprochement cartes/articles et suggestions de catégories |
| `site/functions/api/[[path]].js` | Routeur de l'API |
| `site/functions/_lib/` | Collection, sessions, étiquettes, amis, échanges, marché, chat et synchronisation |
| `site/schema.sql` | Schéma de la base |
| `dev/server.mjs`, `d1.mjs`, `supabase.mjs` | Serveur Node, adaptation SQLite vers D1, simulation du jeu |
| `site/worker.js`, `site/wrangler.jsonc` | Hébergement Cloudflare Worker et base D1 en production |
| `site/SPEC.md` | Contrat des routes et des données |
| `data/`, `page/`, `lib/`, `scripts/` | Ancienne version et scripts de préparation ; pas le point d'entrée du site actuel |

Le navigateur appelle `/api/*`. En local, Node traite ces requêtes avec la même API que Cloudflare et stocke les données dans SQLite. Chaque classeur s'ouvre avec une clé personnelle contenue dans son lien ; il n'y a pas de connexion classique par mot de passe.

## Vérifier

Dans un second terminal, depuis `atelier` :

```powershell
node dev/api.test.mjs
node dev/worker.test.mjs
node dev/match.test.mjs
node dev/propose.test.mjs
node dev/ui/smoke_ui.js site/public dev/ui/vendor/vue.runtime.global.prod.min.js --server=http://localhost:8788
```

La dernière commande nécessite le serveur lancé avec `FAUX_JEU=1`. Elle exerce l'interface dans un DOM simulé avec le vrai Vue et l'API locale ; elle ne remplace pas une vérification visuelle dans un navigateur. Elle ajoute des données de test à la base locale.

Pour tester ensuite une vraie collection, la liaison d'un compte du jeu est une étape distincte, décrite dans l'interface « Synchro » et dans `README.md`. Aucun compte réel n'a été relié lors de cette installation.
