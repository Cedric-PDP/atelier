# spam-atelier — atelier de decks SPAM (projet perso)

> **Projet personnel, sans aucun lien avec O'Work / OCI.** Ne jamais y mêler le travail : pas d'email
> `@oci.fr` dans les commits (le dépôt a sa propre identité git locale, adresse noreply GitHub), pas
> d'outils, de MCP ni de mémoire O'Work (cicd-live, rag, SCRIPTS_V2…). Ouvrir Claude Code **dans ce dossier**.
> Dépôt **privé** : il contient un instantané du moteur et des textes de spamgame-wiki.com (contenu tiers).

L'utilisateur joue à **SPAM** (jeu de cartes Steam de Ticroco). Ce dépôt contient l'interface « Atelier de
decks SPAM » et tout ce qu'il faut pour recalculer ses données.

## L'interface publiée

- Artifact : https://claude.ai/artifact/3a61vyiop6v5cLPs9H19iE — page `site/atelier-spam.html`, qui charge
  `data.json` et `shop.json` (publiés à côté via `files`).
- Capacité `db` : collection `decks` = decks sauvegardés `{name, cards:[numéros], createdAt}`.
  Instantané dans [spam/decks.json](spam/decks.json) ; **la source vivante est la base**, pas le fichier.
- Republier : `Artifact` publish, `file_path: site/atelier-spam.html`,
  `files: {"data.json": "site/data.json", "shop.json": "site/shop.json"}`, `url:` celle ci-dessus. Dans une
  nouvelle session, faire d'abord `action: "read"` sur l'URL. Omettre `capabilities` pour garder la `db`.
- Avant de republier une page modifiée : `node scripts/app/smoke_page.js site/atelier-spam.html site`
  (faux DOM, doit finir par `NO RUNTIME ERRORS`), puis supprimer `site/_analysis.html`.

## Le joueur

- Collection au 2026-10-09 (26 numéros) : `1 2 3 4 5 6 12 27 30 33 69 82 102 103 116 117 153 156 158 160 180
  227 238 243 251 259` ([spam/mine.txt](spam/mine.txt)). Aucun talent débloqué.
- Liste de souhaits (dans la page) : Aleera (231, la grosse amélioration), Maître Amphibien, Spectre Canin,
  Princesse Meridia, Souverain des Chutes d'Éther.
- **N'aime pas les decks qui dépendent des critiques** (trop aléatoire). Les adversaires sont de vrais
  joueurs, qui peuvent avoir des talents.
