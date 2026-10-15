# Collections WikiMasters

Outil personnel de suivi de collection pour [WikiMasters](https://www.wiki-masters.com) (jeu de cartes tirées des
articles de Wikipédia en français). **Sans lien avec le jeu.** Branche orpheline `wikimasters` du dépôt
`spam-atelier` : rien à voir avec SPAM, rien de cette branche ne va dans `main`.

Page publiée (claude.ai, ne s'ouvre que sur le PC du travail) : voir l'URL dans la section « Publier ».

## Le principe : tout se passe hors du jeu

Les règles de WikiMasters (« Règles de la communauté » §3, CGU §6) interdisent bots, scripts et outils qui jouent ou
**interagissent à la place du joueur**, sous peine de bannissement. Donc :

- la page **ne touche jamais au site du jeu** : elle lit un export fait à la main dans le navigateur ;
- les **étiquettes** (nature, métier, pays) et les **collections** sont calculées ici, à partir de Wikidata, et ne
  sont jamais reposées dans le jeu ;
- aucun script n'appelle l'API du jeu (`/api/…`, interdite aux robots par son `robots.txt`).

## Exporter sa collection (manuel, dans le navigateur)

1. Sur wiki-masters.com, connecté, ouvrir la page de sa collection.
2. `F12` → onglet **Réseau** → cocher **Conserver le journal** → `F5`.
3. Faire défiler toute la collection jusqu'en bas (le site charge 50 cartes par requête
   `GET /api/my-collection?sort=rarity&page=N&stats=0` ; seules les pages chargées sont dans l'export).
4. Icône **Exporter HAR** → fichier `.har`.
5. Le déposer dans l'onglet « Mettre à jour » de la page, qui extrait les cartes dans le navigateur et ne garde
   qu'elles (bouton « Enregistrer dans l'album » → base de la page).

**Le HAR peut contenir la session de connexion** (cookies, ou un jeton dans une réponse si le site le renouvelle
pendant la capture). Ne jamais le commiter (`*.har` est ignoré) ni l'envoyer. Chrome et Edge récents l'exportent
par défaut sans cookies ni en-têtes d'authentification.

Une réponse `my-collection` contient, par exemplaire : `card.wikipedia_title`, `rarity` (C, PC, R, SR, UR, L),
`pageviews` (vues mensuelles relevées par le jeu à la création de la carte), `category` (description Wikidata),
`atk`, `def`, `q_score`, `image_url`, `wikipedia_url`, `created_at` ; `count`, `is_shiny`, `starred`, `tags`,
`obtained_at`, et un `user_id` que l'extraction ne garde pas. `GET /api/my-collection/stats` donne `totalUnique`,
qui sert à vérifier que l'export est complet.

## Reconstruire les données et la page

```bash
node scripts/extract_har.js <export.har>   # -> data/owned.json (cartes seules ; dit si l'export est complet)
node scripts/wikidata.js                   # cartes -> éléments Wikidata, natures (P31) ; cache/wd.json
node scripts/build_reference.js            # collections, natures, étiquettes, vues des cartes manquantes -> data/reference.json
node scripts/build_page.js                 # -> dist/collections-wikimasters.html
node scripts/smoke.js                      # faux DOM + collection d'essai ; doit finir par SMOKE OK
```

Sans argument, `build_reference.js` réutilise `cache/` et n'interroge que ce qui manque (`--refresh` refait tout).
Les API Wikimedia limitent le débit : `lib/net.js` fait une requête à la fois avec une pause et attend en cas de
refus (429). Depuis le PC du travail, une rafale sans pause s'est fait refuser après une quarantaine de requêtes.

Quand l'utilisateur dépose un nouvel export dans la page, les collections se mettent à jour tout de suite (elles
comparent les titres). Les étiquettes des **nouvelles** cartes et les nouvelles natures demandent de relancer la
chaîne ci-dessus : relire la base de la page (`ArtifactData` `list` de `owned`, puis remettre les morceaux dans
`data/owned.json`), ou repartir d'un nouvel export.

## Ce que calcule `build_reference.js`

- **Collections thématiques** (`config/themes.json`) : un motif SPARQL par thème (races bovines, chiens, chats,
  chevaux, cépages, fromages, éléments, planètes, constellations, États, départements, régions, présidents, rois de
  France, empereurs romains, pharaons, papes, Sept Merveilles, JO d'été). Seuls comptent les éléments qui ont un
  article sur Wikipédia en français. Ajouter un thème = une ligne dans ce fichier.
- **Natures de tes cartes** : la nature Wikidata (P31) de chaque carte ; celles qui regroupent au moins 2 cartes ont
  leur total sur Wikipédia, et deviennent un album complet si elles comptent au plus 1 000 articles. Natures
  ignorées (trop vastes ou sans intérêt) : `naturesSkip`.
- **Étiquettes automatiques** de chaque carte : natures, métiers (P106, au féminin quand la description l'est) et
  pays (P27 ou P17).
- **Rareté estimée des cartes manquantes** : vues de l'article sur 30 jours (`prop=pageviews`, 50 titres par
  requête) comparées aux seuils observés sur les cartes possédées (`thresholds`, `calibration`). Au 2026-10-15,
  sur 1 043 cartes : Commune < 50 vues, Peu commune < 250, Rare < 1 000, Super rare < 5 000, Ultra rare < 20 000
  (limite UR/L encore floue : UR max 14 967, L min 28 785), Légendaire au-delà.

## La base de la page (capacité `db`)

| Document | Contenu |
|---|---|
| `owned/meta` | `{rev, chunks, fields, cards, total, unique, at, source}` : l'export en vigueur ; écrit **en dernier** |
| `owned/<rev>-<i>` | `{rev, i, rows}` : 700 cartes au plus par document (limite 256 Kio), `rows` = tableaux dans l'ordre de `fields` (`t, r, pv, c, at, n, s, f, tags`). Le `rev` est dans le nom : un enregistrement interrompu ne touche pas l'album en vigueur ; les morceaux de l'ancien `rev` sont supprimés après `meta` |
| `lists/<id>` | `{name, titles, createdAt}` : listes créées dans la page (« Mes listes ») |

Amorçage ou remplacement par Claude : `node scripts/db_seed.js` prépare `cache/db_seed/` (`<rev>-0.json`…,
`meta.json`), puis un `ArtifactData` `batch` de `set` avec `file_path` : les morceaux, puis `meta` (avec
`if_version` s'il existe déjà), puis la suppression des morceaux de l'ancien `rev`.

## Publier

`Artifact` publish de `dist/collections-wikimasters.html` avec `capabilities: {db: {}}` au premier envoi, puis
**sans `capabilities`** (pour garder celles déclarées) avec le `url` de la page. Dans une nouvelle session, faire
d'abord `action: "read"` sur l'URL.
