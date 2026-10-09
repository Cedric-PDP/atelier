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
- [ ] **Métrique L (« Sans sa carte clé »)** : la carte est retirée au tour 1 sans mourir. Le replay montre qu'une absorption est une mort (prime de 50 pour toi, effets à la mort probables). Passer L en « absorbée = morte » (bascule `absorb.bounty` d'`engine_stress.js`, recalcul complet d'environ 30 min, puis republication) ? Décision de l'utilisateur.
- [ ] À long terme : le moteur du wiki fait jouer un adversaire qui se contente d'une courbe de dégâts fixe. Le recaler sur de vraies parties dès qu'il y en aura.
- [x] 1.21 rev2 (2026-10-09) : le wiki a révisé sa notation sous le même numéro (même jeu, scores en baisse de 10 à 14 %). Patcher de L porté (une table de noms par révision), données recalculées, Atelier republié ; le changelog l'explique en tête.

## Règles du jeu à vérifier (replays, sinon captures F12)

- [ ] **Ban de shop** : a-t-il lieu une fois par partie ou à chaque shop ? Voit-on déjà les 4 cartes adverses au moment de bannir ? Les deux bans sont-ils simultanés ? Bannit-on une famille de Tox ou une seule rareté ? Le Tox disparaît-il pour toute la partie ? Le wiki n'en dit rien (recherche du 2026-10-09). Replays : aucun ban dans les 2 premières parties. Pour trancher : bannir quelque chose dans une partie et envoyer son replay.
- [ ] **Absorption (Veuve noire de la Tisseuse de Mots)** : en grande partie RÉPONDU par le replay de la partie `2026-10-09-1546-7144` (2026-10-09) : 100 % des PV de la carte prise (le moteur en compte 50 %), et c'est une mort (message de mort, prime de 50 au propriétaire, élimination pour la Tisseuse). Reste : PV max ou actuels d'une carte blessée ; effets « à la mort d'un allié » (Cimetière, Vengeur).
- [ ] **Prolongation à partir du tour 20** : elle est dans les constantes du moteur mais n'est pas simulée, et aucune page du wiki n'en parle. Aucun replay ne dépasse encore le tour 19 : le premier qui le fera la montrera.
- [ ] Ban d'une carte du deck : MIS DE CÔTÉ. Jamais vu en jeu, peut-être réservé au mode Classé. À rouvrir seulement si une capture le montre.

## PC perso (branche GitHub `pc-perso`)

Les pages claude.ai ne s'ouvrent pas sur le PC perso : la branche `pc-perso` porte l'Atelier hors ligne, le mode d'emploi des envois et nos réponses (voir CLAUDE.md, « Le PC perso »).

- [x] Premier envoi (2026-10-09, `Ticroco.zip`) : le jeu garde un replay de chaque partie (`LocalLow\Ticroco\Spam\replays`). Les 2 parties sont dans le Journal (en-tête seulement, `source` = `pc-perso@bbfb1ca`).
- [x] Replays `.srpl` décodés entièrement (2026-10-09) : `scripts/replay/read_srpl.js`. Les 2 parties du Journal sont complètes (déroulé, boutique, bans, erreurs, leçons).
- [ ] Commande PowerShell qui exporte du registre les réglages du jeu (PlayerPrefs Unity, qui peuvent contenir des jetons de connexion) : préparée puis écartée, le contrôle de sécurité d'une session l'a refusée. Décision de l'utilisateur ; peu utile si les replays suffisent.
- [ ] Le Journal sur le PC perso : en faire aussi une copie hors ligne (lecture seule, instantané de la base) ? Décision de l'utilisateur.
- [ ] Si le décodage des replays marche, les parties viendront seulement des replays : plus besoin de mécanisme ni de page pour en ajouter (décision de l'utilisateur, 2026-10-09). Cela vise l'analyse de captures et la saisie manuelle du Journal, et le Pont. Le décodage marche : page du Journal en cours d'adaptation (session de l'orchestratrice).
- [ ] Page Pont : plus nécessaire (ligne ci-dessus). La supprimer seulement si l'utilisateur le demande.

## Journal

- [ ] Page du Journal sans analyse de captures ni saisie manuelle (les parties viennent des replays), qui affiche ce que les replays apportent (boutique avec relances et offres, « aucun ban ») : en cours.
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
- [x] Skill `spam-journal` déplacé dans `.claude/skills/` du projet (2026-10-09) : il n'apparaît plus dans les sessions des autres projets.
