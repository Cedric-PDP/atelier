# C — Ce qu'un ADVERSAIRE peut faire à nos decks au-delà des dégâts

Agent C — audit SPAM v1.20 (données du README), avec le delta v1.21 publié le 9 octobre 2026.
Périmètre : les 203 compétences actives et les 381 talents des 127 cartes, vus du côté de la victime. Les 100 passifs
de départ (Tox innés) sont repris comme contexte quand ils jouent le même rôle.
Livrables : ce fichier, et `C_actives.json` (catalogue complet : 55 mécaniques, 683 lignes carte×mécanique, texte FR,
CD, 1er tour de disponibilité, cible, durées, coût, possession et note v1.21). Les scripts et les données brutes
sont dans `C_work/`.

Conventions : **FAIT** = lu dans les données, dans une page du wiki ou dans une sortie du moteur (source citée).
**INFÉRENCE** = déduction, avec un niveau de confiance. « 1re dispo T8/T7 » signifie : prête au tour 8 si l'adversaire
joue en premier, au tour 7 s'il joue en second. Règle du wiki (« le 1er joueur commence avec toutes ses recharges
réduites de 1, le 2e de 2 ») ; c'est aussi la fonction `ee(cd,player)=max(1, player===1 ? cd : cd-1)` du moteur.

Plan : 0 À retenir · 1 Alerte v1.21 · 2 Méthode · 3 Texte vs données (M1-M27) · 4 Cartes de l'incident ·
5 Impact sur nos decks · 6 Contre-mesures · 7 Catalogue complet par famille (a)-(h).

---

## 0. À retenir

