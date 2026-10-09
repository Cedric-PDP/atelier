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

