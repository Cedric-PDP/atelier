# Lecteur des replays SPAM (`.srpl`)

`read_srpl.js` lit un replay du jeu (`%USERPROFILE%\AppData\LocalLow\Ticroco\Spam\replays\<serveur>\<compte>\match-<n>.srpl`)
et écrit un JSON lisible : en-tête, déroulé tour par tour (lancers, cibles, PV avant/après, critiques, morts,
absorptions), boutique (offres, relances, achats, Tox remplacé, passes), Spamtons, bonus élémentaires, bans,
statistiques serveur de fin de partie, et un brouillon du document de la partie pour le Journal (`journal`).

```bash
node scripts/replay/read_srpl.js <match.srpl> [--index <index.json>] [--model <model.json>] [--tox <tox.json>] [--messages] [--cards] > out.json
```

- Node seul (`zlib` intégré), aucune dépendance. Le fichier est une **donnée** : rien n'y est exécuté. L'extraire dans
  un dossier neuf et passer son chemin en argument.
- `--index` : l'`index.json` du même dossier ; le lecteur retrouve l'entrée de la partie et vérifie qu'elle concorde
  avec l'en-tête du replay (`index.sameAsHeader`).
- `--model` : par défaut `spam/versions/<AppVersion>/js/model.json` du dépôt (sinon la version la plus haute ; un
  avertissement `checks.modelVersionWarning` le signale). Il sert à donner le numéro et le nom des cartes.
- `--tox` : par défaut `journal/ref/tox.json` (nom FR, rareté, prix). Les identifiants des Tox, eux, viennent du replay.
- `--messages` ajoute tous les messages décodés, `--cards` l'état de chaque carte après chaque mise à jour (gros).
- Les `ticket` de partie (en-tête, index) sont masqués, et la sortie est vérifiée avant d'être écrite.
- Testé sur les deux replays du 2026-10-09 (version 1.21) : 908 et 1 148 messages lus jusqu'au dernier octet,
  0 erreur, 644 états de carte lus en entier, boutique identique aux statistiques du serveur.

## Ce que donne la sortie

| Clé | Contenu |
|---|---|
| `checks` | contrôles : nombre de messages et de tours égal à l'en-tête, octets non lus, types inconnus, Tox ou cartes non résolus, boutique recoupée avec les stats serveur (`shopMatchesServerStats`), lancers sans effet visible |
| `summary` | ce qu'il faut pour le Journal : résultat, cause de fin (`endCause` : `surrender` = abandon), premier joueur (`first` + `firstBasis`), tours joués par camp, decks en numéros, talents, `bans`, `shop` (chaque passage : offres, relance et prix, achat, carte, Tox remplacé), `deaths` (élimination ou absorption, dernier coup, prime de 50), totaux du serveur, prolongation, `log` (lignes en français, par tour) |
| `turns` | chaque demi-tour (`turn` = numéro de tour commun aux deux joueurs, `side` = `me`/`opp`) : chrono, Chance, Spamtons au début, bonus élémentaires des deux camps au début, et les événements dans l'ordre |
| `cards` | les 8 cartes : uid de partie, numéro, camp, état au lancement et état final (PV, PV max, recharges, passifs et Tox, statuts, résistances) |
| `tox` | les Tox vus dans la partie : uid → id (`Berserk_C`), nom, rareté, prix |
| `serverStats` | le JSON de fin de partie envoyé par le serveur (masqué) |
| `journal` | brouillon du document `matches/<id>` du Journal (contrat : [journal/README.md](../../journal/README.md)) : `id` (heure de Paris + 4 derniers chiffres du replay), `date`, `mode`, `result`, `first`, `turns`, `my.cards`, `opp`, `timeline` (une ligne par tour et par camp), `gaps`, `shop` (+ champs facultatifs `cost`, `rerolls`, `rerollSpent`, `offers`), `bans`, `evidence`, `note`. Restent à écrire : `summary`, `turningPoint`, `mistakes`, `goodPlays`, `lessons`, `my.deck`, `source`, `createdAt` |

Événements d'un tour (`kind`) : `money` (avant → après, raison déduite), `shop` (`offre`, `relance`, `achat`, `passe`),
`cast` (capacité lancée : effets 2206, buffs 2208, statuts 2207), `trigger` (passif ou Tox), `turnEffect` (effet de
début de tour sans source, ex. Spamland), `purchaseEffect`, `death`, `aimCancelled`.

## Format (rétro-ingénierie du 2026-10-09, jeu 1.21)

**Sûr** = vérifié octet par octet sur les deux replays et recoupé (PV avant/après, arithmétique des Spamtons,
statistiques du serveur). **Déduit** = cohérent partout, mais le sens d'un champ reste une interprétation.

### Conteneur (sûr)

