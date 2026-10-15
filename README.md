# Le classeur (WikiMasters)

Site de suivi de collection pour [WikiMasters](https://www.wiki-masters.com) (jeu de cartes tirées des articles de
Wikipédia en français), pour l'utilisateur **et ses amis**. **Sans lien avec le jeu.** Branche orpheline
`wikimasters` du dépôt `spam-atelier` : rien à voir avec SPAM, rien de cette branche ne va dans `main`.

Inspiré de wikimaster-one.vercel.app (« Le classeur ») : reliure avec intercalaires, cartes en pochettes, étiquettes
personnelles avec suggestions, sélection multiple, collections à compléter avec cases vides. Réécrit avec notre code
(licence de la référence inconnue). En plus : comptes par code d'invitation et lien personnel, favori de
rafraîchissement, catalogue de collections proposées, rareté estimée des cartes manquantes.

- **Mise en ligne** (Worker Cloudflare + D1, une fois, ~10 min) : [SETUP.md](SETUP.md). Le même dossier `site/` se
  déploie aussi en projet Pages.
- **Contrat interface / serveur** (routes, formes, limites) : [site/SPEC.md](site/SPEC.md).

## Arborescence

| Chemin | Contenu |
|---|---|
| `site/public/` | **seul dossier publié** : `index.html`, `assets/app.js` (Vue 3 runtime depuis cdnjs, fonctions `h()`, pas de build), `assets/app.css`, `assets/bookmarklet.js` (source du favori), `catalog.json`, `_headers` (CSP stricte, sans `unsafe-eval` ni `unsafe-inline`) |
| `site/functions/` | l'API : `api/[[path]].js` (routeur, au format Pages Functions), `_lib/*` |
| `site/worker.js`, `site/wrangler.jsonc`, `wrangler.jsonc` | déploiement en Worker : `/api/*` vers le routeur, le reste aux fichiers de `public/` ; base D1 `DB` déclarée par son identifiant. Deux configurations identiques (à part les chemins), pour que le Worker marche que son dossier racine soit `site` ou la racine de la branche : **les garder en phase** |
| `site/schema.sql` | schéma D1 (aussi appliqué automatiquement au premier appel) |
| `site/SPEC.md` | le contrat |
| `dev/` | `server.mjs` (serveur local : `site/public/` + `/api/*`, D1 simulée par `node:sqlite`), `d1.mjs`, `api.test.mjs`, `ui/` (test de l'interface en faux DOM avec le vrai Vue) |
| `config/themes.json`, `scripts/build_catalog.js` | catalogue des collections proposées (motifs SPARQL Wikidata) → `site/public/catalog.json` |
| `data/`, autres `scripts/`, `lib/`, `page/` | ancienne page claude.ai « Collections WikiMasters » (abandonnée, voir plus bas) |

## Développer et tester

```bash
node dev/api.test.mjs                       # l'API, avec mesures de CPU ; doit finir par API OK
node dev/worker.test.mjs                    # le point d'entrée Worker ; doit finir par WORKER OK
(cd site && npx wrangler deploy --dry-run --outdir <dossier>)   # vérifie la configuration et l'assemblage, sans rien déployer
node dev/server.mjs                         # http://localhost:8788 (code d'invitation : dev ; PORT, DB_PATH, SIGNUP_CODE, COOKIE_SECRET)
node dev/ui/smoke_ui.js site/public dev/ui/vendor/vue.runtime.global.prod.min.js                 # interface sur API simulée -> UI OK
node dev/ui/smoke_ui.js site/public dev/ui/vendor/vue.runtime.global.prod.min.js --server=http://localhost:8788   # sur le serveur local
node scripts/build_catalog.js               # refait site/public/catalog.json (Wikidata, débit limité, cache dans cache/)
```

Avec `--server`, le test de l'interface colle un faux cookie : le serveur local fait alors **un** vrai appel en
lecture à wiki-masters.com, qui répond 401.

Pousser sur `wikimasters` suffit : Cloudflare republie le site (une fois le Worker créé, voir SETUP.md).

## Limites de Cloudflare gratuit (à respecter dans le code)

- **10 ms de CPU par requête** : aucune requête ne traite plus de ~500 cartes en JavaScript. Import par morceaux de
  500, finalisation en SQL dans D1 (le temps SQL ne compte pas), lecture de la collection par morceaux (`?part=N`),
  rafraîchissement par cookie à 10 pages par appel. `dev/api.test.mjs` mesure le JavaScript de chaque chemin.
- **50 sous-requêtes par appel** (rafraîchissement), **D1** : 100 000 lignes écrites par jour (un premier import de
  N cartes en écrit N).

## Règles du jeu et sécurité

- Les règles de WikiMasters (« Règles de la communauté » §3, CGU §6) interdisent les outils qui jouent ou
  **interagissent à la place du joueur**. Le classeur **lit** seulement la collection (mêmes requêtes que la page
  Collection), toujours sur un geste de l'utilisateur, et n'écrit jamais dans le jeu. Les étiquettes et collections
  vivent dans le classeur.
- **Clé du classeur** : 32 octets aléatoires, seul son SHA-256 est stocké ; envoyée en `X-Classeur-Key`. Le lien
  personnel `#cle=…` la contient : qui l'a voit et modifie le classeur.
- **Cookie WikiMasters** (rafraîchissement côté serveur) : chiffré AES-GCM (clé dérivée de `COOKIE_SECRET` par HKDF,
  id du compte en donnée associée), jamais renvoyé au navigateur ; « Oublier ma session » l'efface. Le favori, lui,
  ne transmet jamais la session : il lit la collection dans l'onglet du joueur et n'envoie que les cartes.
- **HAR** : peut contenir la session. L'interface n'en envoie que l'URL et l'en-tête `Cookie` des requêtes vers
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
