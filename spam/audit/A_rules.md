# Audit A : les règles complètes de SPAM, avec leurs sources

Agent A, 2026-10-09. Le but est de rassembler des faits sur les règles, pas de reprendre les verdicts du wiki.
Le rapport porte en priorité sur les règles que le moteur du wiki ne simule pas.

## 0. Quatre points qui changent le cadrage (à lire avant le reste)

1. **Le jeu est passé en v1.21 aujourd'hui (9 octobre 2026)** [PATCH]. Le wiki sert déjà le nouveau moteur
   `/_astro/simulation-KlJhEEqL.js` et le nouveau modèle `/data/model-edeb0ebc315cfd15.json` (v1.21, engineHash `36e2c03d5b7bf4a1`).
   Copies locales : `A_raw/js/simulation-KlJhEEqL.js` et `A_raw/data/model_v121.json`.
   Les fichiers `SP/spam/js/model.json` et `simulation.js` (1.20, `a8193b3d422a54a9`) sont donc **périmés**.
   - Différences du moteur entre 1.20 et 1.21 (comparaison mot à mot) :
     - Tox Gel : 40 → 60 dégâts au bris de la glace, prix 150 → 140 Spamtons.
     - Tox Reset : prix 130 → 160 Spamtons.
     - Courbe de dégâts de l'adversaire abstrait (`dpsByTurn`) : 108…253 → 113…262 (+4 %).
     - Le reste du diff n'est que du renommage de variables.
   - **6 cartes de la collection changent** (détail en annexe A1) : 30, 102, 153, 158, 180, 259.
2. **Le champ `spamton` d'une carte est son revenu par tour, pas un coût.**
   - La fiche de la carte affiche « 2 Spamtons / tour » (Tisseuse de Mots en 1.21, 3 en 1.20) [CARD].
   - [BAS] : « vous gagnez les Spamtons de vos cartes vivantes (valeur en haut à droite) ».
   - Le README écrit « spamton (cost) » : c'est faux.
3. **Le champ `rows` compte les champs déjà occupés, pas les emplacements Tox.**
   - Pour les 127 cartes, `rows` = nombre de compétences + nombre de passifs innés.
   - Chaque carte a 3 champs : les fiches affichent « Trois champs de compétence » et « Champ libre · Ouvert à un Tox de la boutique ».
   - Une carte a donc **3 − rows champs libres** : 2 pour Chouette Polychrome, 1 pour Lame de la forêt, 0 pour Chimère, Hippocampe Nimbé et L'Œil des montagnes.
4. **Aucune source indépendante sur les parties réelles n'est disponible.**
   - Les sources officielles sont bloquées par le proxy : https://spamgame.com (lien « Page officielle / Jouer au jeu ») et
     https://spamgame.com/data/README.md (lien « Source des cartes » de la page méthodologie).
   - Le wiki ne contient aucun lien vers Steam ni vers Discord.
   - L'artifact « Journal de parties SPAM » (https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL), lu en lecture seule, contient
     0 partie. Ses 20 fiches de connaissance reprennent le wiki, sauf 3 (préférence de l'utilisateur, absence de données
     publiques, résumé du patch 1.21). Aucune ne vient d'une partie observée.
   - **La seule observation réelle disponible est le match contre AZURIAN décrit dans le README.**

## Sources et légende

| Code | Source | Nature |
|---|---|---|
| [BAS] | https://spamgame-wiki.com/fr/basics/ (et /en/basics/) | 18 règles « Fondamentaux » écrites par l'auteur du wiki, « déduites des mécaniques du jeu et des données officielles » |
| [TOX] | https://spamgame-wiki.com/fr/tox/ (et /en/tox/) | Textes officiels des 102 Tox (101 en boutique + Contrecoup) et table des raretés par tour |
| [PATCH] | https://spamgame-wiki.com/fr/patch/ | Notes de patch 1.21 (9 oct.) et 1.20 (7 oct.) |
| [METH] | https://spamgame-wiki.com/fr/methodology/ | Hypothèses du moteur |
| [CARD] | https://spamgame-wiki.com/fr/cards/&lt;slug&gt;/ (127 FR + 127 EN, v1.21) | Textes officiels des compétences, Tox de départ et talents |
| [MODEL] | modèle v1.21 (`A_raw/data/model_v121.json`) | Mêmes textes officiels, sous forme structurée |
| [CONST] | bloc `e={cardsPerDeck:4,…}` en tête du moteur | Constantes issues des fichiers du jeu (inchangées entre 1.20 et 1.21) |
| [ENG] | comportement du moteur du wiki | Interprétation de l'auteur du wiki, **pas une règle officielle** |
| [DECK] | https://spamgame-wiki.com/fr/decks/44-136-188-231/ | Exemple de fiche de deck (plan de jeu, boutique) |
| [COLL] | https://spamgame-wiki.com/fr/collection/ | Page « Ma collection » |
| [OBS] | README, match contre AZURIAN | Observation en partie réelle |

Autres pages lues : `/fr/strategies/` et ses 6 guides, `/fr/tiers/`, `/fr/builder/`, et l'index de recherche
`/data/search-edeb0ebc315cfd15-fr.json` (548 entrées). Le sitemap est `/sitemap.xml` (659 URL).
Il n'existe aucune page Talents, Glossaire, FAQ ou Modes : `/fr/talents/`, `/fr/glossaire/`, `/fr/faq/` et `/fr/modes/` renvoient 404.

Légende : **FAIT** = texte officiel, constante du jeu ou observation. **INF** = inférence.
Confiance : **H** (haute), **M** (moyenne), **B** (basse).

---

## Q1 — Phase de ban (`bansPerPlayer:1`)

- **FAIT (H)** La constante `bansPerPlayer:1` est dans le bloc de constantes du jeu [CONST].
- **FAIT (H)** Le wiki n'en parle nulle part. Recherche de « ban / bann / interdi » sur 29 pages, l'index de recherche (548 entrées) et les 254 fiches : les seules occurrences sont dans le lore (Fleur de Vie, Fleurmarine, Neilla, Raffteru).
- **FAIT (H)** Le moteur ne lit jamais cette constante (0 référence) [ENG].
- **INF (M)** Chaque joueur fait 1 bannissement par match.
- **INCONNU** :
  - ce qui est banni : une carte du deck adverse, une carte du catalogue, ou autre chose ;
  - le moment : avant ou après la révélation des decks ;
  - si la carte bannie est remplacée, ou si la victime joue à 3 cartes ;
  - les modes concernés (le schéma du journal prévoit « classé / normal / défi », sans preuve).