1. gzip ;
2. `SRPL` + int32 LE version de format (2) + longueur en 7 bits (.NET) + en-tête JSON (le même objet que l'entrée
   d'`index.json`, `ticket` compris) ;
3. int32 nombre de messages, puis pour chaque message : int32 temps en ms depuis le début (le dernier = `DurationMs`),
   int32 longueur, puis le message : uint16 type + corps.

Deux sérialisations cohabitent :
- **NGO** (Unity Netcode `FastBufferWriter`) : int32/float32 LE, chaîne = int32 nombre de caractères + UTF-16 LE,
  tableau d'octets = int32 taille + int32 taille + octets ;
- **compacte** (dans ces tableaux d'octets) : varint LEB128, entiers en zigzag, chaîne = zigzag(longueur + 1) + UTF-8
  (0 = null), liste = zigzag(nombre + 1) + éléments, float32 LE, dictionnaire = zigzag(nombre + 1) + paires.

### Messages

| Type | Nom | Contenu | Certitude |
|---|---|---|---|
| 2010 | connected | octet, int32 = notre n° de joueur, état de partie (blob compact) | sûr (n° de joueur = `Seat`) |
| 2015, 2000, 2204 | gameState… | état complet de la partie (blob) : joueurs, cosmétiques, les 8 cartes ; 2204 = au lancement | sûr pour les cartes |
| 2003 | turnStart | joueur, chrono (s), n° du tour, Chance (float), Spamtons, relances déjà payées (+5 par relance), nb d'offres, prix de base d'une relance (10), offres (uid, id de Tox), 3 int32 toujours nuls | sûr ; les 3 derniers inconnus |
| 2021 | shopUpdate | joueur, supplément de relance, nb d'offres, prix de base, offres, 3 int32 nuls. Avec offres = relance ; sans offre = boutique fermée (passe, ou après un achat) | sûr |
| 2020 | shopBuy | joueur, carte (uid), Tox (uid), Tox obtenu (uid), Tox ou capacité remplacé (uid, vide = emplacement libre) | sûr |
| 2201 | playerResources | joueur, Chance, Spamtons | sûr |
| 2100 / 2101 | aimStart / aimEnd | carte, capacité, joueur (+ int32 10 pour 2100) ; 2101 vide = visée annulée | sûr (2101 = la capacité part) |
| 1041 | aimPointer | joueur + position 3D de la flèche de visée (cosmétique) | sûr |
| 1033 | aimCancel | int32 (-1) avant un 2101 vide | déduit |
| 2400 | shopDrag | glisser-déposer d'une offre de boutique : type (0, 1 = prend l'offre n°, 2 = position) + valeurs (cosmétique) | déduit |
| 2206 | effects | séquences d'effets : n° de séquence, tour, carte source, source (capacité, passif, uid de Tox, ou vide), puis effets (type, étiquette `Crit` ou vide, valeur, cibles : cible, montant, PV avant, PV après, PV max ; -1 = sans PV) | sûr |
| 2208 | vfx | animations : coup (source, cible, montant, critique, élément), soin, buff (`-4` : 0 critique, 1 dégâts critiques, 3 valeurs de base, 4 résistance + élément), gain d'élément, recharge, marqueur de fin | sûr pour coup/soin/buff ; sert pour les buffs absents de 2206 |
| 2207 | cardsUpdate | n° de version, cartes modifiées (blob carte), puis pour chaque joueur : ordre des cartes sur le plateau et **bonus élémentaires** (dict) | sûr pour les cartes et les bonus |
| 2111 | cardDied | carte qui quitte le terrain, champ « par » (le tueur ; **la carte elle-même pour une absorption**), joueur propriétaire | sûr |
| 2209 | endGraphs | courbes de fin de partie par carte et par tour (blob) | non décodé |
| 2001 | gameResult | gagnant (id, nom), xp, puis le JSON de statistiques du serveur (UTF-16) | sûr pour le JSON |

Types d'effet (2206) : 1 dégâts, 2 soin (valeur négative), 4 critique +x %, 5 dégâts critiques +x %, 6 recharges +x
(Éternité), 7 bonus élémentaire (cible = élément), 8 Spamtons (cible = n° de joueur), 14 carte retirée du jeu (mort ou
absorption), 15 achat de Tox (valeur = prix), 16 PV max +x. Un code inconnu sort comme `type<N>` : à identifier sur
la partie suivante. Les dégâts d'une capacité à deux éléments sont additionnés par cible (2208 garde le détail par
élément) ; un coup critique forme un effet à part (`crit: true`).

