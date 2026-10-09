
## 4. Lecture (INFÉRENCES — confiance indiquée)

1. **L'adversaire « 100 % moteur » est presque propre** (confiance haute *sur le modèle*, faible sur la part réelle de
   ces joueurs). Les 1 000 meilleurs decks du moteur sur le pool complet sont une monoculture Aleera #231 (100 % / 99,7 %)
   + Souverain des Chutes d'Éther #136 (89–92 %). Les porteurs perturbateurs y sont marginaux : Provocation 12,6 % (talents)
   / 26,7 % (sans talent) via Le Transporteur Sauvage #58 (7,8–8,5 %) et Rongeur Nuageux #234 (3–9 %), Fumée ≈ 9 % (Ameru
   #191, Poulpe Parleur #146), Gel 8–12 %, Immunité 4–5 %, absorbAny 0,5 %, Renvoi 0 %.
2. **Contraint par une vraie collection, le même moteur recommande beaucoup plus de perturbateurs** (confiance moyenne).
   Avec une collection de ≈ 27 cartes (Aleera possédée dans ≈ 22 % des cas), l'atelier du wiki (`bestDecks`) met une
   Provocation permanente dans 17,5–22,5 % des decks (Yotaru #262 : 15,8 %), Brise-Provocation 11–16 %, Disparition à
   l'impact 11–14 % (Aidan #115 : 12,5 %), Renvoi 7,5–10,8 % (L'Épine d'Amour #106), Immunité 10–12,5 % (Le compagnon des
   esprits #260 : 10,8 % avec talents). Ce sont des **communes** que le moteur apprécie quand le noyau Aleera manque.
3. **Les listes publiques poussent surtout Renvoi, Immunité et Disparition** (fait sur les listes, inférence sur leur
   lecture) : L'Épine d'Amour #106 est dans 32/205 decks 1.20 et 40/187 decks 1.21 ; Le compagnon des esprits #260 dans
   12,5 % de la tier list « All » 1.20 ; Aidan #115 dans 12,5 % de la liste « No talent » 1.20 et 27,6 % de la liste
   « Accessible sans talent ». En 1.21 la liste se déplace vers **Zombie Floral #174 (vanish, 12,5 %)** et **Rongeur
   Nuageux #234 (tauntOnAttack, 10 % de la liste sans talent)**.
4. **L'incident AZURIAN n'est expliqué que par un joueur « casual »** (confiance faible, n = 1 et biais de sélection : la
   partie est retenue parce qu'elle a été perdue). Sous tous les proxies « qui optimisent » (moteur, atelier, copie,
   meilleures cartes), P(Fleur de Vie #222) = 0 % et P(Tisseuse #123) ≤ 0,7 % ; sous « 4 cartes au hasard dans sa
   collection », 3,2 % et 3,3 % (P(les deux) ≈ 0,08 %). La seule mise en avant publique de Tisseuse est la synergie
   « Execution window » (1 des 28 de la page Strategies, la 21ᵉ). Deux lectures compatibles : (a) une part importante des
   adversaires ne suit pas le wiki ; (b) des humains **choisissent** volontairement absorption + Provocation, effets que le
   modèle abstrait sous-estime (absorbAny y vaut les PV d'une carte adverse de 700 PV ; une Provocation un crédit fixe par
   tour) — aucun proxy ne capte ce goût, qui ne se mesurera qu'en tenant le journal de parties.
5. **Ordre de préparation recommandé** (déduit des chiffres, confiance moyenne ; la Provocation passe en tête parce que
   c'est la mécanique dont le pire cas est le plus haut — ≥ 12,9 % dans toutes les variantes, alors que Gel et Disparition,
   plus hauts au mélange, tombent à 9,5 % / 8,5 % chez les joueurs wiki) : Provocation (dont permanente) → Gel →
   Disparition → Immunité → Fumée / Brise-Provocation → Renvoi (cartes + Tox) → resetEnemyCd → absorbAny / setHpPct
   (≈ 1 % par partie chacun, mais ≈ 9 % et ≈ 8 % sur 10 parties, et jusqu'à 18 % / 15 % chez les casual).

## 5. Limites (à lire avant d'utiliser un chiffre)

- **Aucune donnée réelle** : tout est proxy. Les poids du mélange (w, v, τ) sont des hypothèses ; les colonnes casual /
  wiki-only / vétéran / copie 1.21 / sans B et la plage min–max montrent la sensibilité. Le proxy **B** (les 4 cartes les
  mieux placées au classement public des cartes) est le plus fragile — règle déterministe — et porte à lui seul Lisa #56,
  Éclat du Renard Blanc #34 et Gardien Vert #78 ; le classement des cartes n'est utilisé que comme entrée de ce proxy et
  n'est pas affiché.
- **Modèle de collection calé sur un seul joueur** : taux par rareté avec intervalles larges (rares 6/30 → IC 95 % ≈
  8–39 % ; communes hors Esprits 13/60 → ≈ 12–34 %) ; les 6 Esprits sont supposés possédés par tous (non vérifié) ; « la
  moitié des adversaires ressemble au joueur » suppose un matchmaking par niveau (non vérifié). Le scénario V est inventé.
- **Version** : moteur et atelier en **1.20** ; le jeu est en **1.21** depuis le 09/10. Seules les listes publiques 1.21
  sont prises en compte (P3 1.21, D … 1.21, variante « copie 1.21 ») ; le moteur 1.21 (`engineHash 36e2c03d5b7bf4a1`, code
  différent) n'a pas été exécuté. Effet attendu : plus de Zombie Floral #174 (vanish) et de Rongeur Nuageux #234
  (Provocation) chez les joueurs wiki.
- **Recherche P1** : la variante avec talents est tronquée au-delà du rang ≈ 500 (le score rapide prédit mal le score
  complet avec talents : 129 des 1 000 meilleurs decks au score complet venaient des rangs rapides 3 001–4 000, et le top
  1 000 `Te` puise jusqu'au rang 1 499 du score complet) ; la variante sans talent est robuste (99ᵉ centile du rang rapide
  = 1 928 < 4 000). Contrôle de complétude : 39 928 quadruplets aléatoires, 13 (talents) et 19 (sans talent) au-dessus du
  4 000ᵉ seuil (≈ 15 attendus), **0 absent** de la liste trouvée. Un premier contrôle avec un générateur aléatoire
  défaillant (4 355 tirages distincts sur 40 000) a été jeté et refait.
- **Talents** : « avec talents » = chaque carte a son meilleur talent (mode `best-one` du moteur), alors que les talents
  exigent des doublons ; les mécaniques données par un talent (Focus 25 %/tour de Provocation, Longueur, Imprécision,
  Immunité-8) ne sont comptées que là où le talent est connu (P1 T, C T, listes publiques).
- **Effets ambigus** : une Provocation donnée à un allié (Neilla #101, Girafe Florale #72 sur toute l'équipe, Yotaru #262
  sur un allié au hasard) est comptée comme Provocation ; la cible de Silenfeu (Ignea #91, `target: none`) est supposée
  adverse.
- **Canal Tox (T4)** : probabilités d'**offre** calculées sur les pools et les cotes de toxinfo.json (chance = n° du tour,
  sans relance ni Chanceux) ; l'« achat » à 1/3 est une hypothèse naïve.
- **Indépendance entre parties** supposée dans T7 (en réalité, on recroise des joueurs et des decks).
- **Coût de calcul** : recherche globale 17 min + atelier sur 160 collections 24 min (machine partagée par ≈ 50 processus
  node) — au-dessus du budget de 30 min ; rien d'autre n'a été lancé.

## 6. Fichiers

- `audit/F/F_meta.md` — ce rapport ; `audit/F/F_meta.json` — toutes les valeurs : `mechanics[]` (P par proxy, mélange et
  variantes, cartes porteuses), `cards[]` (P de chaque carte par proxy), `proxies`, `observation` (AZURIAN),
  `toxSideChannel`, `sessionExposure`, `topDecks`, `meta` (poids, scénarios, contrôle de complétude).
- `audit/F/cards_mech.json` — mécaniques par carte ; `audit/F/global_results.json` — decks P1 classés (rapide 20 000,
  X 4 000 ×2, Te 1 500) ; `audit/F/collections.json` + `collections_results.json` — collections tirées et decks de
  l'atelier ; `audit/F/completeness_check.json`.
- `audit/F/tiers_props.json`, `tiers_live_props.json`, `strat_props.json`, `strat_live_props.json` — listes publiques
  extraites (1.20 sauvegardée, 1.21 live) ; `audit/F/dl/` — pages téléchargées (données).
- `audit/F/scripts/` — `lib.js` (pilotes moteur, ≤ 6 processus), `global.js` (P1), `collections.js` (C), `mech.js`,
  `analyze.js` (tous les proxies + mélange), `tables.js` (tableaux de ce rapport), `astro_props.js`.
