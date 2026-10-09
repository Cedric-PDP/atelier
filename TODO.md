# Chantiers SPAM

Liste des chantiers ouverts du projet. Tenue par la session orchestratrice : c'est elle qui coordonne les sessions SPAM et qui seule publie les pages. Ouvert le 2026-10-09.

Pages : [Atelier](https://claude.ai/artifact/3a61vyiop6v5cLPs9H19iE) · [Journal](https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL) · [Pont](https://claude.ai/artifact/6hFsmpioodoRQFGjstecxc)

## Atelier

- [ ] **Résistance aux menaces et ban de shop dans la page.** EN PAUSE : interrompu par l'utilisateur le 2026-10-09, à ne reprendre que sur sa demande.
  - Le modèle est validé :
    - `familyLoss` par famille de Tox : le moteur le calcule déjà dans `st()`, mais `_t()` le retire de sa sortie ;
    - (a) le pire ban adverse et le plan de repli ;
    - (b) le score de notre ban = perte adverse + menace − perte pour nous.
  - Variante affichée par défaut : 1 ban par partie, sans voir le deck adverse.
  - Garder les identifiants de familles de Tox du Journal (`Multiplicator`, `Tenacite`…).
  - Le prototype est dans le scratchpad de la session « SPAM cartes disponibles » : `spam/audit/ban/`.
  - Le ban reste un levier secondaire : au plus 10 % du score, et surestimé, contre 25 à 75 % pour les menaces des cartes.
- [ ] Renommer `site/` en `atelier/`, seulement si l'utilisateur le veut. Il faut alors adapter `recompute.sh`, `build_core`, `smoke_page`, CLAUDE.md et README.
- [ ] À long terme : le moteur du wiki fait jouer un adversaire qui se contente d'une courbe de dégâts fixe. Le recaler sur de vraies parties dès qu'il y en aura.
- [x] 1.21 rev2 (2026-10-09) : le wiki a révisé sa notation sous le même numéro (même jeu, scores en baisse de 10 à 14 %). Patcher de L porté (une table de noms par révision), données recalculées, Atelier republié ; le changelog l'explique en tête.

## Règles du jeu à vérifier (replays, sinon captures F12)

- [ ] **Ban de shop** : a-t-il lieu une fois par partie ou à chaque shop ? Voit-on déjà les 4 cartes adverses au moment de bannir ? Les deux bans sont-ils simultanés ? Bannit-on une famille de Tox ou une seule rareté ? Le Tox disparaît-il pour toute la partie ? Le wiki n'en dit rien (recherche du 2026-10-09) : les replays devraient trancher.
- [ ] **Absorption (Veuve noire de la Tisseuse de Mots)** : elle a pris 100 % des PV absorbés dans la seule partie observée, alors que le moteur en compte 50 %. Compte-t-elle comme une mort (prime, Cimetière) ? PV max ou PV actuels ? Très probablement vue dans la partie `2026-10-09-1546-7144` (replay `match-1087144`) : le décodage le dira.
- [ ] **Prolongation à partir du tour 20** : elle est dans les constantes du moteur mais n'est pas simulée, et aucune page du wiki n'en parle. Aucun replay ne dépasse encore le tour 19.
- [ ] Ban d'une carte du deck : MIS DE CÔTÉ. Jamais vu en jeu, peut-être réservé au mode Classé. À rouvrir seulement si une capture le montre.

## PC perso (branche GitHub `pc-perso`)

Les pages claude.ai ne s'ouvrent pas sur le PC perso : la branche `pc-perso` porte l'Atelier hors ligne, le mode d'emploi des envois et nos réponses (voir CLAUDE.md, « Le PC perso »).

- [x] Premier envoi (2026-10-09, `Ticroco.zip`) : le jeu garde un replay de chaque partie (`LocalLow\Ticroco\Spam\replays`). Les 2 parties sont dans le Journal (en-tête seulement, `source` = `pc-perso@31362e4`).
- [ ] Décoder les messages binaires des replays `.srpl` (script Node dans `scripts/`) : tours, attaques, boutique, bans, absorption. Puis compléter les parties du Journal (`timeline`, `shop`, `bans`) et répondre aux règles à vérifier ci-dessus. **En cours** : session « Replays » de l'orchestratrice (2026-10-09), lecteur dans `scripts/replay/`.
- [ ] Commande PowerShell qui exporte du registre les réglages du jeu (PlayerPrefs Unity, qui peuvent contenir des jetons de connexion) : préparée puis écartée, le contrôle de sécurité d'une session l'a refusée. Décision de l'utilisateur ; peu utile si les replays suffisent.
- [ ] Le Journal sur le PC perso : en faire aussi une copie hors ligne (lecture seule, instantané de la base) ? Décision de l'utilisateur.
- [ ] Page Pont : la garder telle quelle, la supprimer, ou la réduire à un renvoi vers GitHub ? Décision de l'utilisateur.

## Journal

- [ ] Première partie analysée sur de vraies captures : « Analyser une partie » n'a encore jamais servi. Les 2 premières parties viennent des replays (en-tête seulement). Depuis le 2026-10-09, la page note tout le ban (rareté, moment, ordre, deck adverse visible, durée) et la consigne relève l'absorption et le tour 20.
- [ ] Méta : les archétypes et les bans conseillés sont des hypothèses, à confirmer ou corriger avec les vraies parties.

## Decks

- [ ] Essayer en vraies parties le deck recommandé par l'audit 1.21, **Esprit Nature, Keria, Dragon Ciel, Chimère** (6 % de critiques, le plus résistant aux menaces). Puis le comparer au deck chimère dans le Journal. Prêt : sauvegardé dans l'Atelier (« Essai Dragon Ciel », 3·117·180·238, 7 795 en rev2, 4e de la collection) ; plan d'essai dans le Journal (3 fiches « hypothèse ») : 10 parties chacun en alternance, ban Renvoi.

## Dépôt et organisation

- [ ] Premier commit, à faire par l'utilisateur. Rien n'est commité pour l'instant. À vérifier dans le lot :
  - les fichiers initiaux déjà indexés ;
  - `journal/`, `pont/` ;
  - `scripts/app/fetch_version.js`, `make_variants.js`, `new_version.sh` ;
  - ce `TODO.md`.
  - Identité git : l'adresse noreply, jamais @oci.fr.
- [ ] CLAUDE.md, à valider par l'utilisateur :
  - le plan du dépôt, avec `pont/`, `journal/` et les nouveaux scripts ;
  - la procédure de recalcul par version, déjà écrite par « Data collection ».
- [ ] Skill `spam-journal` : le déplacer de `~/.claude/skills` vers `spam-atelier/.claude/skills/` ? Décision de l'utilisateur.
