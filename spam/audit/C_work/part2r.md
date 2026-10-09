
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