- **Pourquoi c'est décisif** : si l'adversaire peut bannir une carte de notre deck, il retire la plus porteuse.
  - Le score réaliste d'un deck devient alors sa métrique « carte perdue au tour 1 », pas sa moyenne.
  - Exemple : deck chimere passe de 8 018 à 1 920 sans Chimère, soit −76 % (README, chiffres 1.20).
  - Les decks au pire cas élevé prennent alors l'avantage : [3,103,117,238] (pire cas 3 672) et [69,160,227,238] (pire cas 3 818).

## Q2 — Structure du tour

- **FAIT (H) Les joueurs jouent l'un après l'autre, pas en simultané.** Textes officiels :
  - Gel : « jusqu'à la fin du prochain tour adverse » ;
  - Bouclier : « Le premier coup reçu à chaque tour adverse » ;
  - Provocation (Tox) : « toutes les attaques ennemies du prochain tour » ;
  - Cœur résistance : « Au début de chacun de vos tours » [TOX].
- **FAIT (M-H) Il y a un premier et un second joueur.** [BAS] : « Le premier joueur commence avec toutes ses recharges réduites de 1, le second de 2 ».
  - Le moteur joue chaque deck dans les deux positions.
  - Sur la fiche du deck n°1 du wiki : « En premier −3,9 % · En second +3,9 % » [DECK]. Jouer second n'y est pas un handicap.
- **INCONNU** : comment le premier joueur est désigné (B : au hasard).
- **Compétences par tour — INF (M)** : chaque compétence prête peut être lancée une fois par tour. Une même carte peut en lancer plusieurs, dans l'ordre choisi par le joueur. Indices :
  - [BAS] « Ordre d'activation : lancez d'abord les compétences qui donnent des bonus (Flambée…) puis les attaques ». Flambée et Souffle de feu sont deux compétences de la même carte, toutes deux à recharge 1.
  - [BAS] « Finissez une carte adverse basse avant de lancer vos autres attaques : tout s'enchaîne dans le même tour ».
  - Reset : « celle-ci reste disponible ». Vengeur : « récupère toutes ses attaques ». Une attaque utilisée reste donc indisponible jusqu'à sa recharge.
  - Le moteur a une option `oneActionPerCardPerTurn`, réglée sur `false`. Son plan de jeu fait lancer 3 compétences à Souverain des Chutes d'Éther dès le tour 1 [DECK].
- **Chronomètre** :
  - FAIT (H) : `turnDurationPerCardAlive:15`.
  - INF (M-B) : un tour dure 15 s par carte vivante (60 s avec 4 cartes, 15 s avec 1).
  - Le moteur ne s'en sert pas.
- **« Passer »** :
  - FAIT (H) : `moneyForSkip:10`, `luckForSkip:0`, `skipPerCardAlive:[10,10,10,10]`.
  - INF (M) : moneyForSkip correspond aux 10 Spamtons gagnés en passant une ouverture de boutique ([BAS] « passer en rapporte dix »). luckForSkip = 0 : passer ne rapporte pas de Chance.
  - `skipPerCardAlive` : **inconnu**. Hypothèse (B) : un gain ou un temps lié au passage du tour selon le nombre de cartes vivantes (10 dans les 4 cas).
- **Début de tour (FAIT H, textes)** : Poison, Soin primitif, Cœur résistance (C/R), Focus, Sursaut Vital et Revitalisation se déclenchent « au début du tour ». Longueur et Réducteur se déclenchent au début du **premier** tour. Les revenus et le +1 de Chance aussi tombent en début de tour ([BAS], [ENG]).

## Q3 — Ciblage

Les codes de cible viennent du modèle du wiki. Les phrases citées sont le texte officiel de la compétence [MODEL].

| Code | Texte officiel | Sens | Conf. | Cartes |
|---|---|---|---|---|
| `enemy` | aucune mention de ciblage | **le lanceur choisit** une carte adverse ; la Provocation le contraint ([OBS] : nos attaques à cible unique ont été forcées sur Fleur de Vie) | M-H | 76 |
| `randomEnemy` | « Cible aléatoirement une carte adverse » | une carte adverse au hasard | H | 6 |
| `spreadEnemy` | « Cible aléatoirement les cartes adverses » / « Ennemis aléatoires » | chaque coup tombe sur une carte adverse au hasard (ex. Mélodie des Divinités « Attaque 3 Lumière X18 ») | M | 9 |
| `aoeEnemy` | « Cible toutes les cartes adverses » | toutes les cartes adverses | H | 18 |
| `ally` / `allAllies` / `randomAlly` / `self` | « Cible toutes les cartes alliées », « aléatoirement… alliée », « au lanceur » | allié choisi, tous les alliés, allié au hasard, le lanceur | M-H | 10 / 12 / 4 / 5 |
| `field` | Lums, Envol : « Cible toutes les cartes du terrain » | les deux camps, donc le +1 de dégâts critiques profite aussi à l'adversaire | M | 1 |
| `spreadField` | Chouette Polychrome, Danse des plumes : « Cible aléatoirement les cartes du terrain » | chacun des 6 coups touche une carte au hasard dans les **deux** camps. Le texte distingue « terrain » de « terrain allié » (Fumée) | M | 1 (possédée) |
| `none` | génération, buffs sur soi… mais aussi des effets ciblés sans code : Veuve noire, Avalement, Corne 25/75 (« La cible se retrouve… »), Ralentissement (« Applique Éternité »), Silenfeu (« Applique Gel ») | cible choisie par le lanceur | M-B | 47 |

- **Provocation et ciblage** :
  - [BAS] : « La provocation force les ciblages adverses, pas les vôtres ».
  - Le Tox dit : « toutes les attaques ennemies du prochain tour doivent le cibler ».
  - [OBS] : nos attaques à cible unique sont forcées vers le provocateur.
  - **INCONNU** : l'effet sur les attaques aléatoires, réparties ou de zone, et le cas de deux provocateurs.
  - Veuve noire n'est pas une attaque. Elle a pris Chimère alors que Fleur de Vie provoquait [OBS]. INF (M) : la Provocation ne restreint pas l'absorption.
- **Adjacence (FAIT H, texte)** : le Tox AoE touche « les cibles adjacentes ». L'ordre des cartes sur le plateau compte donc. INCONNU : le joueur choisit-il les positions ?

## Q4 — Recharges et champs d'une compétence

