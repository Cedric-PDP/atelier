---
name: spam-journal
description: Analyse des parties du jeu de cartes SPAM (Steam, Ticroco) et tenue du « Journal de parties SPAM » — à utiliser quand l'utilisateur envoie des captures d'écran d'une partie SPAM, demande d'analyser une partie, les forces/faiblesses d'un deck, son propre jeu (erreurs, leçons), la méta adverse ou une contre-méta. Triggers — SPAM, partie SPAM, captures de partie, analyse cette partie, journal de parties, méta, contre-méta, archétype adverse, Spamtons, Tox.
---

# Journal de parties SPAM (projet perso)

Skill du projet : tout vit dans ce dépôt (lire `CLAUDE.md`, puis `journal/README.md` : procédure d'analyse, barème
de certitude, schéma de la base, contre-méta). Les parties arrivent aussi par les replays du jeu, envoyés depuis le
PC perso sur la branche `pc-perso` (CLAUDE.md, « Le PC perso »).

- Journal : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL — collections `matches`, `knowledge`, `archetypes`
  (lecture/écriture avec `ArtifactData`, toujours `if_version` sur un document existant).
- Fiche des 127 cartes (1.21) pour lire les captures : `journal/ref/cards_fr.txt`.
- **Ne jamais publier une page SPAM depuis cette session** : seule la session orchestratrice publie. Construire
  `journal/journal-spam.html` (`node journal/page/build_page.js journal/journal-spam.html`) et lui envoyer le chemin
  + 3 lignes de changements.
- Pas de tier des cartes. Répondre en français. Rien de SPAM dans le dépôt SCRIPTS_V2 ni dans les outils O'Work.
