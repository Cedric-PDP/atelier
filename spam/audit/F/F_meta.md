# Audit F — Quelles cartes adverses (et quelles mécaniques perturbatrices) le joueur va-t-il croiser ?

SPAM 1.20 (moteur du wiki, model.json engineHash a8193b3d422a54a9) + contrôle sur les classements publics 1.21 · 2026-10-09
· Valeurs complètes par proxy : `F_meta.json` · Scripts reproductibles : `F/scripts/` (aucune autre écriture hors `audit/F/`).

> **Lecture des chiffres** : « P » = probabilité qu'un deck adverse **pris au hasard** contienne **au moins une** carte
> portant la mécanique (ou la carte). Ce sont des estimations par **proxy** : aucune donnée de vraies parties n'existe.
> L'incertitude est donnée par la colonne « plage » et par les variantes de pondération — elle est grande.

## 0. Résumé chiffré

**Mécaniques, par partie** (P_mix = mélange défini au §2 ; « casual » = joueurs sans wiki ; « wiki-only » = atelier +
copie de decks publiés ; « sans B » = mélange sans le proxy « meilleures cartes », le plus fragile ; plage = min–max
des 23 cellules du mélange) :

| Mécanique (innée) | **P_mix** | casual | wiki-only | sans B | vétéran | plage (min–max) | porteurs les plus probables (P_mix de la carte) |
|---|---|---|---|---|---|---|---|
| freeze OU freezeOnHit | **19.9** | 33.3 | 9.5 | 13.4 | 17.5 | 2.5–50.3 | Éclat du Renard Blanc #34 (R, 8.4) · Princesse Meridia #29 (R, 4.0) · Dragosaure Céleste #211 (C, 2.8) · Guerrier des Neiges #59 (C, 2.1) |
| vanish OU vanishOnHit (retire le dernier passif) | **19.5** | 24.8 | 8.5 | 10.4 | 25.2 | 0.0–59.7 | Lisa, la Dragonnière #56 (C, 13.1) · Aidan #115 (C, 4.8) · Zombie Floral #174 (C, 0.9) · Souris des blés #140 (R, 0.8) |
| taunt OU tauntOnAttack (Provocation) | **16.2** | 12.9 | 18.4 | 21.7 | 13.8 | 0.0–27.5 | Yotaru Gardefeuille #262 (C, 6.2) · Girafe Florale #72 (R, 2.7) · Le Transporteur Sauvage #58 (C, 1.6) · Hibernatus #12 (C, 1.6) |
| Provocation tenable chaque tour (cd ≤ durée, ou tauntOnAttack) | **11.0** | 6.4 | 14.7 | 14.7 | 8.6 | 0.0–22.5 | Yotaru Gardefeuille #262 (C, 6.2) · Girafe Florale #72 (R, 2.7) · Rongeur Nuageux #234 (C, 1.4) · Fleur de Vie #222 (C, 0.9) |
| immunity (Tox Immunité innée) | **7.5** | 6.0 | 8.9 | 9.1 | 6.6 | 0.0–20.0 | Le compagnon des esprits #260 (C, 3.6) · Voyageur des Crêtes #237 (R, 2.0) · Codex des Maux Ancestraux #197 (E, 1.2) · Codex des Sorts Lumineux #198 (E, 0.9) |
| smoke (compétence) OU Fumée (Tox innée) | **6.7** | 7.0 | 6.8 | 9.0 | 8.4 | 0.0–22.5 | Ameru #191 (R, 3.3) · Godlur #261 (C, 0.9) · Vivy #243 (C, 0.9) · Le Héraut des Cendres #152 (C, 0.9) |
| breakTaunt | **6.2** | 1.7 | 10.0 | 8.2 | 4.4 | 0.0–15.8 | Yotaru Gardefeuille #262 (C, 6.2) |
| reflect (Tox Renvoi innée) | **4.4** | 1.7 | 6.5 | 5.8 | 3.0 | 0.0–22.5 | L'Épine d'Amour #106 (C, 4.4) |
| resetEnemyCd | **3.6** | 6.9 | 1.0 | 1.8 | 1.4 | 0.0–16.4 | Gardien Vert #78 (R, 3.6) |
| resurrect | **1.6** | 1.0 | 1.8 | 1.7 | 0.9 | 0.0–3.3 | Ashtarae Lycaria #203 (L, 1.6) |
| absorbAny (absorbe une carte adverse) | **1.0** | 2.0 | 0.1 | 1.2 | 0.9 | 0.0–3.8 | Tisseuse de Mots #123 (C, 1.0) |
| setHpPct ≤ 50 % (PV fixés à 25 %) | **0.9** | 1.6 | 0.1 | 1.1 | 0.9 | 0.0–3.2 | Cornu mythologique #139 (R, 0.9) |
| enemyPrec (compétence) | **0.9** | 0.6 | 1.1 | 1.1 | 1.3 | 0.0–5.0 | Luminaire Abyssal #81 (E, 0.9) |
| resetEnemySpamton | **0.8** | 1.1 | 0.6 | 0.7 | 0.9 | 0.0–7.5 | Mélodie des Divinités #96 (L, 0.8) |
| absorbAlly (absorbe un de SES propres alliés) | **1.1** | 0.7 | 1.3 | 1.4 | 1.2 | 0.0–5.0 | Régent des Abysses #86 (E, 1.1) |
| changeElement (change l’élément de SA carte) | **0.3** | 0.4 | 0.1 | 0.4 | 0.6 | 0.0–3.1 | Aeltheria, Mère Primordiale #265 (D, 0.3) |
| eternity (compétence) OU eternityOnHit (hors liste demandée) | **15.8** | 29.1 | 5.0 | 11.2 | 15.8 | 0.0–43.4 | Éclat du Renard Blanc #34 (R, 8.4) · Sorcière Pyrokinétique #51 (C, 2.5) · Maître Thronebéur #64 (C, 1.2) · Félin Errant #21 (C, 0.9) |
| AU MOINS UNE mécanique de la liste, hors effets sur soi (absorbAlly, changeElement) | **60.2** | 70.8 | 45.3 | 53.7 | 58.5 | 25.0–84.4 | — |
| absorbAny / vanish* / freeze* / setHpPct / tauntPermanent / resetEnemyCd (les plus « destructrices ») | **46.9** | 60.3 | 29.7 | 36.9 | 46.5 | 17.5–84.4 | — |

**Points clés**
- **Provocation** et **Gel** sont dans le trio de tête de toutes les variantes de pondération. La Provocation a le pire
  cas le plus haut : 12,9 % (casual) à 21,7 % (sans B) par partie ; une Provocation **tenable à chaque tour** 6,4 % à 14,7 %, portée surtout par **Yotaru Gardefeuille #262**
  (commune), que l'atelier du wiki choisit dans **15,8 %** des collections « comme le joueur ».
