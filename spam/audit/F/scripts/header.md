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

{{SUMMARY}}

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
  les 205 + 187 decks publiés, 1.20 comme 1.21).
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
