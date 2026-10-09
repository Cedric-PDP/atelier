# Atelier de decks SPAM

Projet perso : un atelier de decks pour le jeu de cartes SPAM (Steam), publié comme page Claude
(https://claude.ai/artifact/3a61vyiop6v5cLPs9H19iE), plus le moteur de simulation qui calcule ses données.

- `site/` : la page et ses données.
- `scripts/app/new_version.sh` : à chaque patch du jeu, récupère le moteur du wiki dans `spam/versions/<v>/`,
  recalcule tout, écrit le changelog (`spam/versions/<v>/CHANGELOG.md`) et met `site/` à jour (Node, sans dépendance).
- `scripts/app/recompute.sh [<v>]` : recalcule une version déjà récupérée.
- `CLAUDE.md` : contexte complet (collection, moteur, pipeline, republication).

Dépôt privé : le moteur et les textes de règles sont un instantané de spamgame-wiki.com.