Carte (blob compact, marque 197 dans 2207) : id de carte (uuid du modèle), uid de partie, joueur, style, variante, 23
entiers (emplacement, dégâts subis, PV max… : `hp` = PV max − dégâts ; à la mort, PV ≤ 0, -1 pour une absorption),
statuts (type, valeur, durée en demi-tours, source, nom ; 200 = Provocation `CastTauntOnCaster`, 210 = posé sur les
alliées du provocateur, sens déduit), capacités, uid des passifs, élément, état des capacités (recharge, recharge
restante, nombre d'usages, et trois bonus déduits : valeur de base (Feu allié +3), critique en % (Embrasement +5),
dégâts critiques (Revitalisation +1)), passifs (uid, id, inné ou acheté), résistances. La fin d'un 2207 donne, pour
chaque joueur, l'ordre des cartes sur le plateau et les bonus élémentaires (`turns[].elementsAtStart`).

### Ce qui est établi par ces deux replays

- Le premier joueur est le joueur du premier 2003 (et `starter` des stats serveur). `Seat` est notre n° de joueur
  (0 ou 1), **pas** l'ordre de jeu : nous avons commencé les deux parties, en `Seat` 1 puis 0.
- Recharges au départ : premier joueur −1, second −2 (Veuve noire, recharge 8 : 7 puis 6 au lancement chez le second
  joueur, prête à son tour 7). Une recharge baisse à la fin du tour de son propriétaire.
- Chrono d'un tour : 20 s + 15 s par carte vivante (80, 65, 50).
- Revenu de début de tour = Spamtons des cartes vivantes + n° du tour ; Spamland ajoute le sien juste après.
  Relance : 10, puis +5 par relance dans la même boutique (remis à 10 à la boutique suivante). Passer : +10, même
  après des relances. La boutique se ferme après un achat. Une relance peut reproposer une offre déjà vue.
- Prime de 50 Spamtons versée **immédiatement au propriétaire** de la carte perdue, y compris pour une absorption.
- Les offres de boutique de l'adversaire sont dans le flux (le serveur les envoie aux deux joueurs).
- Mystère (Paguroniyx) est tiré au lancement : la carte arrive avec le passif tiré (Cœur de lumière R) à la place.

## Le replay comme seule source du Journal

Fiable dès aujourd'hui (lu dans le replay, recoupé) : decks des deux camps en numéros, résultat et cause de fin
(abandon), premier joueur, nombre de tours, chaque lancer (carte, capacité, cibles, dégâts et soins avec PV avant et
après, critiques), passifs déclenchés, Provocation, buffs, éléments générés et bonus élémentaires par tour, Spamtons à
chaque mouvement (revenu, relance, achat, passe, prime), boutique complète des deux joueurs (offres, relances, achat,
carte, Tox remplacé), morts et absorptions (tueur, dernier coup, prime), talents (vides ici), présence ou absence de ban.

Pour qu'il soit la seule source :
- récupérer chaque replay : le jeu en écrit un par partie, mais on ne sait pas combien il en garde ; envoyer le dossier
  `replays` après chaque séance ;
- le premier ban, le premier talent, la première partie classée, la première prolongation et chaque mécanique encore
  jamais vue (Gel, Renvoi, Disparition, Phénix, Bouclier, Poison, raté) : relancer le lecteur, regarder `checks`
  (types ou effets inconnus) et compléter les tables `TYPE_NAMES`, `EFFECT_TYPES`, `STATUS_NAMES` ;
- un `model.json` de la version jouée (`AppVersion`) pour les numéros et noms des cartes ;
- l'analyse (tournant, erreurs, leçons) reste à écrire : le lecteur ne donne que les faits.

## Limites connues

- **Bans** : aucun dans ces deux parties (stats serveur : `bans: []` pour les deux joueurs, `banned` vide à chaque
  passage en boutique ; aucun message de ban). Le format d'un ban dans le flux est donc inconnu : la première partie
  avec un ban le montrera (`summary.bans` lit déjà les stats serveur).
- Talents : jamais vus (tous à 0 dans `draftTalents…`) ; partie classée, contre l'IA, nulle, prolongation (tour ≥ 20),
  précision < 100 % (raté), Gel, Renvoi, Disparition, Phénix, Bouclier, Poison : jamais vus, leurs codes d'effet
  sont inconnus et sortiront comme `type<N>` ou sans effet visible.
- Les 3 entiers de fin de 2003/2021 (toujours 0), une partie des 23 entiers de la carte, le message 2209 et la
  plupart des champs des états de partie (2015/2000/2204, hors cartes) ne sont pas interprétés.
- Les totaux de dégâts du serveur (`serverTotals`) sont 5 à 25 % plus hauts que la somme des PV perdus du flux
  (les soins, eux, sont identiques) : le serveur compte sans doute les dégâts avant résistances. Les PV avant/après
  du flux sont les PV réels.
- Format propre à la version 1.21 du jeu (`AppVersion`, `FormatVersion` 2, `Capabilities` 511) : après une mise à jour,
  vérifier `checks` (types inconnus, octets non lus, erreurs) avant de se fier à la sortie.