**FAITS**
1. **Peu de cartes peuvent retirer une de nos cartes, et ce sont surtout des communes.** 5 compétences actives sur 203
   peuvent retirer ou neutraliser directement une de nos cartes ou ses passifs :
   - Veuve noire (#123, commune) : absorbe n'importe quelle carte, CD 8 ;
   - Corne 25 et Corne 75 (#139, rare) : CD 7 et 5 ;
   - Malédiction aquatique (#174, commune) : Disparition, CD 8 ;
   - Écras'eau (#44, légendaire) : 30 % des PV max de la cible, CD 3.

   À cela s'ajoutent 3 passifs de départ « Disparition à chaque coup » (#56 et #115, communes ; #140, rare) et le
   talent Bombe-8 (2 communes). Sur les 9 cartes porteuses de ces menaces (en excluant #86, qui n'absorbe que ses
   alliés), 6 sont communes, donc très répandues.
2. **La v1.21 (publiée aujourd'hui) aggrave, ou révèle, la Disparition.** Malédiction aquatique (#174) devient une
   **attaque de zone avec 2 Disparitions** (buff silencieux, ou texte 1.20 incomplet : voir M27).
   Chacune de nos cartes perd ses **deux derniers passifs** : Chimère perd Vampirisme 75 % et Mimétisme, L'Œil perd
   Berserk et Cœur d'eau. Zombie Floral passe du tier B au tier S (+60 places). Source :
   `/fr/patch/` et `/data/model-edeb0ebc315cfd15.json`.
3. **Déni d'action (b) :**
   - Gel actif : 6 cartes, plus #122 qui gèle l'allié qu'il soigne.
   - Gel passif sur chaque coup : 2 cartes, dont notre #259.
   - Éternité : 7 cartes en actif, 2 en passif, 15 par talent (Longueur, Heure Funeste).
   - Remise des recharges au maximum : 1 carte (#78).
   - Baisse de précision : 8 cartes.
   - Fumée : 5 cartes.
4. **Ciblage forcé ou contourné (c) :**
   - Provocation active sur 6 cartes adverses (plus nos #12 et #116). Deux l'ont à **CD 1**, ce qui la rend
     **permanente** : Fleur de Vie #222 et Yotaru #262.
   - Provocation passive : 1 carte (#234). Talent Focus : 12 cartes.
   - Brut : 6 cartes. Brut ignore nos provocations et nos résistances.
5. **Déni d'économie (d) : rare.** Une seule carte remet nos Spamtons à 0 : Jugement divin (#96, légendaire, CD 10,
   prêt T10/T9). Racket existe en talent sur 2 cartes. Un seul vol de bonus élémentaire (#42).
6. **Le moteur du wiki ne joue jamais ces mécaniques contre nous** : l'adversaire y est abstrait. Quand c'est **nous**
   qui les possédons, il les crédite au forfait (`g={freezePerTarget:70, eternityPerTarget:25, vanish:40,
   resetEnemyCd:120, resetEnemySpamton:60, smoke:10, breakTaunt:10…}`). Il modélise Absorbe comme « 700 dégâts + 350
   PV max ». **Le vrai match a montré +525 PV**, soit 100 % des PV de Chimère, et non 50 %. Absorbe une carte alliée
   n'a aucun effet dans le moteur (`case absorbAlly: break`).
7. **Le texte et les données divergent à 27 endroits** (section 3). Dans 13 cas, la **cible ou la durée** d'un effet
   de contrôle n'est pas encodée (target `none` ou durée contradictoire), en particulier Veuve noire, Corne 25/75,
   Silenfeu, Ralentissement et Barrière Florale. Les pages EN, elles, sont cohérentes avec le modèle sur les 203
   compétences, 381 talents et 100 passifs : CD, précision, critique et nombres dans le texte.

**INFÉRENCES** (moteur du wiki, plan de jeu sur 10 tours, `C_work/share_out.json`)
- **Deck chimere : tout dépend de Chimère**, qui porte **91,4 % des dégâts** (Galop arctique, en zone) et **69 % des
  soins** (vol de vie). La menace n°1 est donc tout ce qui retire Chimère ou lui fait sauter un Galop :
  - Veuve noire, ou Corne 25 suivie d'un coup ;
  - un Gel ou une Éternité posé le tour où Galop est prêt ;
  - Disparition, qui lui retire Vampirisme en 1.21.

  Confiance haute.
- **Zéro critique : 100 % de ses dégâts sont mono-cible** (Explosion 64 %, Souffle d'eau 22 %, Haleau 14 %).
  - Un provocateur permanent encaisse donc **tout**. Fleur de Vie (600 PV, 0 % de résistance partout) absorbe les
    ~557 premiers dégâts, soit les tours 1 à 5 du plan moteur.
  - Brut contourne nos deux provocateurs et peut viser Scorch (350 PV, la perte la plus coûteuse : −63 %) ou
    Murmures (−60 %).

  Confiance haute pour le mécanisme, moyenne pour les tours exacts.

---

## 1. Alerte fraîcheur : la v1.21 est en ligne depuis le 9 octobre 2026

**FAIT.** Le pied de page du wiki affiche `SPAM v1.21`. Sur `/fr/builder/`, `engineHash` vaut `36e2c03d5b7bf4a1`
(contre `a8193b3d422a54a9` dans `js/model.json`). La note de patch `/fr/patch/` annonce « 15 cartes changent vraiment ;
80 autres ne voient que leurs textes reformulés ». J'ai téléchargé le modèle v1.21 dans `C_work/model_v121.json` et
calculé le diff carte par carte en ignorant la typographie (`C_work/diff_v120_v121_sub.txt`).

| Carte | Changement 1.21 | Effet pour cet audit / nos decks |
|---|---|---|
| #174 Zombie Floral (C) | Malédiction aquatique : cible `enemy` → `aoeEnemy`, effets `[vanish]` → `[vanish, vanish]`. Texte : « Attaque [30 à 60] Eau sur toutes les cartes adverses / Applique Disparition / Attaque [30 à 60] Nature sur toutes les cartes adverses / Applique Disparition ». PV 1000 → 850. | La menace (a) la plus large du jeu. Dès le T8/T7 (une fois par partie en pratique, CD 8), elle retire 2 passifs à chacune de nos 4 cartes. Le wiki présente ce changement comme une simple reformulation : sa note de patch ne liste que les PV (voir M27). |
| #123 Tisseuse de Mots (C) | Spamtons/tour 3 → 2 | Aucun changement sur Veuve noire. |
| #102 Murmures du Corail Noir (**possédée**, zéro critique) | PV 500 → 400 ; Spamtons/tour 7 → 2 ; Murmure : base de soin +5 → +3 par usage | Zéro critique perd 100 PV et 5 Spamtons/tour. Murmures devient plus facile à exécuter (Bomba 500, Écras'eau 120). |
| #51 Sorcière Pyrokinétique (C) | Flamme magique : critique 1 → 20 %, **texte inchangé** | L'Éternité « en cas de critique » passe d'environ 2 % à environ 36 % par lancer (2 coups). |
| #234 Rongeur Nuageux (C) | Ronge-nuage remplacé par Foudre : CD 3 → 2, 30 Lumière + 50 % des PV manquants du lanceur ; PV 750 → 650 | Sa Provocation passive (déclenchée à chaque attaque) se réactive tous les 2 tours au lieu de 3. |
| #203 Ashtarae Lycaria (L) | Résurrection coûte maintenant 5 Ombre ; PV 1000 → 700 ; Spamtons/tour 8 → 4 | Résurrection adverse moins gratuite. |
| #92 Frost & Glacier (L), #259 Dragon de la Cité Infernale (**possédée**) | Gel : dégâts de bris de glace 40 → 60 | Dégeler un allié par un soin coûte désormais 60 PV. |
| #236 Apprentie de la Mort (R) | Brûlure Nocturne (zone) : 15 + 15 → 25 + 25 | Plus de dégâts de zone sur nos cartes fragiles. |
| #37, #124 | Morsure brûlante : critique d'équipe +5 → +7 % | — |
| #180 Dragon Ciel (**possédée**) | Souffle tornade → **Appel de la forêt** (zone 30 Nature, Nature +4) | Une attaque de zone de plus dans la collection, donc insensible aux provocations (inférence, §7, notes de lecture c). |
| #30 Naissance d'Aldrin (**possédée**) | Tox de départ Reset → Cimetière (rare, +5) | — |
| #158 Lapin-Plume (**possédée**) | PV 1000 → 850 ; Cœur résistance « **Au début de chacun de vos tours** … (+3) » | Le passif devient cumulatif d'après le texte, mais les données n'ont pas de champ `perTurn` (M21). |
| #153 L'Inventeur (**possédée**) | Materia [-8 à +10] → [-5 à +8], et **enfin encodée** (`gen all -5..8`) | Corrige M12. |

**FAIT, à corriger dans le README.** Le champ `spamton` n'est **pas un coût** : c'est le **revenu par tour** de la
carte vivante. La fiche de #123 affiche « 500 PV 2 Spamtons / tour ». La page des règles dit « Each turn you earn the
Spamtons of your living cards… plus the turn number ».
- Revenu du deck chimere : 5 + 5 + 6 + 8 = **24/tour**.
- Revenu de zéro critique : 7 + 3 + 12 + 7 = **29/tour**, soit **24** en 1.21.

---

## 2. Méthode et sources

- **Données** : `js/model.json` (v1.20) et `audit/cards_compact.txt`. Une option de compétence est retenue si elle a
  des `effects`, une cible autre qu'un ennemi unique, un coup spécial (`pctMaxHp`, `missingPct`, élément
  `random`/`self`), un soin, un vol, un écho, un nombre d'usages limité, un coût ou un choix. Cela retient
  **182 options**. Les 381 talents sont tous catalogués. Les 100 passifs de départ sont repris pour 28 des 30 types (tous sauf Cœur et Chanceur, qui ne font que générer)
  (`C_work/build_catalog.js` → `catalog_raw.json` → `gen_report.js`).
- **Pages du wiki** : les 127 fichiers `pages/*.html` sont en réalité les pages **EN** de la v1.20 (`<html lang="en">`,
  canonical `/en/cards/…`). J'en ai extrait le texte visible avec `C_work/parse_pages.js`, puis comparé CD, précision,
  critique et nombres. Résultat : **203/203 compétences, 381/381 talents et 100/100 passifs identiques au modèle.** La
  seule précision visible propre à l'EN : Rayonnement dit « *The target's* cooldowns are reset to maximum », alors que
  le FR ne précise pas à qui.

  Pour la v1.21, une page FR en ligne (`/fr/cards/tisseuse_de_mots/`) a été recoupée avec `model_v121.json`
  (2 Spamtons/tour, « attaque adverse ») : identique.
- **Textes des règles** : `basics.txt` et `/fr/basics/`, `/fr/strategies/` en ligne, ainsi que `patch.txt` et
  `/fr/patch/`, `tox_fr.json`. La page Stratégies (FR) confirme que **« Absorbe (tue la cible), Corne 25 (met la cible
  à 25 %) et les dégâts en % des PV max ignorent les gros totaux de PV »**.
- **Moteur** : `js/simulation.js` (version embellie : `audit/B_engine_pretty.js`, l. 1060-1133 pour les effets,
  l. 821-860 pour les dégâts reçus). Trois runs bornés via `scripts/sim_lab2.js` pour obtenir la part de chaque
  compétence dans nos deux decks : `C_work/drv_share.js` et `drv_turns.js`.
- **Perte d'une carte** : `app/lost_saved.json`.
  - Deck chimere (8 018) : perdre Lame coûte −40 %, Chimère −76 %, L'Œil −47 %, Keria −46 %.
  - Zéro critique (6 529) : perdre Murmures coûte −60 %, Prisonnière −55 %, Hibernatus −54 %, Scorch −63 %.

---

## 3. Texte vs données : ce qu'un moteur piloté par les données ignore

Méthode : un contrôle automatique (`C_work/check_text.js` → `mismatch_auto.txt`, et `check_text_v121.js` pour la
1.21) compare plusieurs choses :
- les nombres du texte FR aux champs `hits`, `heals`, `gen` et `effects` ;
- les mots-clés (Gel, Provocation, Éternité, aléatoire, « en cas de critique », « pendant N tours », Écho, Usage
  limité, Coût, X18…) à leur encodage ;
- les cibles `none` des effets ciblés ;
- la durée de la compétence à celle de l'effet ;
- les pages EN aux données.

Les cas sémantiques ont ensuite été relus à la main. Chaque ligne est un **FAIT** de données ; la colonne
« Conséquence » est une **INFÉRENCE**.

| # | Carte / compétence | Ce que dit le texte | Ce qu'encodent les données | Conséquence |
|---|---|---|---|---|
| M1 | #123 Tisseuse — Veuve noire | « Absorbe une carte » (cible libre, ennemis compris) | `target:none`, `effects:[{type:absorbAny}]` ; aucun gain de PV encodé. Le moteur invente 700 dégâts + PV max +350 (50 % de 700). | Réel observé : PV max 500 → 1 025, soit **+525 = 100 %** des PV de Chimère. Le moteur sous-estime le gain de moitié et ne sait pas qui est visé. |
| M2 | #222 Fleur de Vie — Barrière Florale | « Applique Provocation au lanceur » (sans durée) | `ability.duration 0`, effet `taunt.duration 2`, CD 1 | Durée contradictoire. Avec CD 1, la provocation est entretenue en permanence. |
| M3 | #58 Transporteur Sauvage — Fort | « … pendant **2** tours » | `ability.duration` **4**, effet 2, CD 4 | 50 % ou 100 % de couverture selon le champ lu. |
| M4 | #139 Cornu — Corne 25 / Corne 75 | « **La cible** se retrouve à 25 % / 75 % de ses PV max » | `target:none` | Camp non encodé. Le moteur traite Corne 25 comme 630 dégâts à un ennemi (0,75 × 700 × 1,2) et Corne 75 comme un **soin du lanceur**. |
| M5 | #86 Régent — Avalement | « Absorbe une carte alliée » | `target:none` ; gain non encodé ; moteur : aucun effet | Un Régent de 1 000 PV qui mange un allié de 1 000 PV (inférence : comme Veuve noire, +100 %) devient invisible pour le moteur. |
| M6 | #91 Ignea — Silenfeu | « Applique Gel » | `target:none`, `ability.duration 2` | On ne sait pas qui est gelé ni combien de temps. |
| M7 | #23 Artisan des Heures, #64 Maître Thronebéur — Ralentissement | « Applique Éternité » | `target:none` | Cible non encodée (probablement une carte adverse au choix). |
| M8 | Gels actifs #23 Flash, #29 Vent critique, #91 Silenfeu, #122 Soin soleil | Pas de durée dans le texte | `ability.duration 2`, alors que #34, #59 et #211 ont 0 ; la règle et le moteur gèlent 1 tour (`frozenOwnerTurns:1`) | Si « 2 » est la durée réelle du Gel actif, le moteur la divise par deux. Incohérence entre cartes. |
| M9 | #35 Léo — Éclair purificateur ; #51 Sorcière — Flamme magique | Aucune durée | `ability.duration 2` avec Éternité (et une résistance −10 % pour #51) | On ignore ce qui dure 2 tours : l'Éternité ? la baisse de résistance ? |
| M10 | #122 Esprit de la Faune — Soin soleil | « Soigne 60 Lumière / Gel » | Gel encodé avec `target:"ally"` (l'allié soigné) | Soit l'adversaire gèle son propre allié, soit le Gel vise un ennemi et la donnée est fausse. Il remplace un « Étourdissement » de la 1.19. |
| M11 | #22 Lueur d'Espoir — Respiration | « Résistance d'**un élément aléatoire** (+15) » | `res +2.5` sur **tous** les éléments | L'aléa est lissé en espérance (15/6). |
| M12 | #153 L'Inventeur (**possédée**) — Materia | « Bonus [-8 à +10] dans chaque élément » | `gen:[]` (rien) en 1.20 | Le moteur 1.20 ne lui fait **rien générer**. Corrigé en 1.21 (`gen all -5..8`). |
| M13 | #78 Gardien Vert — Rayonnement | FR : « Les temps de recharge des compétences sont remis au maximum » (de qui ?) ; EN : « **The target's** cooldowns » | `{type:resetEnemyCd}` sans cible ; moteur : +120 de contrôle forfaitaire | C'est la carte touchée qui est visée (selon l'EN). |
| M14 | #262 Yotaru — Protect-terre / Protect-boost | « Brise une Provocation pour … » | `target:none`, `breakTaunt` | Sa propre provocation (combo avec Protect) ou **la nôtre** ? Non encodé. |
| M15 | #31 Secousse aléatoire (précision 10 %), #54 Morsure, #64 Marteau-lumineux, #203 Mélodie n°1 | « Attaque X / … sur toutes les cartes alliées » | `target:"allAllies"` sur une option qui frappe | Le moteur en fait un coup sur un ennemi. La cible réelle du coup n'est pas encodée (Secousse « aléatoire » : sur qui ?). |
| M16 | #72 Girafe Florale — Renaissance Sylvatique | « Applique Provocation / Cible toutes les cartes alliées » | taunt `scope:"ally"` mais `target:"allAllies"` | Un allié provoque, ou toute l'équipe ? |
| M17 | #261 Godlur — Frappe golémique ; passif Fumée (#146, #152, #191, #243) | « Fumée » / « Enfume le terrain allié… » | aucun paramètre ; aucune règle trouvée sur le wiki ; moteur : +10 de défense forfaitaire | Mécanique **non documentée** (probablement une baisse de précision contre le terrain enfumé, confiance basse). |
| M18 | Talent Bombe-8 (#12, #59) | Passif embarqué : « Inflige 500 dégâts bruts » | Le Tox Bomba de la boutique dit « … **à une carte adverse aléatoire quand cette carte meurt** » | Le déclencheur (mort) et la cible (aléatoire) ne figurent pas dans le texte du talent. |
| M19 | Talents « AOE » (#17 « AOE Épique », #56/#211 « AOE Rare », #78 « AOE ») | Texte identique : passif « AoE » | `passiveObj.pct` 80 / 40 / 20 | Le pourcentage n'apparaît que dans le nom ou la rareté. |
| M20 | Sursaut Vital (#123, #160, #193) ; Petit prix (#140, #190) | « …récupère entièrement ses PV » ; « …remboursé » | paramètres cachés `minSpamton:100` ; `value:60` | Paramètres de valorisation propres au moteur (inférence), absents du jeu. |
| M21 | #158 Lapin-Plume (**possédée**), #190 — Cœur résistance | 1.21 : « **Au début de chacun de vos tours**, … (+3 / +6) » | `{type:teamRes, value}` sans `perTurn` (1.20 et 1.21) | Si c'est cumulatif : +30 % / +60 % de résistances d'équipe en 10 tours, non modélisés. |
| M22 | Sac de frappe (12 cartes) | 1.21 ajoute « attaque **adverse** » | inchangé | Clarifie que nos coups (et eux seuls) nourrissent l'élément adverse. |
| M23 | #51 Sorcière — Flamme magique | texte 1.20 = texte 1.21 | critique 1 → 20 % en 1.21 | Changement **invisible dans le texte**. Le patch FR liste la carte comme « Modifié » avec un avant/après identique. |
| M24 | Éternité (7 actifs, 2 passifs, 15 talents) | « allonge d'un tour toutes les recharges » (règles) | `value:1` seulement : ni durée ni sémantique ; moteur : 25 forfaitaires/cible | Retard ponctuel ou +1 permanent ? Les CD 1 (4 compétences dans zéro critique, 2 dans chimere) y sont les plus sensibles. |
| M25 | #140 Souris des blés — Disparition (passif) | « Supprime le dernier passif **de la cible** » | aucune attaque, seulement un soin d'allié | Le moteur n'applique `vanishOnHit` qu'aux coups. Si un soin compte comme « cible », il effacerait un passif **de son propre allié**. |
| M26 | Champ `spamton` de toutes les cartes | Pages : « N Spamtons / tour » | Le README l'appelle « cost » | C'est un **revenu** par tour, pas un coût (§1). |
| M27 | #174 Zombie Floral — Malédiction aquatique | 1.20 : « Attaque [30 à +60] Eau / Attaque [30 à +60] Nature / Applique Disparition ». 1.21 : « … **sur toutes les cartes adverses** / Applique Disparition » ×2 | 1.20 : `target:enemy`, 1 `vanish`. 1.21 : `aoeEnemy`, 2 `vanish`. La note de patch 1.21 ne liste pour #174 que « PV 1 000 → 850 » (pas dans les 8 « compétences retouchées »), mais la carte gagne 60 places (B → S). | Soit un **buff silencieux** en 1.21, soit le texte 1.20 **sous-décrivait** déjà une attaque de zone à double Disparition. Dans ce 2e cas, la menace existait déjà au moment de l'incident. Impossible à trancher avec les données. |

---

## 4. Les deux cartes de l'incident

### 4.1 #123 Tisseuse de Mots

**Profil (FAITS)**
- Nature, commune, 500 PV, 3 Spamtons/tour (2 en 1.21).
- Résistances : Feu 8, **Eau −21**, Terre 8, Nature 9, **Lumière 35**, Ombre 6.
- Une seule compétence, **Veuve noire** : CD 8, précision 100, critique 0, `target:none`, `absorbAny`.
- Passif de départ : Sac de frappe (+1 Nature pour l'adversaire à chaque attaque qu'elle subit).
- Talents : Héritage (+50 Spamtons à sa mort), Sursaut Vital (soin total si < 10 % PV en début de tour), Corrosion
  (notre attaquant perd −1 % de résistances par attaque ; « Conseillé » par le wiki, Δ +105,5 en v1.20 et +139 en v1.21).

**Ce que le wiki en voit (FAIT).** Fiche v1.20 : tier B, #50/127, **percentile « Contrôle 0 »**. La carte qui a
décidé du match par du contrôle est notée zéro en contrôle, parce que le moteur compte Absorbe comme 700 dégâts
(percentile Attaque 70).

**Calendrier (FAIT + INFÉRENCE)**
- Prête au T8 si l'adversaire joue en 1er, au T7 s'il joue en 2e. L'« environ tour 7 » de l'incident colle au 2e cas.
- 2e usage au T16/T15, hors de la fenêtre de 10 tours sauf prolongation ou Temporalité alliée (#42 Aide pensive,
  #47 Nuit finale ×3, Réducteur, Dernier souffle).
- **En pratique, une absorption par partie.**

**Ce qu'elle prend (INFÉRENCE, confiance haute).** La meilleure carte selon l'adversaire, quel que soit son total de
PV : le wiki écrit « Absorbe (tue la cible) … ignore les gros totaux de PV ».
- Le gain de PV vaut 100 % de la cible (observé +525). Un joueur avide de PV prendra donc notre plus gros total.
- Un joueur « tueur de moteur » prendra notre carte clé.

**Pourquoi on ne peut pas la tuer avant (INFÉRENCE, moteur, confiance moyenne)**
- Galop arctique inflige par cible environ 28 / 55 / 90 dégâts aux T2 / T4 / T6, soit environ 205 avec la faiblesse
  Eau −21 % sur la moitié Eau, plus environ 60 de Pinces si elle est ciblée.
- Au total ≈ 280/500 : elle a perdu environ 55 % de ses PV quand Veuve noire est prête. La course est perdue sans
  autre attaque mono-cible.
- Avec **Sursaut Vital** et 1 025 PV après l'absorption, elle remonte à fond si elle commence un tour sous 103 PV.
  Le texte ne fixe aucune limite d'usage (voir §7, notes de lecture f).

### 4.2 #222 Fleur de Vie

**Profil (FAITS)**
- Lumière, commune, 600 PV, 7 Spamtons/tour, **0 % de résistance partout**, aucun passif de départ.
- Souffle de lumière : CD 1, 10 Lumière, +1 Lumière.
- **Barrière Florale** : CD 1, `target:self`, `taunt` de durée 2. `ability.duration` vaut 0 (M2).
- Talents : Blindage Partagé (+10 % de résistances à l'équipe), Cœur Corrompu (Cœur rare aléatoire, +2/tour), Incisif
  (+1 % critique et précision par tour à toute l'équipe ; « Conseillé », Δ +488,5).

**Effet : une Provocation permanente dès le T1**, que l'adversaire joue en 1er ou en 2e.

**Qui elle bloque (INFÉRENCE, moteur, confiance moyenne-haute)**
- Seulement nos attaques mono-cible. En deck chimere, c'est **Pinces seule : 8,6 % des dégâts** tant que Chimère vit.
  Galop est une attaque de zone et touche Fleur avec les autres.
- **Zéro critique : 100 % des dégâts.**

**Combien de temps elle tient (INFÉRENCE, plan moteur en 1er joueur, résistance 0 % au lieu des 10 % du moteur,
soit ×1,11)**
- **Zéro critique** : cumul sur Fleur de 31 / 133 / 230 / 431 / 618 aux T1-T5. **Fleur meurt vers le T5**, et
  pendant 5 tours **aucun dégât ne touche les 3 autres cartes adverses**.
- **Deck chimere avec Chimère vivante** : Pinces + ¼ de Galop ≈ 43 (T2) / 130 (T4) / 267 (T6) / 480 (T8) / 800 (T10).
  **Fleur meurt vers le T10.**

### 4.3 Pourquoi la combinaison a été fatale (INFÉRENCE, plan moteur, confiance moyenne-haute)

**Ce que l'absorption de Chimère au T7 retire (plan moteur, 1er joueur)**
- Les Galop des T8 et T10 : 584 + 879 = **1 463 dégâts, soit 62 % des 2 357 dégâts** du plan sur 10 tours. Les
  derniers Galop sont les plus gros, à cause du cumul de critique et de base.
- 1 097 PV de soins (vol de vie).
- En plus, Tisseuse passe à 1 025 PV.

**Ce qu'il reste ensuite** : Pinces seule, mono-cible, soit 28 à 41 dégâts par tour. Ces dégâts sont **tous** forcés
sur Fleur de Vie, qui encaisse environ 105 dégâts du T8 au T10. Elle a reçu ≈ 394 dégâts au total et **survit
avec environ 206/600 PV**.

**L'Absorbe et la Provocation se multiplient.** La première retire la seule source de dégâts de zone ; la seconde
avale tout ce qui reste.

---

## 5. Impact sur les decks sauvegardés (familles a à d, et cartes de l'incident)

### Profils (FAITS : modèle, `lost_saved.json` et plan moteur `share_out.json`)

| Deck | Carte | PV | Sp/t | Passifs de départ (ordre ; le **dernier** part en premier avec Disparition) | Part des dégâts (moteur) | Perte de la carte dès le T1 |
|---|---|---|---|---|---|---|
| chimere | #103 Lame de la forêt | 650 | 5 | — | 8,6 % (Pinces, mono-cible) + 487 de soins | −40 % |
| chimere | #238 Chimère Brasse-chair | 525 | 5 | Vampirisme É 75 %, **Mimétisme** | **91,4 %** (Galop, zone) + 1 616 de soins | **−76 %** |
| chimere | #156 L'Œil des montagnes | 600 | 6 | Berserk C 12 %, **Cœur d'eau** | 0 (soin 50 + dégâts critiques +1) | −47 % |
| chimere | #117 Keria | 550 | 8 | — | 0 (base +3 et critique +5 % d'équipe) | −46 % |
| zéro critique | #102 Murmures du Corail Noir | 500 (400 en 1.21) | 7 (2) | **Multiplicateur** | 21,6 % (Souffle d'eau) | −60 % |
| zéro critique | #116 Prisonnière de la Machine | 1 000 | 3 | — | **64,4 %** (Explosion, coûte 100 PV) | −55 % |
| zéro critique | #12 Hibernatus | 750 | 12 | **Chanceur** | 14,0 % (Haleau) | −54 % |
| zéro critique | #69 Scorch, les Lézards Ignés | 350 | 7 | **Soin primitif** | 0 (Feau : +3 Feu/Eau/Terre par tour, doublé pour les coups et soins de Murmures via Multiplicateur) | **−63 %** |

### Menace par menace

« Cible probable » = ce qu'un adversaire humain choisira (INFÉRENCE). La justification chiffrée vient du tableau
précédent.

| Menace | Mécanique, 1re dispo | Deck chimere : cible probable → effet | Zéro critique : cible probable → effet |
|---|---|---|---|
| **#123 Tisseuse — Veuve noire** (C) | Absorbe 1 carte, +100 % de ses PV ; T8/T7, ~1×/partie | **Chimère** (91 % des dégâts, 69 % des soins) : −62 % des dégâts du plan si elle est prise au T7, et Tisseuse passe à 1 025 PV. Variante « gain de PV max » : Lame (650 → Tisseuse 1 150). | **Scorch** (perte la plus chère, −63 %) ou **Murmures** (−60 %). Variante PV : **Prisonnière** : Tisseuse passe à 1 500 PV, **et** nous perdons un provocateur et 64 % de nos dégâts. |
| **#139 Cornu — Corne 25** (R) | Cible à 25 % de ses PV max ; T7/T6 | Lame 650 → 163 (−488) ou Chimère 525 → 131, puis n'importe quel coup achève. Le vol de vie de Chimère (≈ 440-660 PV par Galop tardif dans le moteur) peut la remonter si elle survit au tour. | **Prisonnière 1 000 → 250 (−750)**. Le moteur interdit un coût en PV qui laisse sous 20 % (`D-costHp < 0.2*hpMax`) : Explosion (64 % des dégâts) devient **inutilisable** tant qu'elle reste sous 300 PV (inférence sur la règle réelle). Hibernatus 750 → 188. |
| **#139 — Corne 75** | Cible à 75 % ; T5/T4 | −25 % des PV max d'une carte pleine (Lame −163, Chimère −131) | Prisonnière −250 |
| **#174 Zombie Floral — Malédiction aquatique** (C) | 1.20 : 30-60 Eau + 30-60 Nature + Disparition (1 cible). 1.21 : **zone**, 2 Disparitions par carte. T8/T7 | 1.20 : Chimère perd **Mimétisme** (faible perte), ou un Tox acheté s'il est en dernier. **1.21 : Chimère perd Mimétisme ET Vampirisme 75 %** (soins), **L'Œil perd Cœur d'eau ET Berserk 12 %** (dégâts d'équipe). Lame et Keria perdent jusqu'à 2 Tox achetés. | 1.20 : **Murmures perd Multiplicateur** (son seul passif ; c'est lui qui double le bonus de Scorch). 1.21 : Multiplicateur, Chanceur (Hibernatus) et Soin primitif (Scorch) tous retirés. Prisonnière prend 45-90 par coup Eau (résistance Eau −50 %). |
| **#56 Lisa** (C) — Disparition à chaque coup | Courant aléatoire, CD 2, 1 cible aléatoire ; T2/T1, ~5 coups/partie | 2 cartes sur 4 portent des passifs (Chimère, L'Œil) : environ 2-3 passifs retirés par partie, au hasard. | 3 cartes sur 4 (Murmures, Hibernatus, Scorch), 1 passif chacune : environ 3 retraits attendus (le maximum). Murmures perd Multiplicateur dès qu'elle est touchée (P = 1/4 par coup). |
| **#115 Aidan** (C) — Disparition à chaque coup | Paie-torche, CD 3, coût 10 Feu (son générateur Chanceur donne +10 dans un élément **aléatoire**, donc pas garanti tôt), cible **choisie** ; T3/T2 au plus tôt | Chimère : Mimétisme, puis **Vampirisme** au 2e coup | **Murmures (Multiplicateur)** dès le 1er coup |
| #140 Souris des blés (R) — Disparition | Aucune attaque | Aucun effet attendu (M25) | idem |
| **#44 Léviathan — Écras'eau** (L) | 30 % des PV max de la cible, CD 3 ; T3/T2 | 158-195 par lancer (Chimère 158, Keria 165, L'Œil 180, Lame 195) : l'intérêt est faible, nos PV sont bas | **Prisonnière 300**/lancer, Hibernatus 225, Murmures 150 (120 en 1.21), Scorch 105 |
| **Bombe-8** (talent, #12 / #59, C) | À partir du T8, à la mort du porteur : 500 bruts sur une carte **aléatoire** | Tue Chimère dès qu'elle a perdu ≥ 25 PV, Keria ≥ 50, L'Œil ≥ 100, Lame ≥ 150 | Tue **Scorch (350) et Murmures (500/400) d'office** |
| #86 Régent — Avalement (É) | N'absorbe que ses alliés | Aucune de nos cartes. Il grossit (ignoré par le moteur, M5). | idem |
| **Gel actif** (#23, #29, #34, #59, #91, #211 ; C/R/L) | 1 tour perdu ; T2-T4, puis tous les 3-4 tours | **Chimère le tour où Galop est prêt** (T2/4/6/8/10 si nous jouons en 1er) : le lancer est perdu ou repoussé, soit 111 à 879 dégâts selon le tour (T8 = 584, 25 % du total). Dégeler par un soin (Lame CD 1, L'Œil CD 4) coûte 40 PV (60 en 1.21). | **Prisonnière** (Explosion : +10 de base par usage, chaque tour gelé retarde la croissance) ou Hibernatus (Digue, Haleau) |
| **Gel passif** (#92 Frost & Glacier, L) | Eau trouble : 2 × 25 Eau, cibles aléatoires, CD 2 ; T2/T1 | Jusqu'à 2 de nos cartes gelées tous les 2 tours, au hasard ; plus Érosion | idem. Chaque coup Eau fait 37,5 sur Prisonnière (résistance Eau −50 %). |
| **Éternité** (7 actifs, 2 passifs, 15 talents) | Recharges +1 ; Longueur au T1, Visée globale (#88) en zone au T9/T8 | **Chimère** : Galop (CD 2) retardé d'un tour, soit environ −1 lancer sur 5 en 10 tours ; −2 lancers si l'Éternité est permanente (CD 3) | Les CD 1 : Murmures ×2, Explosion, Feau. Chaque Éternité coûte jusqu'à un lancer par compétence de la carte. **Prisonnière** en priorité (64 % des dégâts). |
| **#78 Gardien Vert — Rayonnement** (R) | 80 Lumière + recharges de la cible au maximum ; T5/T4, puis tous les 5 tours | **L'Œil** juste avant Revitalisation (CD 4 : jusqu'à 3-4 tours de perdus) ou Chimère (Galop : jusqu'à 1 tour) | Hibernatus ou Prisonnière (Digue/Braisegarde, CD 3). **Sans effet sur nos CD 1.** |
| **Précision** (#81 Phare en zone −10 %/lancer ; Imprécision −20 % ; Erreur Croissante −3 %/attaque) | Phare T4/T3, puis tous les 4 tours | Toutes nos compétences sont à 100 % : chaque −10 % ≈ 10 % de lancers ratés, si les soins sont concernés (inconnu) | idem. Explosion ratée = 100 PV payés pour rien (inférence). |
| **Provocation permanente** : #222 Fleur de Vie, #262 Yotaru (C) | CD 1, dès le T1 | Pinces seule redirigée (8,6 %) tant que Chimère vit ; **100 % après sa perte** (§4.3) | **100 % de nos dégâts redirigés** : Fleur (600 PV, 0 % de résistance) absorbe les T1-T5. Avec Yotaru, c'est un allié aléatoire qui provoque, souvent un gros. |
| **Provocation intermittente** : #58 Fort (CD 4), #94 Forteresse (CD 3) + **Revanche**, #72 (CD 2), #101 (CD 4, + soin 80 + résistance +15), #234 Provocation passive, Focus (12) | — | Même logique, impact faible (Pinces) | Fort impact. Tuer Zayd (#94, 600 PV) déclenche Revanche : il inflige toutes ses attaques, dont Fin du monde (6 × 50 réparties sur nos cartes). |
| **Brut** (#27 nous ; talents #31, #59, #83, #243, #245) | Ignore nos provocations et résistances | Nous n'avons pas de provocateur : seul effet, nos résistances ignorées (5-12 %) | **Contourne Braisegarde/Digue** et frappe **Scorch (350)** ou **Murmures** en direct. Détruit notre provocation s'il cible le provocateur. |
| #262 Yotaru — Protect-terre/boost (breakTaunt) | CD 2 ; camp non encodé (M14) | — | Si elle peut viser nos provocations : Braisegarde/Digue retirées tous les 2 tours |
| **#96 Mélodie — Jugement divin** (L) | Nos Spamtons à 0 ; T10/T9 (plus tôt avec Temporalité alliée) | Revenu 24/tour + n° du tour : l'épargne du T9-T10 est perdue. Impact surtout sur un Tox légendaire en épargne (la boutique n'ouvre qu'aux tours pairs). | Revenu 29/tour (24 en 1.21) : idem |
| Racket (talent #103/#219, C) | −5 Spamtons par dégât infligé ; Catixy Miaulement CD 1 | Environ −5/tour, −50 sur 10 tours | idem |
| #42 Dragonnet — Éclat paisible (É) | Vole 1 Lumière par coup, CD 1 | Nous n'avons aucun bonus Lumière : nul | Haleau donne +5 aléatoire et frappe en Lumière : négligeable |
| Mimétisme (#35, #124 ; #238 nous) | L'adversaire gagne au moins 1 élément à chacune de nos générations | Environ 0-1/tour (Cœur d'eau) | **Environ 2-4/tour** (Feau +3 Feu/Eau/Terre chaque tour, Haleau +5) : notre rampe nourrit la sienne |

---

## 6. Contre-mesures déjà dans la collection (FAITS + INFÉRENCES courtes)

- **Contre les provocations (FAIT, données de #27).** Hippocampe Nimbé (#27, possédée) a **Brut** en passif de
  départ : « Ignore les résistances et les provocations. Détruit les provocations ennemies si ciblé ». Il a aussi
  **Reset** (attaque conservée après un kill). Son attaque Supra-rayon-humide (75 de base, CD 5) est prête au T5 si nous jouons en 1er, au T4 en 2e.
- **Attaques de zone (INFÉRENCE : non redirigées par une Provocation)**, toutes possédées :
  - Chimère : Galop arctique ;
  - Dragon Ciel : Appel de la forêt en 1.21 ;
  - Chouette Polychrome : Danse des plumes, mais `spreadField` touche **aussi nos cartes**.
- **Immunités par talent, si un jour débloquées (FAIT, données ; aucun talent débloqué pour l'instant)** :
  - L'Œil des montagnes : Inscrit, insensible aux Disparitions ;
  - Keria : Éternisé, insensible aux Éternités ;
  - Dragon de la Cité Infernale : Immunité-8.

  La boutique propose Immunité (É, 90). INFÉRENCE (confiance moyenne) : posée sur Chimère, elle bloquerait Absorbe,
  Corne 25, Disparition, Gel et Éternité. Le wiki écrit qu'Immunité « bloque tous les effets adverses (Étourdissement,
  Éternité, Disparition, Érosion…) ».
- **Disparition (FAIT, règle du wiki)** : elle retire le **dernier** passif. Acheter les Tox précieux en premier, ou
  garder un Tox bon marché en dernière position, sert de « fusible ».
- **Gel (FAIT, règle)** : un soin sur la carte gelée la libère contre 40 PV (60 en 1.21). Le deck chimere a deux
  soigneurs (Lame CD 1, L'Œil CD 4).

---

## 7. Catalogue par famille (vue victime)

Dans les tableaux, « Type » vaut ACT (compétence active), PAS (passif de départ) ou TAL (talent : un seul actif par
carte, choisi avant le match). « Poss. » indique si la carte est dans la collection du joueur. Les familles (a) à (e)
sont détaillées ligne par ligne. Les familles (f) à (h) sont condensées par compétence ou talent ; les textes complets
sont dans `C_actives.json`.

**Avertissement transversal (FAIT, `tox_fr.json`).** La boutique peut donner **à n'importe quelle carte adverse** :
Disparition (L, 180), Éternité (L, 220), Gel (É, 150), Immunité (É, 90), Bomba (É, 130), Provocation (R, 70),
Brut (R, 65), Fumée (R, 50), Érosion (C/É) et Mimétisme (R, 50). Les familles (a) à (c) peuvent donc apparaître
hors des cartes listées ici, mais seulement après un achat, à partir du tour 2.

**Notes de lecture par famille (FAITS + INFÉRENCES)**

**(a) Retrait d'une carte**
- **Absorbe (#123).** INFÉRENCE (confiance haute) : la cible est libre. Le texte dit « Absorbe une carte » sans
  restriction, et l'incident l'a vu prendre une carte adverse.
- **Corne 25 / Corne 75 (#139).** Le texte dit « La cible » ; le camp visé n'est pas encodé.
- **Disparition passive.** Elle n'agit que si la carte frappe :
  - #56 Lisa : Courant aléatoire, CD 2, une cible aléatoire ;
  - #115 Aidan : Paie-torche, CD 3, coûte 10 Feu, cible choisie ;
  - #140 Souris des blés : aucune attaque (Épidémie soigne un allié). INFÉRENCE : passif sans effet sur nous.
- **Bombe-8.** Le Tox Bomba de la boutique (É) inflige « 500 dégâts bruts à une carte adverse aléatoire quand cette
  carte meurt ». Le talent applique ce passif au tour 8.

**(b) Déni d'action**
- **Gel**, règle du wiki : « ne peut pas agir jusqu'à la fin du prochain tour adverse ; un autre dégât, un soin ou
  un nouveau Tox brise la glace et inflige 40 dégâts » (60 en 1.21).
- **Éternité**, règle : « allonge d'un tour toutes les recharges de la cible ». INFÉRENCE (confiance moyenne) : c'est
  un retard ponctuel d'un tour, pas un +1 permanent. Les mots « Purge cancels a lengthening » vont dans ce sens.

**(c) Ciblage**
- Le moteur, côté nous, ne redirige vers notre provocateur que la part mono-cible des dégâts adverses. La part de
  zone (21 %) reste répartie (`fe()`, l. 831-855).
- INFÉRENCE (confiance moyenne-haute) : en jeu aussi, une attaque de zone ou aléatoire n'est **pas** redirigée par une
  Provocation. Elle « cible » déjà toutes les cartes.

**(f) Survie adverse**
- **Sursaut Vital** (#123, #160, #193) n'a aucune limite « une fois par partie » dans son texte. INFÉRENCE (confiance
  basse) : il peut se déclencher à chaque début de tour où la carte est sous 10 %.


### (a) Retire / absorbe / fait disparaître une de nos cartes ou ses passifs (incl. exécutions)

#### a1 — absorbAny — « Absorbe une carte » (n’importe quelle carte, adverse comprise)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 123 | Tisseuse de Mots | Nature/C | 3 | 500 | ACT | Veuve noire | 8 | T8/T7 | none | 0/— | Absorbe une carte | non | Spamtons/tour 3→2 |

#### a2 — setHpPct — « La cible se retrouve à X % de ses PV max » (Corne 25 / Corne 75)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 139 | Cornu mythologique | Terre/R | 5 | 700 | ACT | Corne 25 | 7 | T7/T6 | none | 0/— | La cible se retrouve à 25% de ses PV max | non |  |
| 139 | Cornu mythologique | Terre/R | 5 | 700 | ACT | Corne 75 | 5 | T5/T4 | none | 0/— | La cible se retrouve à 75% de ses PV max | non |  |

#### a3 — vanish actif — « Applique Disparition » (retire le dernier passif)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 174 | Zombie Floral | Nature/C | 5 | 1000 | ACT | Malédiction aquatique | 8 | T8/T7 | enemy | 0/— | Attaque [30 à +60] Eau / Attaque [30 à +60] Nature / Applique Disparition | non | PV 1000→850 ; texte → « Attaque [30 à 60] Eau sur toutes les cartes adverses / Applique Disparition / Attaque [30 à 60] Nature sur toutes les cartes adverses / Applique Disparition » |

#### a4 — Disparition à chaque coup (passif légendaire de départ)
_3 carte(s) distincte(s) : 0 via compétence active, 3 via passif de départ, 0 via talent — rareté : 2 common, 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 56 | Lisa, la Dragonnière | Nature/C | 7 | 800 | PAS | PAS Disparition (legendary) | — | — | — | — | Supprime le dernier passif de la cible | non |  |
| 115 | Aidan | Feu/C | 8 | 750 | PAS | PAS Disparition (legendary) | — | — | — | — | Supprime le dernier passif de la cible | non |  |
| 140 | Souris des blés | Terre/R | 10 | 500 | PAS | PAS Disparition (legendary) | — | — | — | — | Supprime le dernier passif de la cible | non |  |

#### a5 — dégâts en % des PV max de la cible (anti-tank)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 44 | Léviathan des Cieux | Eau/L | 5 | 1000 | ACT | Écras'eau | 3 | T3/T2 | enemy | 0/— | Attaque 30% des PV max de la cible | non |  |

#### a6 — Bombe-8 (talent) — passif Bomba au tour 8
_2 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 2 via talent — rareté : 2 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 | Hibernatus | Eau/C | 12 | 750 | TAL | TAL2 Bombe-8 | — | — | — | — | Applique le passif "Bomba" au tour 8 | **oui** |  |
| 59 | Guerrier des Neiges | Terre/C | 7 | 600 | TAL | TAL1 Bombe-8 | — | — | — | — | Applique le passif "Bomba" au tour 8 | non |  |

#### a7 — absorbAlly — « Absorbe une carte alliée » (ne peut PAS nous viser)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 epic._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 86 | Régent des Abysses | Terre/É | 6 | 1000 | ACT | Avalement | 5 | T5/T4 | none | 0/— | Absorbe une carte alliée | non |  |

### (b) Nie nos actions (Gel, Éternité, reset de recharge, précision, Fumée)

#### b1 — Gel actif (la cible ne peut pas agir jusqu’à la fin du prochain tour adverse)
_7 carte(s) distincte(s) : 7 via compétence active, 0 via passif de départ, 0 via talent — rareté : 4 common, 2 rare, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 23 | Artisan des Heures | Lumière/C | 5 | 700 | ACT | Flash | 3 | T3/T2 | enemy | 2/— | Attaque 35 Lumière / Gel | non |  |
| 29 | Princesse Meridia | Nature/R | 7 | 750 | ACT | Vent critique | 4 | T4/T3 | enemy | 2/— | Attaque 40 Nature / Gel | non |  |
| 34 | Éclat du Renard Blanc | Ombre/R | 5 | 700 | ACT | Aqua-sombre (option 1/2) | 4 | T4/T3 | enemy | 0/— | Choix / Attaque 20 Eau / Gel | non |  |
| 59 | Guerrier des Neiges | Terre/C | 7 | 600 | ACT | Tranche-sol | 3 | T3/T2 | enemy | 0/— | Attaque 30 Terre / Gel | non |  |
| 91 | Ignea | Feu/L | 10 | 750 | ACT | Silenfeu | 3 | T3/T2 | none | 2/— | Applique Gel | non |  |
| 122 | Esprit de la Faune | Nature/C | 8 | 800 | ACT | Soin soleil | 3 | T3/T2 | ally | 2/— | Soigne 60 Lumière / Gel | non |  |
| 211 | Dragosaure Céleste | Nature/C | 12 | 800 | ACT | Hurle frappe (option 1/2) | 3 | T3/T2 | enemy | 0/— | Choix / Attaque [10 à 100] Nature / Gel | non |  |
| 211 | Dragosaure Céleste | Nature/C | 12 | 800 | ACT | Hurle frappe (option 2/2) | 3 | T3/T2 | enemy | 0/— | Attaque [45 à 65] Terre / Gel | non |  |

#### b2 — Gel à chaque dégât/soin (passif épique de départ)
_2 carte(s) distincte(s) : 0 via compétence active, 2 via passif de départ, 0 via talent — rareté : 1 legendary, 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 92 | Frost & Glacier | Eau/L | 4 | 500 | PAS | PAS Gel (epic) | — | — | — | — | Les dégâts et les soins de cette carte gèlent leur cible : elle ne peut pas agir jusqu'à la fin du prochain tour adverse. Un autre dégât, un soin ou un nouveau Tox brise la glace et lui inflige 40 dégâts. | non | texte 1.21 : « Les dégâts et les soins de cette carte gèlent leur cible : elle ne peut pas agir jusqu'à la fin du prochain tour adverse. Un autre dégât, un soin ou un nouveau Tox brise la glace et lui inflige 60 dégâts. » |
| 259 | Dragon de la Cité Infernale | Feu/C | 10 | 550 | PAS | PAS Gel (epic) | — | — | — | — | Les dégâts et les soins de cette carte gèlent leur cible : elle ne peut pas agir jusqu'à la fin du prochain tour adverse. Un autre dégât, un soin ou un nouveau Tox brise la glace et lui inflige 40 dégâts. | **oui** | texte 1.21 : « Les dégâts et les soins de cette carte gèlent leur cible : elle ne peut pas agir jusqu'à la fin du prochain tour adverse. Un autre dégât, un soin ou un nouveau Tox brise la glace et lui inflige 60 dégâts. » |

#### b3 — Éternité active (toutes les recharges de la cible +1)
_7 carte(s) distincte(s) : 7 via compétence active, 0 via passif de départ, 0 via talent — rareté : 4 common, 2 rare, 1 epic._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 21 | Félin Errant | Ombre/C | 5 | 550 | ACT | Visée offensive | 2 | T2/T1 | enemy | 0/— | Attaque 15 Ombre / Éternité en cas de coup critique | non |  |
| 23 | Artisan des Heures | Lumière/C | 5 | 700 | ACT | Ralentissement | 4 | T4/T3 | none | 0/— | Applique Éternité | non |  |
| 34 | Éclat du Renard Blanc | Ombre/R | 5 | 700 | ACT | Aqua-sombre (option 2/2) | 4 | T4/T3 | enemy | 0/— | Attaque 20 Ombre / Applique Éternité | non |  |
| 35 | Léo | Lumière/R | 6 | 800 | ACT | Éclair purificateur | 4 | T4/T3 | spreadEnemy | 2/— | Attaque [20 à 60] Lumière / Attaque [20 à 60] Lumière / Ennemis aléatoires / Applique Éternité | non |  |
| 51 | Sorcière Pyrokinétique | Feu/C | 8 | 800 | ACT | Flamme magique | 3 | T3/T2 | enemy | 2/— | Attaque 25 Feu / Applique Éternité en cas de critique / Attaque 25 Lumière / Applique Éternité en cas de critique / Baisse la résistance Feu et Lumière de l'adversaire de (10%) | non | crit 1→20 |
| 64 | Maître Thronebéur | Lumière/C | 8 | 850 | ACT | Ralentissement | 4 | T4/T3 | none | 0/— | Applique Éternité | non |  |
| 88 | Faerylia | Ombre/É | 5 | 600 | ACT | Visée globale | 9 | T9/T8 | aoeEnemy | 0/— | Cible toutes les cartes adverses / Applique Éternité | non |  |
| 88 | Faerylia | Ombre/É | 5 | 600 | ACT | Visée offensive | 2 | T2/T1 | enemy | 0/— | Attaque 15 Ombre / Éternité en cas de coup critique | non |  |

#### b4 — Éternité à chaque coup (passif légendaire de départ)
_2 carte(s) distincte(s) : 0 via compétence active, 2 via passif de départ, 0 via talent — rareté : 1 rare, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 33 | Nakyel | Ombre/R | 3 | 500 | PAS | PAS Éternité (legendary) | — | — | — | — | Augmente les temps de recharge de 1 | **oui** |  |
| 256 | Héraldesse Serpentine | Terre/L | 9 | 900 | PAS | PAS Éternité (legendary) | — | — | — | — | Augmente les temps de recharge de 1 | non |  |

#### b5 — Éternité par talent (Longueur au 1er tour, Heure Funeste à la mort)
_15 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 15 via talent — rareté : 6 rare, 6 common, 1 epic, 2 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 29 | Princesse Meridia | Nature/R | 7 | 750 | TAL | TAL3 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 33 | Nakyel | Ombre/R | 3 | 500 | TAL | TAL2 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | **oui** |  |
| 35 | Léo | Lumière/R | 6 | 800 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 64 | Maître Thronebéur | Lumière/C | 8 | 850 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 88 | Faerylia | Ombre/É | 5 | 600 | TAL | TAL3 Heure Funeste | — | — | — | — | Applique Éternité à toutes les cartes adverses quand cette carte est tuée. | non |  |
| 122 | Esprit de la Faune | Nature/C | 8 | 800 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 140 | Souris des blés | Terre/R | 10 | 500 | TAL | TAL3 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 151 | Sbire des Flammes | Feu/C | 9 | 800 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 176 | Rob l'Aventurier | Terre/C | 9 | 500 | TAL | TAL2 Heure Funeste | — | — | — | — | Applique Éternité à toutes les cartes adverses quand cette carte est tuée. | non |  |
| 190 | Lames en peine | Ombre/R | 15 | 550 | TAL | TAL3 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 229 | Maître Amphibian | Terre/C | 4 | 700 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 236 | Apprentie de la Mort | Feu/R | 6 | 700 | TAL | TAL3 Heure Funeste | — | — | — | — | Applique Éternité à toutes les cartes adverses quand cette carte est tuée. | non |  |
| 255 | Verdelune | Nature/L | 5 | 900 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |
| 256 | Héraldesse Serpentine | Terre/L | 9 | 900 | TAL | TAL2 Heure Funeste | — | — | — | — | Applique Éternité à toutes les cartes adverses quand cette carte est tuée. | non |  |
| 264 | Aristocrate Nébulaire | Lumière/C | 3 | 500 | TAL | TAL1 Longueur | — | — | — | — | Au début de votre premier tour, une carte adverse aléatoire reçoit "Éternité" | non |  |

#### b6 — reset des recharges de la cible au maximum
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 78 | Gardien Vert | Lumière/R | 10 | 800 | ACT | Rayonnement | 5 | T5/T4 | enemy | 0/— | Attaque 80 Lumière / Les temps de recharge des compétences sont remis au maximum | non |  |

#### b7 — baisse de précision adverse
_8 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 8 via talent — rareté : 1 epic, 2 rare, 4 common, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 81 | Luminaire Abyssal | Eau/É | 4 | 600 | ACT | Phare | 4 | T4/T3 | aoeEnemy | 0/— | Cible toutes les cartes adverses / Attaque [30 à 50] Lumière / Précision (-10%) | non |  |
| 27 | Hippocampe Nimbé | Eau/R | 4 | 900 | TAL | TAL3 Imprécision | — | — | — | — | Au début de la partie, une carte adverse aléatoire perd (-20%) de précision. | **oui** |  |
| 39 | Sylvan, Protecteur de la Verdure | Nature/C | 5 | 550 | TAL | TAL1 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |
| 56 | Lisa, la Dragonnière | Nature/C | 7 | 800 | TAL | TAL1 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |
| 81 | Luminaire Abyssal | Eau/É | 4 | 600 | TAL | TAL2 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |
| 119 | Fleurmarine | Eau/C | 6 | 600 | TAL | TAL3 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |
| 134 | Wibs l'Enflammé | Feu/C | 5 | 550 | TAL | TAL3 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |
| 188 | Commando Gerz | Terre/R | 4 | 1200 | TAL | TAL1 Imprécision | — | — | — | — | Au début de la partie, une carte adverse aléatoire perd (-20%) de précision. | non |  |
| 203 | Ashtarae Lycaria | Ombre/L | 8 | 1000 | TAL | TAL3 Erreur Croissante | — | — | — | — | -3% de précision à une carte adverse aléatoire à chaque attaque de cette carte. | non |  |

#### b8 — Fumée (effet non documenté)
_5 carte(s) distincte(s) : 1 via compétence active, 4 via passif de départ, 0 via talent — rareté : 3 common, 1 epic, 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 261 | Godlur | Terre/C | 7 | 1000 | ACT | Frappe golémique | 2 | T2/T1 | enemy | 0/— | Attaque 25 Terre / Fumée | non |  |
| 146 | Poulpe Parleur | Eau/É | 3 | 500 | PAS | PAS Fumée (rare) | — | — | — | — | Enfume le terrain allié après l'utilisation d'une attaque ou d'un soin | non |  |
| 152 | Le Héraut des Cendres | Feu/C | 8 | 800 | PAS | PAS Fumée (rare) | — | — | — | — | Enfume le terrain allié après l'utilisation d'une attaque ou d'un soin | non |  |
| 191 | Ameru | Lumière/R | 15 | 800 | PAS | PAS Fumée (rare) | — | — | — | — | Enfume le terrain allié après l'utilisation d'une attaque ou d'un soin | non |  |
| 243 | Vivy | Ombre/C | 9 | 1000 | PAS | PAS Fumée (rare) | — | — | — | — | Enfume le terrain allié après l'utilisation d'une attaque ou d'un soin | **oui** |  |

### (c) Force ou bloque notre ciblage (Provocation, Brut, Immunité)

#### c1 — Provocation active
_8 carte(s) distincte(s) : 8 via compétence active, 0 via passif de départ, 0 via talent — rareté : 6 common, 1 rare, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 | Hibernatus | Eau/C | 12 | 750 | ACT | Digue | 3 | T3/T2 | none | 2/2 | Applique Provocation | **oui** |  |
| 58 | Le Transporteur Sauvage | Terre/C | 7 | 1000 | ACT | Fort | 4 | T4/T3 | none | 4/2 | Applique Provocation pendant 2 tours | non |  |
| 72 | Girafe Florale | Nature/R | 7 | 750 | ACT | Renaissance Sylvatique | 2 | T2/T1 | allAllies | 2/2 | Applique Provocation / Cible toutes les cartes alliées / Précision et Critique (+5%) | non |  |
| 94 | Zayd | Terre/L | 1 | 600 | ACT | Forteresse | 3 | T3/T2 | none | 2/2 | Applique Provocation | non |  |
| 101 | Neilla | Eau/C | 9 | 650 | ACT | Protection marine | 4 | T4/T3 | ally | 2/2 | Soigne 80 Eau / Résistance à tous les éléments (+15) / Applique Provocation | non |  |
| 116 | Prisonnière de la Machine | Feu/C | 3 | 1000 | ACT | Braisegarde | 3 | T3/T2 | none | 2/2 | Applique Provocation | **oui** |  |
| 222 | Fleur de Vie | Lumière/C | 7 | 600 | ACT | Barrière Florale | 1 | T1/T1 | self | 0/2 | Applique Provocation au lanceur | non |  |
| 262 | Yotaru Gardefeuille | Nature/C | 5 | 500 | ACT | Protect | 1 | T1/T1 | randomAlly | 2/2 | Applique Provocation aléatoirement à une carte alliée | non |  |

#### c2 — Provocation passive (Provocation R) / talent Focus (25 %/tour)
_13 carte(s) distincte(s) : 0 via compétence active, 1 via passif de départ, 12 via talent — rareté : 5 common, 7 epic, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 234 | Rongeur Nuageux | Lumière/C | 11 | 750 | PAS | PAS Provocation (rare) | — | — | — | — | Lorsque ce personnage lance une attaque, toutes les attaques ennemies du prochain tour doivent le cibler | non |  |
| 58 | Le Transporteur Sauvage | Terre/C | 7 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 86 | Régent des Abysses | Terre/É | 6 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 115 | Aidan | Feu/C | 8 | 750 | TAL | TAL2 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 152 | Le Héraut des Cendres | Feu/C | 8 | 800 | TAL | TAL2 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 204 | Ephial | Lumière/L | 12 | 1500 | TAL | TAL2 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 247 | Roi Feu | Feu/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 248 | Roi Eau | Eau/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 249 | Roi Nature | Nature/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 250 | Roi Terre | Terre/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 251 | Roi Ombre | Ombre/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | **oui** |  |
| 252 | Roi Lumière | Lumière/É | 10 | 1000 | TAL | TAL1 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |
| 262 | Yotaru Gardefeuille | Nature/C | 5 | 500 | TAL | TAL2 Focus | — | — | — | — | Au début de chaque tour, cette carte a 25% de chance de gagner Provocation. | non |  |

#### c3 — Brut — ignore NOS provocations et NOS résistances
_6 carte(s) distincte(s) : 0 via compétence active, 1 via passif de départ, 5 via talent — rareté : 3 rare, 2 common, 1 epic._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 27 | Hippocampe Nimbé | Eau/R | 4 | 900 | PAS | PAS Brut (rare) | — | — | — | — | Ignore les résistances et les provocations. Détruit les provocations ennemies si ciblé | **oui** |  |
| 31 | Raffteru | Terre/R | 5 | 600 | TAL | TAL3 Brut | — | — | — | — | Commence la partie avec le passif "Brut" | non |  |
| 59 | Guerrier des Neiges | Terre/C | 7 | 600 | TAL | TAL3 Brut | — | — | — | — | Commence la partie avec le passif "Brut" | non |  |
| 83 | Panthère imaginaire | Nature/É | 4 | 600 | TAL | TAL3 Brut | — | — | — | — | Commence la partie avec le passif "Brut" | non |  |
| 243 | Vivy | Ombre/C | 9 | 1000 | TAL | TAL1 Brut | — | — | — | — | Commence la partie avec le passif "Brut" | **oui** |  |
| 245 | Shinobi Éclairant | Lumière/R | 6 | 600 | TAL | TAL3 Brut | — | — | — | — | Commence la partie avec le passif "Brut" | non |  |

#### c4 — Immunité (insensible à tous les effets adverses)
_6 carte(s) distincte(s) : 0 via compétence active, 4 via passif de départ, 2 via talent — rareté : 2 epic, 1 rare, 3 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 197 | Codex des Maux Ancestraux | Ombre/É | 10 | 1000 | PAS | PAS Immunité (epic) | — | — | — | — | La carte est immunisée contre tous les effets des cartes adverses | non |  |
| 198 | Codex des Sorts Lumineux | Lumière/É | 10 | 1000 | PAS | PAS Immunité (epic) | — | — | — | — | La carte est immunisée contre tous les effets des cartes adverses | non |  |
| 237 | Voyageur des Crêtes | Eau/R | 9 | 1000 | PAS | PAS Immunité (epic) | — | — | — | — | La carte est immunisée contre tous les effets des cartes adverses | non |  |
| 260 | Le compagnon des esprits | Eau/C | 5 | 600 | PAS | PAS Immunité (epic) | — | — | — | — | La carte est immunisée contre tous les effets des cartes adverses | non |  |
| 122 | Esprit de la Faune | Nature/C | 8 | 800 | TAL | TAL2 Immunité-8 | — | — | — | — | Applique le passif "Immunité" au tour 8 | non |  |
| 259 | Dragon de la Cité Infernale | Feu/C | 10 | 550 | TAL | TAL3 Immunité-8 | — | — | — | — | Applique le passif "Immunité" au tour 8 | **oui** |  |

#### c5 — brise une Provocation (camp non encodé)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 262 | Yotaru Gardefeuille | Nature/C | 5 | 500 | ACT | Protect-terre | 2 | T2/T1 | none | 0/— | Brise une Provocation pour donner 100 PV max | non |  |
| 262 | Yotaru Gardefeuille | Nature/C | 5 | 500 | ACT | Protect-boost | 2 | T2/T1 | none | 0/— | Brise une Provocation pour augmenter les dégâts et soins de base de 3 | non |  |

#### c6 — insensibilités par talent (Éternisé, Inscrit)
_12 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 12 via talent — rareté : 2 legendary, 1 epic, 8 common, 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 43 | Souverain des Flammes | Feu/L | 7 | 900 | TAL | TAL2 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |
| 45 | Aldrin & Gorakar | Nature/L | 4 | 700 | TAL | TAL2 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |
| 85 | Bleu-mange-cailloux | Terre/É | 4 | 500 | TAL | TAL1 Inscrit | — | — | — | — | La carte est insensible aux Disparitions. | non |  |
| 97 | Pyro | Feu/C | 4 | 500 | TAL | TAL2 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |
| 101 | Neilla | Eau/C | 9 | 650 | TAL | TAL1 Inscrit | — | — | — | — | La carte est insensible aux Disparitions. | non |  |
| 117 | Keria | Feu/R | 8 | 550 | TAL | TAL2 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | **oui** |  |
| 127 | Spectre Canin | Ombre/C | 7 | 1000 | TAL | TAL1 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |
| 151 | Sbire des Flammes | Feu/C | 9 | 800 | TAL | TAL2 Inscrit | — | — | — | — | La carte est insensible aux Disparitions. | non |  |
| 156 | L'Œil des montagnes | Eau/C | 6 | 600 | TAL | TAL2 Inscrit | — | — | — | — | La carte est insensible aux Disparitions. | **oui** |  |
| 176 | Rob l'Aventurier | Terre/C | 9 | 500 | TAL | TAL1 Inscrit | — | — | — | — | La carte est insensible aux Disparitions. | non |  |
| 206 | Catimimi | Feu/C | 5 | 500 | TAL | TAL1 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |
| 264 | Aristocrate Nébulaire | Lumière/C | 3 | 500 | TAL | TAL3 Éternisé | — | — | — | — | La carte est insensible aux Éternités. | non |  |

### (d) Déni d’économie (Spamtons, bonus élémentaires)

#### d1 — Spamtons de l’adversaire ramenés à 0
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 96 | Mélodie des Divinités | Lumière/L | 3 | 550 | ACT | Jugement divin | 10 | T10/T9 | none | 0/— | Les Spamtons de l'adversaire tombent à 0 | non |  |

#### d2 — vol de bonus élémentaire
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 epic._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 42 | Dragonnet des Lumières | Lumière/É | 3 | 500 | ACT | Éclat paisible | 1 | T1/T1 | enemy | 0/— | Attaque 20 Lumière / Vole (+1) Lumière | non |  |

#### d3 — Racket / Dette (talents)
_4 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 4 via talent — rareté : 3 common, 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 23 | Artisan des Heures | Lumière/C | 5 | 700 | TAL | TAL2 Dette | — | — | — | — | Les deux joueurs commencent avec une dette de (-20) Spamton. | non |  |
| 69 | Scorch, les Lézards Ignés | Eau/R | 7 | 350 | TAL | TAL3 Dette | — | — | — | — | Les deux joueurs commencent avec une dette de (-20) Spamton. | **oui** |  |
| 103 | Lame de la forêt | Nature/C | 5 | 650 | TAL | TAL2 Racket | — | — | — | — | Chaque fois que cette carte inflige des dégâts, l'adversaire perd 5 Spamton. | **oui** |  |
| 219 | Catixy | Ombre/C | 5 | 600 | TAL | TAL1 Racket | — | — | — | — | Chaque fois que cette carte inflige des dégâts, l'adversaire perd 5 Spamton. | non |  |

#### d4 — Mimétisme — copie nos générations d’éléments
_3 carte(s) distincte(s) : 0 via compétence active, 3 via passif de départ, 1 via talent — rareté : 2 rare, 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35 | Léo | Lumière/R | 6 | 800 | PAS | PAS Mimétisme (rare) | — | — | — | — | Chaque fois que l'adversaire génère un ou plusieurs éléments, vous en générez 1 du même type. | non |  |
| 124 | Wyrm des Dunes Cornu | Terre/C | 4 | 500 | PAS | PAS Mimétisme (rare) | — | — | — | — | Chaque fois que l'adversaire génère un ou plusieurs éléments, vous en générez 1 du même type. | non |  |
| 238 | Chimère Brasse-chair | Eau/R | 5 | 525 | PAS | PAS Mimétisme (rare) | — | — | — | — | Chaque fois que l'adversaire génère un ou plusieurs éléments, vous en générez 1 du même type. | **oui** |  |
| 35 | Léo | Lumière/R | 6 | 800 | TAL | TAL3 Mimétisme | — | — | — | — | Commence la partie avec le passif Mimétisme | non |  |

### (e) Manipulation de résistances / d’élément / de PV max

#### e1 — baisse de résistance adverse (active)
_1 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 0 via talent — rareté : 1 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 51 | Sorcière Pyrokinétique | Feu/C | 8 | 800 | ACT | Flamme magique | 3 | T3/T2 | enemy | 2/— | Attaque 25 Feu / Applique Éternité en cas de critique / Attaque 25 Lumière / Applique Éternité en cas de critique / Baisse la résistance Feu et Lumière de l'adversaire de (10%) | non | crit 1→20 |

#### e2 — érosion progressive de nos résistances (talents)
_11 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 11 via talent — rareté : 7 common, 3 rare, 1 divine._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 51 | Sorcière Pyrokinétique | Feu/C | 8 | 800 | TAL | TAL3 Affaiblissement | — | — | — | — | Diminue les résistances élémentaires de toutes les cartes adverses de (-1%) par tour de jeu | non |  |
| 54 | Loutre Intrépide | Eau/C | 5 | 650 | TAL | TAL3 Affaiblissement | — | — | — | — | Diminue les résistances élémentaires de toutes les cartes adverses de (-1%) par tour de jeu | non |  |
| 72 | Girafe Florale | Nature/R | 7 | 750 | TAL | TAL3 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |
| 103 | Lame de la forêt | Nature/C | 5 | 650 | TAL | TAL3 Affaiblissement | — | — | — | — | Diminue les résistances élémentaires de toutes les cartes adverses de (-1%) par tour de jeu | **oui** |  |
| 106 | L'Épine d'Amour | Terre/C | 6 | 500 | TAL | TAL3 Affaiblissement | — | — | — | — | Diminue les résistances élémentaires de toutes les cartes adverses de (-1%) par tour de jeu | non |  |
| 123 | Tisseuse de Mots | Nature/C | 3 | 500 | TAL | TAL3 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |
| 152 | Le Héraut des Cendres | Feu/C | 8 | 800 | TAL | TAL3 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |
| 178 | Épine Médusine | Ombre/C | 10 | 800 | TAL | TAL3 Affaiblissement | — | — | — | — | Diminue les résistances élémentaires de toutes les cartes adverses de (-1%) par tour de jeu | non |  |
| 191 | Ameru | Lumière/R | 15 | 800 | TAL | TAL1 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |
| 244 | Gazpoison Flottant | Ombre/R | 4 | 450 | TAL | TAL3 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |
| 265 | Aeltheria, Mère Primordiale | Divin/D | 10 | 700 | TAL | TAL3 Corrosion | — | — | — | — | Chaque fois que cette carte subit une attaque, l'attaquant perd (-1%) dans toutes ses résistances élémentaires. | non |  |

#### e3 — Érosion — nos PV max baissent avec les dégâts subis
_5 carte(s) distincte(s) : 0 via compétence active, 3 via passif de départ, 2 via talent — rareté : 4 common, 1 legendary._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | Sylvan, Protecteur de la Verdure | Nature/C | 5 | 550 | PAS | PAS Érosion (common) | — | — | — | — | Réduit les PV max à hauteur de 50% des dégâts infligés | non |  |
| 92 | Frost & Glacier | Eau/L | 4 | 500 | PAS | PAS Érosion (common) | — | — | — | — | Réduit les PV max à hauteur de 50% des dégâts infligés | non |  |
| 229 | Maître Amphibian | Terre/C | 4 | 700 | PAS | PAS Érosion (common) | — | — | — | — | Réduit les PV max à hauteur de 50% des dégâts infligés | non |  |
| 122 | Esprit de la Faune | Nature/C | 8 | 800 | TAL | TAL3 Erosion | — | — | — | — | Commence la partie avec le passif "Érosion" | non |  |
| 124 | Wyrm des Dunes Cornu | Terre/C | 4 | 500 | TAL | TAL1 Erosion | — | — | — | — | Commence la partie avec le passif "Érosion" | non |  |

#### e4 — Paradoxe — ses propres résistances inversées
_2 carte(s) distincte(s) : 0 via compétence active, 0 via passif de départ, 2 via talent — rareté : 2 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 116 | Prisonnière de la Machine | Feu/C | 3 | 1000 | TAL | TAL1 Paradoxe | — | — | — | — | Les résistances de cette carte sont inversées : les positives deviennent négatives, et inversement. | **oui** |  |
| 233 | Oisillons de Midas | Lumière/C | 8 | 500 | TAL | TAL3 Paradoxe | — | — | — | — | Les résistances de cette carte sont inversées : les positives deviennent négatives, et inversement. | non |  |

#### e5 — élément aléatoire / changeant
_3 carte(s) distincte(s) : 3 via compétence active, 0 via passif de départ, 0 via talent — rareté : 2 common, 1 divine._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 115 | Aidan | Feu/C | 8 | 750 | ACT | Paie-torche (coût {"fire":10}) | 3 | T3/T2 | enemy | 0/— | [Coût 10 Feu] / Attaque 30 dans un élément aléatoire | non |  |
| 153 | L'Inventeur | Feu/C | 5 | 1000 | ACT | Arc-en-ciel | 1 | T1/T1 | enemy | 0/— | Attaque 10 dans un élément aléatoire | **oui** |  |
| 265 | Aeltheria, Mère Primordiale | Divin/D | 10 | 700 | ACT | Souffle élémentaire | 1 | T1/T1 | enemy | 0/— | Attaque 30 dans son élément | non |  |
| 265 | Aeltheria, Mère Primordiale | Divin/D | 10 | 700 | ACT | Mythique | 1 | T1/T1 | none | 0/— | Change aléatoirement l'élément de votre carte | non |  |

### (f) Survie adverse (soins, vol de vie, régén, PV max, résurrection, résistances)

#### f1 — soins actifs
_23 carte(s) distincte(s) : 23 via compétence active, 0 via passif de départ, 0 via talent — rareté : 11 common, 5 rare, 5 legendary, 2 epic._

- **ACT Respiration** [CD 1, cible ally] — « Soigne 20 Nature / Soigne 20 Lumière / Résistance d'un élément aléatoire (+15) » — #22 Lueur d'Espoir (C, 900 PV)
- **ACT Clair-obscur** [CD 3, cible enemy] — « Attaque 40 Ombre / Se soigne 40 Lumière » — #36 Astry (R, 600 PV)
- **ACT Ultime repos** [CD 6, cible self] — « Se soigne 50% de ses PV max » — #44 Léviathan des Cieux (L, 1000 PV)
- **ACT Feuille magique** [CD 1, cible allAllies] — « Soigne 10 Nature / Critique (+2%) sur toutes les cartes alliées » — #71 Soigneuse Astrale des Bois (R, 600 PV)
- **ACT Soin multiple** [CD 5, cible allAllies] — « Soigne 40 Lumière à toutes les cartes alliées » — #78 Gardien Vert (R, 800 PV)
- **ACT Avaleau** [CD 5, cible enemy] — « Attaque 100 Eau / Se soigne (+100) Eau / Bonus Eau (+2) » — #100 Blancheur Aquatique (C, 700 PV)
- **ACT Protection marine** [CD 4, cible ally] — « Soigne 80 Eau / Résistance à tous les éléments (+15) / Applique Provocation » — #101 Neilla (C, 650 PV)
- **ACT Murmure** [CD 1, cible ally] — « Soigne 10 Eau / La valeur de base du soin augmente de 5 » — #102 Murmures du Corail Noir (C, 500 PV, **possédée**) — 1.21 : PV 500→400 ; Spamtons/tour 7→2 ; texte → « Soigne 10 Eau / La valeur de base du soin augmente de 3 »
- **ACT Soin critique** [CD 1, cible ally] — « Soigne 20 Nature / Critique (+10%) en cas de coup critique » — #103 Lame de la forêt (C, 650 PV, **possédée**)
- **ACT Soin soleil** [CD 3, cible ally] — « Soigne 60 Lumière / Gel » — #122 Esprit de la Faune (C, 800 PV)
- **ACT Épidémie** [CD 3, cible ally] — « Soigne 125 Terre / Bonus Terre (+2) » — #140 Souris des blés (R, 500 PV)
- **ACT Encre sèche** [CD 1, cible ally] — « Soigne 10 Eau / Bonus Eau (+2) » — #146 Poulpe Parleur (É, 500 PV)
- **ACT Doux foyer** [CD 2, cible randomAlly] — « Cible aléatoirement les cartes alliées / Soigne 25 Feu / Soigne 25 Feu / Soigne 25 Feu » — #151 Sbire des Flammes (C, 800 PV)
- **ACT Revitalisation** [CD 4, cible ally] — « Soigne 50 Eau / Dégâts critiques (+1) » — #156 L'Œil des montagnes (C, 600 PV, **possédée**)
- **ACT Régénair** [CD 1, cible randomAlly] — « Cible aléatoirement les cartes alliées / Soigne 10 Nature X4 » — #177 Moxilys, la Fredonneuse (C, 900 PV)
- **ACT Toxine enflammée** [CD 1, cible enemy] — « Attaque [1 à 35] Eau / Soigne [1 à 35] Feu » — #178 Épine Médusine (C, 800 PV)
- **ACT Transfusion** [CD 1, cible self] — « Vole 100 PV max à un allié pour se soigner du même montant » — #193 Vladislaus (É, 350 PV)
- **ACT Mélodie n°2** [CD 1, cible allAllies] — « Soigne [15 à 25] Ombre / Précision (+2%) sur toutes les cartes alliées » — #203 Ashtarae Lycaria (L, 1000 PV) — 1.21 : PV 1000→700 ; Spamtons/tour 8→4
- **ACT Planète Soin** [CD 5, cible allAllies] — « Soigne 70 Lumière à toutes les cartes alliées » — #204 Ephial (L, 1500 PV)
- **ACT Piou-piou-piou** [CD 2, cible ally] — « Soigne 10 Lumière / Soigne 10 Lumière / Soigne 10 Lumière / Soigne 10 Lumière / Bonus Lumière (+3) » — #233 Oisillons de Midas (C, 500 PV)
- **ACT Fin du périple** [CD 5, cible enemy] — « Attaque 65 Eau / Se soigne totalement » — #237 Voyageur des Crêtes (R, 1000 PV)
- **ACT Trêve** [CD 3, cible ally] — « Soigne 60 Nature / Résistance à tous les éléments (+10) » — #255 Verdelune (L, 900 PV)
- **ACT Sacrifice** [CD 1, cible self] — « [Coût 7 Terre] / Se soigne totalement » — #256 Héraldesse Serpentine (L, 900 PV)

#### f2 — vol de vie (Vampirisme)
_6 carte(s) distincte(s) : 3 via compétence active, 3 via passif de départ, 0 via talent — rareté : 1 legendary, 2 common, 3 rare._

- **ACT Tenebr'eal** [CD 3, cible enemy] — « Attaque 40 Ombre / Bonus Ombre (+1) / Vampirisme » — #47 Veilleur Nocturne (L, 800 PV), #63 Shado, Fléau abyssal (C, 800 PV)
- **ACT Drain élémentaire** [CD 1, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 6 Terre / Attaque 6 Nature / Attaque 6 Feu / Attaque 6 Eau / Attaque 6 Lumière / Attaque 6 Ombre / Vampirisme » — #137 Cerf des Couleurs Funèbres (R, 600 PV)
- **PAS PAS Vampirisme (rare)** — « Régénère 50% des dégâts infligés à la cible » — #67 Logidrake, l'Ignatius (R, 500 PV)
- **PAS PAS Vampirisme (common)** — « Régénère 25% des dégâts infligés à la cible » — #128 Dévoreur de faune (C, 700 PV)
- **PAS PAS Vampirisme (epic)** — « Régénère 75% des dégâts infligés à la cible » — #238 Chimère Brasse-chair (R, 525 PV, **possédée**)

#### f3 — régénération passive (Soin primitif)
_4 carte(s) distincte(s) : 0 via compétence active, 4 via passif de départ, 0 via talent — rareté : 2 common, 1 rare, 1 epic._

- **PAS PAS Soin primitif (common)** — « Au début de chaque tour, la carte récupère 4% de ses PV max » — #63 Shado, Fléau abyssal (C, 800 PV), #69 Scorch, les Lézards Ignés (R, 350 PV, **possédée**), #86 Régent des Abysses (É, 1000 PV), #261 Godlur (C, 1000 PV)

#### f4 — croissance / bonus de PV max
_39 carte(s) distincte(s) : 4 via compétence active, 1 via passif de départ, 37 via talent — rareté : 22 common, 2 epic, 10 rare, 5 legendary._

- **ACT Remue-sol** [CD 2, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque 40 Terre / Augmente ses PV max de 40 Terre / Bonus Terre (+2) » — #160 Sanglier Doré (C, 900 PV, **possédée**)
- **ACT Transfusion** [CD 1, cible self] — « Vole 100 PV max à un allié pour se soigner du même montant » — #193 Vladislaus (É, 350 PV)
- **ACT Protect-terre** [CD 2, cible none] — « Brise une Provocation pour donner 100 PV max » — #262 Yotaru Gardefeuille (C, 500 PV)
- **ACT Terrier** [CD 4, cible allAllies] — « Augmente les PV max de toutes les cartes alliées de 100 » — #263 Paguroniyx (C, 850 PV)
- **PAS PAS Cœur vital (common)** — « Cette carte augmente ses PV max de 15 chaque tour » — #21 Félin Errant (C, 550 PV)
- **TAL Cavalerie** — « Augmente les PV max de toutes les autres cartes alliées de (+150). » — #1 Esprit Feu (C, 500 PV, **possédée**), #2 Esprit Eau (C, 500 PV, **possédée**), #3 Esprit Nature (C, 500 PV, **possédée**), #4 Esprit Terre (C, 500 PV, **possédée**), #5 Esprit Ombre (C, 500 PV, **possédée**), #6 Esprit Lumière (C, 500 PV, **possédée**), #58 Le Transporteur Sauvage (C, 1000 PV), #72 Girafe Florale (R, 750 PV), #82 Baleine Farceuse (C, 1000 PV, **possédée**), #190 Lames en peine (R, 550 PV), #191 Ameru (R, 800 PV), #204 Ephial (L, 1500 PV)
- **TAL Imprudent** — « Applique immédiatement "Métamorphe aléatoire" à cette carte puis confère un bonus de (+500) PV. » — #23 Artisan des Heures (C, 700 PV), #34 Éclat du Renard Blanc (R, 700 PV), #36 Astry (R, 600 PV), #47 Veilleur Nocturne (L, 800 PV), #91 Ignea (L, 750 PV), #226 Apprenti Évocateur (C, 800 PV), #227 Chouette Polychrome (C, 500 PV, **possédée**), #233 Oisillons de Midas (C, 500 PV)
- **TAL Life-8** — « Les PV et PV max de la carte sont doublés au début du tour 8 » — #29 Princesse Meridia (R, 750 PV), #35 Léo (R, 800 PV), #124 Wyrm des Dunes Cornu (C, 500 PV), #177 Moxilys, la Fredonneuse (C, 900 PV), #203 Ashtarae Lycaria (L, 1000 PV)
- **TAL Vitalité des Âmes** — « Dès qu'une carte sur le terrain meurt, les PV et PV max de cette carte augmentent de (+300) » — #33 Nakyel (R, 500 PV, **possédée**), #44 Léviathan des Cieux (L, 1000 PV), #153 L'Inventeur (C, 1000 PV, **possédée**), #158 Lapin-Plume (C, 1000 PV, **possédée**), #160 Sanglier Doré (C, 900 PV, **possédée**), #188 Commando Gerz (R, 1200 PV), #193 Vladislaus (É, 350 PV), #195 Gabriel (É, 1000 PV), #221 Crapaud des Étoiles (C, 900 PV), #226 Apprenti Évocateur (C, 800 PV), #263 Paguroniyx (C, 850 PV)
- **TAL Baleine bleue** — « Augmente les PV de cette carte de (+200). » — #36 Astry (R, 600 PV), #44 Léviathan des Cieux (L, 1000 PV), #82 Baleine Farceuse (C, 1000 PV, **possédée**), #91 Ignea (L, 750 PV), #142 Squall, Émissaire des cauchemars (R, 1000 PV), #160 Sanglier Doré (C, 900 PV, **possédée**), #243 Vivy (C, 1000 PV, **possédée**)

#### f5 — retour à la vie (Résurrection, Phénix, Transition)
_17 carte(s) distincte(s) : 1 via compétence active, 3 via passif de départ, 15 via talent — rareté : 2 legendary, 3 rare, 5 epic, 7 common._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 203 | Ashtarae Lycaria | Ombre/L | 8 | 1000 | ACT | Résurrection | 8 | T8/T7 | none | 0/— | Ressuscite le dernier allié détruit avec la moitié de ses PV max | non | PV 1000→700 ; Spamtons/tour 8→4 ; coût null→{"shadow":5} ; texte → « [Coût 5 Ombre] / Ressuscite le dernier allié détruit avec la moitié de ses PV max » |
| 30 | Naissance d'Aldrin | Nature/R | 7 | 700 | PAS | PAS Phénix (rare) | — | — | — | — | Lorsqu’elle est détruite, cette carte revient à la vie avec 50% de ses PV max. Usage unique | **oui** |  |
| 37 | Roi des Flammes Ardentes | Feu/É | 7 | 900 | PAS | PAS Phénix (common) | — | — | — | — | Lorsqu’elle est détruite, cette carte revient à la vie avec 25% de ses PV max. Usage unique | non |  |
| 85 | Bleu-mange-cailloux | Terre/É | 4 | 500 | PAS | PAS Phénix (common) | — | — | — | — | Lorsqu’elle est détruite, cette carte revient à la vie avec 25% de ses PV max. Usage unique | non |  |
| 22 | Lueur d'Espoir | Lumière/C | 10 | 900 | TAL | TAL3 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 30 | Naissance d'Aldrin | Nature/R | 7 | 700 | TAL | TAL2 Plume de Phénix | — | — | — | — | 50% de chance de récupérer le passif Phénix une fois utilisé. | **oui** |  |
| 42 | Dragonnet des Lumières | Lumière/É | 3 | 500 | TAL | TAL2 Nouvelle vie | — | — | — | — | Commence la partie avec, au hasard, le passif Phénix ou Cimetière. | non |  |
| 56 | Lisa, la Dragonnière | Nature/C | 7 | 800 | TAL | TAL2 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 67 | Logidrake, l'Ignatius | Feu/R | 5 | 500 | TAL | TAL2 Nouvelle vie | — | — | — | — | Commence la partie avec, au hasard, le passif Phénix ou Cimetière. | non |  |
| 69 | Scorch, les Lézards Ignés | Eau/R | 7 | 350 | TAL | TAL1 Nouvelle vie | — | — | — | — | Commence la partie avec, au hasard, le passif Phénix ou Cimetière. | **oui** |  |
| 85 | Bleu-mange-cailloux | Terre/É | 4 | 500 | TAL | TAL3 Plume de Phénix | — | — | — | — | 50% de chance de récupérer le passif Phénix une fois utilisé. | non |  |
| 97 | Pyro | Feu/C | 4 | 500 | TAL | TAL3 Plume de Phénix | — | — | — | — | 50% de chance de récupérer le passif Phénix une fois utilisé. | non |  |
| 115 | Aidan | Feu/C | 8 | 750 | TAL | TAL3 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 146 | Poulpe Parleur | Eau/É | 3 | 500 | TAL | TAL1 Nouvelle vie | — | — | — | — | Commence la partie avec, au hasard, le passif Phénix ou Cimetière. | non |  |
| 174 | Zombie Floral | Nature/C | 5 | 1000 | TAL | TAL3 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 193 | Vladislaus | Feu/É | 4 | 350 | TAL | TAL2 Plume de Phénix | — | — | — | — | 50% de chance de récupérer le passif Phénix une fois utilisé. | non |  |
| 256 | Héraldesse Serpentine | Terre/L | 9 | 900 | TAL | TAL3 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 262 | Yotaru Gardefeuille | Nature/C | 5 | 500 | TAL | TAL3 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |
| 264 | Aristocrate Nébulaire | Lumière/C | 3 | 500 | TAL | TAL2 Transition | — | — | — | — | Quand cette carte est tuée définitivement, elle revient à la vie avec le passif "Métamorphe aléatoire". | non |  |

#### f6 — survie conditionnelle / soins totaux
_24 carte(s) distincte(s) : 0 via compétence active, 3 via passif de départ, 22 via talent — rareté : 9 epic, 5 rare, 7 common, 3 legendary._

- **PAS PAS Ténacité (common)** — « La première attaque fatale vous laisse à 1 PV » — #193 Vladislaus (É, 350 PV), #244 Gazpoison Flottant (R, 450 PV), #261 Godlur (C, 1000 PV)
- **TAL Reset ultime** — « La carte remonte à 100 % de ses PV max si une attaque de cette carte tue une carte adverse. » — #30 Naissance d'Aldrin (R, 700 PV, **possédée**), #31 Raffteru (R, 600 PV), #45 Aldrin & Gorakar (L, 700 PV), #91 Ignea (L, 750 PV), #92 Frost & Glacier (L, 500 PV), #174 Zombie Floral (C, 1000 PV), #180 Dragon Ciel (C, 700 PV, **possédée**), #247 Roi Feu (É, 1000 PV), #248 Roi Eau (É, 1000 PV), #249 Roi Nature (É, 1000 PV), #250 Roi Terre (É, 1000 PV), #251 Roi Ombre (É, 1000 PV, **possédée**), #252 Roi Lumière (É, 1000 PV)
- **TAL Chance Vitale** — « Cette carte a 10% de chance de se soigner plutôt que de subir des dégâts en cas d'attaque. » — #59 Guerrier des Neiges (C, 600 PV), #83 Panthère imaginaire (É, 600 PV), #153 L'Inventeur (C, 1000 PV, **possédée**)
- **TAL Revitalisation** — « 5 % de chance par tour de jeu de restaurer ses PV au maximum. » — #88 Faerylia (É, 600 PV), #236 Apprentie de la Mort (R, 700 PV), #237 Voyageur des Crêtes (R, 1000 PV)
- **TAL Sursaut Vital** — « Au début du tour, si les PV sont inférieurs à 10 %, la carte récupère entièrement ses PV. » — #123 Tisseuse de Mots (C, 500 PV), #160 Sanglier Doré (C, 900 PV, **possédée**), #193 Vladislaus (É, 350 PV)

#### f7 — résistances propres (buffs)
_44 carte(s) distincte(s) : 6 via compétence active, 2 via passif de départ, 38 via talent — rareté : 22 common, 13 rare, 4 legendary, 4 epic, 1 divine._

- **ACT Respiration** [CD 1, cible ally] — « Soigne 20 Nature / Soigne 20 Lumière / Résistance d'un élément aléatoire (+15) » — #22 Lueur d'Espoir (C, 900 PV)
- **ACT Écorchage** [CD 2, cible enemy] — « Attaque 20 Ombre / Augmente les dégâts de base de (+5) / Augmente les résistances du lanceur de (+5%) » — #33 Nakyel (R, 500 PV, **possédée**)
- **ACT Braise chaude** [CD 1, cible enemy] — « Attaque 10 Feu / Résistance Feu (+3) » — #43 Souverain des Flammes (L, 900 PV)
- **ACT Voile solide** [CD 1, cible none] — « Résistance à tous les éléments (+3) » — #51 Sorcière Pyrokinétique (C, 800 PV)
- **ACT Protection marine** [CD 4, cible ally] — « Soigne 80 Eau / Résistance à tous les éléments (+15) / Applique Provocation » — #101 Neilla (C, 650 PV)
- **ACT Trêve** [CD 3, cible ally] — « Soigne 60 Nature / Résistance à tous les éléments (+10) » — #255 Verdelune (L, 900 PV)
- **PAS PAS Cœur résistance (common)** — « Cette carte augmente les résistances de toutes les cartes alliées (+3) » — #158 Lapin-Plume (C, 1000 PV, **possédée**) — 1.21 : texte 1.21 : « Au début de chacun de vos tours, cette carte augmente les résistances de toutes les cartes alliées (+3). »
- **PAS PAS Cœur résistance (rare)** — « Cette carte augmente les résistances de toutes les cartes alliées (+6) » — #190 Lames en peine (R, 550 PV) — 1.21 : texte 1.21 : « Au début de chacun de vos tours, cette carte augmente les résistances de toutes les cartes alliées (+6). »
- **TAL Résilience** — « Tant que les PV de cette carte sont sous 50 %, ses résistances élémentaires augmentent de (+25%). » — #23 Artisan des Heures (C, 700 PV), #51 Sorcière Pyrokinétique (C, 800 PV), #63 Shado, Fléau abyssal (C, 800 PV), #86 Régent des Abysses (É, 1000 PV), #177 Moxilys, la Fredonneuse (C, 900 PV), #226 Apprenti Évocateur (C, 800 PV), #231 Aleera Mange-Cauchemars (C, 500 PV), #237 Voyageur des Crêtes (R, 1000 PV), #265 Aeltheria, Mère Primordiale (D, 700 PV)
- **TAL Blindage F/E** — « Résistance feu(+25%) Résistance eau (+25%) » — #25 Amber (R, 750 PV), #26 Blaze (R, 750 PV), #60 Protecteur des ruines (C, 700 PV), #100 Blancheur Aquatique (C, 700 PV), #128 Dévoreur de faune (C, 700 PV), #197 Codex des Maux Ancestraux (É, 1000 PV), #198 Codex des Sorts Lumineux (É, 1000 PV), #231 Aleera Mange-Cauchemars (C, 500 PV)
- **TAL Cœur d’acier** — « Chaque fois que cette carte subit une attaque, ses résistances élémentaires augmentent de (+1%). » — #32 Maîtresse des Teintes (R, 600 PV), #67 Logidrake, l'Ignatius (R, 500 PV), #78 Gardien Vert (R, 800 PV), #94 Zayd (L, 600 PV), #156 L'Œil des montagnes (C, 600 PV, **possédée**), #188 Commando Gerz (R, 1200 PV), #203 Ashtarae Lycaria (L, 1000 PV), #237 Voyageur des Crêtes (R, 1000 PV)
- **TAL Blindage Partagé** — « Augmente les résistances élémentaires de toutes les cartes alliées de (+10%) » — #43 Souverain des Flammes (L, 900 PV), #94 Zayd (L, 600 PV), #102 Murmures du Corail Noir (C, 500 PV, **possédée**), #117 Keria (R, 550 PV, **possédée**), #146 Poulpe Parleur (É, 500 PV), #222 Fleur de Vie (C, 600 PV), #262 Yotaru Gardefeuille (C, 500 PV)
- **TAL Blindage N/T** — « Résistance nature (+25%) Résistance terre (+25%) » — #60 Protecteur des ruines (C, 700 PV), #100 Blancheur Aquatique (C, 700 PV), #128 Dévoreur de faune (C, 700 PV), #134 Wibs l'Enflammé (C, 550 PV), #197 Codex des Maux Ancestraux (É, 1000 PV), #198 Codex des Sorts Lumineux (É, 1000 PV), #234 Rongeur Nuageux (C, 750 PV)
- **TAL Blindage O/L** — « Résistance ombre (+25%) Résistance lumière (+25%) » — #60 Protecteur des ruines (C, 700 PV), #100 Blancheur Aquatique (C, 700 PV), #128 Dévoreur de faune (C, 700 PV), #197 Codex des Maux Ancestraux (É, 1000 PV), #198 Codex des Sorts Lumineux (É, 1000 PV), #231 Aleera Mange-Cauchemars (C, 500 PV), #234 Rongeur Nuageux (C, 750 PV)
- **TAL Armure des Âmes** — « Dès qu'une carte sur le terrain meurt, les résistances élémentaires de cette carte augmentent de (+10%) » — #63 Shado, Fléau abyssal (C, 800 PV), #137 Cerf des Couleurs Funèbres (R, 600 PV), #211 Dragosaure Céleste (C, 800 PV)
- **TAL Durcissement** — « Augmente les résistances élémentaires de la carte de (+15%). » — #82 Baleine Farceuse (C, 1000 PV, **possédée**), #127 Spectre Canin (C, 1000 PV), #191 Ameru (R, 800 PV), #229 Maître Amphibian (C, 700 PV), #236 Apprentie de la Mort (R, 700 PV)

### (g) Burst / montée en puissance (critique, multiplicateurs, Temporalité, Écho, nukes)

#### g1 — buffs de critique
_32 carte(s) distincte(s) : 18 via compétence active, 0 via passif de départ, 22 via talent — rareté : 17 common, 10 rare, 1 epic, 4 legendary._

- **ACT Bond-rapide** [CD 1, cible enemy] — « Attaque 5 Nature / Bonus Nature (+1) / Précision et Critique (+2%) pour le lanceur » — #21 Félin Errant (C, 550 PV), #39 Sylvan, Protecteur de la Verdure (C, 550 PV)
- **ACT Secousse aléatoire** [CD 1, cible allAllies] — « Attaque 70 Terre / Critique (+20%) sur toutes les cartes alliées » — #31 Raffteru (R, 600 PV)
- **ACT Morsure brûlante** [CD 2, cible enemy] — « Attaque 15 Feu / Attaque 15 Terre / Critique de toutes les cartes du lanceur (+5%) » — #37 Roi des Flammes Ardentes (É, 900 PV), #124 Wyrm des Dunes Cornu (C, 500 PV) — 1.21 : texte → « Attaque 15 Feu / Attaque 15 Terre / Critique de toutes les cartes du lanceur (+7%) »
- **ACT Embrasement** [CD 2, cible allAllies] — « Cible toutes les cartes alliées / Critique (+5%) » — #43 Souverain des Flammes (L, 900 PV), #117 Keria (R, 550 PV, **possédée**)
- **ACT Morsure** [CD 1, cible allAllies] — « Attaque 6 Eau / Critique (+3%) sur toutes les cartes alliées » — #54 Loutre Intrépide (C, 650 PV)
- **ACT Feuille magique** [CD 1, cible allAllies] — « Soigne 10 Nature / Critique (+2%) sur toutes les cartes alliées » — #71 Soigneuse Astrale des Bois (R, 600 PV)
- **ACT Renaissance Sylvatique** [CD 2, cible allAllies] — « Applique Provocation / Cible toutes les cartes alliées / Précision et Critique (+5%) » — #72 Girafe Florale (R, 750 PV)
- **ACT Ohohohohohoh** [CD 6, cible self] — « Critique du lanceur (+50%) » — #82 Baleine Farceuse (C, 1000 PV, **possédée**)
- **ACT Soin critique** [CD 1, cible ally] — « Soigne 20 Nature / Critique (+10%) en cas de coup critique » — #103 Lame de la forêt (C, 650 PV, **possédée**)
- **ACT Chute critique** [CD 1, cible none] — « Critique (+10%) » — #136 Souverain des Chutes d'Éther (R, 800 PV)
- **ACT Aventure** [CD 1, cible none] — « Les valeurs de base des soins et des dégâts augmentent de 1 / Précision et Critique (+4%) » — #176 Rob l'Aventurier (C, 500 PV)
- **ACT Mélodie n°1** [CD 1, cible allAllies] — « Attaque [15 à 25] Ombre / Critique (+2%) sur toutes les cartes alliées » — #203 Ashtarae Lycaria (L, 1000 PV) — 1.21 : PV 1000→700 ; Spamtons/tour 8→4
- **ACT Miaulement** [CD 1, cible enemy] — « Attaque [4 à 16] Ombre / Critique du lanceur (+5%) » — #219 Catixy (C, 600 PV)
- **ACT Charme Sinistre** [CD 2, cible randomAlly] — « Critique (+25%) aléatoirement sur une carte alliée » — #219 Catixy (C, 600 PV)
- **ACT Onde de Ténèbres** [CD 3, cible enemy] — « Attaque 40 Ombre / Attaque [+1 à +40] Lumière / Critique du lanceur (+20) » — #243 Vivy (C, 1000 PV, **possédée**)
- **ACT Mascarade cosmique (option 2/2)** [CD 2, cible none] — « Critique (+20%) » — #264 Aristocrate Nébulaire (C, 500 PV)
- **TAL Incisif** — « Les critiques et la précision de toutes vos cartes augmentent de (+1%) par tour » — #27 Hippocampe Nimbé (R, 900 PV, **possédée**), #32 Maîtresse des Teintes (R, 600 PV), #39 Sylvan, Protecteur de la Verdure (C, 550 PV), #119 Fleurmarine (C, 600 PV), #136 Souverain des Chutes d'Éther (R, 800 PV), #222 Fleur de Vie (C, 600 PV), #261 Godlur (C, 1000 PV)
- **TAL Boule de Crit** — « Augmente les critiques de cette carte de (+2%) à chaque tour » — #31 Raffteru (R, 600 PV), #37 Roi des Flammes Ardentes (É, 900 PV), #71 Soigneuse Astrale des Bois (R, 600 PV), #97 Pyro (C, 500 PV), #113 Lums (C, 600 PV), #245 Shinobi Éclairant (R, 600 PV)
- **TAL Critique** — « Bonus critique (+10%) » — #34 Éclat du Renard Blanc (R, 700 PV), #43 Souverain des Flammes (L, 900 PV), #54 Loutre Intrépide (C, 650 PV), #94 Zayd (L, 600 PV), #119 Fleurmarine (C, 600 PV), #156 L'Œil des montagnes (C, 600 PV, **possédée**), #211 Dragosaure Céleste (C, 800 PV), #219 Catixy (C, 600 PV), #238 Chimère Brasse-chair (R, 525 PV, **possédée**), #255 Verdelune (L, 900 PV)

#### g2 — dégâts critiques +1 (critMult)
_7 carte(s) distincte(s) : 2 via compétence active, 0 via passif de départ, 5 via talent — rareté : 3 common, 3 rare, 1 epic._

- **ACT Envol** [CD 4, cible field] — « Cible toutes les cartes du terrain / Dégâts critiques (+1) » — #113 Lums (C, 600 PV)
- **ACT Revitalisation** [CD 4, cible ally] — « Soigne 50 Eau / Dégâts critiques (+1) » — #156 L'Œil des montagnes (C, 600 PV, **possédée**)
- **TAL Frappe** — « Augmente les dégâts critiques de (+1). » — #29 Princesse Meridia (R, 750 PV), #34 Éclat du Renard Blanc (R, 700 PV), #85 Bleu-mange-cailloux (É, 500 PV), #134 Wibs l'Enflammé (C, 550 PV), #238 Chimère Brasse-chair (R, 525 PV, **possédée**)

#### g3 — attaques à critique lourd (×4 à ×6, ≥25 % de base)
_4 carte(s) distincte(s) : 4 via compétence active, 0 via passif de départ, 0 via talent — rareté : 4 common._

- **ACT Morsure** [CD 1, cible allAllies] — « Attaque 6 Eau / Critique (+3%) sur toutes les cartes alliées » — #54 Loutre Intrépide (C, 650 PV)
- **ACT Tranche-sol** [CD 3, cible enemy] — « Attaque 30 Terre / Gel » — #59 Guerrier des Neiges (C, 600 PV)
- **ACT Incendie** [CD 1, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 5 Feu / Bonus Feu (+1) » — #97 Pyro (C, 500 PV)
- **ACT Miaulement** [CD 1, cible enemy] — « Attaque [4 à 16] Ombre / Critique du lanceur (+5%) » — #219 Catixy (C, 600 PV)

#### g4 — Berserk / Multiplicateur
_9 carte(s) distincte(s) : 0 via compétence active, 9 via passif de départ, 0 via talent — rareté : 6 common, 3 rare._

- **PAS PAS Multiplicateur (rare)** — « Les bonus élémentaires sont doublés pour les dégâts et les soins de cette carte » — #102 Murmures du Corail Noir (C, 500 PV, **possédée**), #137 Cerf des Couleurs Funèbres (R, 600 PV), #153 L'Inventeur (C, 1000 PV, **possédée**), #178 Épine Médusine (C, 800 PV)
- **PAS PAS Berserk (common)** — « Les dégâts et les soins de toutes vos cartes sont augmentés de 12% » — #142 Squall, Émissaire des cauchemars (R, 1000 PV), #151 Sbire des Flammes (C, 800 PV), #156 L'Œil des montagnes (C, 600 PV, **possédée**), #234 Rongeur Nuageux (C, 750 PV)
- **PAS PAS Berserk (rare)** — « Les dégâts et les soins de toutes vos cartes sont augmentés de 25% » — #188 Commando Gerz (R, 1200 PV)

#### g5 — Temporalité (recharges -1)
_8 carte(s) distincte(s) : 3 via compétence active, 2 via passif de départ, 6 via talent — rareté : 1 epic, 2 legendary, 4 common, 1 rare._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 42 | Dragonnet des Lumières | Lumière/É | 3 | 500 | ACT | Aide pensive | 3 | T3/T2 | none | 0/— | Applique Temporalité | non |  |
| 47 | Veilleur Nocturne | Ombre/L | 7 | 800 | ACT | Nuit finale | 9 | T9/T8 | allAllies | 0/— | Cible toutes les cartes alliées / Applique Temporalité x (+3) | non |  |
| 227 | Chouette Polychrome | Nature/C | 9 | 500 | ACT | Danse des plumes | 2 | T2/T1 | spreadField | 0/— | Cible aléatoirement les cartes du terrain / Attaque 30 Nature / Attaque 30 Feu / Attaque 30 Ombre / Attaque 30 Lumière / Attaque 30 Eau / Attaque 30 Terre / Applique Temporalité à la carte ciblée en cas de coup critique | **oui** |  |
| 101 | Neilla | Eau/C | 9 | 650 | PAS | PAS Temporalité (legendary) | — | — | — | — | Diminue les temps de recharge de 1 | non |  |
| 255 | Verdelune | Nature/L | 5 | 900 | PAS | PAS Temporalité (legendary) | — | — | — | — | Diminue les temps de recharge de 1 | non |  |
| 101 | Neilla | Eau/C | 9 | 650 | TAL | TAL2 Réducteur | — | — | — | — | Au début de votre premier tour, une carte alliée aléatoire reçoit "Temporalité" | non |  |
| 124 | Wyrm des Dunes Cornu | Terre/C | 4 | 500 | TAL | TAL3 Dernier souffle | — | — | — | — | Applique Temporalité à toutes vos cartes quand celle-ci meurt | non |  |
| 136 | Souverain des Chutes d'Éther | Eau/R | 5 | 800 | TAL | TAL3 Dernier souffle | — | — | — | — | Applique Temporalité à toutes vos cartes quand celle-ci meurt | non |  |
| 180 | Dragon Ciel | Lumière/C | 8 | 700 | TAL | TAL1 Dernier souffle | — | — | — | — | Applique Temporalité à toutes vos cartes quand celle-ci meurt | **oui** |  |
| 227 | Chouette Polychrome | Nature/C | 9 | 500 | TAL | TAL3 Dernier souffle | — | — | — | — | Applique Temporalité à toutes vos cartes quand celle-ci meurt | **oui** |  |
| 255 | Verdelune | Nature/L | 5 | 900 | TAL | TAL3 Dernier souffle | — | — | — | — | Applique Temporalité à toutes vos cartes quand celle-ci meurt | non |  |

#### g6 — Écho (chance de relancer)
_15 carte(s) distincte(s) : 5 via compétence active, 0 via passif de départ, 11 via talent — rareté : 5 rare, 7 common, 2 epic, 1 divine._

- **ACT Bond-chanceux** [CD 1, cible enemy] — « Attaque 10 Nature / Echo (50%) » — #31 Raffteru (R, 600 PV)
- **ACT Lucky-Fire** [CD 1, cible enemy] — « Attaque 7 Feu / Attaque 7 Feu / Attaque 7 Feu / Echo (50%) » — #67 Logidrake, l'Ignatius (R, 500 PV)
- **ACT Hydrochance** [CD 3, cible enemy] — « Attaque 35 Eau / Echo (50%) » — #82 Baleine Farceuse (C, 1000 PV, **possédée**)
- **ACT Vitesse folle** [CD 1, cible enemy] — « Attaque 9 Nature / Echo (75%) » — #83 Panthère imaginaire (É, 600 PV)
- **ACT Petite vague** [CD 1, cible enemy] — « Attaque 10 Eau / Augmente sa génération de Spamtons de (+1) / Echo (50%) » — #260 Le compagnon des esprits (C, 600 PV)
- **TAL Roulette** — « Toutes les compétences de cette carte gagnent Echo (10%). » — #21 Félin Errant (C, 550 PV), #22 Lueur d'Espoir (C, 900 PV), #25 Amber (R, 750 PV), #26 Blaze (R, 750 PV), #54 Loutre Intrépide (C, 650 PV), #81 Luminaire Abyssal (É, 600 PV), #83 Panthère imaginaire (É, 600 PV), #102 Murmures du Corail Noir (C, 500 PV, **possédée**), #139 Cornu mythologique (R, 700 PV), #153 L'Inventeur (C, 1000 PV, **possédée**), #265 Aeltheria, Mère Primordiale (D, 700 PV) — 1.21 : texte 1.21 : « Toutes les compétences de cette carte gagnent Écho (10 %). »

#### g7 — dégâts/soins de base croissants
_17 carte(s) distincte(s) : 11 via compétence active, 0 via passif de départ, 7 via talent — rareté : 3 rare, 10 common, 3 epic, 1 legendary._

- **ACT Écorchage** [CD 2, cible enemy] — « Attaque 20 Ombre / Augmente les dégâts de base de (+5) / Augmente les résistances du lanceur de (+5%) » — #33 Nakyel (R, 500 PV, **possédée**)
- **ACT Roulé-boulé** [CD 1, cible enemy] — « Attaque 15 Terre / La valeur de base de dégâts augmente de 5 » — #60 Protecteur des ruines (C, 700 PV)
- **ACT Murmure** [CD 1, cible ally] — « Soigne 10 Eau / La valeur de base du soin augmente de 5 » — #102 Murmures du Corail Noir (C, 500 PV, **possédée**) — 1.21 : PV 500→400 ; Spamtons/tour 7→2 ; texte → « Soigne 10 Eau / La valeur de base du soin augmente de 3 »
- **ACT Explosion** [CD 1, cible enemy] — « [Coût 100 PV] / Attaque 10 Feu / Après utilisation, les dégâts de base de cette attaque augmentent de (+10) » — #116 Prisonnière de la Machine (C, 1000 PV, **possédée**)
- **ACT Feu allié** [CD 3, cible allAllies] — « Cible toutes les cartes alliées / Les valeurs de base des soins et des dégâts augmentent de 3 » — #117 Keria (R, 550 PV, **possédée**)
- **ACT Boule de haine** [CD 1, cible enemy] — « Attaque 5 Ombre / La valeur de base de dégâts augmente de 5 » — #128 Dévoreur de faune (C, 700 PV)
- **ACT Son perçant** [CD 1, cible enemy] — « [Coût 1 Nature] / Attaque 20 Nature / Les dégâts de base de cette attaque augmentent de (+2) après utilisation » — #158 Lapin-Plume (C, 1000 PV, **possédée**) — 1.21 : PV 1000→850
- **ACT Aventure** [CD 1, cible none] — « Les valeurs de base des soins et des dégâts augmentent de 1 / Précision et Critique (+4%) » — #176 Rob l'Aventurier (C, 500 PV)
- **ACT Double-afflux** [CD 1, cible enemy] — « Attaque 5 Feu / Attaque 5 Ombre / La valeur de base de dégâts augmente de 5 » — #193 Vladislaus (É, 350 PV)
- **ACT Quintuor** [CD 2, cible none] — « Les valeurs de base des soins et des dégâts augmentent de 2 » — #233 Oisillons de Midas (C, 500 PV)
- **ACT Protect-boost** [CD 2, cible none] — « Brise une Provocation pour augmenter les dégâts et soins de base de 3 » — #262 Yotaru Gardefeuille (C, 500 PV)
- **TAL One man army** — « Chaque fois qu'une autre carte meurt sur le terrain, les dégâts et les soins de base de toutes les attaques de cette carte augmentent de (+5). » — #81 Luminaire Abyssal (É, 600 PV), #86 Régent des Abysses (É, 1000 PV), #96 Mélodie des Divinités (L, 550 PV), #127 Spectre Canin (C, 1000 PV), #142 Squall, Émissaire des cauchemars (R, 1000 PV), #158 Lapin-Plume (C, 1000 PV, **possédée**), #260 Le compagnon des esprits (C, 600 PV)

#### g8 — cascades sur kill / à la mort / riposte
_14 carte(s) distincte(s) : 0 via compétence active, 9 via passif de départ, 5 via talent — rareté : 6 rare, 2 epic, 2 legendary, 4 common._

- **PAS PAS Reset (epic)** — « Lorsque vous tuez une carte ADVERSE avec une de vos attaques, celle-ci reste disponible » — #27 Hippocampe Nimbé (R, 900 PV, **possédée**), #30 Naissance d'Aldrin (R, 700 PV, **possédée**), #85 Bleu-mange-cailloux (É, 500 PV), #204 Ephial (L, 1500 PV), #211 Dragosaure Céleste (C, 800 PV) — 1.21 : passif remplacé en 1.21 par Cimetière rare
- **PAS PAS Revanche (rare)** — « Une fois détruite, cette carte inflige l'entièreté de ses attaques à l'adversaire » — #94 Zayd (L, 600 PV)
- **PAS PAS Vengeur (epic)** — « Cette carte récupère toutes ses attaques chaque fois qu'une carte qu'elle n'a pas tuée meurt. » — #180 Dragon Ciel (C, 700 PV, **possédée**), #236 Apprentie de la Mort (R, 700 PV)
- **PAS PAS Cimetière (rare)** — « Augmente tous vos bonus élémentaires de (+5) lorsqu'une carte meurt » — #190 Lames en peine (R, 550 PV)
- **PAS PAS Cimetière (common)** — « Augmente tous vos bonus élémentaires de (+3) lorsqu'une carte meurt » — #236 Apprentie de la Mort (R, 700 PV)
- **TAL Contre** — « Une fois par partie, quand cette carte subit des dégâts et que ses PV sont sous 25 %, elle riposte en lançant toutes ses compétences sur la carte qui l'a attaquée. » — #37 Roi des Flammes Ardentes (É, 900 PV), #115 Aidan (C, 750 PV), #142 Squall, Émissaire des cauchemars (R, 1000 PV), #244 Gazpoison Flottant (R, 450 PV), #260 Le compagnon des esprits (C, 600 PV)

#### g9 — gros coups (≥100 de base, % PV manquants, usage limité)
_9 carte(s) distincte(s) : 9 via compétence active, 0 via passif de départ, 0 via talent — rareté : 4 legendary, 3 common, 1 rare, 1 epic._

| # | Carte | Élém./Rar. | Sp/tour | PV | Type | Compétence / talent | CD | 1re dispo (adv. 1er/2e) | Cible | Durée comp./effet | Texte FR | Poss. | Δ 1.21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 45 | Aldrin & Gorakar | Nature/L | 4 | 700 | ACT | Valse des nuages (usage 1) | 5 | T5/T4 | enemy | 0/— | Attaque 90 Nature / [Usage Limité 1/1] | non |  |
| 91 | Ignea | Feu/L | 10 | 750 | ACT | Incandescence | 4 | T4/T3 | randomEnemy | 0/— | Cible aléatoirement une carte adverse / Attaque 120 Feu / Bonus Feu (+2) | non |  |
| 94 | Zayd | Terre/L | 1 | 600 | ACT | Fin du monde | 7 | T7/T6 | spreadEnemy | 0/— | Cible aléatoirement les cartes adverses / Attaque 50 Terre / Attaque 50 Nature / Attaque 50 Feu / Attaque 50 Lumière / Attaque 50 Ombre / Attaque 50 Eau | non |  |
| 100 | Blancheur Aquatique | Eau/C | 7 | 700 | ACT | Avaleau | 5 | T5/T4 | enemy | 0/— | Attaque 100 Eau / Se soigne (+100) Eau / Bonus Eau (+2) | non |  |
| 188 | Commando Gerz | Terre/R | 4 | 1200 | ACT | Dernier plaisir | 10 | T10/T9 | spreadEnemy | 0/— | Cible aléatoirement les cartes adverses / Attaque 100 Terre / Attaque 100 Lumière | non |  |
| 195 | Gabriel | Nature/É | 9 | 1000 | ACT | Cocon (usage 1) | 3 | T3/T2 | enemy | 0/— | Attaque 20 Nature / Bonus Nature (+5) / [Usage Limité 1/1] | non |  |
| 195 | Gabriel | Nature/É | 9 | 1000 | ACT | Chenille (usage 1) | 6 | T6/T5 | enemy | 0/— | Attaque 40 Nature / Bonus Nature (+10) / [Usage Limité 1/1] | non |  |
| 195 | Gabriel | Nature/É | 9 | 1000 | ACT | Papillon (usage 1) | 9 | T9/T8 | enemy | 0/— | Attaque 60 Nature / Bonus Nature (+15) / [Usage Limité 1/1] | non |  |
| 227 | Chouette Polychrome | Nature/C | 9 | 500 | ACT | Danse des plumes | 2 | T2/T1 | spreadField | 0/— | Cible aléatoirement les cartes du terrain / Attaque 30 Nature / Attaque 30 Feu / Attaque 30 Ombre / Attaque 30 Lumière / Attaque 30 Eau / Attaque 30 Terre / Applique Temporalité à la carte ciblée en cas de coup critique | **oui** |  |
| 231 | Aleera Mange-Cauchemars | Ombre/C | 5 | 500 | ACT | Mâche-mot | 2 | T2/T1 | aoeEnemy | 0/— | Cible toutes les cartes adverses / Attaque 5 Ombre + 50% des PV manquants du lanceur | non |  |
| 256 | Héraldesse Serpentine | Terre/L | 9 | 900 | ACT | Constriction Éternelle | 5 | T5/T4 | spreadEnemy | 0/— | Cible aléatoirement les cartes adverses / Attaque 30 Terre X8 | non |  |

#### g10 — buffs de précision
_9 carte(s) distincte(s) : 9 via compétence active, 0 via passif de départ, 0 via talent — rareté : 6 common, 2 rare, 1 legendary._

- **ACT Bond-rapide** [CD 1, cible enemy] — « Attaque 5 Nature / Bonus Nature (+1) / Précision et Critique (+2%) pour le lanceur » — #21 Félin Errant (C, 550 PV), #39 Sylvan, Protecteur de la Verdure (C, 550 PV)
- **ACT Marteau-lumineux** [CD 3, cible allAllies] — « Attaque 20 Lumière / Attaque 20 Terre / Précision (+20%) sur toutes les cartes alliées » — #64 Maître Thronebéur (C, 850 PV)
- **ACT Renaissance Sylvatique** [CD 2, cible allAllies] — « Applique Provocation / Cible toutes les cartes alliées / Précision et Critique (+5%) » — #72 Girafe Florale (R, 750 PV)
- **ACT Fond marin** [CD 2, cible none] — « Précision (+12%) » — #119 Fleurmarine (C, 600 PV)
- **ACT Chute précise** [CD 1, cible none] — « Précision (+10%) » — #136 Souverain des Chutes d'Éther (R, 800 PV)
- **ACT Aventure** [CD 1, cible none] — « Les valeurs de base des soins et des dégâts augmentent de 1 / Précision et Critique (+4%) » — #176 Rob l'Aventurier (C, 500 PV)
- **ACT Mélodie n°2** [CD 1, cible allAllies] — « Soigne [15 à 25] Ombre / Précision (+2%) sur toutes les cartes alliées » — #203 Ashtarae Lycaria (L, 1000 PV) — 1.21 : PV 1000→700 ; Spamtons/tour 8→4
- **ACT Mascarade cosmique (option 1/2)** [CD 2, cible none] — « Choix / Précision (+20%) » — #264 Aristocrate Nébulaire (C, 500 PV)

#### g11 — rampe élémentaire (génération, Cœurs, Terrains, AoE talents)
_55 carte(s) distincte(s) : 26 via compétence active, 0 via passif de départ, 38 via talent — rareté : 27 common, 14 rare, 10 epic, 1 divine, 3 legendary._

- **ACT Flambée** [CD 1, cible none] — « Bonus Feu (+1) » — #1 Esprit Feu (C, 500 PV, **possédée**)
- **ACT Vague** [CD 1, cible none] — « Bonus Eau (+1) » — #2 Esprit Eau (C, 500 PV, **possédée**)
- **ACT Éolienne** [CD 1, cible none] — « Bonus Nature (+1) » — #3 Esprit Nature (C, 500 PV, **possédée**)
- **ACT Rempart** [CD 1, cible none] — « Bonus Terre (+1) » — #4 Esprit Terre (C, 500 PV, **possédée**)
- **ACT Obscur** [CD 1, cible none] — « Bonus Ombre (+1) » — #5 Esprit Ombre (C, 500 PV, **possédée**)
- **ACT Écran** [CD 1, cible none] — « Bonus Lumière (+1) » — #6 Esprit Lumière (C, 500 PV, **possédée**)
- **ACT Volupté** [CD 2, cible none] — « Bonus Eau (+2 à +5) / Bonus Nature (+2 à +5) » — #29 Princesse Meridia (R, 750 PV)
- **ACT Multiboost** [CD 3, cible none] — « Bonus de chaque élément (+3) » — #32 Maîtresse des Teintes (R, 600 PV), #59 Guerrier des Neiges (C, 600 PV), #88 Faerylia (É, 600 PV)
- **ACT Génie incompris** [CD 4, cible none] — « Bonus (+35) dans un élément aléatoire » — #36 Astry (R, 600 PV)
- **ACT Feau** [CD 1, cible none] — « Bonus Feu (+3) / Bonus Eau (+3) / Bonus Terre (+3) » — #69 Scorch, les Lézards Ignés (R, 350 PV, **possédée**)
- **ACT Sagesse** [CD 1, cible none] — « Bonus Terre (+2) / Bonus Nature (+2) / Bonus Lumière (+2) » — #106 L'Épine d'Amour (C, 500 PV)
- **ACT Vent argenté (option 2/2)** [CD 2, cible none] — « Bonus Lumière (+3) Bonus Ombre (+3) » — #113 Lums (C, 600 PV)
- **ACT Chanceur** [CD 1, cible none] — « Bonus (+10) dans un élément aléatoire » — #115 Aidan (C, 750 PV)
- **ACT Souffle du dragon (option 2/2)** [CD 3, cible none] — « Bonus Feu (+5) / Bonus Nature (+5) » — #152 Le Héraut des Cendres (C, 800 PV)
- **ACT Cigarillos** [CD 2, cible none] — « Bonus Terre (+3) / Bonus Lumière (+3) » — #188 Commando Gerz (R, 1200 PV)
- **ACT Écrit sombre** [CD 1, cible none] — « Bonus Ombre (+1). La valeur de base du bonus augmente de 1 » — #197 Codex des Maux Ancestraux (É, 1000 PV)
- **ACT Écrit luminescent** [CD 1, cible none] — « Bonus Lumière (+1). La valeur de base du bonus augmente de 1 » — #198 Codex des Sorts Lumineux (É, 1000 PV)
- **ACT Choix brûlant (option 1/3)** [CD 5, cible none] — « Choix / Bonus Feu [1 à 20] » — #247 Roi Feu (É, 1000 PV)
- **ACT Choix brûlant (option 2/3)** [CD 5, cible none] — « Bonus Feu [5 à 15] » — #247 Roi Feu (É, 1000 PV)
- **ACT Choix brûlant (option 3/3)** [CD 5, cible none] — « Bonus Feu [8 à 12] » — #247 Roi Feu (É, 1000 PV)
- **ACT Choix Aqueux (option 1/3)** [CD 5, cible none] — « Choix / Bonus Eau [1 à 20] » — #248 Roi Eau (É, 1000 PV)
- **ACT Choix Aqueux (option 2/3)** [CD 5, cible none] — « Bonus Eau [5 à 15] » — #248 Roi Eau (É, 1000 PV)
- **ACT Choix Aqueux (option 3/3)** [CD 5, cible none] — « Bonus Eau [8 à 12] » — #248 Roi Eau (É, 1000 PV)
- **ACT Choix Floral (option 1/3)** [CD 5, cible none] — « Choix / Bonus Nature [1 à 20] » — #249 Roi Nature (É, 1000 PV)
- **ACT Choix Floral (option 2/3)** [CD 5, cible none] — « Bonus Nature [5 à 15] » — #249 Roi Nature (É, 1000 PV)
- **ACT Choix Floral (option 3/3)** [CD 5, cible none] — « Bonus Nature [8 à 12] » — #249 Roi Nature (É, 1000 PV)
- **ACT Choix Terrestre (option 1/3)** [CD 5, cible none] — « Choix / Bonus Terre [1 à 20] » — #250 Roi Terre (É, 1000 PV)
- **ACT Choix Terrestre (option 2/3)** [CD 5, cible none] — « Bonus Terre [5 à 15] » — #250 Roi Terre (É, 1000 PV)
- **ACT Choix Terrestre (option 3/3)** [CD 5, cible none] — « Bonus Terre [8 à 12] » — #250 Roi Terre (É, 1000 PV)
- **ACT Choix sombre (option 1/3)** [CD 5, cible none] — « Choix / Bonus Ombre [1 à 20] » — #251 Roi Ombre (É, 1000 PV, **possédée**)
- **ACT Choix sombre (option 2/3)** [CD 5, cible none] — « Bonus Ombre [5 à 15] » — #251 Roi Ombre (É, 1000 PV, **possédée**)
- **ACT Choix sombre (option 3/3)** [CD 5, cible none] — « Bonus Ombre [8 à 12] » — #251 Roi Ombre (É, 1000 PV, **possédée**)
- **ACT Choix Solaire (option 1/3)** [CD 5, cible none] — « Choix / Bonus Lumière [1 à 20] » — #252 Roi Lumière (É, 1000 PV)
- **ACT Choix Solaire (option 2/3)** [CD 5, cible none] — « Bonus Lumière [5 à 15] » — #252 Roi Lumière (É, 1000 PV)
- **ACT Choix Solaire (option 3/3)** [CD 5, cible none] — « Bonus Lumière [8 à 12] » — #252 Roi Lumière (É, 1000 PV)
- **ACT Berceau des Éléments** [CD 1, cible none] — « Bonus (1 à 5) dans son élément » — #265 Aeltheria, Mère Primordiale (D, 700 PV)
- **TAL Cœur FEU** — « Commence la partie avec le passif "Cœur de feu" » — #1 Esprit Feu (C, 500 PV, **possédée**), #259 Dragon de la Cité Infernale (C, 550 PV, **possédée**)
- **TAL Terrain aquatique** — « Bonus (+7) Eau. » — #1 Esprit Feu (C, 500 PV, **possédée**), #178 Épine Médusine (C, 800 PV), #221 Crapaud des Étoiles (C, 900 PV)
- **TAL Cœur EAU** — « Commence la partie avec le passif Cœur d'eau » — #2 Esprit Eau (C, 500 PV, **possédée**)
- **TAL Terrain enflammé** — « Bonus (+7) Feu. » — #2 Esprit Eau (C, 500 PV, **possédée**), #45 Aldrin & Gorakar (L, 700 PV), #178 Épine Médusine (C, 800 PV)
- **TAL Cœur NATURE** — « Commence la partie avec le passif Cœur de nature » — #3 Esprit Nature (C, 500 PV, **possédée**), #103 Lame de la forêt (C, 650 PV, **possédée**)
- **TAL Terrain terrestre** — « Bonus (+7) Terre. » — #3 Esprit Nature (C, 500 PV, **possédée**), #195 Gabriel (É, 1000 PV)
- **TAL Cœur TERRE** — « Commence la partie avec le passif Cœur de terre » — #4 Esprit Terre (C, 500 PV, **possédée**)
- **TAL Terrain naturel** — « Bonus (+7) Nature. » — #4 Esprit Terre (C, 500 PV, **possédée**)
- **TAL Coeur OMBRE** — « Commence la partie avec le passif "Cœur d'ombre" » — #5 Esprit Ombre (C, 500 PV, **possédée**), #33 Nakyel (R, 500 PV, **possédée**), #113 Lums (C, 600 PV), #259 Dragon de la Cité Infernale (C, 550 PV, **possédée**)
- **TAL Terrain lumineux** — « Bonus (+7) Lumière. » — #5 Esprit Ombre (C, 500 PV, **possédée**), #140 Souris des blés (R, 500 PV), #243 Vivy (C, 1000 PV, **possédée**)
- **TAL Cœur LUMIÈRE** — « Commence la partie avec le passif Cœur de lumière » — #6 Esprit Lumière (C, 500 PV, **possédée**), #51 Sorcière Pyrokinétique (C, 800 PV), #113 Lums (C, 600 PV)
- **TAL Terrain sombre** — « Bonus (+7) Ombre. » — #6 Esprit Lumière (C, 500 PV, **possédée**), #102 Murmures du Corail Noir (C, 500 PV, **possédée**), #256 Héraldesse Serpentine (L, 900 PV)
- **TAL Départ multi** — « Bonus (+3) dans chaque élément. » — #12 Hibernatus (C, 750 PV, **possédée**), #27 Hippocampe Nimbé (R, 900 PV, **possédée**), #32 Maîtresse des Teintes (R, 600 PV), #64 Maître Thronebéur (C, 850 PV), #72 Girafe Florale (R, 750 PV), #88 Faerylia (É, 600 PV), #137 Cerf des Couleurs Funèbres (R, 600 PV), #263 Paguroniyx (C, 850 PV)
- **TAL AOE Épique** — « Commence la partie avec le passif "AoE" » — #17 Croqueur de Fruits Verdoyant (C, 650 PV)
- **TAL Souffle-8** — « Récupère l'attaque Souffle élémentaire au début du tour 8 » — #17 Croqueur de Fruits Verdoyant (C, 650 PV), #101 Neilla (C, 650 PV), #117 Keria (R, 550 PV, **possédée**), #139 Cornu mythologique (R, 700 PV), #233 Oisillons de Midas (C, 500 PV)
- **TAL AOE Rare** — « Commence la partie avec le passif "AoE" » — #56 Lisa, la Dragonnière (C, 800 PV), #211 Dragosaure Céleste (C, 800 PV)
- **TAL AOE** — « Commence la partie avec le passif "AoE" » — #78 Gardien Vert (R, 800 PV)
- **TAL Cœur Corrompu** — « Commence la partie avec un passif Cœur rare aléatoire » — #96 Mélodie des Divinités (L, 550 PV), #222 Fleur de Vie (C, 600 PV)
- **TAL Multicolore** — « Bonus (+1) dans tous les éléments à chaque attaque de cette carte » — #245 Shinobi Éclairant (R, 600 PV)

### (h) Autres (schémas de ciblage, Poison, Renvoi, transformations, économie propre)

#### h1 — schémas de ciblage des dégâts (zone, aléatoire, réparti, champ entier)
_30 carte(s) distincte(s) : 30 via compétence active, 0 via passif de départ, 0 via talent — rareté : 12 common, 9 rare, 7 legendary, 2 epic._

- **ACT Dévalement** [CD 1, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque [20 à 30] Terre » — #17 Croqueur de Fruits Verdoyant (C, 650 PV)
- **ACT Chaos élémentaire** [CD 3, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 15 Nature / 15 Terre / 15 Feu / 15 Lumière / 15 Ombre / 15 Eau » — #32 Maîtresse des Teintes (R, 600 PV)
- **ACT Duombre** [CD 2, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 15 Ombre / Bonus Ombre (+2) » — #34 Éclat du Renard Blanc (R, 700 PV), #177 Moxilys, la Fredonneuse (C, 900 PV)
- **ACT Éclair purificateur** [CD 4, cible spreadEnemy] — « Attaque [20 à 60] Lumière / Attaque [20 à 60] Lumière / Ennemis aléatoires / Applique Éternité » — #35 Léo (R, 800 PV)
- **ACT Chaleur divine** [CD 4, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 20 Feu » — #43 Souverain des Flammes (L, 900 PV)
- **ACT Courant aléatoire** [CD 2, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque [30 à 50] Nature / Bonus Nature (+2) » — #56 Lisa, la Dragonnière (C, 800 PV)
- **ACT Hasardo** [CD 1, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque [20 à +30] Eau » — #81 Luminaire Abyssal (É, 600 PV), #260 Le compagnon des esprits (C, 600 PV)
- **ACT Phare** [CD 4, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque [30 à 50] Lumière / Précision (-10%) » — #81 Luminaire Abyssal (É, 600 PV)
- **ACT Gobe-pierre (option 1/2)** [CD 3, cible aoeEnemy] — « Choix / Cible toutes les cartes adverses / Attaque 30 Terre » — #85 Bleu-mange-cailloux (É, 500 PV)
- **ACT Gobe-pierre (option 2/2)** [CD 3, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque [10 à 70] Terre » — #85 Bleu-mange-cailloux (É, 500 PV)
- **ACT Incandescence** [CD 4, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque 120 Feu / Bonus Feu (+2) » — #91 Ignea (L, 750 PV)
- **ACT Eau trouble** [CD 2, cible spreadEnemy] — « Attaque 25 Eau / Attaque 25 Eau / Ennemis aléatoires » — #92 Frost & Glacier (L, 500 PV)
- **ACT Fin du monde** [CD 7, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 50 Terre / Attaque 50 Nature / Attaque 50 Feu / Attaque 50 Lumière / Attaque 50 Ombre / Attaque 50 Eau » — #94 Zayd (L, 600 PV)
- **ACT Flèches célestes** [CD 2, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 3 Lumière X18 » — #96 Mélodie des Divinités (L, 550 PV)
- **ACT Incendie** [CD 1, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 5 Feu / Bonus Feu (+1) » — #97 Pyro (C, 500 PV)
- **ACT Appel de la forêt** [CD 4, cible aoeEnemy] — « Attaque toutes les cartes adverses 30 Nature / Bonus Nature (+4) » — #122 Esprit de la Faune (C, 800 PV)
- **ACT Bim-boum** [CD 2, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 20 Ombre et 20 Lumière » — #127 Spectre Canin (C, 1000 PV)
- **ACT Drain élémentaire** [CD 1, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 6 Terre / Attaque 6 Nature / Attaque 6 Feu / Attaque 6 Eau / Attaque 6 Lumière / Attaque 6 Ombre / Vampirisme » — #137 Cerf des Couleurs Funèbres (R, 600 PV)
- **ACT Remue-sol** [CD 2, cible randomEnemy] — « Cible aléatoirement une carte adverse / Attaque 40 Terre / Augmente ses PV max de 40 Terre / Bonus Terre (+2) » — #160 Sanglier Doré (C, 900 PV, **possédée**)
- **ACT Dernier plaisir** [CD 10, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 100 Terre / Attaque 100 Lumière » — #188 Commando Gerz (R, 1200 PV)
- **ACT Claque sombrevol** [CD 2, cible aoeEnemy] — « [Coût 2 Feu & 2 Ombre & 2 Nature] / Cible toutes les cartes adverses / Attaque 15 Ombre 15 Nature 15 Feu / Bonus Ombre (+3) Nature (+3) Feu (+3) » — #206 Catimimi (C, 500 PV)
- **ACT Danse des plumes** [CD 2, cible spreadField] — « Cible aléatoirement les cartes du terrain / Attaque 30 Nature / Attaque 30 Feu / Attaque 30 Ombre / Attaque 30 Lumière / Attaque 30 Eau / Attaque 30 Terre / Applique Temporalité à la carte ciblée en cas de coup critique » — #227 Chouette Polychrome (C, 500 PV, **possédée**)
- **ACT Miasmes de la Sagesse** [CD 1, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 15 Terre 15 Eau » — #229 Maître Amphibian (C, 700 PV)
- **ACT Mâche-mot** [CD 2, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 5 Ombre + 50% des PV manquants du lanceur » — #231 Aleera Mange-Cauchemars (C, 500 PV)
- **ACT Brûlure Nocturne** [CD 3, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 15 Feu et 15 Ombre » — #236 Apprentie de la Mort (R, 700 PV) — 1.21 : texte → « Cible toutes les cartes adverses / Attaque 25 Feu et 25 Ombre »
- **ACT Galop arctique** [CD 2, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 10 Eau 10 Nature » — #238 Chimère Brasse-chair (R, 525 PV, **possédée**)
- **ACT Exploison** [CD 1, cible aoeEnemy] — « Cible toutes les cartes adverses / Attaque 10 Ombre » — #244 Gazpoison Flottant (R, 450 PV)
- **ACT Éclair jaune** [CD 5, cible aoeEnemy] — « Attaque 50 Lumière à toutes les cartes adverses » — #245 Shinobi Éclairant (R, 600 PV)
- **ACT Kung‑Fu** [CD 5, cible enemy] — « Attaque 40 Terre / AoE » — #245 Shinobi Éclairant (R, 600 PV)
- **ACT Multi feuillage** [CD 3, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 5 Nature / Attaque 15 Nature / Attaque 25 Nature / Attaque 35 Nature » — #255 Verdelune (L, 900 PV)
- **ACT Constriction Éternelle** [CD 5, cible spreadEnemy] — « Cible aléatoirement les cartes adverses / Attaque 30 Terre X8 » — #256 Héraldesse Serpentine (L, 900 PV)

#### h2 — Poison (dégâts sur la durée)
_2 carte(s) distincte(s) : 0 via compétence active, 2 via passif de départ, 0 via talent — rareté : 1 common, 1 rare._

- **PAS PAS Poison (common)** — « Inflige des dégâts égaux à 1% des PV max de la cible au début de chacun de ses tours, pendant 3 tours. » — #134 Wibs l'Enflammé (C, 550 PV), #244 Gazpoison Flottant (R, 450 PV)

#### h3 — punis / nourris par nos attaques (Renvoi, Sac de frappe) ; Contrecoup
_15 carte(s) distincte(s) : 0 via compétence active, 14 via passif de départ, 1 via talent — rareté : 8 common, 1 rare, 6 epic._

- **PAS PAS Sac de frappe (common)** — « Augmente de +1 l'élément de la carte du lanceur à chaque fois que celle-ci subit une attaque » — #58 Le Transporteur Sauvage (C, 1000 PV), #72 Girafe Florale (R, 750 PV), #123 Tisseuse de Mots (C, 500 PV), #160 Sanglier Doré (C, 900 PV, **possédée**), #221 Crapaud des Étoiles (C, 900 PV), #231 Aleera Mange-Cauchemars (C, 500 PV), #247 Roi Feu (É, 1000 PV), #248 Roi Eau (É, 1000 PV), #249 Roi Nature (É, 1000 PV), #250 Roi Terre (É, 1000 PV), #251 Roi Ombre (É, 1000 PV, **possédée**), #252 Roi Lumière (É, 1000 PV) — 1.21 : texte 1.21 : « Augmente de +1 l'élément de la carte du lanceur à chaque fois que celle-ci subit une attaque adverse »
- **PAS PAS Renvoi (epic)** — « Renvoie 75% des dégâts subis à l'attaquant » — #106 L'Épine d'Amour (C, 500 PV)
- **PAS PAS Contrecoup (common)** — « Subit 50% des dégâts infligés à la cible » — #158 Lapin-Plume (C, 1000 PV, **possédée**), #221 Crapaud des Étoiles (C, 900 PV)
- **TAL Sac de frappe** — « Commence la partie avec le passif "Sac de frappe" » — #116 Prisonnière de la Machine (C, 1000 PV, **possédée**)

#### h4 — aléatoire & transformations (Anticipation, Métamorphe, Évolution, Mystère, Inversement)
_33 carte(s) distincte(s) : 0 via compétence active, 2 via passif de départ, 32 via talent — rareté : 16 common, 8 rare, 8 epic, 1 legendary._

- **PAS PAS Mystère (rare)** — « Commence la partie avec un passif aléatoire » — #226 Apprenti Évocateur (C, 800 PV), #263 Paguroniyx (C, 850 PV)
- **TAL Anticipation** — « Au début de la partie, cette carte lance toutes ses compétences. Les compétences à cible unique visent une même carte adverse aléatoire. » — #12 Hibernatus (C, 750 PV, **possédée**), #263 Paguroniyx (C, 850 PV)
- **TAL Évolution** — « Si possible, les passifs d'origine de cette carte changent de rareté selon ses PV : plus ses PV sont bas, plus ils sont rares. Paliers à 75 %, 50 % et 25 % des PV. » — #21 Félin Errant (C, 550 PV), #37 Roi des Flammes Ardentes (É, 900 PV), #44 Léviathan des Cieux (L, 1000 PV), #58 Le Transporteur Sauvage (C, 1000 PV), #63 Shado, Fléau abyssal (C, 800 PV), #69 Scorch, les Lézards Ignés (R, 350 PV, **possédée**), #71 Soigneuse Astrale des Bois (R, 600 PV), #151 Sbire des Flammes (C, 800 PV), #158 Lapin-Plume (C, 1000 PV, **possédée**), #176 Rob l'Aventurier (C, 500 PV), #221 Crapaud des Étoiles (C, 900 PV), #234 Rongeur Nuageux (C, 750 PV), #244 Gazpoison Flottant (R, 450 PV), #247 Roi Feu (É, 1000 PV), #248 Roi Eau (É, 1000 PV), #249 Roi Nature (É, 1000 PV), #250 Roi Terre (É, 1000 PV), #251 Roi Ombre (É, 1000 PV, **possédée**), #252 Roi Lumière (É, 1000 PV), #261 Godlur (C, 1000 PV)
- **TAL Inversement** — « Commence la partie avec le passif "Inversement" » — #25 Amber (R, 750 PV), #26 Blaze (R, 750 PV), #146 Poulpe Parleur (É, 500 PV), #219 Catixy (C, 600 PV)
- **TAL Virage 360** — « Applique "Métamorphe aléatoire" à toutes vos autres cartes quand celle-ci est tuée. » — #30 Naissance d'Aldrin (R, 700 PV, **possédée**), #39 Sylvan, Protecteur de la Verdure (C, 550 PV), #116 Prisonnière de la Machine (C, 1000 PV, **possédée**), #139 Cornu mythologique (R, 700 PV), #227 Chouette Polychrome (C, 500 PV, **possédée**)
- **TAL Mystère** — « Commence la partie avec le passif "Mystère" » — #36 Astry (R, 600 PV)

#### h5 — économie / chance propres
_28 carte(s) distincte(s) : 1 via compétence active, 0 via passif de départ, 28 via talent — rareté : 14 common, 2 epic, 4 legendary, 8 rare._

- **ACT Petite vague** [CD 1, cible enemy] — « Attaque 10 Eau / Augmente sa génération de Spamtons de (+1) / Echo (50%) » — #260 Le compagnon des esprits (C, 600 PV)
- **TAL Tox chanceux** — « Chaque rareté de Tox a exactement 25% de probabilité d’être obtenue. » — #17 Croqueur de Fruits Verdoyant (C, 650 PV), #22 Lueur d'Espoir (C, 900 PV), #195 Gabriel (É, 1000 PV), #204 Ephial (L, 1500 PV)
- **TAL À la caisse** — « Au début de la partie, gagnez (+25) Spamton. » — #21 Félin Errant (C, 550 PV), #67 Logidrake, l'Ignatius (R, 500 PV), #137 Cerf des Couleurs Funèbres (R, 600 PV)
- **TAL Nouveau riche** — « Commence la partie avec, au hasard, le passif Spamland ou Chanceur. » — #42 Dragonnet des Lumières (É, 500 PV)
- **TAL Pièce magique** — « Commencez la partie avec (+2) en Chance » — #42 Dragonnet des Lumières (É, 500 PV), #92 Frost & Glacier (L, 500 PV), #106 L'Épine d'Amour (C, 500 PV), #177 Moxilys, la Fredonneuse (C, 900 PV), #206 Catimimi (C, 500 PV), #238 Chimère Brasse-chair (R, 525 PV, **possédée**), #260 Le compagnon des esprits (C, 600 PV)
- **TAL Héritage** — « Bonus (+50) Spamton quand cette carte est tuée. » — #47 Veilleur Nocturne (L, 800 PV), #71 Soigneuse Astrale des Bois (R, 600 PV), #96 Mélodie des Divinités (L, 550 PV), #123 Tisseuse de Mots (C, 500 PV), #136 Souverain des Chutes d'Éther (R, 800 PV), #206 Catimimi (C, 500 PV)
- **TAL Revalorisation** — « Augmente la génération de Spamton de cette carte de (+5) » — #47 Veilleur Nocturne (L, 800 PV), #92 Frost & Glacier (L, 500 PV), #106 L'Épine d'Amour (C, 500 PV), #174 Zombie Floral (C, 1000 PV), #261 Godlur (C, 1000 PV)
- **TAL Fortune** — « Augmente la génération de Spamton de cette carte de (+2) par tour de jeu » — #64 Maître Thronebéur (C, 850 PV), #152 Le Héraut des Cendres (C, 800 PV), #180 Dragon Ciel (C, 700 PV, **possédée**)
- **TAL 13e mois** — « La première fois que vous atteignez 200 Spamton ou plus, vous recevez 100 Spamton supplémentaires. » — #78 Gardien Vert (R, 800 PV), #229 Maître Amphibian (C, 700 PV)
- **TAL Petit prix** — « Votre premier achat de Tox de la partie est remboursé. » — #140 Souris des blés (R, 500 PV), #190 Lames en peine (R, 550 PV)

#### h6 — options de choix réduites à une attaque simple (et Materia, voir mismatch M13)
_4 carte(s) distincte(s) : 4 via compétence active, 0 via passif de départ, 0 via talent — rareté : 4 common._

- **ACT Vent argenté (option 1/2)** [CD 2, cible enemy] — « Choix / Attaque 10 Lumière 10 Ombre » — #113 Lums (C, 600 PV)
- **ACT Souffle du dragon (option 1/2)** [CD 3, cible enemy] — « Choix / Attaque 30 Feu / Attaque 10 Nature / Attaque 10 Nature » — #152 Le Héraut des Cendres (C, 800 PV)
- **ACT Materia** [CD 2, cible none] — « Bonus [-8 à +10] dans chaque élément » — #153 L'Inventeur (C, 1000 PV, **possédée**) — 1.21 : texte → « Bonus [-5 à +8] dans chaque élément »
- **ACT Dualité Draconique (option 1/2)** [CD 2, cible enemy] — « Choix / Attaque [10 à 40] Feu » — #259 Dragon de la Cité Infernale (C, 550 PV, **possédée**)
- **ACT Dualité Draconique (option 2/2)** [CD 2, cible enemy] — « Attaque [10 à 40] Ombre » — #259 Dragon de la Cité Infernale (C, 550 PV, **possédée**)

#### h7 — AoE (passif de départ) — éclaboussure sur les cibles adjacentes
_3 carte(s) distincte(s) : 0 via compétence active, 3 via passif de départ, 0 via talent — rareté : 2 common, 1 rare._

- **PAS PAS AoE (common)** — « Attaque et soigne les cibles adjacentes à hauteur de 20% des dégâts infligés » — #63 Shado, Fléau abyssal (C, 800 PV), #151 Sbire des Flammes (C, 800 PV)
- **PAS PAS AoE (epic)** — « Attaque et soigne les cibles adjacentes à hauteur de 80% des dégâts infligés » — #237 Voyageur des Crêtes (R, 1000 PV)