- Incident fondateur : en vrai match, *Tisseuse de Mots* (#123, Veuve noire = `absorbAny`) a absorbé notre
  *Chimère Brasse-chair* → d'où la métrique « carte perdue » `L` (score si une carte disparaît au tour 1).

## Le moteur (instantané du wiki, jeu 1.20)

- `spam/js/simulation.js` = `/_astro/simulation-*.js` de spamgame-wiki.com, `spam/js/model.json` =
  `/data/model-*.json` (127 cartes, engineHash `a8193b3d422a54a9`). `model_crit1.json` est identique à
  `model.json`. Variantes : `model_nocrit` (sans critiques), `model_crit<k>` (critiques ×k),
  `model_dead` (+ une carte factice `dead-card`, 1 PV, pour la carte perdue).
- Exécuté dans un `vm` Node isolé (ni `require` ni `fs` dedans) : `scripts/sim_lab2.js <engine>
  "x1=<model>;x0=<model>" <driver.js> <out.json>`. Le driver est du JS évalué dans le contexte du moteur :
  globals `MODELS`, `OUT` (écrit dans out.json), `ht` (fabrique d'évaluateur) ; les données doivent être
  embarquées dans le driver.
  ```js
  (()=>{const I=ht(MODELS.x1);const r=I.evaluate(ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false});
   OUT.res={score:r.score,ttk:r.ttk,matchups:r.matchups,dmgByTurn:r.dmgByTurn};})();
  ```
- Repères sans talent : baseline 4 714,7, meilleur deck 15 336,6. Deck chimere = 8 018 (48 % des dégâts
  viennent des critiques).

## Recalculer les données de la page

```bash
bash scripts/app/recompute.sh
```

Enchaîne : `gen_drivers` (pre, lost) → `pre` = tous les decks de 4 cartes du pool (31 465, 6 process,
≈ 9 min) → `pick_shop_keys` (1 630 decks) → `gen_drivers shop` → `lost` (20 process) → `shop` (20 process,
≈ 2,4 s/deck ; le PC perso a 22 cœurs) → `build_core` + `build_shop` → smoke de la page. Les sorties
intermédiaires vont dans `spam/app/`, les journaux `*_log_*.txt` sont ignorés par git.

Le **pool** = [spam/app/pool_order.json](spam/app/pool_order.json) : 31 uuid, les **26 possédés d'abord**,
puis les 5 souhaités. Quand la collection change :
1. mettre à jour `spam/mine.txt` et `pool_order.json` (possédés en tête) ;
2. mettre à jour `NOWN` dans `scripts/app/build_core.js` **et** `scripts/app/pick_shop_keys.js` ;
3. relancer `recompute.sh`, republier.

Valeurs **codées en dur** dans `build_core.js`, à revoir après un patch : `meta` (version du jeu, date,
baseline, best, paliers S/A/B/C, meilleur deck) et `sims` (simulations de boutique Monte-Carlo de 4 decks).
`stats/g_res_*.json` (échantillon global de 24 000 decks, drivers `scripts/stats/drv_g_*.js`) ne dépend pas
de la collection.

## ⚠️ Patch 1.21 (2026-10-09) — les scores de la page sont périmés

15 cartes modifiées, dont 6 de la collection : 180, 259, 153, 30, 158, 102 (`spam/patch.txt` = 1.20). Pour
recalculer : récupérer le nouveau `simulation-*.js` + `model-*.json` du wiki (noms hachés, à lire dans le
HTML de la page builder), les déposer dans `spam/js/`, régénérer les variantes de modèle (`model_nocrit`,
`model_dead`…), mettre à jour `meta` dans `build_core.js`, puis `recompute.sh`.

## Réseau et données réelles

- Depuis le PC du travail, le proxy bloque spamgame.com, Steam (store/community/api) et metabot.gg (curl
  **et** WebFetch) ; spamgame-wiki.com passe en `curl -s -L --max-time 30`.
- Aucune source publique de matchs réels (ladder, replays, API) : le wiki et metabot ne font que simuler.
  Le jeu garde l'historique des matchs (taux de victoire par deck) **en local** sur le PC perso.

## Plan du dépôt

| Chemin | Contenu |
|---|---|
| `site/` | la page publiée + `data.json` / `shop.json` (sortie de `recompute.sh`) |
| `scripts/sim_lab*.js`, `run_sim.js` | lanceurs du moteur dans un `vm` |
| `scripts/app/` | pipeline de la page (`recompute.sh`, `gen_drivers`, `pick_shop_keys`, `build_*`, `smoke_page`) ; `drv_*_N.js` sont **générés** depuis `drv_*_0.js` |
| `scripts/*.js`, `stats/`, `addx/`, `mcv2/` | drivers des analyses ponctuelles (critiques, talents, Monte-Carlo, ajout de carte…) |
| `spam/js/` | moteur + modèles |
| `spam/*.json`, `*.csv`, `*.txt` | cartes (FR/EN), Tox, collection, extraits texte du wiki (règles, méthodologie, stratégies), résultats d'analyses |
| `spam/app/`, `spam/stats/` | sorties intermédiaires lues par `build_core.js` |
| `spam/audit/README.md` | cadrage de l'audit des mécaniques (en cours le 2026-10-09, rapports pas encore versés) |

Les pages HTML brutes aspirées du wiki (`spam/pages/`, `spam/*.html`, `spam/audit/A_raw/`) ne sont pas
versionnées : elles se re-téléchargent.
