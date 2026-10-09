# D — Les Tox vus du côté ADVERSE : ce qu'ils font à nos decks, et quand l'adversaire les a

Agent D — audit SPAM, données 1.20 du README **mises à jour 1.21** (patch publié le 9 octobre 2026, cf. § 1).
Périmètre : les 101 Tox de la boutique (40 familles) et les passifs imprimés d'office sur les cartes (43 identifiants,
dont Contrecoup, absent de la boutique), vus comme une **menace posée sur une carte adverse** — ce que le moteur du wiki
ne simule jamais (son adversaire est abstrait et n'achète rien).
Livrables : ce fichier et `D_tox.json` (une ligne par Tox : sémantique, menace, contre, porteurs d'office, exposition).
Convention : **FAIT** = lu dans les données/règles (source citée) ; **INFÉRENCE** = déduction (confiance indiquée).
Les rangs de tier des cartes ne sont volontairement pas affichés (préférence de l'utilisateur).

## 0. L'essentiel

- **La boutique adverse est surtout commune jusqu'à T8.** Un Tox *précis* de rareté commune est offert au moins une fois
  d'ici T8 dans 30 % des parties ; un adversaire « glouton » (il l'achète dès qu'il le voit et peut le payer) l'a dans
  27,8 % des parties à T8, un acheteur « mou » (1 fois sur 3) dans 10 %. Rare : 11,8 % / 4,1 % à T8. Épique : 4,2 % /
  1,4 %. Légendaire : 0,1 % à T8 et 0,6 % à T10 — **sauf** talent « Tox chanceux » (25 % par rareté) : 4,5 % à T8.
- **Une famille entière** (4 raretés) monte à ≈ 39-40 % (glouton) / ≈ 15 % (mou) à T8 : Renvoi, Sac de frappe,
  Soin primitif, Cœur résistance, Poison, Berserk, Bouclier…
- **Les effets rares et dévastateurs viennent des CARTES, pas de la boutique** : Sac de frappe est imprimé sur 12 cartes
  (33,1 % des decks tirés au hasard en ont au moins une), Disparition sur 3 (9,2 %), Gel sur 2 (6,2 %), Renvoi E sur 1
  (3,1 %), Provocation sur 1 (3,1 %). En 1.21, une compétence de Zombie Floral (#174) applique 2 Disparitions à TOUTES nos cartes.
- **deck chimere** : (1) Sac de frappe (Galop nourrit chaque porteur 5 fois d'ici T10), (2) Érosion (annule le Vampirisme,
  borne moteur −53 %), (3) Soin primitif (absorbe ~85 % de la part de Galop), (4) Cœur résistance s'il cumule vraiment en
  1.21 ; pire cas **Disparition** : −8,8 % au 1er passif retiré à Chimère, **−56,8 % au 2e**, −65,4 % si les 4 passifs du deck
  tombent (moteur 1.21).
- **zéro critique** : Sac de frappe, AoE (Scorch 350 PV, Murmures 400 PV), Cœur résistance, Renvoi (Explosion coûte déjà
  100 PV par usage), **Mimétisme** (l'adversaire récupère +20 à +36 points d'éléments d'ici T8), et le combo
  Provocation + Renvoi sur la même carte (agent E1 : −42 %).
- **Contres** : Brut (seul anti-Provocation de la boutique), Gel sur notre attaquant (moteur : Lame +7,0 %,
  Prisonnière +8,7 %), Immunité (protège une carte clé ; sur Chimère à la place de Mimétisme : −8,1 % sur le papier),
  Ténacité (Scorch +10,5 %). Mais on les obtient rarement : Brut d'ici T8 dans 11,6 % des parties (deck chimere, acheté
  dès qu'offert), 38,5 % en chassant (épargne + jusqu'à 3 relances par boutique) ; Immunité 3,0 % / 10,2 % ; Gel 1,9 % / 10,3 %.

## 1. Sources, version, méthode

**FAITS / sources**
- Tox : `tox_fr.json` (101 Tox, FR 1.20), `toxinfo.json`, moteur `spam/js/simulation.js` (constantes `e`, courbes de
  rareté `t`, pools `n`, coûts `r`, fonction de cotes `$e`, config boutique `u`), textes EN `builder.txt`, règles `basics.txt`.
- Page Tox **en direct** du wiki (https://spamgame-wiki.com/fr/tox/ et /en/tox/, décodée dans `D_raw/tox_*_props.json`),
  moteur **en direct** `/_astro/simulation-KlJhEEqL.js` (`D_raw/simulation_live.js`) et modèle 1.21
  `/data/model-edeb0ebc315cfd15.json` (`D_raw/model_121.json`, engineHash 36e2c03d5b7bf4a1).
- Notes de patch en direct (https://spamgame-wiki.com/en/patch/) : **1.21 publiée le 9 octobre 2026**.

**Ce que la 1.21 change pour les Tox et passifs (FAIT, diff modèle 1.20 → 1.21 et moteur en direct)**
- Gel : brise-glace 40 → **60** dégâts ; coût boutique 150 → **140**. Reset : coût 130 → **160**.
- Sac de frappe : « … à chaque fois que celle-ci subit une attaque **adverse** ».
- Cœur résistance **C et R** : « **Au début de chacun de vos tours**, cette carte augmente les résistances… (+3)/(+6) » =
  cumulatif. Les textes E/L ne bougent pas ; le moteur lit toujours une valeur à plat.
- Naissance d'Aldrin (#30, possédée) : Reset E remplacé par **Cimetière R**.
- Zombie Floral (#174) : Malédiction aquatique (CD 8) passe en **AoE avec 2 « Applique Disparition »** ; PV 1000 → 850.
- Murmures du Corail Noir (#102, dans zéro critique) : PV 500 → **400**, Spamtons 7 → **2**, Murmure +5 → **+3**.
- Rongeur Nuageux (#234, Provocation d'office) : PV 750 → 650, nouvelle attaque Foudre **CD 2** (avant CD 3).
- Tisseuse de Mots 3 → 2 Spamtons ; Lapin-Plume (Cœur résistance C) 1000 → 850 PV.
- Inchangés : courbes de rareté, pools (22/29/27/23), constantes de boutique, tous les autres coûts.

**Méthode** : (1) sémantique de chaque Tox = texte FR (1.20 et 1.21) + interprétation du moteur ; (2) menace = mécanisme
appliqué à nos deux decks, chiffré quand c'est possible (moteur 1.21 avec passifs retirés/ajoutés via `loadout`,
arithmétique sur les dégâts par tour du moteur, recoupement avec les scénarios de l'agent E1, `E1/tables.md`) ;
(3) exposition = Monte Carlo de la boutique adverse (§ 2) ; (4) porteurs d'office = passifs des 127 cartes 1.21.
Note : le README appelle `spamton` un coût ; d'après les règles (`basics.txt` : « Each turn you earn the Spamtons of your
living cards… plus the turn number ») c'est un **revenu par tour** — c'est ainsi qu'il est utilisé ici.

## 2. La boutique adverse : règles, hypothèses, exposition

**Règles (FAITS, `basics.txt` + config moteur `u`)** : boutique aux tours pairs (2, 4, 6, 8, 10…), 3 Tox offerts, elle se
ferme après **un** achat ; relance 10 Spamtons puis +5 à chaque fois ; passer rapporte 10 ; revenu par tour = n° du tour +
Spamtons des cartes vivantes, +50 au joueur qui PERD une carte (prime de mort) ; Chance de départ 0, +1 par tour, + Chanceur (+0,5/1/2/4 par tour) ;
talent « Tox chanceux » = 25 % par rareté ; un Tox va sur une ligne libre ou remplace une ligne (3 lignes max par carte).
Cotes par rareté (%) selon la Chance (fonction `$e` du moteur, identique au tableau de la page Tox du wiki) :

| Chance (= n° du tour sans bonus) | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 16 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| commun | 100 | 92,9 | 80,1 | 64,4 | 50,1 | 38,9 | 27,1 | 16,5 | 10,1 | 4,5 | 0,1 | 0,1 | 0,1 |
| rare | 0 | 7,1 | 19,9 | 34,3 | 45 | 49,9 | 53 | 53,3 | 50 | 41,6 | 35 | 27,8 | 14,9 |
| épique | 0 | 0 | 0 | 1,3 | 4,9 | 11,2 | 19,9 | 30,2 | 39,9 | 52,8 | 60 | 58,8 | 50 |
| légendaire | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1,1 | 4,9 | 13,3 | 35 |

**Hypothèses du Monte Carlo (INFÉRENCES, `D_mc.js`)** — 40 000 adversaires par famille et par politique, 20 000 par Tox :
- les 3 offres sont tirées indépendamment : rareté selon `$e(Chance)`, puis uniforme dans le pool de la rareté (c'est
  l'hypothèse du moteur lui-même pour son espérance « meilleur des 3 ») ; doublons possibles ;
- l'adversaire = 4 cartes distinctes tirées au hasard parmi les 127 (revenu moyen 28,5 Spamtons/tour en 1.21, Chanceur
  d'office compris) ; aucune carte ne meurt avant T10 ; 0 Spamton au départ (budget moyen ≈ 60 à T2, 124 à T4, 192 à T6,
  264 à T8, 340 à T10 avant achats) ; le revenu du tour T est disponible à la boutique du tour T (convention du moteur) ;
  coûts 1.21 ;
- **glouton** : achète le Tox visé (la plus haute rareté abordable de la famille) dès qu'il est offert et payable ; sinon
  il achète une autre offre abordable au hasard (un Chanceur/Spamland acheté augmente ensuite sa Chance/son revenu), ou
  passe (+10) ; **mou** : achète le Tox visé avec probabilité 1/3 quand il est offert et payable ;
- variantes : « épargnant » (n'achète rien d'autre), 1 relance par boutique, talent Tox chanceux, deck à +1 Chance/tour,
  et « pertes » : l'adversaire perd une carte à la fin des tours 5 et 8 (prime de mort +50 au joueur qui PERD la carte —
  modèle de revenu confirmé par le coordinateur —, revenu et Chance de la carte perdus). Effet : ≤ +1,5 point d'exposition
  (Gel 7,1 → 8,6 % à T10, Reset 5,9 → 7,6 %), sauf Phénix (24,9 → 29,7 % à T10) : les chiffres sont robustes à la prime ;
- « posséder à T » = après la boutique du tour T.

Exposition à **un Tox précis** selon sa rareté (moyenne des Tox de la rareté ; % à T2 / T4 / T6 / T8 / T10) :

| Un Tox précis de rareté… | Offert au moins une fois (argent infini) | Glouton | Mou 1/3 | Glouton, talent Tox chanceux |
|---|---|---|---|---|
| common (moyenne de 21 Tox, hors Phénix/Gel/Reset chers) | 13 / 22,2 / 27,4 / 30 / 31 | 12,8 / 21,2 / 25,7 / 27,8 / 28,5 | 4,2 / 7,3 / 9,1 / 10 / 10,3 | 3,4 / 6,6 / 9,7 / 12,8 / 15,7 |
| rare (moyenne de 28 Tox, hors Phénix/Gel/Reset chers) | 0 / 2 / 6,5 / 11,6 / 16,1 | 0,2 / 2,6 / 7,1 / 11,8 / 15,8 | 0,1 / 0,9 / 2,4 / 4,1 / 5,5 | 1,8 / 4,2 / 6,7 / 9 / 11,3 |
| epic (moyenne de 24 Tox, hors Phénix/Gel/Reset chers) | 0 / 0 / 0,5 / 2,7 / 7 | 0 / 0,2 / 1,3 / 4,2 / 8,7 | 0 / 0,1 / 0,5 / 1,4 / 2,9 | 0,8 / 2,7 / 5 / 7,4 / 9,7 |
| legendary (moyenne de 22 Tox, hors Phénix/Gel/Reset chers) | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0,1 / 0,6 | 0 / 0 / 0 / 0 / 0,2 | 0,3 / 1,2 / 2,7 / 4,5 / 6,7 |

Exposition à **une famille** (n'importe quelle rareté) et probabilité qu'une carte adverse la porte **d'office** :

| Famille | Glouton (T2 / T4 / T6 / T8 / T10) | Mou 1/3 | Glouton + 1 relance/boutique | Talent Tox chanceux (glouton) | Deck à +1 Chance/tour (glouton) | Porteur inné dans un deck au hasard |
|---|---|---|---|---|---|---|
| Sac de frappe | 12,9 / 23,5 / 31,9 / 39,2 / 45,3 | 4,3 / 8,2 / 11,6 / 14,9 / 17,9 | 23,9 / 41,5 / 53,9 / 63 / 70 | 5,3 / 12,3 / 20,1 / 27,8 / 35,1 | 12,7 / 21,8 / 29,6 / 35,8 / 41,6 | 33,1 % |
| Renvoi | 13 / 23,7 / 32,5 / 39,6 / 46 | 4,5 / 8,4 / 11,9 / 15,2 / 18 | 24 / 41,5 / 54,1 / 63,4 / 70,7 | 6 / 15,4 / 24,8 / 33 / 40,7 | 12,6 / 22 / 30,3 / 37,5 / 44,3 | 3,1 % |
| Érosion | 12,6 / 21,2 / 26,6 / 30,8 / 34,7 | 4,3 / 7,6 / 9,6 / 11,3 / 13 | 23,7 / 37,9 / 46,2 / 52,3 / 57,4 | 3,6 / 9,2 / 14,5 / 19,5 / 24,5 | 10,6 / 15,7 / 21,3 / 26,3 / 30,3 | 9,2 % |
| Soin primitif | 12,9 / 23,6 / 32,2 / 39,4 / 46 | 4,3 / 8,2 / 11,6 / 14,9 / 17,8 | 23,9 / 41,3 / 53,6 / 63,2 / 70,6 | 7,2 / 15,6 / 24,2 / 32,4 / 39,8 | 12 / 21,7 / 30,1 / 37,2 / 43,6 | 12,2 % |
| Cœur résistance | 13 / 23,6 / 32,3 / 39,6 / 45,7 | 4,2 / 8,1 / 11,5 / 14,6 / 17,6 | 24,1 / 41,6 / 54,1 / 63,6 / 70,6 | 6,5 / 15,1 / 23,8 / 31,9 / 39,6 | 12,6 / 22,2 / 30,5 / 37,7 / 44,1 | 6,2 % |
| Berserk | 12,7 / 23,3 / 32,1 / 39,3 / 45,2 | 4,4 / 8,2 / 11,5 / 14,7 / 17,6 | 23,9 / 40,9 / 53,2 / 62,1 / 69,1 | 4,7 / 11,7 / 19,1 / 26,2 / 33,1 | 12,6 / 21,5 / 29,2 / 35,2 / 40,2 | 15 % |
| AoE | 11,9 / 22,2 / 30,7 / 37,7 / 43,6 | 3,9 / 7,6 / 11 / 14 / 16,8 | 19,5 / 36,1 / 48,3 / 57,4 / 64,1 | 3,1 / 8,3 / 14,7 / 21,9 / 28,9 | 10,5 / 18 / 24,2 / 29,3 / 33,9 | 9,2 % |
| Cimetière | 12,7 / 23,3 / 32,1 / 39,3 / 45,6 | 4,3 / 8,1 / 11,4 / 14,7 / 17,7 | 24 / 41,7 / 54,4 / 63,7 / 70,8 | 7,2 / 17,5 / 26,8 / 35,1 / 42,5 | 12,3 / 22,1 / 30,4 / 37,9 / 45 | 9,2 % |
| Vampirisme | 12,6 / 23,4 / 32 / 39,5 / 45,6 | 4,3 / 8 / 11,4 / 14,4 / 17,3 | 23,5 / 40,5 / 52,5 / 61,5 / 68,4 | 4 / 10,7 / 18,1 / 25,8 / 33,1 | 10,4 / 19,3 / 26,8 / 33 / 38,4 | 9,2 % |
| Poison | 12,6 / 23,4 / 31,9 / 39,1 / 45,3 | 4,4 / 8,2 / 11,6 / 14,7 / 17,8 | 24,2 / 41,4 / 53,6 / 62,5 / 69,7 | 5,2 / 12,3 / 20,2 / 27,9 / 35,3 | 12,5 / 21,5 / 29 / 35,3 / 40,9 | 6,2 % |
| Bouclier | 12,9 / 23,2 / 31,9 / 38,8 / 45 | 4,2 / 8 / 11,3 / 14,5 / 17,4 | 23,7 / 40,7 / 53,2 / 61,9 / 68,5 | 4,7 / 11 / 17,8 / 25,2 / 32 | 12,4 / 20,4 / 27,4 / 32,8 / 37,3 | 0 % |
| Ténacité | 12,5 / 20,7 / 25,1 / 27,3 / 28 | 4,2 / 7,3 / 9,2 / 10 / 10,4 | 24 / 37,9 / 44,8 / 47,8 / 48,7 | 3,4 / 6,6 / 9,7 / 12,7 / 15,6 | 10,8 / 14 / 14,4 / 14,4 / 14,4 | 9,2 % |
| Phénix | 0 / 5,6 / 12,6 / 19,1 / 24,9 | 0 / 1,8 / 4,1 / 6,4 / 8,8 | 0 / 9,2 / 20,6 / 30,1 / 37,4 | 0 / 2 / 5,5 / 10,2 / 15,6 | 0 / 2,5 / 4,4 / 6,3 / 8,2 | 9,2 % |
| Mimétisme | 0,2 / 2,7 / 7,3 / 11,9 / 15,8 | 0,1 / 1 / 2,5 / 4,1 / 5,5 | 0,3 / 5,3 / 14,1 / 22,7 / 29,6 | 2,1 / 4,7 / 7,2 / 9,5 / 11,9 | 2,2 / 7,4 / 11,3 / 13,8 / 15 | 9,2 % |
| Provocation | 0,1 / 2,7 / 7 / 11,7 / 15,6 | 0 / 0,8 / 2,3 / 3,9 / 5,4 | 0,1 / 4,6 / 13,3 / 21,9 / 28,7 | 0,5 / 2,8 / 5,1 / 7,6 / 10,1 | 0 / 5,3 / 9 / 11,4 / 12,8 | 3,1 % |
| Brut | 0,1 / 2,5 / 7,2 / 11,8 / 15,7 | 0,1 / 0,8 / 2,3 / 4 / 5,3 | 0,2 / 4,9 / 13,5 / 21,8 / 28,8 | 0,9 / 3,2 / 5,6 / 8,1 / 10,5 | 0 / 5,6 / 9,4 / 11,8 / 13 | 3,1 % |
| Revanche | 0 / 2,3 / 6,7 / 11,5 / 15,5 | 0 / 0,7 / 2,3 / 3,9 / 5,3 | 0 / 4,2 / 12,2 / 20,6 / 27,5 | 0,1 / 2,2 / 4,6 / 6,9 / 9,1 | 0 / 5,2 / 9,3 / 11,6 / 12,9 | 3,1 % |
| Fumée | 0,2 / 2,7 / 7,1 / 11,8 / 15,7 | 0,1 / 0,9 / 2,6 / 4,3 / 5,8 | 0,4 / 5,2 / 13,8 / 22,3 / 29,2 | 2 / 4,5 / 6,9 / 9,3 / 11,7 | 2,1 / 7,3 / 11,1 / 13,5 / 14,8 | 12,2 % |
| Bomba | 0 / 0,1 / 1 / 3,5 / 7,6 | 0 / 0 / 0,3 / 1,2 / 2,5 | 0 / 0,1 / 1,7 / 6,3 / 13,5 | 0 / 0,5 / 1,9 / 3,7 / 5,7 | 0 / 0 / 3,5 / 7,5 / 10,7 | 0 % |
| Gel | 0 / 0 / 0,8 / 3,2 / 7,1 | 0 / 0 / 0,3 / 1,1 / 2,5 | 0 / 0,1 / 1,4 / 5,7 / 12,7 | 0 / 0,3 / 1,3 / 2,8 / 4,7 | 0 / 0 / 2,7 / 6 / 9,2 | 6,2 % |
| Reset | 0 / 0 / 0,6 / 2,5 / 5,9 | 0 / 0 / 0,2 / 0,9 / 2 | 0 / 0 / 1 / 4,6 / 10,8 | 0 / 0,1 / 0,8 / 2 / 3,6 | 0 / 0 / 1,2 / 3,5 / 5,8 | 12,2 % |
| Vengeur | 0 / 0,2 / 1,4 / 4,4 / 8,9 | 0 / 0,1 / 0,5 / 1,5 / 3 | 0 / 0,4 / 2,6 / 7,9 / 16,4 | 0,1 / 2,3 / 4,9 / 7,3 / 9,9 | 0 / 2,1 / 7,4 / 12,9 / 17,7 | 6,2 % |
| Immunité | 0 / 0,2 / 1,4 / 4,2 / 8,6 | 0 / 0,1 / 0,5 / 1,4 / 2,9 | 0 / 0,5 / 2,6 / 7,9 / 16 | 0 / 1,7 / 4 / 6,4 / 8,7 | 0 / 2,2 / 7,6 / 12,8 / 17,4 | 12,2 % |
| Métamorphe | 0 / 0,1 / 1,1 / 3,7 / 7,8 | 0 / 0,1 / 0,3 / 1,1 / 2,5 | 0 / 0,2 / 2 / 7 / 14,7 | 0 / 0,7 / 2,3 / 4,1 / 6,2 | 0 / 0,3 / 4,2 / 8,5 / 12,1 | 0 % |
| Disparition | 0 / 0 / 0 / 0,1 / 0,4 | 0 / 0 / 0 / 0 / 0,2 | 0 / 0 / 0 / 0,1 / 0,7 | 0 / 0,1 / 0,5 / 1,5 / 3,1 | 0 / 0 / 0 / 0,5 / 2,2 | 9,2 % |
| Éternité | 0 / 0 / 0 / 0 / 0,3 | 0 / 0 / 0 / 0 / 0,1 | 0 / 0 / 0 / 0,1 / 0,4 | 0 / 0 / 0,2 / 0,7 / 1,6 | 0 / 0 / 0 / 0,1 / 0,9 | 6,2 % |

Lecture : la part des communs s'effondre (80 % des offres à T4, 10 % à T10), donc une famille commune plafonne vers
28 % (Tox isolé) / 45 % (famille) à T10 ; les épiques n'arrivent vraiment qu'à T8-T10 ; Phénix C (100) n'est jamais
abordable à T2. Une relance par boutique multiplie l'exposition par 1,6 à 1,9 ; le talent Tox chanceux l'**abaisse** pour
les communs (25 % des offres au lieu de 80-100 %) mais rend les épiques et légendaires possibles dès T2.

Probabilité qu'un adversaire ait **au moins une** des menaces d'un ensemble (achat seulement, sans compter les porteurs) :

| Ensemble | Familles | Glouton | Mou 1/3 | Tox chanceux (glouton) |
|---|---|---|---|---|
| chimere_core | Sac de frappe, Renvoi, Érosion, Gel, Bomba, Disparition | 35,6 / 55,9 / 68,9 / 78 / 85,1 | 11,6 / 21 / 28,6 / 35,6 / 42,5 | 14,2 / 33,8 / 51,3 / 65,6 / 76 |
| chimere_core_plus | Sac de frappe, Renvoi, Érosion, Gel, Bomba, Disparition, Provocation, Soin primitif, Éternité, Reset, Revanche | 44,6 / 69,1 / 82,9 / 90,9 / 95,4 | 15,2 / 27,9 / 38,7 / 48,4 / 57 | 21,2 / 48 / 68,2 / 81,7 / 89,7 |
| zero_core | Mimétisme, Provocation, Renvoi, Bouclier, Bomba, Disparition | 24,9 / 45,7 / 62,1 / 73,9 / 82 | 8,5 / 16,8 / 25,3 / 33,1 / 39,9 | 12,8 / 31 / 47,6 / 61,1 / 71,7 |
| zero_core_plus | Mimétisme, Provocation, Renvoi, Bouclier, Bomba, Disparition, Brut, Ténacité, Phénix, Reset, AoE | 44,1 / 71,7 / 86,3 / 93,1 / 96,5 | 14,9 / 29,2 / 41,5 / 51,6 / 59,8 | 19,5 / 45,4 / 66 / 79,9 / 88,7 |
| any_epic_control | Gel, Immunité, Bomba, Métamorphe, Reset, Vengeur | 0 / 0,7 / 5,8 / 18,9 / 37,9 | 0 / 0,2 / 1,9 / 6,7 / 13,9 | 0,1 / 5,6 / 14,6 / 24,4 / 34 |

## 3. Catalogue des 101 Tox (40 familles) — menace quand ils sont sur une carte ADVERSE

Niveau générique de menace 0-5 (par rareté quand l'ampleur compte : C/R/E/L) et impact 0-5 sur nos deux decks
(deck chimere [103, 238, 156, 117], zéro critique [102, 116, 12, 69]). Valeurs et coûts 1.21 (`engine_consts_121.json`).
Le détail par Tox (texte FR 1.20 et 1.21, porteurs, exposition par politique) est dans `D_tox.json`.

| Famille (FR) | Rareté : valeur / coût 1.21 | Ce que ça fait | Menace (0-5) | vs deck chimere | vs zéro critique | Contre / parade |
|---|---|---|---|---|---|---|
| **AoE** (Aoe) | C : 20 % / 45 · R : 40 % / 90 · E : 80 % / 135 · L : 100 % / 180 | leurs attaques ET soins mono-cible touchent aussi les cartes adjacentes à 20/40/80/100 % des dégâts | C2 R2 E3 L4 | 2 | 3 | AoE sur notre propre attaquant mono-cible · cartes à gros PV au centre, fragiles au bord (adjacence = INFÉRENCE, ordre des cartes non documenté) |
| **Berserk** (Berserk) | C : 12 % / 30 · R : 25 % / 60 · E : 50 % / 100 · L : 100 % / 180 | +12/25/50/100 % aux dégâts et soins de toutes leurs cartes | C1 R2 E3 L4 | 2 | 2 | c’est aussi notre meilleur Tox générique · aucun contre direct : tuer vite |
| **Brut** (Brut) | R : — / 65 | ignore résistances et Provocations ; détruit la Provocation adverse quand il la cible | R3 | 1 | 3 | LE contre de Provocation (Tox ou compétence, ex. Barrière Florale) et du Cœur résistance cumulatif : sur notre attaquant mono-cible (moteur 1.21 : Lame +1,2 %, Prisonnière +5,7 %) · ne pas compter sur nos Provocations face à un porteur (Hippocampe Nimbé #27 l’a d’office) |
| **Chanceur** (Chance) | C : +0,5 / 5 · R : +1 / 10 · E : +2 / 15 · L : +4 / 20 | +0,5/1/2/4 de Chance par tour | C0 R1 E1 L1 | 1 | 1 | Hibernatus nous donne déjà +0,5/tour |
| **Cimetière** (Cimetiere) | C : +3 / 20 · R : +5 / 40 · E : +8 / 60 · L : +12 / 80 | +3/5/8/12 à TOUS leurs bonus élémentaires à chaque mort de carte (n’importe quel camp) | C1 R2 E3 L3 | 2 | 2 | même effet boule de neige pour nous · tuer le porteur en premier, éviter les échanges précoces |
| **Cœur d'eau** (CoeurEau) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Eau par tour | C1 R1 E2 L3 | 1 | 2 | garder Prisonnière hors de portée des attaquants Eau |
| **Cœur de feu** (CoeurFeu) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Feu par tour | C1 R1 E2 L3 | 1 | 1 |  |
| **Cœur de lumière** (CoeurLumiere) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Lumière par tour | C1 R1 E2 L3 | 1 | 1 |  |
| **Cœur de nature** (CoeurNature) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Nature par tour | C1 R1 E2 L3 | 1 | 1 |  |
| **Cœur d'ombre** (CoeurOmbre) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Ombre par tour | C1 R1 E2 L3 | 1 | 1 |  |
| **Cœur de terre** (CoeurTerre) | C : +1 / 15 · R : +2 / 30 · E : +5 / 60 · L : +8 / 120 | +1/2/5/8 Terre par tour | C1 R1 E2 L3 | 1 | 1 |  |
| **Cœur résistance** (CoeurResistance) | C : +3 / 10 · R : +6 / 30 · E : +10 / 70 · L : +15 / 120 | 1.20 : +3/6/10/15 % de résistances à toutes leurs cartes. 1.21 (C et R seulement) : « au début de chacun de vos tours » = cumulatif | C3 R4 E2 L3 | 3 | 3 | Brut ignore les résistances · tuer le porteur tôt (Lapin-Plume #158, Lames en peine #190) ; À VÉRIFIER en jeu |
| **Cœur vital** (CoeurVital) | C : +15 / 10 · R : +30 / 30 · E : +60 / 70 · L : +100 / 150 | +15/30/60/100 PV max par tour sur le porteur | C1 R1 E2 L2 | 1 | 1 | focaliser le porteur tôt |
| **Érosion** (Erosion) | C : 50 % / 20 · E : 100 % / 75 | leurs dégâts retirent aussi 50 % (C) / 100 % (E) de leur montant à nos PV MAX | C3 E4 | 4 | 2 | Cœur vital / Cœur résistance compensent un peu · tuer l’éroder en premier |
| **Vampirisme** (Life Steal) | C : 25 % / 30 · R : 50 % / 70 · E : 75 % / 110 · L : 100 % / 160 | soigne 25/50/75/100 % des dégâts infligés | C1 R2 E2 L3 | 2 | 1 | Érosion de notre côté · burster le porteur |
| **Phénix** (Phoenix) | C : 25 % / 100 · R : 50 % / 150 · E : 75 % / 200 · L : 100 % / 250 | revient une fois à 25/50/75/100 % de ses PV max (usage unique) | C1 R2 E2 L3 | 2 | 2 | Disparition le retirerait (hors de portée) · garder le burst pour la 2e vie |
| **Poison** (Poison) | C : 1 % / 10 · R : 3 % / 50 · E : 6 % / 100 · L : 8 % / 150 | 1/3/6/8 % des PV max de la cible au début de chacun de ses tours, 3 tours | C1 R2 E2 L3 | 1 | 2 | Soin primitif / soins |
| **Soin primitif** (Primitive heal) | C : 4 % / 20 · R : 9 % / 40 · E : 14 % / 60 · L : 19 % / 120 | régénère 4/9/14/19 % de ses PV max au début de chaque tour | C2 R3 E4 L4 | 3 | 1 | Érosion, ou focaliser avec Pinces · focus mono-cible sur la carte qui régénère |
| **Sac de frappe** (PunchingBag) | C : +1 / 25 · R : +2 / 50 · E : +3 / 100 · L : +4 / 150 | +1/2/3/4 à l’élément du porteur à chaque attaque ADVERSE subie (« adverse » ajouté en 1.21) | C3 R3 E4 L4 | 3 | 2 | Disparition (hors de portée) · ne jamais nourrir un porteur PB qui provoque (Transporteur Sauvage, Girafe Florale) |
| **Renvoi** (Reflect) | C : 25 % / 24 · R : 50 % / 48 · E : 75 % / 72 · L : 100 % / 96 | renvoie 25/50/75/100 % des dégâts subis à l’attaquant, coup par coup | C2 R3 E4 L5 | 2 | 3 | Vampirisme (Chimère) compense · ne frapper le porteur qu’avec de petits coups ; le tuer à l’AoE |
| **Bouclier** (Shield) | C : 25 % / 30 · R : 50 % / 60 · E : 75 % / 120 · L : 100 % / 180 | le PREMIER coup subi à chaque tour adverse est réduit de 25/50/75/100 % | C1 R2 E2 L3 | 1 | 2 | casser le bouclier avec un petit coup d’abord (Galop avant Pinces ; Souffle d’eau avant Explosion) |
| **Spamland** (Spamland) | C : +3 / 6 · R : +8 / 10 · E : +24 / 16 · L : +48 / 24 | +3/8/24/48 Spamtons par tour | C0 R1 E1 L1 | 1 | 1 | Spamland E/L ne coûtent que 16/24 : à prendre si offerts |
| **Ténacité** (Tenacite) | C : — / 10 | la première attaque fatale laisse à 1 PV | C1 | 1 | 2 | assurance à 10 Spamtons sur notre carte fragile (moteur : Scorch +10,5 %) · achever avec un petit coup |
| **Inversement** (Inversement) | R : — / 40 | leurs dégâts deviennent des soins, Éternité ↔ Temporalité, et inversement | R1 | 0 | 0 |  |
| **Mimétisme** (Mimetisme) | R : — / 50 | chaque fois que NOUS générons des éléments, ils en génèrent 1 du même type | R3 | 1 | 4 | le Mimétisme de Chimère copie LEUR génération · tuer Léo / Wyrm des Dunes Cornu avant de générer gros |
| **Multiplicateur** (Multiplicator) | R : ×2 / 80 | double les bonus élémentaires pour les dégâts/soins du porteur | R2 | 1 | 1 | Murmures l’a (zéro critique) · tuer le porteur |
| **Mystère** (Mystere) | R : — / 70 | commence la partie avec un passif aléatoire | R1 | 1 | 1 | lire le passif obtenu |
| **Optimisation** (Optimisation) | R : — / 40 | les valeurs variables (dégâts, soins, bonus) du porteur sont toujours au maximum | R1 | 1 | 1 |  |
| **Revanche** (Revenge) | R : — / 80 | une fois détruite, la carte lance l’intégralité de ses attaques | R3 | 2 | 2 | le tuer quand nos cartes fragiles sont pleines |
| **Fumée** (Smoked) | R : — / 50 | enfume le terrain allié (le leur) après une attaque ou un soin | R1 | 1 | 1 | noter les ratés après leurs attaques |
| **Provocation** (Taunt) | R : — / 70 | quand le porteur attaque, TOUTES nos attaques du tour suivant doivent le cibler | R4 | 1 | 3 | Brut (ignore/détruit), dégâts AoE, Gel/Éternité sur le provocateur avant qu’il attaque · Rongeur Nuageux (1.21 : Foudre CD 2) provoque un tour sur deux |
| **Bomba** (Bomba) | E : 500 bruts / 130 | à sa mort, 500 dégâts BRUTS (ignorent la résistance) à une de nos cartes au hasard | E4 | 3 | 4 | Ténacité ? (seulement si Bomba compte comme une « attaque » : inconnu) ; Phénix · tuer la carte Bomba quand nos cartes sont au-dessus de 500 PV |
| **Gel** (Frozen) | E : 60 dégâts / 140 (1.20 : 150) | chaque dégât ou soin du porteur gèle sa cible jusqu’à la fin de NOTRE prochain tour ; un autre dégât, un soin ou un nouveau Tox brise la glace et inflige 40 (1.20) / 60 (1.21) dégâts | E5 | 3 | 4 | nos soins CD 1 brisent la glace (Soin critique, Murmure ; coût 60 PV en 1.21) ; Immunité le bloque ; notre propre Gel (Lame, ligne libre : moteur +7,0 %) verrouille LEUR carte clé · soigner la carte clé gelée avant son tour |
| **Immunité** (Immunity) | E : — / 90 | le porteur est immunisé contre tous les effets de nos cartes | E1 | 0 | 0 | MEILLEUR contre défensif sur Chimère : bloque Gel, Éternité, Disparition, probablement l’absorption (Veuve noire) — INFÉRENCE, à tester. Prix : remplacer Mimétisme coûte −8,1 % (moteur) |
| **Métamorphe** (Metamorph) | E : — / 120 | remplace la carte par 1 carte au choix parmi 3 de même rareté | E2 | 1 | 1 | relire leur plateau après chaque boutique |
| **Reset** (Reset) | E : — / 160 (1.20 : 130) | une attaque qui tue reste disponible | E3 | 2 | 3 | Ténacité casse la chaîne · garder les cartes fragiles au-dessus de leur burst |
| **Vengeur** (Vengeur) | E : — / 80 | récupère toutes ses attaques chaque fois qu’une carte qu’il n’a pas tuée meurt | E3 | 2 | 2 | Dragon Ciel #180 (possédé) l’a · tuer le porteur avant d’échanger des cartes |
| **Disparition** (Disparition) | L : — / 180 | chaque coup retire le DERNIER passif de la cible | L5 | 5 | 3 | Immunité (si elle la bloque) ; talent Inscrit (L’Œil, non débloqué) ; garder Mimétisme en dernier comme leurre — ne jamais placer un Tox précieux en dernière position · tuer Lisa/Aidan en premier ; prévoir l’AoE de Zombie Floral vers T6-T7 |
| **Éternité** (Eternity) | L : — / 220 | chaque coup augmente de 1 les recharges de la cible | L4 | 3 | 3 | Immunité ; talent Éternisé (Keria, non débloqué) · porteurs : Héraldesse Serpentine (beaucoup de coups), Nakyel #33 (possédé) |
| **Temporalité** (Temporality) | L : — / 190 | réduit de 1 les recharges des cibles touchées (de leur côté) | L2 | 1 | 1 |  |

Classes de menace (FAIT pour le mécanisme, INFÉRENCE pour le classement) :
- **contre les decks AoE / multi-coups** : Sac de frappe (chaque attaque reçue les nourrit), Renvoi (chaque coup renvoyé),
  Soin primitif / Vampirisme / Cœur vital (l'usure répartie ne passe pas la régénération) ;
- **contre les decks mono-cible** : Provocation (redirige tout), Bouclier (absorbe le gros coup), Ténacité, Phénix ;
- **contre les decks générateurs** : Mimétisme (copie), Éternité (CD 1 → 2) ;
- **contre les decks de soutien** : Érosion (PV max perdus), Disparition (passifs retirés) ;
- **contre les cartes fragiles** : Bomba (500 bruts), AoE (éclaboussures), Reset/Revanche/Vengeur (chaînes), Gel ;
- **contre tout le monde** : Berserk, Cimetière, Cœurs élémentaires, Cœur résistance (surtout s'il cumule en 1.21) ;
- **sans danger direct** : Chanceur, Spamland (indirect : boutique adverse meilleure), Inversement, Mystère,
  Optimisation, Multiplicateur (modéré), Temporalité, Immunité (ne gêne que nos propres effets), Contrecoup (handicap).

**Limites du moteur relevées dans `simulation.js` (FAIT)** : Poison est lu à 1 % quelle que soit la rareté, Spamland à
+3, Sac de frappe sans valeur (+1 implicite), Cœur résistance à plat ; et l'adversaire n'a jamais de Tox —
**toutes les menaces de ce rapport sont invisibles dans le score du wiki.**

## 4. Les cartes qui COMMENCENT avec un passif-menace

Rareté de la carte, Spamtons par tour (revenu), PV en 1.21 ; menace = niveau générique du Tox porté.

| Passif inné (rareté du Tox) | Carte(s) qui le portent d’office : #, nom, rareté carte, Spamtons/tour, PV | Menace (0-5) | vs chimere / vs zéro |
|---|---|---|---|
| **Disparition** L (Disparition_L) | #56 Lisa, la Dragonnière (common, 7/t, 800 PV — Courant aléatoire CD 2 : cible ALÉATOIRE) ; #115 Aidan (common, 8/t, 750 PV — Paie-torche CD 3 : cible CHOISIE, coûte 10 Feu) ; #140 Souris des blés (rare, 10/t, 500 PV — seule compétence = soin allié : pas de Disparition offensive (INFÉRENCE)) | 5 | 5 / 3 |
| **Gel** E (Frozen_E) | #92 Frost & Glacier (legendary, 4/t, 500 PV — Eau trouble CD 2 : 2 coups aléatoires → gèle + érode) ; #259 Dragon de la Cité Infernale (common, 10/t, 550 PV — Dualité Draconique CD 2 : cible choisie → gèle (60 dégâts de bris en 1.21)) | 5 | 3 / 4 |
| **Cœur résistance** R (CoeurResistance_R) | #190 Lames en peine (rare, 15/t, 550 PV — Cimetière R + Cœur résistance R + Chanceur R) | 4 | 3 / 3 |
| **Éternité** L (Eternity_L) | #33 Nakyel (rare, 3/t, 500 PV — Écorchage CD 2 : +1 recharge par coup) ; #256 Héraldesse Serpentine (legendary, 9/t, 900 PV — Constriction Éternelle CD 5 : nombreux coups, +1 recharge chacun) | 4 | 3 / 3 |
| **Renvoi** E (Reflect_E) | #106 L'Épine d'Amour (common, 6/t, 500 PV — générateur sans attaque : Renvoi purement défensif) | 4 | 2 / 3 |
| **Provocation** R (Taunt_R) | #234 Rongeur Nuageux (common, 11/t, 650 PV — 1.21 : Foudre CD 2 → provoque 1 tour sur 2) | 4 | 1 / 3 |
| **AoE** E (Aoe_E) | #237 Voyageur des Crêtes (rare, 9/t, 1000 PV — AoE E + Immunité) | 3 | 2 / 3 |
| **Brut** R (Brut_R) | #27 Hippocampe Nimbé (rare, 4/t, 900 PV — Brut + Reset) | 3 | 1 / 3 |
| **Cœur résistance** C (CoeurResistance_C) | #158 Lapin-Plume (common, 7/t, 850 PV — Contrecoup : se blesse en attaquant) | 3 | 3 / 3 |
| **Érosion** C (Erosion_C) | #39 Sylvan, Protecteur de la Verdure (common, 5/t, 550 PV — Double souffle CD 4 (3×25) + Bond-rapide CD 1) ; #92 Frost & Glacier (legendary, 4/t, 500 PV — Eau trouble CD 2 : 2 coups aléatoires → gèle + érode) ; #229 Maître Amphibian (common, 4/t, 700 PV — Miasmes CD 1 en AoE : érode toutes nos cartes à chaque tour) | 3 | 4 / 2 |
| **Mimétisme** R (Mimetisme_R) | #35 Léo (rare, 6/t, 800 PV — Éclair purificateur CD 4 applique aussi Éternité) ; #124 Wyrm des Dunes Cornu (common, 4/t, 500 PV) ; #238 Chimère Brasse-chair (rare, 5/t, 525 PV) | 3 | 1 / 4 |
| **Sac de frappe** C (PunchingBag_C) | #58 Le Transporteur Sauvage (common, 7/t, 1000 PV — Fort CD 4 = Provocation : combo Sac de frappe + Provocation) ; #72 Girafe Florale (rare, 7/t, 750 PV — Renaissance Sylvatique CD 2 = Provocation sur toute leur équipe : combo) ; #123 Tisseuse de Mots (common, 2/t, 500 PV — Veuve noire CD 8 = absorbe une carte) ; #160 Sanglier Doré (common, 6/t, 900 PV) ; #221 Crapaud des Étoiles (common, 6/t, 900 PV) ; #231 Aleera Mange-Cauchemars (common, 5/t, 500 PV) ; #247 Roi Feu (epic, 10/t, 1000 PV) ; #248 Roi Eau (epic, 10/t, 1000 PV) ; #249 Roi Nature (epic, 10/t, 1000 PV) ; #250 Roi Terre (epic, 10/t, 1000 PV) ; #251 Roi Ombre (epic, 10/t, 1000 PV) ; #252 Roi Lumière (epic, 10/t, 1000 PV) | 3 | 3 / 2 |
| **Reset** E (Reset_E) | #27 Hippocampe Nimbé (rare, 4/t, 900 PV — Brut + Reset) ; #85 Bleu-mange-cailloux (epic, 4/t, 500 PV) ; #204 Ephial (legendary, 12/t, 1500 PV) ; #211 Dragosaure Céleste (common, 12/t, 800 PV — Hurle frappe CD 3 gèle aussi) | 3 | 2 / 3 |
| **Revanche** R (Revenge_R) | #94 Zayd (legendary, 1/t, 600 PV — Fin du monde CD 7 (6×50) + Forteresse (Provocation)) | 3 | 2 / 2 |
| **Vengeur** E (Vengeur_E) | #180 Dragon Ciel (common, 8/t, 700 PV) ; #236 Apprentie de la Mort (rare, 6/t, 700 PV) | 3 | 2 / 2 |
| **AoE** C (Aoe_C) | #63 Shado, Fléau abyssal (common, 11/t, 800 PV) ; #151 Sbire des Flammes (common, 9/t, 800 PV) | 2 | 2 / 3 |
| **Berserk** R (Berserk_R) | #188 Commando Gerz (rare, 4/t, 1200 PV) | 2 | 2 / 2 |
| **Cimetière** R (Cimetiere_R) | #30 Naissance d'Aldrin (rare, 7/t, 700 PV) ; #190 Lames en peine (rare, 15/t, 550 PV — Cimetière R + Cœur résistance R + Chanceur R) | 2 | 2 / 2 |
| **Vampirisme** E (Life Steal_E) | #238 Chimère Brasse-chair (rare, 5/t, 525 PV) | 2 | 2 / 1 |
| **Vampirisme** R (Life Steal_R) | #67 Logidrake, l'Ignatius (rare, 5/t, 500 PV) | 2 | 2 / 1 |
| **Multiplicateur** R (Multiplicator_R) | #102 Murmures du Corail Noir (common, 2/t, 400 PV) ; #137 Cerf des Couleurs Funèbres (rare, 5/t, 600 PV) ; #153 L'Inventeur (common, 5/t, 1000 PV) ; #178 Épine Médusine (common, 10/t, 800 PV) | 2 | 1 / 1 |
| **Phénix** R (Phoenix_R) | #30 Naissance d'Aldrin (rare, 7/t, 700 PV) | 2 | 2 / 2 |
| **Soin primitif** C (Primitive heal_C) | #63 Shado, Fléau abyssal (common, 11/t, 800 PV) ; #69 Scorch, les Lézards Ignés (rare, 7/t, 350 PV) ; #86 Régent des Abysses (epic, 6/t, 1000 PV) ; #261 Godlur (common, 7/t, 1000 PV) | 2 | 3 / 1 |
| **Temporalité** L (Temporality_L) | #101 Neilla (common, 9/t, 650 PV) ; #255 Verdelune (legendary, 5/t, 900 PV) | 2 | 1 / 1 |
| **Berserk** C (Berserk_C) | #142 Squall, Émissaire des cauchemars (rare, 8/t, 1000 PV) ; #151 Sbire des Flammes (common, 9/t, 800 PV) ; #156 L'Œil des montagnes (common, 6/t, 600 PV) ; #234 Rongeur Nuageux (common, 11/t, 650 PV — 1.21 : Foudre CD 2 → provoque 1 tour sur 2) | 1 | 2 / 2 |
| **Cimetière** C (Cimetiere_C) | #236 Apprentie de la Mort (rare, 6/t, 700 PV) | 1 | 2 / 2 |
| **Cœur d'eau** C (CoeurEau_C) | #44 Léviathan des Cieux (legendary, 5/t, 1000 PV) ; #156 L'Œil des montagnes (common, 6/t, 600 PV) ; #174 Zombie Floral (common, 5/t, 850 PV — (1.21) compétence Malédiction aquatique CD 8 : AoE + 2 Disparitions) | 1 | 1 / 2 |
| **Vampirisme** C (Life Steal_C) | #128 Dévoreur de faune (common, 5/t, 700 PV) | 1 | 2 / 1 |
| **Phénix** C (Phoenix_C) | #37 Roi des Flammes Ardentes (epic, 7/t, 900 PV) ; #85 Bleu-mange-cailloux (epic, 4/t, 500 PV) | 1 | 2 / 2 |
| **Poison** C (Poison_C) | #134 Wibs l'Enflammé (common, 5/t, 550 PV) ; #244 Gazpoison Flottant (rare, 4/t, 450 PV) | 1 | 1 / 2 |
| **Ténacité** C (Tenacite_C) | #193 Vladislaus (epic, 4/t, 350 PV) ; #244 Gazpoison Flottant (rare, 4/t, 450 PV) ; #261 Godlur (common, 7/t, 1000 PV) | 1 | 1 / 2 |

Précisions (FAIT sauf mention) :
- **Disparition** : Lisa (#56) frappe une cible **aléatoire** tous les 2 tours → sur 4 cibles vivantes, Chimère perd au moins
  un passif d'ici T6 dans 58 % des cas (les deux : 16 %), d'ici T10 dans 76 % (les deux : 37 %) ; Aidan (#115) **choisit**
  sa cible tous les 3 tours dès qu'il a 10 Feu → Chimère nue en 2 lancers ; Souris des blés (#140) ne fait que soigner ses
  alliés → pas de Disparition offensive (INFÉRENCE, confiance moyenne) ; Zombie Floral (#174, 1.21, compétence et non
  passif) retire 2 passifs à **toutes** nos cartes en un lancer, disponible vers T6-T7 (CD 8 réduit de 1 ou 2 au départ).
- **Gel** : Dragon de la Cité Infernale (#259, commune, possédée) gèle une cible **choisie** tous les 2 tours ; Frost & Glacier
  (#92) gèle 2 cibles aléatoires tous les 2 tours et les érode.
- **Renvoi E 75 %** : L'Épine d'Amour (#106) n'attaque pas (générateur +2 Terre/Nature/Lumière par tour) : on peut l'ignorer
  avec un deck mono-cible, pas avec Galop.
- **Provocation** : Rongeur Nuageux (#234) ; en 1.21 il attaque tous les 2 tours, donc provoque 1 tour sur 2.
- **Sac de frappe** : 12 porteurs, dont 2 qui provoquent aussi (Le Transporteur Sauvage — Fort, CD 4 ; Girafe Florale —
  Provocation sur toute son équipe, CD 2) : le combo qui force un deck mono-cible à les nourrir.
- **Talents** (si l'adversaire en a débloqué — inconnu) qui donnent d'office un passif-menace : AoE (Gardien Vert ; Croqueur
  de Fruits Verdoyant en épique ; Lisa et Dragosaure Céleste en rare), Érosion (Esprit de la Faune, Wyrm des Dunes Cornu),
  Mimétisme (Léo), Brut (Raffteru, Guerrier des Neiges, Panthère imaginaire, Vivy, Shinobi Éclairant), Sac de frappe
  (Prisonnière), Bombe-8 = Bomba au tour 8 (Hibernatus, Guerrier des Neiges), Immunité-8 (Esprit de la Faune, Dragon de la
  Cité Infernale), Tox chanceux (Croqueur de Fruits Verdoyant, Lueur d'Espoir, Gabriel, Ephial), Pièce magique +2 Chance
  (7 cartes). Les compétences qui produisent les mêmes effets (Provocation × 8 dont Barrière Florale CD 1, Gel × 7,
  absorption, Disparition) relèvent de l'agent C.

## 5. Classement probabilité × impact

Présence « réaliste » à T8 = 1 − (1 − porteur d'office) × (1 − achat mou) ; « glouton » = idem avec l'achat glouton.
Porteur d'office = deck adverse de 4 cartes tirées au hasard (la popularité réelle des cartes est inconnue : biais possible).
Impact = note 0-5 justifiée au § 6 (chiffres moteur ou arithmétique) : **le produit est un ordre de grandeur, pas une mesure.**

**deck chimere** — les 12 premiers :

| Rang | Famille | Présence à T8 (réaliste : porteur inné ou achat « mou ») | Présence à T8 (glouton) | Impact sur le deck (0-5) | Risque = présence réaliste × impact |
|---|---|---|---|---|---|
| 1 | Sac de frappe | 43,1 % | 59,3 % | 3 | 1,29 |
| 2 | Érosion | 19,5 % | 37,2 % | 4 | 0,78 |
| 3 | Soin primitif | 25,3 % | 46,8 % | 3 | 0,76 |
| 4 | Cœur résistance | 19,9 % | 43,3 % | 3 | 0,6 |
| 5 | Berserk | 27,5 % | 48,4 % | 2 | 0,55 |
| 6 | Disparition | 9,2 % | 9,3 % | 5 | 0,46 |
| 7 | Cimetière | 22,5 % | 44,9 % | 2 | 0,45 |
| 8 | Vampirisme | 22,3 % | 45,1 % | 2 | 0,45 |
| 9 | AoE | 21,9 % | 43,4 % | 2 | 0,44 |
| 10 | Renvoi | 17,8 % | 41,5 % | 2 | 0,36 |
| 11 | Phénix | 15 % | 26,5 % | 2 | 0,3 |
| 12 | Chanceur | 27,8 % | 48,8 % | 1 | 0,28 |

**zéro critique** — les 12 premiers :

| Rang | Famille | Présence à T8 (réaliste : porteur inné ou achat « mou ») | Présence à T8 (glouton) | Impact sur le deck (0-5) | Risque = présence réaliste × impact |
|---|---|---|---|---|---|
| 1 | Sac de frappe | 43,1 % | 59,3 % | 2 | 0,86 |
| 2 | AoE | 21,9 % | 43,4 % | 3 | 0,66 |
| 3 | Cœur résistance | 19,9 % | 43,3 % | 3 | 0,6 |
| 4 | Berserk | 27,5 % | 48,4 % | 2 | 0,55 |
| 5 | Renvoi | 17,8 % | 41,5 % | 3 | 0,53 |
| 6 | Mimétisme | 12,9 % | 20 % | 4 | 0,52 |
| 7 | Cimetière | 22,5 % | 44,9 % | 2 | 0,45 |
| 8 | Cœur d'eau | 22,4 % | 45,1 % | 2 | 0,45 |
| 9 | Poison | 20 % | 42,9 % | 2 | 0,4 |
| 10 | Reset | 13 % | 14,4 % | 3 | 0,39 |
| 11 | Érosion | 19,5 % | 37,2 % | 2 | 0,39 |
| 12 | Ténacité | 18,3 % | 34 % | 2 | 0,37 |

Pire cas (impact ≥ 4, rares mais décisifs) : deck chimere → Disparition (5 ; 9,2 % via cartes, plus Zombie Floral),
Érosion (4) ; zéro critique → Mimétisme (4 ; 12,9 %), Gel (4 ; ≈ 7 %), Bomba (4 ; 1,2 % en boutique + talent Bombe-8).

## 6. Nos decks : ce qui fait le plus mal, ce qu'il faut garder ou acheter

**Disponibilité des Tox-contres dans NOTRE boutique** (même modèle ; deck chimere 24 Spamtons/tour et Chance 1/tour ;
zéro critique 24 Spamtons/tour en 1.21 et Chance 1,5/tour ; % obtenus à T2 / T4 / T6 / T8 / T10) :

| Notre deck | Tox-contre (toute rareté) | Acheté dès qu’offert (sinon on dépense) | Épargne + 1 relance/boutique | Épargne + jusqu’à 3 relances/boutique |
|---|---|---|---|---|
| deck chimere | Brut | 0 / 2,1 / 6,6 / 11,6 / 16,1 | 0 / 4,1 / 12,8 / 21,9 / 29,9 | 0 / 7,8 / 23,6 / 38,5 / 50,1 |
| deck chimere | Immunité | 0 / 0 / 0,6 / 3 / 7,5 | 0 / 0 / 1,1 / 5,3 / 13,3 | 0 / 0 / 2,2 / 10,2 / 24,9 |
| deck chimere | Gel | 0 / 0 / 0,2 / 1,9 / 5,4 | 0 / 0 / 1,2 / 5,4 / 13,4 | 0 / 0 / 2,1 / 10,3 / 25,2 |
| deck chimere | Ténacité | 12,7 / 21,9 / 27 / 29,6 / 30,4 | 24,1 / 39,4 / 47,1 / 51 / 52,3 | 34,3 / 57,7 / 67,9 / 72,2 / 73,6 |
| deck chimere | Phénix | 0 / 0,8 / 7 / 12,9 / 18,2 | 0 / 19,6 / 36,3 / 49,4 / 59,8 | 0 / 19,8 / 47,6 / 64,7 / 76,3 |
| deck chimere | Bouclier | 13,1 / 23,7 / 32,4 / 39,5 / 45,6 | 24,3 / 41,8 / 54,3 / 63,7 / 70,9 | 24,8 / 55,8 / 72,6 / 82,5 / 88,7 |
| zéro critique | Brut | 0 / 4,3 / 9,2 / 12,9 / 15,4 | 0 / 9,1 / 18,6 / 25,2 / 29,8 | 0 / 17,2 / 33,7 / 44,4 / 51,2 |
| zéro critique | Immunité | 0 / 0,3 / 3,3 / 8,1 / 13,4 | 0 / 1,1 / 7,5 / 17,6 / 27,8 | 0 / 1,5 / 13,9 / 31,7 / 47,6 |
| zéro critique | Gel | 0 / 0 / 0,6 / 3 / 6,2 | 0 / 0 / 6,4 / 16,9 / 27,4 | 0 / 0 / 12,6 / 31 / 47,5 |
| zéro critique | Ténacité | 12,1 / 17,6 / 19,3 / 19,7 / 19,7 | 22,6 / 32,8 / 35,7 / 36,5 / 36,5 | 32,3 / 48,4 / 52,8 / 53,9 / 53,9 |
| zéro critique | Phénix | 0 / 0,6 / 2,3 / 4 / 5,8 | 0 / 12,6 / 25,4 / 40 / 52,2 | 0 / 13,1 / 32,9 / 48,3 / 63,2 |
| zéro critique | Bouclier | 11,9 / 21,4 / 28,9 / 34,9 / 39,8 | 22,6 / 38,9 / 51,4 / 61 / 68,7 | 23 / 51,8 / 67,4 / 77,6 / 85,4 |

### 6.1 deck chimere [103 Lame de la forêt, 238 Chimère Brasse-chair, 156 L'Œil des montagnes, 117 Keria]

Profil (FAIT, moteur 1.21 : score 8 011) : Galop arctique (CD 2, 2 coups sur **toutes** les cartes adverses) fait ≈ 92 %
des dégâts du moteur, Pinces (5 de base, critique ×6) ≈ 8 % ; dégâts de Galop par cible et par lancer ≈ 27 (T2), 55 (T4),
91 (T6), 146 (T8), 221 (T10) ; survie = Vampirisme 75 % de Chimère + 2 soins ; PV 525-650 ; génération ≈ +1 Eau/tour.
Lignes libres : Lame 1, Keria 1 ; Chimère (Galop + Vampirisme + Mimétisme) et L'Œil sont pleines.
Ordre des passifs de Chimère : Vampirisme puis **Mimétisme en dernier**.

Ce qui fait le plus mal (par ordre de risque) :
1. **Sac de frappe** (présence 43 % à T8) : chaque Galop attaque chaque porteur ; à T10 un porteur commun a gagné +5 (par
   attaque) à +10 (par coup) points dans son élément = +50 à +100 % de ses dégâts dans cet élément ; 2 porteurs du même
   élément (ex. Roi Nature + Tisseuse) doublent. INFÉRENCE : impact 3.
2. **Érosion** (19,5 %) : rend le Vampirisme inutile pour les PV perdus ; borne moteur « Vampirisme annulé » −53 %. Maître
   Amphibian (AoE CD 1) érode nos 4 cartes à chaque tour.
3. **Soin primitif** (25 %) : une carte de 1000 PV en Soin primitif C régénère 40/tour contre ≈ 46/tour de Galop.
4. **Cœur résistance** (20 %) : si le cumul 1.21 est réel, +24 % (C) / +48 % (R) de résistance sur chaque carte adverse à T8.
5. **Disparition** (9 %, impact 5) : 1er passif −8,8 %, 2e −56,8 %, L'Œil −16,2 % / −24,0 %, tout −65,4 % (moteur 1.21).
6. **Gel** (≈ 7 %) : Dragon de la Cité Infernale sur Chimère −20,7 % (E1) ; Soin critique (CD 1) brise la glace (60 PV en 1.21).
7. **Bomba** (rare) : 500 bruts tuent Chimère dès qu'elle a perdu 25 PV, Keria 50, L'Œil 100, Lame 150.
8. **Renvoi** (18 %, impact 2) : une carte à Renvoi E rend ≈ 68 par Galop à T6, le Vampirisme en soigne ≈ 274 ; ça devient
   grave seulement sur plusieurs cartes (E1 : Renvoi E sur toutes −53,6 %) ou après la perte du Vampirisme.
9. **Provocation** : seule Pinces est forcée (≈ 8 % des dégâts ; E1 : provocateur 900 PV −4,3 %).

À **garder** :
- **Mimétisme** sur Chimère, en dernière position : c'est le leurre de la 1re Disparition (−8,8 % au lieu de −53 % si le
  Vampirisme partait d'abord). Tout Tox posé à sa place deviendrait la cible de la 1re Disparition.
- **Vampirisme** : c'est le deck (−53 % sans lui) et il neutralise Renvoi.

À **acheter** si offert (ligne libre de Lame d'abord) :
- **Gel** sur Lame (moteur +7,0 %) : Pinces CD 1 en dernier coup du tour gèle LEUR carte clé (Tisseuse avant Veuve noire,
  Fleur de Vie avant Barrière Florale, Lisa, Aidan). Obtenu d'ici T8 dans 1,9 % des parties (acheté dès qu'offert), 10,3 % en
  chassant (épargne + ≤ 3 relances).
- **Brut** sur Lame (+1,2 %) : ignore Provocation et résistances (dont Cœur résistance cumulatif). 11,6 % / 38,5 % à T8.
- **Immunité** : sur Keria/Lame +0,7 / +0,9 % ; **sur Chimère à la place de Mimétisme −8,1 %**, mais elle protégerait le cœur
  du deck contre Gel, Éternité, Disparition et probablement l'absorption de Veuve noire (INFÉRENCE, à tester) → seulement face
  à Tisseuse / Lisa / Aidan / Zombie Floral / Dragon de la Cité / Frost & Glacier. 3,0 % / 10,2 % à T8.
- Jeu : Galop avant Pinces (casse les Boucliers) ; Pinces sur la carte qui régénère ; ne pas compter sur l'AoE contre une
  carte en Soin primitif R/E/L.

### 6.2 zéro critique [102 Murmures du Corail Noir, 116 Prisonnière de la Machine, 12 Hibernatus, 69 Scorch]

Profil (FAIT, moteur 1.21 : score 6 315 ; 6 529 en 1.20, Murmures affaibli) : 100 % des dégâts en mono-cible (Souffle
d'eau et Explosion CD 1, Haleau CD 2) ; génération ≈ 12,5 points/tour (Feau +9, Souffle +1, Haleau +5 un tour sur 2) ;
Explosion coûte 100 PV par usage et prend +10 de base à chaque usage ; Scorch 350 PV, Murmures 400 PV ; deux Provocations
(Digue, Braisegarde) ; Chance 1,5/tour grâce à Hibernatus. Lignes libres : Prisonnière 1, Scorch 1.

Ce qui fait le plus mal :
1. **Sac de frappe** (43 %) : ne se nourrit que si on le vise — mais les porteurs qui provoquent (Transporteur Sauvage,
   Girafe Florale) nous y obligent : jusqu'à 25 attaques d'ici T10 = +25 points pour eux (porteur commun).
2. **AoE** (22 %) : chaque coup adverse mono-cible éclabousse nos voisines ; Scorch et Murmures ne tiennent pas.
3. **Cœur résistance** (20 %) : même remarque qu'au § 6.1 ; Brut l'ignore.
4. **Renvoi** (18 %) : Explosion ≈ 125 (T5) → 272 (T8) par coup (bonus Feu de Scorch seul, hors critique) ; Renvoi E en
   renvoie 94-204 en plus des 100 PV payés ; provocateur 900 PV + Renvoi E : −42,0 % (agent E1).
5. **Mimétisme** (13 %, impact 4) : l'adversaire gagne +2,5 à +4,5 points/tour dans nos éléments (Feu/Eau/Terre), soit +20 à
   +36 points d'ici T8.
6. **Gel** (≈ 7 %) : Murmures gelée 1 tour sur 2 −35,5 %, Prisonnière −34,9 % (E1). **Bomba** : tue Scorch ou Murmures pleins
   (2 cibles sur 4). **Disparition** : Murmures −20,6 %, Scorch −10,5 %, tout −26,9 %. **Éternité** : nos CD 1 passent CD 2.
7. **Provocation** seule : −7,4 % (E1, provocateur 900 PV) ; dangereuse surtout en combo.

À **garder** : Multiplicateur de Murmures (−20,6 % s'il est retiré), Soin primitif de Scorch (−10,5 %).
À **acheter** si offert : **Brut** sur Prisonnière (+5,7 % ; seul contre de Provocation ; 12,9 % d'ici T8, 44,4 % en chassant),
**Ténacité** sur Scorch (+10,5 % ; commun à 10 Spamtons ; 19,7 % / 53,9 %), **Gel** sur Prisonnière (+8,7 % ; 3,0 % / 31,0 %),
**Immunité** sur Scorch (+0,6 % ; protège le générateur du Gel et de l'Éternité ; 8,1 % / 31,7 %).

## 7. Faits, inférences, et ce qu'il faut vérifier en jeu

FAITS : textes et valeurs des Tox (1.20 et 1.21), coûts, pools, cotes, règles de boutique, porteurs d'office, scores moteur.
INFÉRENCES (confiance) : sémantique des cas ambigus ci-dessous ; impacts 0-5 (moyenne) ; Monte Carlo (élevée pour les cotes
et les prix, moyenne pour le comportement d'achat, faible pour la popularité des cartes).

À vérifier en partie (une capture suffit à trancher) :
1. Sac de frappe compte-t-il par **attaque** ou par **coup** ? (Galop = 2 coups : facteur 2.)
2. Mimétisme : +1 par **événement** de génération ou +1 par **type** généré ?
3. Immunité bloque-t-elle l'**absorption** (Veuve noire), la Disparition, l'Érosion ?
4. Ténacité arrête-t-elle Bomba (Bomba est-elle une « attaque ») ?
5. Effet réel de la **Fumée** sur nos attaques (aucune source téléchargée ne le décrit).
6. Cœur résistance C/R **cumule-t-il** chaque tour en 1.21, et y a-t-il un plafond de résistance ?
7. Adjacence d'AoE : l'ordre des cartes à l'écran détermine-t-il les voisines ?
8. Une boutique peut-elle offrir deux fois le même Tox ? Le revenu du tour arrive-t-il avant la boutique ?

## 8. Fichiers

- `D_tox.md` (ce rapport, rendu par `D_build.js` depuis `D_raw/D_tox_src.md`), `D_tox.json` (102 lignes : 101 Tox + Contrecoup).
- `D_mc.js` → `D_mc_out.json` (exposition par famille × 9 politiques — dont les 2 « pertes » ajoutées par `D_mc_deaths.js` —
  et par Tox × 4 politiques) ;
  `D_mc_sets.js` → `D_mc_sets_out.json` (ensembles de menaces, nos contres, porteurs d'office).
- `D_drv_passives.js` → `D_raw/passives_eval_121.json` (moteur 1.21 : passifs retirés/ajoutés ; 1.20 dans
  `D_raw/passives_eval.json`), `D_raw/allvanish_121.json`.
- `D_raw/` : `engine_consts.json` (1.20) / `engine_consts_121.json`, `model_121.json`, `simulation_live.js`,
  `tox_en_props.json` / `tox_fr_props.json` (page Tox en direct), `patch_live.txt`.