- **Gel** et **Disparition** sont plus hauts au mélange (19,9 % et 19,5 %) mais dépendent du profil : 33,3 % / 24,8 % chez
  les joueurs casual, 9,5 % / 8,5 % chez les joueurs wiki (la Disparition y sort du trio de tête). Leurs porteurs n°1 (**Lisa #56**, **Éclat du Renard Blanc #34**) ne sortent
  presque que du proxy « meilleures cartes » (Lisa : 13,1 % au mélange, 2,0 % sans ce proxy).
- **Au moins une mécanique « dure »** (absorbAny, vanish, freeze, setHpPct, Provocation permanente, resetEnemyCd) :
  **46,9 %** des parties (29,7 % wiki-only → 60,3 % casual). Sur 10 parties : 99,8 %.
- Les cartes de l'incident sont **peu probables sous tous les proxies** (≤ 3,8 % par partie) : Tisseuse de Mots #123 (absorbAny) **1,0 %** par
  partie (0,1 % wiki-only, 2,0 % casual ; 9 % de la croiser au moins une fois en 10 parties), Fleur de Vie #222 **0,9 %**.
  Seul le proxy « 4 cartes au hasard dans sa collection » leur donne une probabilité notable (3,3 % et 3,2 %) :
  l'adversaire AZURIAN ne suivait vraisemblablement **aucune** recommandation du wiki (aucune des deux cartes n'est dans
  les 205 + 187 decks publiés, 1.20 comme 1.21 ; Tisseuse n'apparaît que dans 1 des 28 synergies de la page Strategies).
- Le **Renvoi** passe surtout par la boutique : 4,4 % via une carte (L'Épine d'Amour #106, pourtant la carte perturbatrice
  la plus présente dans les listes publiques : 10–22,5 %), mais la Tox Renvoi (4 raretés, dont une commune) est proposée
  au moins une fois dans 46 % des parties (T2–T10) et achetée ≈ 18 % (hypothèse naïve 1/3).

## 1. Faits de départ (sources)

| # | Fait | Source |
|---|---|---|
| F1 | Aucune statistique publique de parties ; le journal de parties du joueur ne contient **0 partie** (collection `matches` vide, lue le 09/10 ≈ 15:15 UTC) ; ses archétypes sont tous « théorique » (issus du wiki). La seule partie réelle connue est l'incident AZURIAN (2 cartes adverses sur 4 connues : #123, #222). | journal `knowledge/pas-de-donnees-publiques`, `matches`, `archetypes` (lecture seule) ; README |
| F2 | `spamton` = **revenu par tour** d'une carte vivante, pas un coût (Ameru 15/tour, Hibernatus 12/tour). Il n'y a pas de coût de construction de deck : la diffusion d'une carte ne passe que par la **rareté** (et les doublons pour les talents). Tisseuse « 3 Spamtons » = 3/tour (2/tour en 1.21). | basics.txt (« Each turn you earn the Spamtons of your living cards », « The best Spamton income ») ; correction du coordinateur ; journal `knowledge/revenus` |
| F3 | Pool : 66 C / 30 R / 18 E / 12 L / 1 divine. Collection du joueur : 19/66 C (dont les 6 Esprits), 6/30 R, 1/18 E, 0/12 L, 0/1 D. | model.json ; README |
| F4 | Le wiki publie **205 decks** (1.20) — tier list « All / No talent » × « All / Accessible / Intermediate / Advanced » (40 decks par liste) + axes élémentaires — et les blocs « N ranked decks play this card » des pages cartes comptent **ce même catalogue** (vérifié : Aidan 21 = 21). En 1.21 (page live, analysée 09/10 14:29 UTC) : **187 decks**. La page Strategies liste 28 synergies (combos de 1 à 4 cartes). | tiers.html (props `Rankings`), dl/tiers_live.html, pages/aidan.html, strategies.html |
| F5 | Le jeu est passé en **1.21 le 09/10** : Gel (Tox innée de #92 et #259) brise à 60 au lieu de 40 ; Tisseuse #123 revenu 3 → 2 ; Zombie Floral #174 (vanish) 1 000 → 850 PV mais entre dans 12,5 % des deux tier lists 1.21 (0 % en 1.20) ; Rongeur Nuageux #234 (tauntOnAttack) entre dans 10 % de la tier list 1.21 sans talent. | dl/patch_live.txt ; tables P3 1.21 |
| F6 | Porteurs des mécaniques (innées, compétences + Tox de départ) : voir la ligne « Cartes porteuses » sous T1. Trois effets de la liste ne touchent **que le camp adverse lui-même** : changeElement (Aeltheria #265 change l'élément de **sa** carte), absorbAlly (Régent des Abysses #86 absorbe **son** allié), et le « Gel » d'Esprit de la Faune #122 vise **son propre allié** (exclu du Gel). | model.json, cards_compact.txt ; `F/cards_mech.json` |
| F7 | Le moteur trouve les mêmes sommets que le wiki : meilleur deck avec talents 15 946,6 (Aleera #231 + Souverain des Chutes d'Éther #136 + Commando Gerz #188 + Souverain des Flammes #43, talents identiques à la tier list), sans talent 15 336,6 (#231 + #136 + Squall #142 + Paguroniyx #263) = `model.best` / `model.noTalent.best`. | F_meta.json `topDecks` ; model.json |

## 2. Méthode — quatre proxies d'adversaire, puis un mélange explicite

Aucune donnée de parties n'est observable, donc on modélise **comment un adversaire construit son deck**, à partir de
ce qui est mesurable : le moteur du wiki (ce que les joueurs « optimisés » obtiennent), la rareté (ce que les joueurs
possèdent) et les classements publics (ce que les joueurs lisent). Chaque proxy produit une liste de decks pondérés ;
pour chaque mécanique M on mesure **P(M) = part (pondérée) des decks qui contiennent au moins une carte portant M**,
et pour chaque carte c, **P(c) = part des decks qui la contiennent**.

| Proxy | Joueur modélisé | Construction (reproductible : `F/scripts/`) |
|---|---|---|
| **P1** moteur, pool complet | possède les 127 cartes et joue ce que le moteur classe en tête | Recherche avec le moteur 1.20 (`simulation.js`, model.json engineHash a8193b3d422a54a9) : les **333 375 triplets** (exhaustif) au score rapide du moteur (`J(q(...))`, adversaire neutre, 1er joueur — le score que la beam search du wiki utilise) → 5 000 meilleurs triplets × 124 4ᵉ cartes → quadruplets classés → les 4 000 premiers rescorés au **score complet** (`X` = 9 profils × 2 ordres, = `evaluate()`), puis, pour la variante avec talents, les 1 500 premiers ré-optimisés en talents (`Te`, comme `bestDecks`). Fréquences dans les top 100 / 500 / 1 000. **T** = avec talents (1 talent optimisé par carte), **N** = sans talent. |
| **P2** accessibilité seule | ne lit rien, joue 4 cartes de sa collection | Collections tirées carte par carte selon la rareté : scénario **U** (calé sur la collection du joueur : 6 Esprits toujours possédés, autres communes 13/60, rares 6/30, épiques 1/18, légendaires et divine 0,5/13 ≈ 3,8 % ; ≈ 27 cartes en moyenne) et scénario **V** « vétéran » (hypothèse : 60 % / 50 % / 25 % / 15 % ; 64 cartes). Deck = 4 cartes au hasard parmi les possédées (probabilité exacte, 20 000 collections). |
| **P3** classements publics | copie ce que le wiki affiche | Listes du wiki telles que publiées : tier list « All » avec talents (40 decks), « No talent » (40), filtres « Accessible », catalogue complet (205 decks 1.20 = la source des blocs « Its best decks » de chaque page carte ; 187 en 1.21), et les 28 synergies de la page Strategies. Versions **1.20** (page sauvegardée, analysée le 09/10 09:06 UTC) et **1.21** (page live, 09/10 14:30 UTC). |
| **B** P2 × classement des cartes | joue ses 4 cartes les mieux classées individuellement | Collections U/V ; deck = les 4 cartes possédées les mieux placées dans le classement public des cartes du wiki 1.20 (utilisé comme mesure de « force perçue » ; le classement lui-même n'est pas affiché ici). |
| **C** P1 × P2 (atelier) | utilise l'atelier du wiki « meilleurs decks pour ma collection » | Pour chaque collection tirée (U : 120, V : 40), appel de la **vraie fonction du wiki `bestDecks(collection)`** (beam 120/100/400 + optimisation des talents) ; deck = le 1ᵉʳ proposé (variantes : les 3 proposés à 1/3). |
| **D** P3 × P2 (copieur) | copie le meilleur deck publié qu'il peut monter | Mêmes collections ; deck = le deck du catalogue wiki le mieux noté qu'il possède entièrement ; s'il n'en possède aucun, il retombe sur l'atelier (C). Variante catalogue 1.21. |

**Mélange (formule).** Avec s ∈ {U, V, F} (F = collection complète), t ∈ {hasard, meilleures cartes, atelier, copieur}
et τ_s la part de joueurs ayant des talents :

> **P_mix(M) = Σ_s w_s · Σ_t v_t · [ τ_s · P_{s,t,talents}(M) + (1 − τ_s) · P_{s,t,sans talent}(M) ]**
>
> w = {U : 0,50 ; V : 0,35 ; F : 0,15} · v = {hasard : 0,25 ; meilleures cartes : 0,25 ; atelier : 0,30 ; copieur : 0,20} · τ = {U : 0,25 ; V : 0,5 ; F : 0,5}
>
> Cellules : U/V → P2, B, C, D ; F → P2 sur 127 cartes, B sur 127 cartes, P1 top 1 000, P3 tier list (All / No talent). Les proxies sans notion de talent (P2, B) servent pour les deux variantes.

Justification des poids (toutes des **hypothèses**, aucune n'est mesurée) : la moitié des adversaires ressemblent au
joueur (≈ 27 cartes) parce qu'un matchmaking classé apparie des niveaux proches ; joueurs « sans wiki » (hasard +
meilleures cartes) = joueurs « wiki » (atelier + copieur) = 50/50 faute de mieux ; talents rares chez les petites
collections (ils exigent des doublons). La **sensibilité** est donnée à côté : « casual » (hasard + meilleures cartes
seulement), « wiki-only » (atelier + copieur seulement), « vétéran » (V + F seulement), « copie 1.21 » (copieurs sur le
catalogue 1.21), « sans B » (hasard 0,35 ; atelier 0,40 ; copieur 0,25 — sans le proxy « meilleures cartes »), et le
**min–max** sur les 23 cellules du mélange (hors la cellule B F, qui n'est qu'un seul deck donc vaut 0 ou 100 %).

## 3. Résultats détaillés

### T1 — Exposition par mécanique : P(le deck adverse contient ≥ 1 carte qui la porte), en %

| Mécanique | P1 T1000 | P1 N1000 | P2 U | P2 V | B U | C U N | C U T | C V N | D U N | P3 all 1.20 | P3 nt 1.20 | P3 all 1.21 | P3 nt 1.21 | P3 cat 1.20 | **Mélange** | min–max (cellules du mélange, hors B F) | casual | wiki-only | vétéran | copie 1.21 | sans B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| absorbAny (absorbe une carte adverse) | 0.5 | 0.6 | 3.3 | 3.8 | 0.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **1.0** | 0.0–3.8 | 2.0 | 0.1 | 0.9 | 1.0 | 1.2 |
| absorbAlly (absorbe un de SES propres alliés) | 0.2 | 0.9 | 0.8 | 1.6 | 0.5 | 1.7 | 0.8 | 2.5 | 1.7 | 5.0 | 5.0 | 5.0 | 5.0 | 3.4 | **1.1** | 0.0–5.0 | 0.7 | 1.3 | 1.2 | 1.1 | 1.4 |
| vanish OU vanishOnHit (retire le dernier passif) | 2.1 | 2.5 | 12.2 | 13.9 | 21.4 | 14.2 | 10.8 | 0.0 | 11.7 | 2.5 | 12.5 | 15.0 | 17.5 | 12.7 | **19.5** | 0.0–59.7 | 24.8 | 8.5 | 25.2 | 20.1 | 10.4 |
|   vanish (compétence) | 0.7 | 0.7 | 3.2 | 3.8 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 12.5 | 12.5 | 0.0 | **0.9** | 0.0–12.5 | 1.8 | 0.1 | 1.0 | 2.3 | 1.2 |
|   vanishOnHit (Tox Disparition innée) | 1.4 | 1.8 | 9.2 | 10.4 | 21.3 | 14.2 | 10.8 | 0.0 | 11.7 | 2.5 | 12.5 | 7.5 | 7.5 | 12.7 | **18.6** | 0.0–59.7 | 23.2 | 8.5 | 24.3 | 18.3 | 9.3 |
| setHpPct ≤ 50 % (PV fixés à 25 %) | 0.9 | 1.0 | 3.0 | 3.2 | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **0.9** | 0.0–3.2 | 1.6 | 0.1 | 0.9 | 0.9 | 1.1 |
| freeze OU freezeOnHit | 11.5 | 8.3 | 18.9 | 21.6 | 44.2 | 10.0 | 8.3 | 5.0 | 13.3 | 12.5 | 12.5 | 10.0 | 12.5 | 17.6 | **19.9** | 2.5–50.3 | 33.3 | 9.5 | 17.5 | 19.6 | 13.4 |
|   freeze (compétence, cible adverse ; hors #122 qui gèle son allié) | 9.7 | 6.6 | 15.5 | 17.6 | 44.2 | 9.2 | 8.3 | 5.0 | 12.5 | 12.5 | 12.5 | 10.0 | 12.5 | 17.6 | **18.6** | 2.5–50.3 | 31.5 | 9.0 | 16.2 | 18.5 | 11.7 |
|   freezeOnHit (Tox Gel innée) | 1.8 | 1.7 | 3.9 | 4.7 | 0.0 | 0.8 | 0.0 | 0.0 | 0.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **1.4** | 0.0–6.2 | 2.1 | 0.5 | 1.5 | 1.3 | 1.9 |
| taunt OU tauntOnAttack (Provocation) | 12.6 | 26.7 | 24.0 | 27.5 | 0.5 | 27.5 | 21.7 | 20.0 | 25.0 | 5.0 | 15.0 | 5.0 | 15.0 | 11.7 | **16.2** | 0.0–27.5 | 12.9 | 18.4 | 13.8 | 16.5 | 21.7 |
|   Provocation tenable chaque tour (cd ≤ durée, ou tauntOnAttack) | 3.8 | 12.0 | 12.2 | 13.9 | 0.0 | 22.5 | 17.5 | 20.0 | 20.0 | 5.0 | 12.5 | 5.0 | 12.5 | 7.8 | **11.0** | 0.0–22.5 | 6.4 | 14.7 | 8.6 | 11.5 | 14.7 |
|   tauntOnAttack (Tox Provocation innée) | 3.0 | 9.2 | 3.3 | 3.8 | 0.0 | 0.0 | 0.0 | 5.0 | 0.0 | 0.0 | 0.0 | 2.5 | 10.0 | 0.0 | **1.4** | 0.0–10.0 | 1.7 | 1.3 | 2.1 | 2.2 | 1.9 |
| resetEnemyCd | 1.1 | 1.4 | 3.0 | 3.2 | 16.4 | 2.5 | 0.0 | 0.0 | 2.5 | 0.0 | 2.5 | 0.0 | 2.5 | 1.0 | **3.6** | 0.0–16.4 | 6.9 | 1.0 | 1.4 | 3.6 | 1.8 |
| enemyPrec (compétence) | 2.1 | 1.2 | 0.8 | 1.6 | 0.3 | 0.0 | 0.8 | 0.0 | 0.8 | 2.5 | 2.5 | 2.5 | 5.0 | 4.4 | **0.9** | 0.0–5.0 | 0.6 | 1.1 | 1.3 | 1.0 | 1.1 |
| smoke (compétence) OU Fumée (Tox innée) | 9.1 | 9.4 | 13.0 | 15.4 | 0.2 | 2.5 | 3.3 | 0.0 | 2.5 | 2.5 | 0.0 | 0.0 | 0.0 | 2.4 | **6.7** | 0.0–22.5 | 7.0 | 6.8 | 8.4 | 5.8 | 9.0 |
|   smoke (compétence) | 1.0 | 0.8 | 3.3 | 3.8 | 0.0 | 0.0 | 0.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | **0.9** | 0.0–3.8 | 1.7 | 0.2 | 1.0 | 0.9 | 1.3 |
|   Fumée (Tox innée) | 8.1 | 8.6 | 10.0 | 11.9 | 0.2 | 2.5 | 2.5 | 0.0 | 2.5 | 2.5 | 0.0 | 0.0 | 0.0 | 1.5 | **5.8** | 0.0–22.5 | 5.4 | 6.6 | 7.5 | 4.9 | 7.8 |
| resetEnemySpamton | 0.6 | 0.9 | 0.6 | 1.0 | 2.5 | 0.0 | 0.8 | 0.0 | 0.0 | 2.5 | 2.5 | 7.5 | 5.0 | 0.5 | **0.8** | 0.0–7.5 | 1.1 | 0.6 | 0.9 | 0.9 | 0.7 |
| changeElement (change l’élément de SA carte) | 1.0 | 0.8 | 0.6 | 0.9 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **0.3** | 0.0–3.1 | 0.4 | 0.1 | 0.6 | 0.3 | 0.4 |
| resurrect | 0.3 | 1.8 | 0.6 | 1.0 | 2.2 | 3.3 | 2.5 | 2.5 | 3.3 | 2.5 | 0.0 | 0.0 | 0.0 | 0.5 | **1.6** | 0.0–3.3 | 1.0 | 1.8 | 0.9 | 1.4 | 1.7 |
| breakTaunt | 0.0 | 0.1 | 3.2 | 3.8 | 0.0 | 15.8 | 10.8 | 12.5 | 14.2 | 5.0 | 12.5 | 2.5 | 2.5 | 7.8 | **6.2** | 0.0–15.8 | 1.7 | 10.0 | 4.4 | 5.8 | 8.2 |
| reflect (Tox Renvoi innée) | 0.0 | 0.0 | 3.2 | 3.8 | 0.0 | 10.8 | 7.5 | 2.5 | 11.7 | 10.0 | 17.5 | 17.5 | 22.5 | 15.6 | **4.4** | 0.0–22.5 | 1.7 | 6.5 | 3.0 | 5.0 | 5.8 |
| immunity (Tox Immunité innée) | 5.3 | 4.2 | 7.7 | 9.8 | 5.8 | 10.0 | 12.5 | 5.0 | 10.8 | 20.0 | 17.5 | 12.5 | 15.0 | 11.7 | **7.5** | 0.0–20.0 | 6.0 | 8.9 | 6.6 | 6.8 | 9.1 |
| eternity (compétence) OU eternityOnHit (hors liste demandée) | 10.8 | 8.1 | 21.6 | 24.8 | 30.0 | 4.2 | 3.3 | 2.5 | 4.2 | 10.0 | 7.5 | 0.0 | 5.0 | 10.7 | **15.8** | 0.0–43.4 | 29.1 | 5.0 | 15.8 | 15.2 | 11.2 |
| talent Focus : 25 %/tour de Provocation (si talent actif) | 0.9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 11.7 | 0.0 | 0.0 | 12.5 | 0.0 | 12.5 | 0.0 | 13.2 | **1.4** | 0.0–12.5 | 0.0 | 2.7 | 1.4 | 1.2 | 1.7 |
| talent Longueur / Heure funeste : Éternité (si talent actif) | 3.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 3.3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 6.3 | **0.5** | 0.0–5.0 | 0.0 | 1.1 | 0.7 | 0.6 | 0.7 |
| talent Imprécision / Erreur croissante (si talent actif) | 5.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 7.8 | **0.5** | 0.0–6.7 | 0.0 | 1.0 | 0.6 | 0.4 | 0.6 |
| talent Immunité-8 (si talent actif) | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2.5 | 0.0 | 6.8 | **0.1** | 0.0–2.5 | 0.0 | 0.2 | 0.1 | 0.1 | 0.1 |
| AU MOINS UNE mécanique de la liste demandée (innée) | 36.3 | 45.3 | 62.6 | 69.8 | 72.3 | 61.7 | 55.8 | 32.5 | 60.8 | 47.5 | 67.5 | 57.5 | 65.0 | 60.5 | **61.0** | 25.0–84.4 | 71.3 | 46.3 | 59.6 | 61.4 | 54.7 |
| AU MOINS UNE mécanique de la liste, hors effets sur soi (absorbAlly, changeElement) | 35.2 | 44.0 | 61.9 | 68.7 | 72.0 | 60.8 | 55.0 | 30.0 | 60.0 | 42.5 | 65.0 | 52.5 | 62.5 | 58.0 | **60.2** | 25.0–84.4 | 70.8 | 45.3 | 58.5 | 60.6 | 53.7 |
| absorbAny / vanish* / freeze* / setHpPct / tauntPermanent / resetEnemyCd (les plus « destructrices ») | 19.3 | 23.8 | 44.9 | 49.8 | 66.6 | 43.3 | 31.7 | 25.0 | 40.8 | 17.5 | 30.0 | 22.5 | 35.0 | 30.7 | **46.9** | 17.5–84.4 | 60.3 | 29.7 | 46.5 | 47.6 | 36.9 |

Cartes porteuses (n° FR) : **absorbAny** 123 · **absorbAlly** 86 · **vanishAny** 56, 115, 140, 174 · **setHpPct** 139 · **freezeAny** 23, 29, 34, 59, 91, 92, 211, 259 · **tauntAny** 12, 58, 72, 94, 101, 116, 222, 234, 262 · **resetEnemyCd** 78 · **enemyPrec** 81 · **smokeAny** 146, 152, 191, 243, 261 · **resetEnemySpamton** 96 · **changeElement** 265 · **resurrect** 203 · **breakTaunt** 262 · **reflect** 106 · **immunity** 197, 198, 237, 260 · **eternityAny** 21, 23, 33, 34, 35, 51, 64, 88, 256 · **T_taunt25** 58, 86, 115, 152, 204, 247, 248, 249, 250, 251, 252, 262 · **T_eternity** 29, 33, 35, 64, 88, 122, 140, 151, 176, 190, 229, 236, 255, 256, 264 · **T_enemyPrec** 27, 39, 56, 81, 119, 134, 188, 203 · **T_immunity8** 122, 259 · **anyHostile** 12, 23, 29, 34, 56, 58, 59, 72, 78, 81, 91, 92, 94, 96, 101, 106, 115, 116, 123, 139, 140, 174, 197, 198, 203, 211, 222, 234, 237, 259, 260, 261, 262

### T2 — Top 40 cartes adverses : P(la carte est dans le deck adverse), en %, triées par mélange

| # | n° | Carte | Rar. | Mécaniques perturbatrices (innées) | **Mélange** | casual | wiki-only | copie 1.21 | P1 T1000 | P1 N1000 | P2 U | B U | C U N | C U T | C V N | D U N | P3 all 1.20 | P3 nt 1.20 | P3 all 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 231 | Aleera Mange-Cauchemars | C | — | **24.5** | 13.6 | 41.6 | 23.7 | 100.0 | 99.7 | 3.3 | 21.5 | 15.8 | 16.7 | 57.5 | 15.0 | 12.5 | 15.0 | 12.5 |
| 2 | 127 | Spectre Canin | C | — | **20.4** | 20.4 | 14.7 | 19.8 | 11.0 | 2.6 | 3.3 | 21.9 | 20.8 | 16.7 | 10.0 | 18.3 | 7.5 | 10.0 | 2.5 |
| 3 | 136 | Souverain des Chutes d'Éther | R | — | **15.3** | 5.2 | 29.6 | 15.2 | 89.2 | 92.1 | 3.0 | 12.1 | 11.7 | 12.5 | 35.0 | 10.0 | 12.5 | 12.5 | 10.0 |
| 4 | 177 | Moxilys, la Fredonneuse | C | — | **15.2** | 20.4 | 4.6 | 15.4 | 1.8 | 1.5 | 3.3 | 21.8 | 9.2 | 10.0 | 0.0 | 6.7 | 0.0 | 0.0 | 2.5 |
| 5 | 188 | Commando Gerz | R | — | **15.1** | 10.2 | 22.5 | 14.7 | 19.1 | 3.2 | 3.0 | 19.3 | 13.3 | 14.2 | 20.0 | 15.0 | 32.5 | 35.0 | 32.5 |
| 6 | 122 | Esprit de la Faune | C | gel sur SON allié (non perturbant) | **14.9** | 20.0 | 4.6 | 15.0 | 0.3 | 3.7 | 3.2 | 21.3 | 7.5 | 0.8 | 0.0 | 6.7 | 2.5 | 15.0 | 10.0 |
| 7 | 56 | Lisa, la Dragonnière | C | vanishOnHit | **13.1** | 20.0 | 1.2 | 13.0 | 1.1 | 0.9 | 3.2 | 21.3 | 1.7 | 1.7 | 0.0 | 1.7 | 0.0 | 0.0 | 2.5 |
| 8 | 229 | Maître Amphibian | C | — | **9.1** | 2.2 | 16.5 | 8.3 | 10.4 | 2.7 | 3.2 | 1.6 | 13.3 | 13.3 | 22.5 | 11.7 | 17.5 | 15.0 | 10.0 |
| 9 | 263 | Paguroniyx | C | — | **9.0** | 7.0 | 12.4 | 8.9 | 4.2 | 14.8 | 3.2 | 16.6 | 8.3 | 6.7 | 35.0 | 7.5 | 0.0 | 5.0 | 0.0 |
| 10 | 34 | Éclat du Renard Blanc | R | eternity, freeze | **8.4** | 16.0 | 2.8 | 8.1 | 2.5 | 2.2 | 2.9 | 19.5 | 4.2 | 0.8 | 2.5 | 3.3 | 2.5 | 2.5 | 0.0 |
| 11 | 17 | Croqueur de Fruits Verdoyant | C | — | **8.2** | 16.0 | 2.5 | 8.0 | 1.4 | 0.8 | 3.4 | 22.2 | 1.7 | 8.3 | 0.0 | 1.7 | 12.5 | 7.5 | 2.5 |
| 12 | 176 | Rob l'Aventurier | C | — | **7.5** | 1.8 | 12.8 | 7.4 | 0.0 | 0.1 | 3.3 | 0.0 | 15.8 | 13.3 | 30.0 | 13.3 | 7.5 | 15.0 | 2.5 |
| 13 | 69 | Scorch, les Lézards Ignés | R | — | **7.2** | 1.5 | 12.9 | 6.7 | 0.0 | 0.2 | 3.0 | 0.0 | 11.7 | 11.7 | 15.0 | 10.8 | 20.0 | 12.5 | 20.0 |
| 14 | 142 | Squall, Émissaire des cauchemars | R | — | **7.1** | 2.2 | 12.7 | 6.4 | 8.1 | 2.4 | 3.1 | 2.2 | 6.7 | 8.3 | 20.0 | 7.5 | 7.5 | 7.5 | 2.5 |
| 15 | 178 | Épine Médusine | C | — | **7.0** | 10.0 | 4.9 | 6.8 | 0.8 | 8.8 | 3.2 | 20.0 | 5.8 | 10.0 | 2.5 | 6.7 | 5.0 | 2.5 | 7.5 |
| 16 | 160 | Sanglier Doré | C | — | **6.4** | 8.8 | 4.8 | 6.3 | 4.6 | 1.0 | 3.2 | 18.9 | 7.5 | 10.0 | 0.0 | 5.8 | 10.0 | 7.5 | 2.5 |
| 17 | 262 | Yotaru Gardefeuille | C | breakTaunt, taunt (permanente) | **6.2** | 1.7 | 10.0 | 5.8 | 0.0 | 0.1 | 3.2 | 0.0 | 15.8 | 10.8 | 12.5 | 14.2 | 5.0 | 12.5 | 2.5 |
| 18 | 97 | Pyro | C | — | **6.1** | 2.9 | 9.5 | 6.1 | 0.0 | 0.0 | 3.3 | 3.8 | 10.0 | 8.3 | 17.5 | 9.2 | 10.0 | 5.0 | 5.0 |
| 19 | 219 | Catixy | C | — | **5.8** | 4.0 | 8.6 | 5.6 | 5.0 | 5.2 | 3.2 | 7.6 | 4.2 | 3.3 | 25.0 | 4.2 | 0.0 | 0.0 | 0.0 |
| 20 | 244 | Gazpoison Flottant | R | — | **5.3** | 1.5 | 7.7 | 5.2 | 0.0 | 0.0 | 2.9 | 0.0 | 17.5 | 13.3 | 10.0 | 14.2 | 2.5 | 2.5 | 0.0 |
| 21 | 233 | Oisillons de Midas | C | — | **5.2** | 6.3 | 4.8 | 5.0 | 0.0 | 0.0 | 3.3 | 14.8 | 5.8 | 2.5 | 12.5 | 5.8 | 2.5 | 7.5 | 2.5 |
| 22 | 1 | Esprit Feu | C | — | **5.0** | 5.9 | 4.0 | 4.7 | 0.6 | 0.8 | 15.5 | 0.0 | 7.5 | 8.3 | 0.0 | 10.8 | 2.5 | 0.0 | 2.5 |
| 23 | 115 | Aidan | C | vanishOnHit | **4.8** | 1.7 | 7.3 | 4.6 | 0.3 | 0.9 | 3.2 | 0.1 | 12.5 | 9.2 | 0.0 | 10.0 | 2.5 | 12.5 | 5.0 |
| 24 | 32 | Maîtresse des Teintes | R | — | **4.6** | 2.1 | 6.7 | 4.5 | 1.6 | 0.7 | 2.9 | 1.9 | 9.2 | 8.3 | 0.0 | 10.8 | 17.5 | 10.0 | 10.0 |
| 25 | 4 | Esprit Terre | C | — | **4.4** | 5.9 | 3.0 | 4.5 | 0.0 | 0.9 | 15.5 | 0.0 | 7.5 | 5.8 | 0.0 | 7.5 | 2.5 | 0.0 | 2.5 |
| 26 | 106 | L'Épine d'Amour | C | reflect | **4.4** | 1.7 | 6.5 | 5.0 | 0.0 | 0.0 | 3.2 | 0.0 | 10.8 | 7.5 | 2.5 | 11.7 | 10.0 | 17.5 | 17.5 |
| 27 | 156 | L'Œil des montagnes | C | — | **4.4** | 1.7 | 7.4 | 4.6 | 2.6 | 13.0 | 3.2 | 0.0 | 5.8 | 2.5 | 15.0 | 5.8 | 5.0 | 2.5 | 5.0 |
| 28 | 2 | Esprit Eau | C | — | **4.3** | 5.9 | 2.9 | 4.2 | 0.0 | 0.0 | 15.5 | 0.0 | 4.2 | 9.2 | 0.0 | 5.8 | 7.5 | 0.0 | 2.5 |
| 29 | 134 | Wibs l'Enflammé | C | — | **4.2** | 3.6 | 4.9 | 3.8 | 1.0 | 0.9 | 3.3 | 6.0 | 5.0 | 2.5 | 7.5 | 9.2 | 10.0 | 7.5 | 10.0 |
| 30 | 29 | Princesse Meridia | R | freeze | **4.0** | 6.0 | 2.6 | 3.8 | 1.3 | 0.9 | 3.0 | 14.5 | 1.7 | 4.2 | 0.0 | 2.5 | 7.5 | 5.0 | 7.5 |
| 31 | 117 | Keria | R | — | **3.8** | 1.5 | 6.4 | 3.4 | 2.3 | 3.4 | 3.0 | 0.0 | 2.5 | 4.2 | 10.0 | 3.3 | 12.5 | 2.5 | 10.0 |
| 32 | 260 | Le compagnon des esprits | C | immunity | **3.6** | 2.6 | 4.5 | 3.0 | 1.6 | 1.0 | 3.3 | 3.0 | 4.2 | 10.8 | 0.0 | 5.8 | 12.5 | 2.5 | 10.0 |
| 33 | 78 | Gardien Vert | R | resetEnemyCd | **3.6** | 6.9 | 1.0 | 3.6 | 1.1 | 1.4 | 3.0 | 16.4 | 2.5 | 0.0 | 0.0 | 2.5 | 0.0 | 2.5 | 0.0 |
| 34 | 191 | Ameru | R | smokePassive | **3.3** | 1.6 | 5.5 | 2.5 | 6.1 | 1.2 | 3.0 | 0.2 | 1.7 | 2.5 | 0.0 | 1.7 | 2.5 | 0.0 | 0.0 |
| 35 | 137 | Cerf des Couleurs Funèbres | R | — | **3.2** | 1.5 | 4.4 | 2.7 | 1.4 | 0.8 | 3.0 | 0.0 | 5.0 | 11.7 | 0.0 | 5.0 | 5.0 | 7.5 | 2.5 |
| 36 | 5 | Esprit Ombre | C | — | **3.1** | 5.9 | 0.8 | 3.1 | 0.0 | 0.0 | 15.5 | 0.0 | 0.8 | 5.8 | 0.0 | 0.8 | 0.0 | 0.0 | 0.0 |
| 37 | 245 | Shinobi Éclairant | R | — | **3.0** | 1.6 | 3.9 | 3.0 | 1.7 | 1.4 | 3.0 | 0.1 | 9.2 | 5.0 | 0.0 | 7.5 | 7.5 | 10.0 | 5.0 |
| 38 | 119 | Fleurmarine | C | — | **2.9** | 3.9 | 2.2 | 2.8 | 1.2 | 0.9 | 3.3 | 7.2 | 2.5 | 5.8 | 0.0 | 2.5 | 5.0 | 2.5 | 2.5 |
| 39 | 3 | Esprit Nature | C | — | **2.8** | 5.9 | 0.4 | 3.3 | 0.0 | 0.8 | 15.5 | 0.0 | 0.8 | 0.8 | 0.0 | 0.8 | 0.0 | 0.0 | 5.0 |
| 40 | 6 | Esprit Lumière | C | — | **2.8** | 5.9 | 0.4 | 2.6 | 0.5 | 1.0 | 15.5 | 0.0 | 0.0 | 0.0 | 0.0 | 1.7 | 0.0 | 0.0 | 0.0 |

Cartes perturbatrices hors top 40 (rang du mélange) : 211 Dragosaure Céleste [C, freeze] 2.8 % (#41) · 72 Girafe Florale [R, taunt/tauntPermanent] 2.7 % (#43) · 51 Sorcière Pyrokinétique [C, eternity] 2.5 % (#47) · 59 Guerrier des Neiges [C, freeze] 2.1 % (#51) · 237 Voyageur des Crêtes [R, immunity] 2.0 % (#53) · 91 Ignea [L, freeze] 1.8 % (#59) · 58 Le Transporteur Sauvage [C, taunt] 1.6 % (#62) · 12 Hibernatus [C, taunt] 1.6 % (#67) · 203 Ashtarae Lycaria [L, resurrect] 1.6 % (#68) · 234 Rongeur Nuageux [C, tauntOnAttack/tauntPermanent] 1.4 % (#74) · 64 Maître Thronebéur [C, eternity] 1.2 % (#80) · 197 Codex des Maux Ancestraux [E, immunity] 1.2 % (#82) · 86 Régent des Abysses [E, absorbAlly] 1.1 % (#83) · 259 Dragon de la Cité Infernale [C, freezeOnHit] 1.1 % (#87) · 101 Neilla [C, taunt] 1.0 % (#89) · 116 Prisonnière de la Machine [C, taunt] 1.0 % (#90) · 123 Tisseuse de Mots [C, absorbAny] 1.0 % (#91) · 261 Godlur [C, smoke] 0.9 % (#93) · 21 Félin Errant [C, eternity] 0.9 % (#94) · 243 Vivy [C, smokePassive] 0.9 % (#96) · 174 Zombie Floral [C, vanish] 0.9 % (#97) · 81 Luminaire Abyssal [E, enemyPrec] 0.9 % (#98) · 152 Le Héraut des Cendres [C, smokePassive] 0.9 % (#99) · 23 Artisan des Heures [C, eternity/freeze] 0.9 % (#100) · 198 Codex des Sorts Lumineux [E, immunity] 0.9 % (#103) · 139 Cornu mythologique [R, setHpPct] 0.9 % (#104) · 222 Fleur de Vie [C, taunt/tauntPermanent] 0.9 % (#105) · 96 Mélodie des Divinités [L, resetEnemySpamton] 0.8 % (#106) · 35 Léo [R, eternity] 0.8 % (#107) · 146 Poulpe Parleur [E, smokePassive] 0.8 % (#109) · 140 Souris des blés [R, vanishOnHit] 0.8 % (#110) · 33 Nakyel [R, eternityOnHit] 0.8 % (#111) · 88 Faerylia [E, eternity] 0.6 % (#115) · 94 Zayd [L, taunt] 0.5 % (#121) · 265 Aeltheria, Mère Primordiale [D, changeElement] 0.3 % (#125) · 92 Frost & Glacier [L, freezeOnHit] 0.3 % (#126) · 256 Héraldesse Serpentine [L, eternityOnHit] 0.3 % (#127)

### T3 — Proxy 1 : fréquence des cartes dans les N meilleurs decks du moteur (pool complet de 127 cartes), en %

| n° | Carte | Rar. | Méca. | T100 | T500 | T1000 | N100 | N500 | N1000 |
|---|---|---|---|---|---|---|---|---|---|
| 231 | Aleera Mange-Cauchemars | C | — | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.7 |
| 136 | Souverain des Chutes d'Éther | R | — | 100.0 | 93.0 | 89.2 | 100.0 | 96.6 | 92.1 |
| 188 | Commando Gerz | R | — | 44.0 | 22.4 | 19.1 | 5.0 | 3.8 | 3.2 |
| 263 | Paguroniyx | C | — | 12.0 | 5.0 | 4.2 | 18.0 | 21.4 | 14.8 |
| 156 | L'Œil des montagnes | C | — | 3.0 | 3.0 | 2.6 | 52.0 | 19.4 | 13.0 |
| 127 | Spectre Canin | C | — | 10.0 | 13.8 | 11.0 | 8.0 | 3.6 | 2.6 |
| 229 | Maître Amphibian | C | — | 8.0 | 12.0 | 10.4 | 10.0 | 3.0 | 2.7 |
| 204 | Ephial | L | — | 16.0 | 13.4 | 7.6 | 8.0 | 17.8 | 9.3 |
| 234 | Rongeur Nuageux | C | tauntOnAttack, tauntPermanent | 0.0 | 1.8 | 3.0 | 4.0 | 3.8 | 9.2 |
| 178 | Épine Médusine | C | — | 0.0 | 1.0 | 0.8 | 3.0 | 10.6 | 8.8 |
| 58 | Le Transporteur Sauvage | C | taunt | 7.0 | 8.2 | 7.8 | 2.0 | 3.6 | 8.5 |
| 71 | Soigneuse Astrale des Bois | R | — | 0.0 | 0.0 | 0.2 | 3.0 | 6.4 | 8.4 |
| 142 | Squall, Émissaire des cauchemars | R | — | 6.0 | 7.8 | 8.1 | 4.0 | 3.6 | 2.4 |
| 103 | Lame de la forêt | C | — | 0.0 | 0.0 | 0.2 | 0.0 | 4.0 | 6.9 |
| 31 | Raffteru | R | — | 9.0 | 11.2 | 6.7 | 9.0 | 3.2 | 2.1 |
| 44 | Léviathan des Cieux | L | — | 10.0 | 5.4 | 6.6 | 1.0 | 1.4 | 0.9 |
| 191 | Ameru | R | smokePassive | 4.0 | 5.6 | 6.1 | 0.0 | 1.0 | 1.2 |
| 146 | Poulpe Parleur | E | smokePassive | 0.0 | 0.0 | 0.2 | 1.0 | 1.2 | 5.9 |
| 219 | Catixy | C | — | 0.0 | 3.8 | 5.0 | 3.0 | 3.4 | 5.2 |
| 82 | Baleine Farceuse | C | — | 4.0 | 4.6 | 5.2 | 1.0 | 1.0 | 0.9 |
| 160 | Sanglier Doré | C | — | 7.0 | 3.6 | 4.6 | 1.0 | 1.2 | 1.0 |
| 236 | Apprentie de la Mort | R | — | 2.0 | 3.0 | 4.5 | 3.0 | 1.6 | 2.8 |
| 226 | Apprenti Évocateur | C | — | 5.0 | 3.4 | 4.2 | 0.0 | 0.8 | 0.8 |
| 153 | L'Inventeur | C | — | 5.0 | 3.4 | 4.2 | 1.0 | 1.4 | 0.9 |
| 43 | Souverain des Flammes | L | — | 4.0 | 3.6 | 4.1 | 4.0 | 4.0 | 3.4 |
| 122 | Esprit de la Faune | C | gel sur SON allié (non perturbant) | 0.0 | 0.0 | 0.3 | 3.0 | 3.6 | 3.7 |
| 117 | Keria | R | — | 2.0 | 2.4 | 2.3 | 3.0 | 2.6 | 3.4 |
| 54 | Loutre Intrépide | C | — | 2.0 | 2.2 | 3.3 | 2.0 | 1.0 | 2.5 |
| 72 | Girafe Florale | R | taunt, tauntPermanent | 0.0 | 0.6 | 0.8 | 1.0 | 1.4 | 2.7 |
| 85 | Bleu-mange-cailloux | E | — | 1.0 | 2.0 | 2.7 | 1.0 | 1.0 | 2.1 |
| 34 | Éclat du Renard Blanc | R | eternity, freeze | 1.0 | 2.0 | 2.5 | 2.0 | 1.8 | 2.2 |
| 211 | Dragosaure Céleste | C | freeze | 4.0 | 3.0 | 2.5 | 1.0 | 1.6 | 1.1 |
| 116 | Prisonnière de la Machine | C | taunt | 0.0 | 0.2 | 0.2 | 0.0 | 0.8 | 2.3 |
| 12 | Hibernatus | C | taunt | 0.0 | 0.2 | 0.6 | 0.0 | 1.4 | 2.2 |
| 63 | Shado, Fléau abyssal | C | — | 2.0 | 2.0 | 2.2 | 1.0 | 1.0 | 1.2 |
| 37 | Roi des Flammes Ardentes | E | — | 1.0 | 2.0 | 2.2 | 1.0 | 2.0 | 1.7 |
| 221 | Crapaud des Étoiles | C | — | 3.0 | 2.2 | 2.1 | 1.0 | 0.8 | 0.9 |
| 81 | Luminaire Abyssal | E | enemyPrec | 1.0 | 1.6 | 2.1 | 1.0 | 0.8 | 1.2 |
| 255 | Verdelune | L | — | 0.0 | 0.0 | 0.0 | 0.0 | 2.4 | 2.1 |
| 195 | Gabriel | E | — | 5.0 | 3.2 | 2.0 | 1.0 | 0.8 | 1.0 |

### T4 — Canal hors deck : Tox perturbatrices que l'adversaire peut ACHETER (boutique, chance = tour, 3 offres, sans relance)

| Mécanique | Tox | P(proposée ≥ 1× T2–T8) | P(proposée ≥ 1× T2–T10) | P(achetée, naïf 1/3 si proposée, T2–T10) |
|---|---|---|---|---|
| reflect | Reflect_C, Reflect_R, Reflect_E, Reflect_L | 40.0 % | 46.4 % | 18.1 % |
| tauntOnAttack | Taunt_R | 11.6 % | 16.1 % | 5.6 % |
| smokePassive | Smoked_R | 11.6 % | 16.1 % | 5.6 % |
| freezeOnHit | Frozen_E | 2.7 % | 7.0 % | 2.4 % |
| immunity | Immunity_E | 2.7 % | 7.0 % | 2.4 % |
| vanishOnHit | Disparition_L | 0.0 % | 0.0 % | 0.0 % |
| eternityOnHit | Eternity_L | 0.0 % | 0.0 % | 0.0 % |

### T5 — Contrôle sur la seule partie observée (AZURIAN : Tisseuse #123 + Fleur de Vie #222 dans le même deck)

| Proxy | P(#123 dans le deck) | P(#222) | P(les deux) |
|---|---|---|---|
| P1_T_top1000 | 0.5 % | 0.0 % | 0.000 % |
| P1_N_top1000 | 0.6 % | 0.0 % | 0.000 % |
| P3_all_120 | 0.0 % | 0.0 % | 0.000 % |
| P3_nt_120 | 0.0 % | 0.0 % | 0.000 % |
| P3_cat_120 | 0.0 % | 0.0 % | 0.000 % |
| P3_cat_121 | 0.0 % | 0.0 % | 0.000 % |
| P2_U_random | 3.3 % | 3.2 % | 0.083 % |
| P2_V_random | 3.8 % | 3.8 % | 0.108 % |
| B_U_greedy | 0.7 % | 0.0 % | 0.000 % |
| B_V_greedy | 0.0 % | 0.0 % | 0.000 % |
| C_U_T | 0.0 % | 0.0 % | 0.000 % |
| C_U_N | 0.0 % | 0.0 % | 0.000 % |
| C_V_T | 0.0 % | 0.0 % | 0.000 % |
| C_V_N | 0.0 % | 0.0 % | 0.000 % |
| D_U_N | 0.0 % | 0.0 % | 0.000 % |
| D_V_N | 0.0 % | 0.0 % | 0.000 % |

### T7 — Sur une série de N parties : P(croiser au moins une fois la mécanique), mélange [casual ; wiki-only], indépendance supposée entre parties

| Mécanique | 1 partie | 5 parties | 10 parties | 20 parties |
|---|---|---|---|---|
| freeze OU freezeOnHit | 19.9 [33.3 ; 9.5] | 67.0 [86.8 ; 39.3] | 89.1 [98.3 ; 63.1] | 98.8 [100.0 ; 86.4] |
| vanish OU vanishOnHit (retire le dernier passif) | 19.5 [24.8 ; 8.5] | 66.1 [76.0 ; 36.0] | 88.5 [94.2 ; 59.1] | 98.7 [99.7 ; 83.2] |
| taunt OU tauntOnAttack (Provocation) | 16.2 [12.9 ; 18.4] | 58.6 [49.8 ; 63.8] | 82.9 [74.8 ; 86.9] | 97.1 [93.7 ; 98.3] |
| Provocation tenable chaque tour (cd ≤ durée, ou tauntOnAttack) | 11.0 [6.4 ; 14.7] | 44.3 [28.3 ; 54.8] | 69.0 [48.6 ; 79.6] | 90.4 [73.6 ; 95.8] |
| immunity (Tox Immunité innée) | 7.5 [6.0 ; 8.9] | 32.5 [26.6 ; 37.1] | 54.4 [46.2 ; 60.4] | 79.2 [71.0 ; 84.3] |
| smoke (compétence) OU Fumée (Tox innée) | 6.7 [7.0 ; 6.8] | 29.1 [30.5 ; 29.7] | 49.8 [51.7 ; 50.5] | 74.8 [76.7 ; 75.5] |
| reflect (Tox Renvoi innée) | 4.4 [1.7 ; 6.5] | 20.2 [8.3 ; 28.7] | 36.3 [15.8 ; 49.1] | 59.4 [29.2 ; 74.1] |
| breakTaunt | 6.2 [1.7 ; 10.0] | 27.5 [8.3 ; 41.0] | 47.5 [15.9 ; 65.2] | 72.4 [29.3 ; 87.9] |
| resetEnemyCd | 3.6 [6.9 ; 1.0] | 16.7 [30.0 ; 5.1] | 30.7 [51.1 ; 9.9] | 52.0 [76.1 ; 18.8] |
| absorbAny (absorbe une carte adverse) | 1.0 [2.0 ; 0.1] | 4.8 [9.4 ; 0.3] | 9.3 [17.9 ; 0.7] | 17.8 [32.7 ; 1.3] |
| setHpPct ≤ 50 % (PV fixés à 25 %) | 0.9 [1.6 ; 0.1] | 4.2 [7.9 ; 0.6] | 8.2 [15.2 ; 1.1] | 15.8 [28.1 ; 2.3] |
| absorbAny / vanish* / freeze* / setHpPct / tauntPermanent / resetEnemyCd (les plus « destructrices ») | 46.9 [60.3 ; 29.7] | 95.8 [99.0 ; 82.9] | 99.8 [100.0 ; 97.1] | 100.0 [100.0 ; 99.9] |

### T6 — Légende des proxies

| Code | Définition | Nb decks |
|---|---|---|
| P1_T_top100 | moteur wiki, pool complet, talents optimisés (Te), top 100 | 100 |
| P1_N_top100 | moteur wiki, pool complet, sans talent (X), top 100 | 100 |
| P1_T_top500 | moteur wiki, pool complet, talents optimisés (Te), top 500 | 500 |
| P1_N_top500 | moteur wiki, pool complet, sans talent (X), top 500 | 500 |
| P1_T_top1000 | moteur wiki, pool complet, talents optimisés (Te), top 1000 | 1000 |
| P1_N_top1000 | moteur wiki, pool complet, sans talent (X), top 1000 | 1000 |
| P3_all_120 | wiki 1.20 : tier list decks « All / avec talents » (40, uniforme) | 40 |
| P3_all_120_rank | wiki 1.20 : même liste pondérée 1/rang (attention décroissante) | 40 |
| P3_nt_120 | wiki 1.20 : tier list « No talent / All » (40) | 40 |
| P3_low_120 | wiki 1.20 : filtre « Accessible » avec talents (34) | 34 |
| P3_ntlow_120 | wiki 1.20 : filtre « Accessible » sans talent (29) | 29 |
| P3_cat_120 | wiki 1.20 : catalogue complet (205 decks, = listes « Its best decks » des pages cartes) | 205 |
| P3_all_121 | wiki 1.21 (live 09/10 14:30 UTC) : tier list « All / avec talents » (40) | 40 |
| P3_nt_121 | wiki 1.21 : tier list « No talent / All » (40) | 40 |
| P3_cat_121 | wiki 1.21 : catalogue complet (187) | 187 |
| P3_combo_120 | wiki 1.20 : 28 synergies de la page Strategies (combos de 1 à 4 cartes) | 28 |
| P3_combo_121 | wiki 1.21 : 28 synergies Strategies | 28 |
| P2_U_random | accessibilité seule : 4 cartes au hasard dans une collection tirée (scénario U, 20 000 collections) | 20000 |
| B_U_greedy | collection U : les 4 cartes possédées les mieux placées au classement public des cartes du wiki 1.20 (20 000 collections) | 20000 |
| D_U_copyOnly_T | collection U : meilleur deck du catalogue wiki 1.20 entièrement possédé (seulement les 19.9 % qui en possèdent un) | 3970 |
| D_U_copyOnly_N | idem, classé par score sans talent | 3970 |
| C_U_T | collection U : atelier wiki bestDecks(collection), 1er deck AVEC talents (120 collections) | 120 |
| C_U_N | collection U : atelier wiki bestDecks(collection), 1er deck SANS talent (120 collections) | 120 |
| C_U_T3 | idem, les 3 decks proposés (poids 1/3) | 341 |
| C_U_N3 | idem sans talent, 3 decks (poids 1/3) | 332 |
| D_U_T | collection U : copie le meilleur deck du catalogue wiki possédé, sinon l'atelier (repli 86 %) — talents | 120 |
| D_U_N | idem sans talent | 120 |
| D_U_T_121 | collection U : copie le meilleur deck du catalogue wiki 1.21 (live) possédé, sinon l'atelier 1.20 (repli 85 %) — talents | 120 |
| D_U_N_121 | idem 1.21 sans talent | 120 |
| P2_U_random_sameSample | contrôle : P2 sur les 120 mêmes collections que l'atelier | 120 |
| P2_V_random | accessibilité seule : 4 cartes au hasard dans une collection tirée (scénario V, 20 000 collections) | 20000 |
| B_V_greedy | collection V : les 4 cartes possédées les mieux placées au classement public des cartes du wiki 1.20 (20 000 collections) | 20000 |
| D_V_copyOnly_T | collection V : meilleur deck du catalogue wiki 1.20 entièrement possédé (seulement les 99.2 % qui en possèdent un) | 19830 |
| D_V_copyOnly_N | idem, classé par score sans talent | 19830 |
| C_V_T | collection V : atelier wiki bestDecks(collection), 1er deck AVEC talents (40 collections) | 40 |
| C_V_N | collection V : atelier wiki bestDecks(collection), 1er deck SANS talent (40 collections) | 40 |
| C_V_T3 | idem, les 3 decks proposés (poids 1/3) | 112 |
| C_V_N3 | idem sans talent, 3 decks (poids 1/3) | 109 |
| D_V_T | collection V : copie le meilleur deck du catalogue wiki possédé, sinon l'atelier (repli 0 %) — talents | 40 |
| D_V_N | idem sans talent | 40 |
| D_V_T_121 | collection V : copie le meilleur deck du catalogue wiki 1.21 (live) possédé, sinon l'atelier 1.20 (repli 3 %) — talents | 40 |
| D_V_N_121 | idem 1.21 sans talent | 40 |
| P2_V_random_sameSample | contrôle : P2 sur les 40 mêmes collections que l'atelier | 40 |
| P2_F_random | référence : 4 cartes au hasard parmi les 127 (collection complète) | 1 |
| B_F_greedy | collection complète : les 4 premières du classement public des cartes 1.20 (1 seul deck) | 1 |

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
