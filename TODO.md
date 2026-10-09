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

## Règles du jeu à vérifier en jeu (captures F12)

- [ ] **Ban de shop** : a-t-il lieu une fois par partie ou à chaque shop ? Voit-on déjà les 4 cartes adverses au moment de bannir ? Les deux bans sont-ils simultanés ?
- [ ] **Absorption (Veuve noire de la Tisseuse de Mots)** : elle a pris 100 % des PV absorbés dans la seule partie observée, alors que le moteur en compte 50 %. Compte-t-elle comme une mort (prime, Cimetière) ?
- [ ] **Prolongation à partir du tour 20** : elle est dans les constantes du moteur mais n'est pas simulée.
- [ ] Ban d'une carte du deck : MIS DE CÔTÉ. Jamais vu en jeu, peut-être réservé au mode Classé. À rouvrir seulement si une capture le montre.

## Pont, depuis le PC perso

- [ ] Premier envoi depuis le PC perso : dossier de l'éditeur dans `AppData\LocalLow`, `Steam\userdata\<numéro>`, installation du jeu. Il dira si le jeu garde l'historique des parties en local.
- [ ] Après ce premier envoi :
  - ajouter au Pont un lecteur pour le format trouvé ;
  - transférer les captures et les parties vers le Journal, avec `source` = le nom de l'envoi et les cartes en numéros, selon `journal/README.md`.

## Journal

- [ ] Première vraie partie : elle servira de test à « Analyser une partie », jamais essayée sur de vraies captures.
- [ ] Méta : les archétypes et les bans conseillés sont des hypothèses, à confirmer ou corriger avec les vraies parties.

## Decks

- [ ] Essayer en vraies parties le deck recommandé par l'audit 1.21, **Esprit Nature, Keria, Dragon Ciel, Chimère** (6 % de critiques, le plus résistant aux menaces). Puis le comparer au deck chimère dans le Journal.

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