- **Recharge** :
  - [BAS] (M-H) : « recharge n = utilisable tous les n tours ». Au départ, le premier joueur a toutes ses recharges réduites de 1, le second de 2.
  - [ENG] : premier tour d'utilisation = max(1, cd) en premier joueur, max(1, cd − 1) en second ; ensuite tour d'usage + cd. C'est cohérent avec l'exemple du wiki (recharge 2 prête au tour 1 en second).
  - **Une compétence à recharge 8 n'est pas jouable au tour 1.** Elle l'est au tour 8 en premier joueur, au tour 7 en second, puis aux tours 16 ou 15.
  - Veuve noire « vers le tour 7 » [OBS] colle avec une Tisseuse jouée en second.
  - Répartition des 203 compétences du jeu : recharge 1 : 68, 2 : 39, 3 : 38, 4 : 21, 5 : 24, 6 : 3, 7 : 2, 8 : 3, 9 : 3, 10 : 2 [MODEL].
- **Ce qui modifie les recharges** :
  - Éternité : +1 à toutes les recharges de la cible. Temporalité : −1 [TOX].
  - Gardien Vert, Rayonnement : « Les temps de recharge des compétences sont remis au maximum ».
  - Vengeur et Reset (Q8) ; Éternisé rend insensible à Éternité.
  - [BAS] parle aussi d'une « Purge », mais **aucune carte ne l'a dans les données 1.21**.
- **`uses`** : « [Usage Limité 1/1] » = une fois par match (H). Exemples : Valse des nuages, Cocon, Chenille, Papillon.
- **`echo`** :
  - Texte « Echo (50 %) » sur 5 compétences, dont Hydrochance de Baleine Farceuse (possédée). Le talent Roulette donne Écho 10 % à toutes les compétences.
  - INF (M) : X % de chances que la compétence se relance.
  - [ENG] (B) : le moteur enchaîne les relances, avec +5 points à chaque échec, 4 lancers au plus et un plafond de 90 %.
- **`duration`** :
  - Valeur 2 sur la plupart des compétences de Provocation, Gel et Éternité. Valeur 4 sur Fort (« Provocation pendant 2 tours »). Valeur 0 sur Barrière Florale, dont l'effet de Provocation dure 2.
  - INF (B) : durée comptée en demi-tours ; 2 = jusqu'à la fin du prochain tour adverse.
- **`cost`** :
  - « [Coût N Élément] » retire N points de bonus de cet élément au lancer (H).
  - [BAS] (M) : « un bonus passé sous zéro ne réduit pas vos dégâts », donc le bonus peut devenir négatif.
  - [ENG] : le moteur refuse de lancer si le bonus est inférieur au coût. C'est une hypothèse du moteur.
- **`costHp`** : « [Coût 100 PV] » sur Explosion de Prisonnière de la Machine (possédée) (H). La carte peut-elle se tuer elle-même ? Inconnu. Le moteur ne lance pas si la carte doit finir sous 20 % de ses PV.
- **`choice`** : 13 compétences « Choix … ou … ». Le lanceur choisit une option à chaque lancer (H). Exemples possédés : Dualité Draconique, Choix sombre.
- **`prec` / `crit` / `critMult`** (FAIT H, données) :
  - précision propre à chaque compétence, presque partout 100 % ;
  - chance de critique de 0 à 50 % ;
  - multiplicateur de critique de ×2 à ×6 (Pinces de Lame de la forêt : ×6).
  - INF (M) : sous 100 % de précision, une attaque peut rater.

## Q5 — Prolongation après le tour 20

- **FAIT (H)** Constantes `turnAfterOvertime:20`, `overtimeReducingRatio:.1`, `overtimeScalingRatio:.5` [CONST].
- **FAIT (H)** Le wiki n'en dit rien. Le moteur ne les lit pas et arrête la simulation au tour 10 [METH].
- **INF (B)** À partir du tour 20, un mode anti-blocage réduit quelque chose de 10 % (les soins ? les PV max ?) et en augmente une autre de 50 % (les dégâts ?), peut-être à chaque tour. **Le détail est inconnu.**
- Conséquence certaine : tout ce qui se passe entre les tours 11 et 20 et au-delà est hors du modèle (voir la section « Règles non modélisées »).

## Q6 — Économie

- **Revenus** :
  - [BAS], [ENG] (M-H) : à chaque tour, somme des « Spamtons / tour » des cartes vivantes + numéro du tour.
  - Vérification sur une fiche de deck : un deck à 19/tour affiche 41 Spamtons au tour 2, soit 2 × 19 + 1 + 2 [DECK].
  - Revenu par carte : de 1 à 15, médiane 7 [MODEL].
  - INF (M) : départ à 0 Spamton. Le talent À la caisse donne +25 ; le talent Dette met **les deux joueurs** à −20.
- **Prime de mort (`deathBounty:50`)** :
  - FAIT (H) : la valeur est 50.
  - **C'est le joueur qui PERD la carte qui touche les 50** (M-H) : [BAS] « chaque carte perdue en rend cinquante » ; dans le moteur, la fonction de mort crédite le camp de la carte morte.
  - Le talent Héritage ajoute +50.
  - **Chaque carte que nous tuons fait donc gagner 50 Spamtons à l'adversaire** : c'est une prime de rattrapage.
