---
name: spam-journal
description: Journal de parties du jeu de cartes SPAM (Steam, Ticroco) — import des replays du jeu dans le « Journal de parties SPAM », analyse d'une partie (tournant, erreurs, leçons), forces et faiblesses d'un deck, méta adverse et contre-méta. À utiliser quand l'utilisateur envoie des replays ou dit avoir fait un envoi depuis son PC perso, demande d'analyser une partie (importée ou qu'il raconte), parle de son jeu, de la méta ou d'un archétype adverse. Triggers — SPAM, replay, .srpl, partie SPAM, analyse cette partie, journal de parties, méta, contre-méta, archétype adverse, Spamtons, Tox.
---

# Journal de parties SPAM (projet perso)

Skill du projet : tout vit dans ce dépôt. Lire `CLAUDE.md`, puis `journal/README.md` : import des replays, écriture de
l'analyse, barème de certitude, schéma de la base (un contrat), contre-méta.

- **Les parties viennent seulement des replays du jeu**, envoyés depuis le PC perso par la branche `pc-perso`
  (CLAUDE.md, « Le PC perso »). Lecteur : `scripts/replay/read_srpl.js` (`scripts/replay/README.md`). Sa clé `journal`
  est le brouillon du document ; contrôler `checks`, écrire avec `if_version`, puis ajouter l'analyse.
- Une partie que l'utilisateur raconte, sans replay : l'analyser dans la conversation, sans l'écrire dans le Journal.
  Elle y entrera avec son replay.
- Journal : https://claude.ai/artifact/WSVR5uVuFT9SMAa9WSaqpL — collections `matches`, `knowledge`, `archetypes`
  (`ArtifactData`, toujours `if_version` sur un document existant). La page ne fait qu'afficher : ni saisie ni
  analyse de captures.
- Cartes (1.21) : `journal/ref/cards_fr.txt` ; Tox (ids du jeu, rareté comprise) : `journal/ref/tox.json`.
- **Ne jamais publier une page SPAM depuis cette session** : seule la session orchestratrice publie. Construire
  `journal/journal-spam.html` (`node journal/page/build_page.js journal/journal-spam.html`), lancer
  `node journal/page/smoke_journal.js journal/journal-spam.html` (`SMOKE OK`), puis lui envoyer le chemin et 3 lignes
  de changements.
- Pas de tier des cartes. Répondre en français. Rien d'O'Work (dépôts, outils, MCP, mémoire).
