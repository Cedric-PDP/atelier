# Le classeur (WikiMasters)

Site de suivi de collection pour [WikiMasters](https://www.wiki-masters.com) (jeu de cartes tirées des articles de
Wikipédia en français), pour l'utilisateur **et ses amis**. **Sans lien avec le jeu.** Branche orpheline
`wikimasters` du dépôt `spam-atelier` : rien à voir avec SPAM, rien de cette branche ne va dans `main`.

Inspiré de wikimaster-one.vercel.app (« Le classeur ») : reliure avec intercalaires, cartes en pochettes, étiquettes
personnelles avec suggestions, sélection multiple, collections à compléter avec cases vides. Réécrit avec notre code
(licence de la référence inconnue). En plus : comptes par code d'invitation et lien personnel, **synchro par le
serveur** (tu relies ton compte du jeu une fois, depuis une fenêtre privée : le classeur lit ensuite ta collection
toutes les 10 minutes, le marché toutes les 20, ou à ton clic, sur n'importe quel appareil), création de collections
depuis les cartes du jeu (« Depuis le jeu »), catégories de Wikipédia (recherche avec suggestions, propositions
d'après tes cartes), rareté estimée des cartes manquantes, cotes et marché, partage entre amis.

Vocabulaire de l'interface : les **collections** sont les listes de l'utilisateur (créées dans la fenêtre
« Nouvelle collection » : par URL, mots-clés, liste d'articles, propositions ou « Depuis le jeu », une recherche dans
les cartes du jeu) ; les **catégories** sont
les catégories de Wikipédia (« Catégorie:Violet ») qu'il suit. Les deux sont des « collections à compléter » du
serveur (une catégorie suivie a la source `wp:<nom>`).

- **Mise en ligne** (Worker Cloudflare + D1, une fois, ~10 min) : [SETUP.md](SETUP.md). Le même dossier `site/` se
  déploie aussi en projet Pages (sans les lectures automatiques : seul le Worker a des déclencheurs planifiés).
- **Contrat interface / serveur** (routes, formes, limites) : [site/SPEC.md](site/SPEC.md).

## Arborescence

| Chemin | Contenu |
|---|---|
| `site/public/` | **seul dossier publié** : `index.html`, `assets/app.js` (Vue 3 runtime depuis cdnjs, fonctions `h()`, pas de build), `assets/match.js` (rapprochement carte ↔ article par identifiant Wikidata), `assets/propose.js` (propositions : catégories Wikipédia des cartes à ≥ 5 %), `assets/app.css`, `assets/relier.js` (le favori « Relier », servi par `/api/favori.js`), `assets/kokoro.js` et `kokoro.css` (**Kokoro Farmer**, page cachée : le code Konami ↑ ↑ ↓ ↓ ← → ← → B A tapé au clavier, ou sur téléphone SOS en morse ··· ——— ··· (appuis courts et longs) sur le titre de la barre du haut, guettés par `app.js`, ouvre en plein écran un faux booster de 8 cartes UR et L : de vrais articles de Wikipédia très lus (top 1 000 mensuel de deux mois pris au hasard, lu sur `wikimedia.org`, d'où sa place dans `connect-src` ; rareté estimée d'après leurs vues des 30 derniers jours comme dans le classeur ; candidats gardés 3 jours dans le navigateur) ; rien n'est enregistré ; fichiers chargés seulement à ce moment), `nouveautes.json` (page « Nouveautés » et messages système du chat, écrit à la main : SPEC.md, « Nouveautés »), `manifest.webmanifest`, `sw.js` et `assets/icon-*.png` / `apple-touch-icon.png` (app installée, voir plus bas), `_headers` (CSP stricte, sans `unsafe-eval` ni `unsafe-inline`) |
| `site/functions/` | l'API : `api/[[path]].js` (routeur, au format Pages Functions), `_lib/*` (dont `game.js` : la base du jeu, sessions et renouvellement ; `refresh.js` et `import.js` : lecture de la collection ; `cron.js` : lectures automatiques ; `marketread.js` : lecture du marché ; `cardmarket.js` : marché d'une carte à l'ouverture de sa fiche (enchères en cours, ventes, détail d'une enchère sur le site du jeu) ; `link.js` : liaison par favori « Relier » ; `trades.js` : proposition d'un échange dans le jeu ; `friends.js` : amis du jeu (liste lue, demandes d'ami au clic et automatiques) ; `wishlist.js` : liste de souhaits du jeu (cartes qui manquent aux collections ajoutées, cartes possédées retirées) ; `sell.js` : mise en vente d'une carte dans le jeu et annulation d'une vente ; `bid.js` : mise sur une enchère du jeu) |
| `site/worker.js`, `site/wrangler.jsonc`, `wrangler.jsonc` | déploiement en Worker : `/api/*` vers le routeur, le reste aux fichiers de `public/` ; `scheduled()` lance les lectures automatiques (Cron Triggers `*/10 * * * *` et `5-59/20 * * * *`) ; base D1 `DB` déclarée par son identifiant. Deux configurations identiques (à part les chemins), pour que le Worker marche que son dossier racine soit `site` ou la racine de la branche : **les garder en phase** |
| `site/schema.sql` | schéma D1 (aussi appliqué automatiquement au premier appel) |
| `site/SPEC.md` | le contrat |
| `dev/` | `server.mjs` (serveur local : `site/public/` + `/api/*`, D1 simulée par `node:sqlite`, `--cron`, `FAUX_JEU=1`), `d1.mjs`, `supabase.mjs` (faux Supabase : Auth et PostgREST du jeu), `cron.mjs` (lance un déclencheur à la main), `api.test.mjs`, `worker.test.mjs`, `match.test.mjs`, `propose.test.mjs`, `ui/` (test de l'interface en faux DOM avec le vrai Vue) |
| `data/`, `config/themes.json`, `scripts/`, `lib/`, `page/` | ancienne page claude.ai « Collections WikiMasters » (abandonnée, voir plus bas) |

## Développer et tester

```bash
node dev/api.test.mjs                       # l'API, la session du jeu, la lecture de la collection, les cron et le marché (faux Supabase), avec mesures de CPU ; doit finir par API OK
node dev/worker.test.mjs                    # le point d'entrée Worker ; doit finir par WORKER OK
node dev/match.test.mjs                     # rapprochement par identifiant Wikidata ; MATCH OK
node dev/propose.test.mjs                   # propositions d'après les catégories ; PROPOSE OK
(cd site && npx wrangler deploy --dry-run --outdir <dossier>)   # vérifie la configuration et l'assemblage, sans rien déployer
node dev/server.mjs                         # http://localhost:8788 (code d'invitation : dev ; PORT, DB_PATH, SIGNUP_CODE, COOKIE_SECRET, REFRESH_PAUSE_MS, FAUX_JEU) ; --cron : les lectures automatiques tournent aussi ; FAUX_JEU=1 : la base du jeu est simulée
node dev/cron.mjs collection                # lance une passe du cron (collection ou market) contre la base locale (DB_PATH, COOKIE_SECRET, SYNC_PAUSED) ; affiche son résultat
node dev/ui/smoke_ui.js site/public dev/ui/vendor/vue.runtime.global.prod.min.js                 # interface sur API simulée -> UI OK
node dev/ui/smoke_ui.js site/public dev/ui/vendor/vue.runtime.global.prod.min.js --server=http://localhost:8788   # sur le serveur local lancé avec FAUX_JEU=1
```

**Catalogue retiré (2026-10-16)** : les 59 collections proposées tirées de Wikidata (`site/public/catalog.json`, fait par
`scripts/build_catalog.js` d'après `config/themes.json`) ont quitté l'interface, remplacées par les catégories de
Wikipédia. Le fichier et son script sont supprimés (ils restent dans l'historique git, jusqu'au commit 0efecd9) ;
`config/themes.json` reste, lu par `scripts/build_reference.js` de l'ancienne page. Les collections déjà ajoutées depuis
le catalogue (source `catalog:…`) restent des collections comme les autres.

Avec `--server`, le test de l'interface a besoin du faux jeu : lancer le serveur local avec `FAUX_JEU=1 node dev/server.mjs`
(routes de dev `/__jeu/joueur`, `/__jeu/collection`, `/__jeu/cartes`, `/__jeu/encheres`, sans clé, qui ne répondent que dans ce mode). Aucun
appel ne part vers le vrai jeu : les tests n'ont jamais la base Supabase du jeu. **Première lecture réelle à faire à la main**
avant d'annoncer : `node dev/cron.mjs collection` contre une copie de la vraie base avec un compte relié.

Pousser sur `wikimasters` suffit : Cloudflare republie le site (une fois le Worker créé, voir SETUP.md).

## Téléphone et app installée (2026-10-20)

- **Interface téléphone** (sous 760 px, `@media (max-width: 760px)` à la fin de `app.css`) : barre du haut (retour,
  titre de la vue, synchro), barre flottante en bas (Collections, Amis, Chat, Marché, Plus), feuille « Plus » (Mes
  cartes, Synchro, Réglages, Nouveautés, Installer l'app), filtres de « Mes cartes » et fenêtres en feuilles du
  bas. Les éléments `.m-only` sont rendus partout mais cachés au-delà : **la version large ne doit pas changer**.
- **App installée (PWA)** : `manifest.webmanifest` + `sw.js` (service worker à la racine, sa propre CSP dans
  `_headers`). Le service worker prend **toujours le réseau d'abord** et ne garde une copie que pour ouvrir l'app sans
  réseau ; il ne touche jamais `/api/*` (ni `/api/favori.js`, le code du favori « Relier »), ni les illustrations de Wikimedia. Sans réseau, l'app
  montre « Pas de connexion au classeur » et « Réessayer » (jamais « Oublier cette clé ») et se rouvre seule au retour
  du réseau. Icônes tirées de `assets/icon.svg` (fond plein ; la « maskable » réduite à 78 % pour la zone sûre).
- **Sur iPhone**, l'app installée ne partage pas le stockage de Safari : au premier lancement elle ne connaît pas la
  clé. « Installer l'app » (feuille « Plus ») fait copier le lien personnel, et l'accueil de l'app met « J'ai déjà un
  lien » en premier. Le favori « Relier » se lance toujours dans une fenêtre privée du navigateur, jamais dans l'app (rappelé dans « Synchro »).
- **Changer le service worker** : changer `CACHE` (`classeur-v1` → `v2`) quand la stratégie change ; les anciens caches
  sont effacés à l'activation. **Tout annuler** (service worker cassé chez les membres) : remplacer `sw.js` par
  `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.map((x) => caches.delete(x)))).then(() => self.registration.unregister())));`
  et retirer l'appel à `register` dans `app.js` ; le navigateur relit `sw.js` à chaque ouverture (`Cache-Control: no-cache`).
- Testé dans Chrome (écran de 390 px simulé : critères d'installation, cache, ouverture hors ligne) ; **pas encore sur
  un vrai iPhone ni un vrai Android**.

## Limites de Cloudflare (à respecter dans le code)

- Le classeur tourne sur l'**abonnement payant des Workers** (depuis le 2026-10-17) : les Cron Triggers des lectures automatiques en ont
  besoin (30 s de CPU par invocation pour une expression de moins d'une heure, les attentes réseau ne comptant pas). La règle des
  **10 ms de CPU par requête** des Workers gratuits est gardée, parce qu'elle ne coûte rien : aucune requête ne traite plus de ~500
  cartes en JavaScript. La lecture de la collection range chaque page de 1 000 exemplaires en deux lignes de 500 (une ligne de D1
  fait 2 Mo au plus) et la finalisation se fait en SQL dans D1 (le temps SQL ne compte pas). `dev/api.test.mjs` mesure le JavaScript
  de chaque chemin. Collections à compléter : pas de nombre d'éléments maximal, 1,7 Mo chacune, 600 Ko par envoi ; au-delà, la page
  les envoie en morceaux, réassemblés en SQL (`targets.js`, `upload`).
- **Sous-requêtes et temps d'une invocation de cron** : une passe du marché fait jusqu'à ~30 requêtes par membre à une par seconde
  (`CRON_BUDGET_MS`, 10 min, borne la passe) ; le code ne compte pas les sous-requêtes (limite de la plateforme : 1 000 par invocation
  en payant) : **à surveiller** dans les journaux du Worker quand le nombre de membres augmente.
- **D1** : 50 millions de lignes écrites par mois comprises dans l'abonnement ; les cotes (jusqu'à 15 000 par membre et par jour,
  150 000 pour tout le site) en sont la plus grosse part.
- **Projet Pages** : pas de Cron Triggers, donc pas de lectures automatiques (le clic marche).

## Règles du jeu et sécurité

- Les règles de WikiMasters (« Règles de la communauté » §3, CGU §6) interdisent les outils qui jouent ou
  **interagissent à la place du joueur**. Le classeur **lit** seulement (la collection du membre, ses mises et ses ventes, les
  cotes du marché) dans la base du jeu, et, à l'ouverture d'une fiche, le détail de ses enchères sur la route du marché du site du jeu
  (`/api/marketplace/<id>`, limitée par le jeu : plafond par minute, pause de 10 min s'il limite) ; il n'y écrit, au clic du membre, que la **proposition d'un échange** à un ami
  (« Proposer un échange », 2026-10-22 ; cartes et wikibidous d'un côté ou de l'autre depuis le 2026-10-23) et la **mise en vente** d'une de ses cartes ou l'**annulation** d'une de ses ventes tant que personne n'a misé
  (« Mettre en vente », 2026-10-23, routes `/api/marketplace` du site du jeu), une **mise** sur une enchère (« Miser », 2026-10-26, depuis les
  bonnes affaires et les enchères d'une fiche, `POST /api/marketplace/<id>/bid` relevée dans le HAR du 2026-10-26), et des **demandes d'ami** (2026-10-24 : au clic depuis
  la fenêtre d'échange, et **sans clic** pour un membre qui coche « Envoyer une demande d'ami aux membres du classeur », une fois
  par membre relié, route `POST /api/friends` du site du jeu relevée dans le HAR du 2026-10-24, voir [site/SPEC.md](site/SPEC.md),
  « Amis dans le jeu »), et, pour un membre qui coche « Liste de souhaits du jeu » (2026-10-24, **sans clic**), sa **liste de
  souhaits** (cartes qui manquent à ses collections ajoutées, cartes obtenues retirées, table `wishlist_items` relevée dans le HAR
  du 2026-10-24, voir [site/SPEC.md](site/SPEC.md), « Liste de souhaits du jeu ») : ce que visent ces règles, choix assumé ; il n'imite pas un navigateur. **Depuis le 2026-10-22, il lit
  régulièrement et automatiquement, sans geste du joueur**, depuis des adresses Cloudflare : la collection et le solde de wikibidous
  toutes les 10 minutes (collection relue en entier si elle a changé, et au moins toutes les 6 h), le marché toutes les 20 minutes (30 requêtes à une par seconde au
  plus par passe), avec une session du jeu par membre. Ce que le jeu peut en voir, les garde-fous (limite du jeu → passe sautée,
  trois échecs → pause, case « Synchro automatique », variable `SYNC_PAUSED`) et ce que ça change par rapport à la règle d'avant :
  [site/SPEC.md](site/SPEC.md), « Règles du jeu ». Les étiquettes et collections vivent dans le classeur.
- **Clé du classeur** : 32 octets aléatoires, seul son SHA-256 est stocké ; envoyée en `X-Classeur-Key`. Le lien
  personnel `#cle=…` la contient : qui l'a voit et modifie le classeur.
- **Session du jeu** : une par membre, née dans une **fenêtre privée** (une session partagée avec le navigateur du joueur se
  ferme des deux côtés, Supabase renouvelle ses jetons par rotation). Vérifiée auprès du jeu avant d'être gardée (à qui est-elle ?
  un compte du jeu ne se lie qu'à un classeur), chiffrée AES-GCM (clé dérivée de `COOKIE_SECRET` par HKDF, id du compte en donnée
  associée), jamais renvoyée au navigateur, renouvelée par le serveur sous verrou ; « Oublier la liaison » l'efface (sans
  déconnecter le jeu). Se déconnecter du jeu, sur n'importe quel appareil, ferme aussi celle du classeur : il faut relier à nouveau.
- **Liaison par favori « Relier »** : jeton à usage unique de 30 minutes (seul son SHA-256 est stocké), qui ne permet que de **déposer**
  une session que le jeu doit reconnaître ; il n'ouvre jamais le classeur. Il passe dans `window.__classeurLien`, jamais dans l'adresse.
- **HAR** (secours) : peut contenir la session. L'interface n'en envoie que l'URL et l'en-tête `Cookie` des requêtes vers
  wiki-masters.com. Jamais de HAR dans git (`*.har` ignoré).

## Ancienne page claude.ai (abandonnée)

Avant le classeur, une page claude.ai « Collections WikiMasters » (capacité `db`) affichait la collection d'après un
HAR. Elle est devenue introuvable quand la session a changé de compte claude.ai, et le classeur la remplace. Ses
scripts restent, pour leurs données et leurs leçons :

- `scripts/extract_har.js` + `lib/extract.js` : cartes d'un HAR (format des réponses `my-collection`) ;
- `scripts/wikidata.js`, `refine.js` : natures, métiers, lieux, petits albums tirés des relations Wikidata ;
- `scripts/categories.js` : test « élargir » (catégories Wikipédia et leurs parentes ; à 10 % ne sortent que des
  ensembles minuscules, les vraies pistes sont ceux où l'on a déjà 2 cartes) ;
- `scripts/pageviews.js` : vues sur 30 jours (`prop=pageviews`, suivre `pvipcontinue`, 429 + Retry-After en rafale) ;
  seuils de rareté observés en vues/mois : C < 50, PC < 250, R < 1 000, SR < 5 000, UR < ~20 000, L au-delà ;
- `scripts/images.js` + `thumbs.py` : vignettes Wikimedia en WebP (Pillow, `python -E -P`) ;
- `page/app.html`, `scripts/build_reference.js`, `build_page.js`, `smoke.js`, `db_seed.js` : la page elle-même.