- **Boutique** (M-H, [BAS], [CONST] `itemShopMax:3`, `rerollCost:10`) :
  - ouverte aux tours pairs (2, 4, 6…) ;
  - 3 Tox proposés ;
  - fermeture après 1 achat ;
  - relance à 10 Spamtons, puis +5 à chaque relance (le +5 vient de [BAS] et de [ENG], pas d'une constante) ;
  - passer rapporte 10 ;
  - le talent Petit prix rembourse le premier achat.
- **Chance** :
  - FAIT (H) : `startLuck:0`, `luckPerTurn:1`.
  - Pièce magique : +2 au départ. Chanceur : +0,5 / +1 / +2 / +4 par tour. Tox chanceux : chaque rareté à 25 %.
  - Rareté de chaque offre selon la Chance : ce sont des courbes Unity tirées des fichiers du jeu [CONST], table publiée sur [TOX] (commun / rare / épique / légendaire, en %) :

| Chance | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 | 30 | ≥ 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C/R/E/L | 100/0/0/0 | 80/20/0/0 | 50/45/5/0 | 27/53/20/0 | 10/50/40/0 | 4,5/41,6/52,8/1,1 | 0/35/60/5 | 0/28/59/13 | 0/21/55/25 | 0/15/50/35 | 0/0/30/70 | légendaire 100 |

- **Catalogue et prix (v1.21)** :
  - 101 Tox en boutique : 22 communs, 29 rares, 27 épiques, 23 légendaires.
  - Prix en Spamtons, par exemple :
    - Brut 65 ; Provocation 70 ; Immunité 90 ;
    - Gel 140 ; Reset 160 ; Disparition 180 ; Temporalité 190 ; Éternité 220 ;
    - Phénix 100 / 150 / 200 / 250 ;
    - Spamland 6 / 10 / 16 / 24 ;
    - Berserk 30 / 60 / 100 / 180.
  - Hors boutique : Contrecoup C/R, Étourdissement (Stun_L, 200), Voleur (StealTox, 70), Découverte (100), Métamorphe aléatoire, plus les passifs réservés aux talents (`A_work/engine_tox_v121.txt`).
- **Champs** :
  - 3 par carte, compétences et Tox confondus (H, fiches).
  - Un Tox se pose sur un champ libre ou **remplace une compétence ou un passif sacrifié** ([BAS], M-H).
  - Un champ déjà occupé par un Tox peut être remplacé (atelier : « An occupied slot is replaced »), M.
- **Retrait** : Disparition supprime le dernier passif, souvent le dernier Tox acheté ([BAS], [TOX]). Le talent Inscrit en protège.
- **L'adversaire voit-il nos Tox ?** Inconnu.

## Q7 — Talents

- **FAIT (H)** Chaque carte a « Trois talents déblocables · un seul actif » [CARD].
- **FAIT (M-H)** Les talents se débloquent avec les **doublons** :
  - infobulle : « Lecture pour un joueur sans doublon : aucun talent n'est actif » ;
  - [COLL] : « les talents que tu as débloqués ».
  - INF (M) : chaque talent se débloque séparément.
- **`talentDraftSeconds:30`** (FAIT H constante) :
  - INF (M-B) : avant le match, une phase de 30 s sert à choisir le talent actif de chaque carte.
  - [METH] : « Un talent actif par carte, choisi avant le match ».
  - Voit-on le deck adverse avant de choisir ? Inconnu.
- **Ce que l'adversaire peut avoir** : pour chaque carte adverse, un de ses 3 talents (80 talents distincts, listés dans `A_work/talents_unique.txt` et `A_work/threats_v121.txt`). Talents qui **agissent sur nous**, avec le nombre de cartes qui les portent :

  | Talent | Cartes | Effet |
  |---|---|---|
  | Focus | 12 (Régent des Abysses, les 6 Rois, Aidan, Ephial…) | 25 % de chances par tour de gagner Provocation |
  | Longueur | 11 | Éternité sur une de nos cartes au hasard au début du premier tour adverse |
  | Imprécision | 2 | −20 % de précision |
  | Erreur Croissante | 6 | −3 % de précision par attaque |
  | Affaiblissement | 5 | −1 % de résistances par tour sur toutes nos cartes |
  | Corrosion | 6, dont Tisseuse | −1 % de résistances pour l'attaquant à chaque coup qu'il porte |
  | Racket | 2 | −5 Spamtons pour nous à chaque coup qui inflige des dégâts |
  | Dette | 2 | −20 Spamtons au départ pour les deux joueurs |
  | Anticipation | 2 (Hibernatus, Paguroniyx) | lance toutes ses compétences au début de la partie |
  | Contre | 5 | sous 25 % de PV, riposte une fois avec toutes ses compétences |
  | Heure Funeste | 4 | Éternité sur toutes nos cartes à sa mort |
  | Vitalité des Âmes | 11 | +300 PV et PV max à chaque mort sur le terrain |
  | Reset ultime | 13 | PV au maximum quand elle tue |

  Autres talents de survie ou d'escalade :
  - Life-8 (5 cartes), Immunité-8 (2), Bombe-8 (2) ;
  - Sursaut Vital (3), Chance Vitale (3), Imprudent (+500 PV, 8 cartes) ;
  - Transition (7), Virage 360 (5) ;
  - Inscrit (5), Éternisé (7), Brut (5).

  Les talents « -8 » ne font rien avant le tour 8 [BAS].

## Q8 — Les mécaniques une par une

Pour chaque mécanique : texte officiel (H), puis les précisions avec leur confiance. Entre crochets, ce qu'en fait le moteur [ENG].

- **Gel** : « Les dégâts et les soins de cette carte gèlent leur cible : elle ne peut pas agir jusqu'à la fin du prochain tour adverse. Un autre dégât, un soin ou un nouveau Tox brise la glace et lui inflige **60** dégâts » (40 en 1.20) [TOX], [PATCH].
  - `frozenOwnerTurns:1` [CONST] : la carte gelée perd un de ses tours.
  - Porteurs :
    - Gel comme compétence : 7 cartes (Artisan des Heures, Princesse Meridia, Éclat du Renard Blanc, Guerrier des Neiges, Ignea, Esprit de la Faune, Dragosaure Céleste) ;
    - Gel comme passif : Frost & Glacier, Dragon de la Cité Infernale (possédée).
  - INCONNU : les Gel des compétences brisent-ils aussi à 60 ? La recharge d'une carte gelée continue-t-elle de descendre ?
  - Soin soleil (Esprit de la Faune) gèle **l'allié soigné**.
  - INF (M) : acheter un Tox pour une alliée gelée la dégèle, au prix de 60 dégâts.
  - [ENG : crédit forfaitaire de 70 points de contrôle par cible, sans effet sur l'adversaire abstrait.]
- **Étourdissement** : supprimé des cartes en 1.20 et remplacé par Gel [PATCH]. Le Tox Stun_L (légendaire, 200) existe encore dans les fichiers, mais dans aucune boutique. « Une carte étourdie ne lance rien » [BAS].
- **Provocation** :
  - Sur une compétence (« Applique Provocation », durée 2) : 8 cartes, dont 6 communes. Hibernatus et Prisonnière de la Machine (possédées), Le Transporteur Sauvage, Neilla, Fleur de Vie, Yotaru Gardefeuille ; plus Girafe Florale et Zayd.
  - Sur un passif, le Tox Provocation : « Lorsque ce personnage lance une attaque, toutes les attaques ennemies du prochain tour doivent le cibler » (Rongeur Nuageux, ou en boutique : rare, 70).
  - Talent Focus (25 % par tour).
  - Barrière Florale (Fleur de Vie, recharge 1, sur le lanceur) donne une **Provocation permanente** [OBS].
  - Contre-mesures : Brut et « Brise une Provocation » (Yotaru).
  - [ENG : seule NOTRE provocation est simulée, elle détourne les coups abstraits ; l'adversaire ne provoque jamais.]
- **Brut** : « Ignore les résistances et les provocations. Détruit les provocations ennemies si ciblé ».
  - Inné sur **Hippocampe Nimbé (possédée)**. C'est son **dernier** passif : Disparition l'enlève en premier.
  - Aussi en Tox rare (65) et en talent (5 cartes).
  - Les « dégâts bruts » (Bomba) ignorent les résistances (INF M).
  - [ENG : seul le contournement des résistances est simulé ; contourner une provocation ne vaut rien face à l'adversaire abstrait.]
- **Renvoi** : « Renvoie X % des dégâts subis à l'attaquant », X = 25, 50, 75 ou 100. Inné sur L'Épine d'Amour (75 %).
  - INF (M) : s'applique à chaque coup reçu, y compris en zone et en multi-coups.
  - [ENG : non simulé contre nous.]
- **Immunité** : « La carte est immunisée contre tous les effets des cartes adverses ».
  - Porteurs : Codex des Maux Ancestraux, Codex des Sorts Lumineux, Voyageur des Crêtes, Le compagnon des esprits ; Tox épique (90) ; talent Immunité-8.
  - INF (M) : bloque Gel, Éternité, Disparition et les baisses de précision ou de résistance. Les dégâts passent. Pour l'absorption : inconnu (B : bloquée).
- **Disparition** : « Supprime le dernier passif de la cible ». Le dernier passif est souvent le dernier Tox acheté [BAS]. Inscrit en protège.
  - En 1.21, **Zombie Floral** (commune, classée S, passée de B à S, +60 places) applique Disparition à **toutes** nos cartes à recharge 8.
  - En passif sur Lisa, Aidan et Souris des blés : chaque coup qu'elles portent retire un passif.
  - Tox légendaire (180).
  - [ENG : +40 de contrôle forfaitaire, et nos passifs ne sont jamais retirés.]
- **Fumée** : « Enfume le terrain allié après l'utilisation d'une attaque ou d'un soin ».
  - Porteurs : Poulpe Parleur, Le Héraut des Cendres, Ameru, **Vivy (possédée)** ; Godlur par sa compétence ; Tox rare (50).
  - **L'effet réel est INCONNU.** Une définition existe dans le glossaire officiel (tag « Glossaire officiel » sur [TOX]), mais il est inaccessible.
  - [ENG : +10 de défense forfaitaire.]
- **Éternité** : « Augmente les temps de recharge de 1 ».
  - Sur une compétence : 7 cartes.
  - Appliquée à chaque coup : Nakyel (possédée), Héraldesse Serpentine.
  - Tox légendaire (220), talents Longueur et Heure Funeste. Éternisé en protège.
  - [BAS] : « allonge d'un tour toutes les recharges de la cible ».
- **Temporalité** : « Diminue les temps de recharge de 1 ».
  - Porteurs : Dragonnet des Lumières ; Veilleur Nocturne (×3 sur toute l'équipe, recharge 9) ; Chouette Polychrome (sur coup critique, **sur la carte touchée, alliée ou adverse**) ; Neilla et Verdelune en passif ; Tox légendaire (190) ; talents Réducteur et Dernier souffle.
- **Mimétisme** : « Chaque fois que l'adversaire génère un ou plusieurs éléments, vous en générez 1 du même type ».
  - Porteurs : Léo, Wyrm des Dunes Cornu, **Chimère (possédée)**.
  - Sa valeur dépend entièrement du deck adverse [ENG : 1,5 point forfaitaire par tour].
- **Résurrection** (Ashtarae Lycaria) : « Ressuscite le dernier allié détruit avec la moitié de ses PV max », recharge 8, coûte 5 Ombre depuis la 1.21.
- **Phénix** : « Lorsqu'elle est détruite, cette carte revient à la vie avec 25 / 50 / 75 / 100 % de ses PV max. Usage unique ». Le talent Plume de Phénix donne 50 % de chances de le récupérer.
- **Cimetière** : « Augmente tous vos bonus élémentaires de (+3/+5/+8/+12) lorsqu'une carte meurt ».
  - INF (M) : n'importe quelle carte du terrain, alliée ou adverse.
  - **Naissance d'Aldrin (possédée) l'a depuis la 1.21** (rare, +5), à la place de Reset.
- **Vengeur** : « Cette carte récupère toutes ses attaques chaque fois qu'une carte qu'elle n'a pas tuée meurt ». Porteurs : **Dragon Ciel (possédée)**, Apprentie de la Mort.
- **Revanche** : « Une fois détruite, cette carte inflige l'entièreté de ses attaques à l'adversaire ». Porteur : Zayd. La cible est inconnue.
- **Métamorphe** :
  - Tox épique (120) : « Choisissez une carte parmi trois de la même rareté pour remplacer cette carte ».
  - « Métamorphe aléatoire » : transforme la carte en une carte au hasard de même rareté. On le trouve sur les talents Imprudent (immédiat, +500 PV), Transition (à la mort définitive, la carte revient métamorphosée) et Virage 360 (à sa mort, toutes nos autres cartes se métamorphosent).
  - Virage 360 correspond à `metamorphOthersOnDeath` dans le moteur, qui suppose les cartes transformées remises à pleine vie (hypothèse).
- **Bomba** : « Inflige 500 dégâts bruts à une carte adverse aléatoire quand cette carte meurt ». Tox épique (130), talent Bombe-8 (Hibernatus, Guerrier des Neiges).
- **Inversement** : « Les dégâts de cette carte deviennent des soins, ses Éternités des Temporalités, et inversement ». Tox rare (40), talent sur 4 cartes.
- **Optimisation** : « Les valeurs variables des dégâts, des soins et des bonus de cette carte sont toujours au maximum ». Tox rare (40).
- **Spamland** : « Génère (+3 / +8 / +24 / +48) Spamtons chaque tour ».
- **Bouclier** : « Le premier coup reçu à chaque tour adverse est réduit de 25 / 50 / 75 / 100 % ».
- **Autres textes utiles** :
  - Ténacité : la première attaque fatale laisse la carte à 1 PV.
  - Poison : 1 / 3 / 6 / 8 % des PV max de la cible au début de chacun de **ses** tours, pendant 3 tours.
  - Érosion : retire 50 ou 100 % des dégâts infligés aux PV **max** de la cible.
  - Vampirisme : rend au lanceur 25 à 100 % des dégâts infligés ; la compétence « Vampirisme » ne donne pas de pourcentage, le moteur prend 50 %.
  - Contrecoup : la carte subit 50 % des dégâts qu'elle inflige (Lapin-Plume).
  - Sac de frappe : +1 à +4 dans l'élément de la carte à chaque attaque reçue.
  - **Cœur résistance C/R** : le texte 1.21 dit « **Au début de chacun de vos tours** … (+3/+6) », donc un cumul à chaque tour. Le moteur ne l'applique qu'une fois. Cela concerne Lapin-Plume (possédée).
  - AoE : touche les cartes adjacentes à 20 / 40 / 80 / 100 %.
  - Multiplicateur : bonus élémentaires doublés pour cette carte.
  - Berserk : +12 / 25 / 50 / 100 % de dégâts et de soins pour toutes nos cartes.
  - Mystère : un passif au hasard en début de partie.

## Q9 — Absorption

- **Veuve noire** (Tisseuse de Mots, n°123, **commune** — 66 des 127 cartes sont communes) : « Absorbe une carte » (EN « Absorbs a card »).
  - Recharge 8, précision 100 %, critique 0 %. Le modèle ne code pas de cible (`none`) et le texte ne dit pas « aléatoire » : **INF (M) le lanceur choisit**.
  - Le texte dit « une carte », celui du Régent « une carte alliée » : INF (M) Veuve noire peut prendre une carte adverse (c'est ce qui a été observé) et probablement aussi une alliée.
  - Disponible au **tour 8 si la Tisseuse est jouée en premier, au tour 7 si elle est jouée en second**, puis tous les 8 tours (Q4).
  - Fiche v1.21 : 500 PV, 2 Spamtons/tour. Résistances : **Eau −21 %**, Lumière +35 %, autres de 6 à 9 %.
  - Talents possibles : Héritage, Sursaut Vital, Corrosion.
- **Ce qui a été observé [OBS, H pour ce seul cas]** :
  - Chimère (525 PV imprimés) a **disparu**.
  - Les PV max de la Tisseuse sont passés de 500 à **1 025**, soit **+525 = 100 % des PV max imprimés de Chimère**.
  - On ne peut pas trancher entre PV actuels et PV max : il faudrait savoir si Chimère était blessée à ce moment.
- **Le moteur sous-estime l'absorption [ENG]** :
  - Il la compte comme 700 dégâts sur une carte adverse et +350 PV max pour la Tisseuse (50 % de 700).
  - Or l'observation montre une carte retirée quels que soient ses PV, et un gain de 100 % des PV absorbés, soit deux fois plus que le moteur.
  - Le moteur ne simule jamais la perte de **notre** carte.
- **INCONNU** :
  1. L'absorption compte-t-elle comme une mort ? Cela décide de beaucoup de choses : +50 pour nous, Cimetière, Vengeur, Vitalité des Âmes, One man army, Phénix, Résurrection, Revanche, Bomba, Héritage, Transition.
  2. La Tisseuse récupère-t-elle les compétences ou passifs absorbés ?
  3. Immunité ou Ténacité bloquent-elles l'absorption ?
- **Contre-mesures disponibles dans la collection** (faits de règles, efficacité non chiffrée) :
  - **Tuer la Tisseuse avant son tour 7 ou 8** : 500 PV, faible à l'Eau (×1,21).
  - **La retarder** :
    - Nakyel (possédée) : Éternité à chaque coup, compétence à recharge 2. INF (B) : en la frappant tous les 2 tours, l'échéance de 8 tours passerait à environ 16, si l'Éternité s'applique à une recharge en cours.
    - Dragon de la Cité Infernale (possédée) : chacun de ses coups gèle. Il faut la geler le tour où Veuve noire devient prête, puis ne plus la toucher, sinon la glace se brise.
  - Cible probable : le **porteur clé** du deck (Chimère dans deck chimere).
- **Avalement** (Régent des Abysses, n°86, épique, 1 000 PV) : « Absorbe une carte alliée », recharge 5. Le Régent mange une carte de **son propre camp**.
  - Le moteur l'ignore (il ne lance jamais `absorbAlly`).
  - INF (B) : sert à priver l'adversaire d'une mise à mort, de sa prime ou d'un Cimetière, et à gonfler les PV du Régent. Non vérifié.
  - Talents possibles : Focus, Résilience, One man army.

## Q10 — Victoire, durée, égalité

- **INF (M)** Un camp perd quand ses 4 cartes sont mortes ou retirées. Le moteur « s'arrête après l'élimination des quatre cartes adverses » [METH]. Aucun texte officiel n'est disponible.
- Des cartes peuvent revenir (Phénix, Résurrection, Transition) ou survivre à un coup fatal (Ténacité ; Sursaut Vital, qui soigne entièrement en début de tour sous 10 % de PV).
- **Nombre de tours maximum** : aucun plafond connu. La prolongation commence au tour 20 [CONST] (Q5).
- **Égalité** : inconnu. Elle pourrait arriver si les dernières cartes des deux camps meurent en même temps (Renvoi, Revanche, Bomba, Contrecoup).

## Q11 — Ce qu'une simulation de 10 tours contre un adversaire abstrait ne peut pas voir

L'adversaire du moteur se résume à `{cards:4, cardHp:700, resist:.1, dpsByTurn:[113…262] (1.21), aoeShare:.21}`, sans compétences, sans Tox, sans talents, sans économie, sur 10 tours [ENG].
Tout ce que les cartes adverses **font** en dehors d'infliger des dégâts est donc invisible. La liste détaillée suit.

---

## Règles non modélisées par le moteur du wiki

Classées par impact estimé sur le choix du deck. Chaque ligne donne la règle, puis pourquoi elle compte.

1. **Ban d'une carte par joueur (`bansPerPlayer:1`)** → si l'adversaire peut bannir chez nous, le score attendu face à un bon joueur devient la métrique « carte perdue ». Il faut choisir le deck sur son **pire cas**, pas sur sa moyenne. Le mécanisme exact reste à vérifier (question 1).
2. **Absorption** (Veuve noire : commune, prête au tour 7 ou 8 ; Avalement) → une de nos cartes disparaît en milieu de partie et l'adversaire gagne ses PV (+525 observés). Un deck qui repose sur **une** carte (deck chimere : −76 % sans Chimère) est le plus exposé. Le moteur ne voit que l'absorption que nous lançons, et il la sous-estime.
3. **Provocation adverse** (8 cartes à compétence de Provocation dont 6 communes ; Barrière Florale à recharge 1 = permanente ; Focus sur 12 cartes ; Tox à 70) → nos attaques à cible unique sont détournées vers un provocateur à gros PV ou soigné. **Dans deck chimere, la seule attaque à cible unique est Pinces (Lame de la forêt, critique ×6), c'est-à-dire le moteur à critiques du deck** ; Galop arctique (zone) n'est pas concerné. Antidotes possédés :
   - Brut (Hippocampe Nimbé) ;
   - les attaques de zone : Galop arctique, Appel de la forêt (Dragon Ciel, de zone depuis la 1.21) ;
   - l'effet des attaques aléatoires (Sanglier Doré) est inconnu.
4. **Disparition adverse** (Zombie Floral en 1.21 : toutes nos cartes tous les 8 tours ; Lisa, Aidan et Souris des blés à chaque coup) → les decks dont la valeur tient aux passifs innés les perdent, le dernier d'abord. Ordre de perte pour nos cartes :
   - Chimère : Mimétisme puis Vampirisme ;
   - Hippocampe : **Brut** puis Reset ;
   - Naissance d'Aldrin : Cimetière puis Phénix ;
   - L'Œil des montagnes : Cœur d'eau puis Berserk ;
   - Lapin-Plume : Contrecoup puis Cœur résistance ;
   - Murmures du Corail Noir : Multiplicateur.
5. **Gel, Éternité, remise des recharges, mise à 25 % de PV, Spamtons à 0 chez l'adversaire** → décalent ou annulent nos grosses compétences et notre économie :
   - Gel : 7 compétences, 2 passifs, Tox ;
   - Éternité : 7 compétences, 2 passifs, Longueur sur 11 cartes ;
   - Rayonnement (Gardien Vert) : recharges remises au maximum ;
   - Corne 25 (Cornu mythologique) : une carte ramenée à 25 % de ses PV ;
   - Jugement divin (Mélodie des Divinités) : nos Spamtons tombent à 0.

   Le moteur ne retarde jamais nos compétences. Un deck qui dépend d'une compétence à recharge 4 ou 5 perd des tours entiers.
6. **Pertes de précision et de résistances imposées par l'adversaire** :
   - Phare (Luminaire Abyssal) : −10 % de précision en zone ;
   - Imprécision : −20 % ; Erreur Croissante : −3 % par attaque ;
   - Affaiblissement : −1 % par tour ; Corrosion : −1 % de résistances à chaque coup que nous portons.

   Ce sont des ratés et des dégâts subis en plus, absents du modèle.
7. **Survie et croissance de l'adversaire** :
   - soins : Soin multiple (Gardien Vert), Neilla, Verdelune ;
   - Phénix, Résurrection, Reset ultime, Sursaut Vital, Vitalité des Âmes (+300 PV à **chaque** mort, y compris des nôtres) ;
   - Life-8, Imprudent (+500 PV), Cœur vital, Soin primitif ;
   - les PV gagnés par absorption.

   L'adversaire réel a plus de 2 800 PV effectifs, et ce total augmente. Un deck de 4 cartes va de 1 550 à 4 700 PV (médiane 700 PV par carte). Le moteur ne fait varier que les profils « fragile » et « tank ».
8. **Punitions à la mort de cartes adverses** :
   - Bomba : 500 dégâts bruts sur **une de nos cartes au hasard**. Cela tue d'un coup toute carte à 500 PV ou moins (Scorch 350, Murmures 400) et laisse Chimère (525), Keria et Dragon de la Cité Infernale (550) entre 25 et 50 PV ;
   - Revanche, Heure Funeste (Éternité sur toutes nos cartes), Contre, Virage 360, Transition.

   L'ordre dans lequel nous tuons compte, et le moteur l'ignore.
9. **Guerre économique** :
   - la prime de 50 va à l'adversaire **à chacune de nos victimes** : rattrapage, Tox plus tôt pour lui ;
   - Racket (−5 Spamtons par coup), Dette (−20 au départ), Jugement divin ;
   - **l'adversaire achète aussi en boutique** (Brut, Provocation, Immunité, Renvoi, Disparition, Gel, Phénix…).

   Le moteur n'a ni économie ni boutique adverses.
10. **Renvoi et Immunité chez l'adversaire** → nos dégâts reviennent vers nous (jusqu'à 100 %, L'Épine d'Amour à 75 %), ce qui pénalise les decks multi-coups et de zone. Nos effets de contrôle ne valent rien contre 4 cartes, un Tox et un talent Immunité-8. Le moteur crédite nos contrôles en forfait, quel que soit l'adversaire.
11. **Chouette Polychrome (possédée), Danse des plumes, terrain aléatoire** :
    - 6 coups de 30 répartis sur les **deux** camps : le moteur compte 50 % des dégâts sur nos propres cartes ;
    - sa Temporalité sur coup critique va **à la carte touchée**. Avec 50 % de critique, cela fait environ 3 critiques par lancer, dont environ la moitié sur l'adversaire. INF (M) : cela **accélère les recharges adverses**, dont Veuve noire.
    - Le moteur donne une valeur 0 à cette Temporalité de terrain : le coût caché n'est pas compté.
    - De même, Envol de Lums donne +1 de dégâts critiques aux deux camps.
12. **Durée de partie** :
    - le moteur s'arrête au tour 10, alors que la prolongation ne commence qu'au tour 20 ;
    - les compétences à recharge 8 à 10 (Veuve noire, Malédiction aquatique, Résurrection, Visée globale, Nuit finale, Jugement divin, Dernier plaisir) et les effets cumulatifs (Cœur résistance à chaque tour selon le texte 1.21, Cœur vital, Vitalité des Âmes, talents « -8 ») sont mal pondérés ;
    - dans le moteur, le deck n°1 du wiki élimine l'adversaire abstrait en 6 tours estimés. Une partie réelle contre un deck qui provoque et soigne dure plus longtemps.
13. **Variance** : critiques, Écho, cibles aléatoires, éléments aléatoires et fourchettes [min–max] sont tous remplacés par leur espérance. Deck chimere tire 48 % de ses dégâts des critiques (README) : son score moyen cache sa dispersion.
14. **Choix de cible de l'adversaire** : le moteur envoie les coups abstraits sur notre carte la plus basse en PV ou sur notre provocateur. Un vrai joueur vise notre porteur clé ou notre générateur.
15. **Chronomètre de 15 s par carte vivante** → une séquence de jeu complexe (générer, puis buffer, puis attaquer, choisir les options et les cibles) doit se faire vite. Le risque d'erreur n'est pas modélisé.
16. **Adjacence (Tox AoE), Fumée (effet inconnu), Mimétisme (dépend de ce que génère l'adversaire)** : le moteur les traite en forfait ou en abstraction.
17. **Écarts mineurs du moteur** :
    - il interdit de lancer une compétence à Coût sans le bonus suffisant, alors que [BAS] permet un bonus négatif ;
    - Cœur résistance n'est appliqué qu'une fois, alors que le texte 1.21 parle d'un cumul à chaque tour : Lapin-Plume est sous-estimé ;
    - il remet à pleine vie les cartes touchées par Virage 360.
18. **Version** : les scores du README et de l'Atelier sont en 1.20. Six cartes possédées ont changé et les menaces ont bougé : Zombie Floral passe en S avec une Disparition de zone, Tisseuse passe à 2 Spamtons par tour.

## Questions ouvertes

Chacune se tranche en une partie, ou en regardant un écran.

1. **Ban** : que bannit-on, et quand ? Avant ou après avoir vu le deck adverse ? La carte bannie est-elle remplacée ? Dans quels modes ?
2. **Absorption** :
   - avons-nous touché +50 Spamtons quand Chimère a été absorbée ?
   - un Cimetière, Vengeur ou Vitalité des Âmes s'est-il déclenché ?
   - Chimère était-elle à pleins PV (pour savoir si le gain vaut les PV actuels ou les PV max) ?
   - la Tisseuse a-t-elle récupéré Vampirisme, Mimétisme ou Galop arctique ?
   - Immunité bloque-t-elle l'absorption ?
3. **Provocation** : touche-t-elle les attaques aléatoires, réparties ou de zone ? Que se passe-t-il avec deux provocateurs ? Bloque-t-elle les effets qui ne sont pas des attaques ?
4. **Prolongation** : que réduisent les 10 % et qu'augmentent les 50 % ? À partir de quel tour exactement ? Y a-t-il un tour maximum ou des égalités ?
5. **Tour et « passer »** : quelle est la durée réelle du tour ? Que fait `skipPerCardAlive` ? Comment est tiré le premier joueur ?
6. **Choix des talents** : se fait-il au début du match ? En voyant le deck adverse ? Voit-on les talents et les Tox adverses ?
7. **Fumée** : que fait le terrain enfumé ?
8. **Unités** : `duration` (demi-tours ?) ; Écho (enchaînement ? rattrapage ?) ; bris des Gel de compétence (40 ou 60 ?) ; la recharge d'une carte gelée descend-elle ?
9. **Cœur résistance** : le bonus se cumule-t-il à chaque tour ?
10. **Plateau** : les positions comptent-elles pour l'adjacence de l'AoE ? Le joueur les choisit-il ?
11. **Numéro du tour** : est-il propre à chaque joueur ou commun ? Cela compte pour « + numéro du tour » et pour « boutique aux tours pairs ».

---

## Annexe A1 — Changements 1.20 → 1.21 qui nous concernent ([PATCH], diff des modèles `A_work/diff_v120_v121.txt`)

**Cartes possédées :**

| Carte | Changement |
|---|---|
| Dragon Ciel (180) | Souffle tornade (40 Nature, cible unique) **remplacé par** Appel de la forêt (30 Nature sur toutes les cartes adverses, +4 Nature). Passe de D à A (+103 places) et devient une source de zone qui contourne la Provocation |
| Dragon de la Cité Infernale (259) | bris de Gel 40 → 60 |
| L'Inventeur (153) | Materia [−8, +10] → [−5, +8] |
| Naissance d'Aldrin (30) | Tox de départ Reset → **Cimetière** (rare, +5) |
| Lapin-Plume (158) | PV 1 000 → **850** |
| Murmures du Corail Noir (102) | PV 500 → **400**, Spamtons/tour 7 → **2**, soin de base +5 → +3 |
| Lame de la forêt (103) | classement D → B, carte inchangée |
| Baleine Farceuse (82) | classement B → C, carte inchangée |

**Menaces :**

| Carte | Changement |
|---|---|
| Tisseuse de Mots | Spamtons/tour 3 → 2 |
| Zombie Floral | PV 1 000 → 850 ; Malédiction aquatique devient de zone + Disparition sur toutes les cartes adverses ; classée S |
| Ashtarae Lycaria | PV 1 000 → 700, Spamtons/tour 8 → 4, Résurrection coûte 5 Ombre |
| Rongeur Nuageux | nouvelle compétence Foudre, 30 Lumière + 50 % des PV manquants du lanceur ; garde le Tox Provocation |
| Apprentie de la Mort | zone 15 + 15 → 25 + 25 |
| Wyrm des Dunes Cornu, Roi des Flammes Ardentes | critique d'équipe +5 % → +7 % |

## Annexe A2 — Fichiers produits (tous sous `SP/spam/audit/`)

| Dossier ou fichier | Contenu |
|---|---|
| `A_raw/` | téléchargements bruts : `sitemap.xml`, `all_urls.txt` (659 URL), `pages/` (29 pages + collection), `cards_fr/` et `cards_en/` (127 + 127 fiches v1.21), `decks_fr/first.html`, `js/` (bundles du site + moteur 1.21), `data/` (modèle v1.21, index de recherche FR/EN), `journal/` (lecture seule de l'artifact Journal) |
| `A_txt/` | les mêmes pages converties en texte |
| `A_work/threats_v121.txt` | porteurs de chaque effet, passif, type de cible et talent (v1.21) |
| `A_work/diff_v120_v121.txt` | diff des cartes entre 1.20 et 1.21 |
| `A_work/engine_tox_v121.txt` | table des Tox du moteur (effet, valeur, rareté, prix) |
| `A_work/effects_v120.txt` | effets et passifs avec leurs textes (1.20) |
| `A_work/talents_unique.txt` | les 80 talents |
| `A_scripts/` | `h2t.js`, `h2t_dir.js`, `ctx.js`, `effects.js`, `threats.js`, `diffmodel.js` (sans dépendance). `exposure.js` n'est pas utilisé dans ce rapport : sa part de dégâts de base ignore les critiques et sous-estime donc les attaques à cible unique (Pinces) |
