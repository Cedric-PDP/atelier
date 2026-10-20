---
name: patchnote
description: Rédige la patchnote du classeur WikiMasters (branche wikimasters, page « Nouveautés ») à partir de la session Claude Code en cours (ou de sessions données) — ce qui a changé pour les membres, court, par thème, prêt à coller dans site/public/nouveautes.json. Rédaction seulement, jamais de publication. À utiliser quand l'utilisateur demande une patchnote, un changelog, des notes de version ou « ce qui a changé » pour le classeur. Triggers — patchnote, patch note, changelog, notes de version, nouveautés, qu'est-ce qui a changé.
argument-hint: "[id de session…] (défaut : la session en cours)"
---

# Patchnote du classeur (rédaction seulement)

Lire la ou les sessions, en tirer ce qui a changé **pour les membres du classeur**, et rédiger la patchnote dans la
réponse. **Ne rien publier** : ne pas modifier `site/public/nouveautes.json`, ne pas ajouter de message système au
chat, ne pas commiter ni pousser. L'utilisateur relit d'abord. Format du fichier et règles d'affichage : section
« Nouveautés » de `.wikimasters/site/SPEC.md`.

## 1. Lire la session

```bash
node .claude/skills/patchnote/extract.mjs ${CLAUDE_SESSION_ID}
```

- Sans argument (ou si `${CLAUDE_SESSION_ID}` n'a pas été remplacé), le script prend la session la plus récemment
  écrite, c'est-à-dire celle en cours. `$ARGUMENTS` peut nommer d'autres sessions : les passer une par une (id ou
  chemin `.jsonl`). `--full` donne les réponses de Claude en entier.
- **`commits <plage>`** dans `$ARGUMENTS` (par exemple `commits origin/wikimasters..HEAD`, passé par le skill
  `publier` avant un push) : la patchnote couvre **exactement ces commits**
  (`git -C .wikimasters log --format='%h %ad %s' --date=iso <plage>`, et leurs diffs au besoin). La session ne sert
  plus qu'à comprendre leur intention.
- Le script sort les demandes de l'utilisateur, les réponses de Claude, les fichiers modifiés et les commandes git.
- **La source de vérité, ce sont les commits**, pas la conversation :
  `git -C .wikimasters log --since=<début> --until=<fin> --format='%h %ad %s' --date=iso`, avec les heures du script
  (`.wikimasters` = worktree de la branche `wikimasters` ; s'il manque : `git fetch origin wikimasters && git worktree add
  .wikimasters wikimasters`). En cas de doute sur un commit, lire son diff (`git -C .wikimasters show --stat <sha>`).
- Une fonction abandonnée, retirée ou jamais commitée ne va **pas** dans la patchnote. Ce qui est commité mais pas
  poussé, si : le dire à l'utilisateur.

## 2. Rédiger

Ce que l'utilisateur a validé (2026-10-20 : la première version, détaillée, était « trop verbeuse ») :

- **Court.** Une ligne par changement, une ou deux phrases au plus. Pas de « comment ça marche », pas de cas limites.
- **Par thème, pas par commit.** Une rubrique = un emoji + un titre court (« Chat », « Albums », « Pages Wikipédia »…).
  Un correctif d'une fonction de la même session se fond dans la ligne de cette fonction.
- **Pour les membres.** On tutoie, on dit ce qu'ils peuvent faire (« Replie une section en cliquant sur son
  intercalaire »). Les tests, la spec, le faux DOM, la base, les limites techniques et les refactorisations restent
  dehors, sauf quand ils changent quelque chose de visible (« les collections peuvent dépasser 3 000 cartes »).
- **Liens internes** (`to` + `link`) vers la vue concernée quand elle existe : `#/collections`, `#/cartes`, `#/amis`,
  `#/amis/echanges`, `#/marche`, `#/chat`, `#/maj`, `#/reglages` (voir « Adresse de chaque vue » de la spec). Aucun lien
  externe.
- Texte brut. Seul `` `code` `` est mis en forme (`@`, `#`). Espace insécable dans les nombres (« 3 000 »).

## 3. Rendre

Dans la réponse, dans cet ordre :

1. **La patchnote telle que les membres la liront**, en Markdown :

   ```markdown
   ## Nouveautés du 19 octobre

   **💬 Chat**
   - `@` pour mentionner un ami, `#` pour citer une carte.
   ```

2. **L'entrée de `versions` à coller dans `nouveautes.json`** (en tête de la liste), sans l'y écrire :

   ```json
   { "id": "2026-10-19", "date": "2026-10-19", "sections": [
     { "icon": "💬", "title": "Chat", "items": [
       { "text": "`@` pour mentionner un ami, `#` pour citer une carte.", "to": "#/chat", "link": "Chat" } ] } ] }
   ```

   `id` et `date` : le jour des changements (`AAAA-MM-JJ`). S'il existe déjà une version ce jour-là, proposer de
   compléter celle-ci plutôt que d'en créer une seconde avec le même `id`. Proposer aussi, à part et sans l'ajouter,
   le message système éventuel (`{"id", "at", "text", "version"}`) : c'est l'utilisateur qui décide de l'annoncer.

3. **Trois lignes au plus pour l'utilisateur**, hors patchnote : les commits couverts (premier et dernier sha), ce qui a
   été laissé de côté exprès (abandonné, interne), et ce qui n'a été vérifié que dans les tests, pas en ligne.

Répondre en français.
