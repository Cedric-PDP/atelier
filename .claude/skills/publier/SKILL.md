---
name: publier
description: Pousse (publie) le classeur WikiMasters — la branche wikimasters, que Cloudflare republie à chaque push — en proposant d'abord la patchnote des commits poussés pour la page « Nouveautés », puis, si la dernière chose du chat n'est pas déjà une annonce, de l'annoncer dans le chat. À utiliser dès que l'utilisateur veut pousser, publier, mettre en ligne ou déployer le classeur — « pousse », « push », « publie », « mets en ligne », « commite et pousse », « oui pousse », « ok push ». Pas pour la branche pc-perso ni pour main (SPAM).
argument-hint: "(rien)"
---

# Publier le classeur (push de `wikimasters` avec sa patchnote)

Un push de `wikimasters` met le site en ligne tout de suite, pour l'utilisateur **et ses amis** (Cloudflare republie
tout seul). Ce skill ajoute deux questions avant ce push : la patchnote, puis l'annonce dans le chat. **Rien n'est
ajouté à `nouveautes.json` sans un oui explicite**, et l'utilisateur peut toujours pousser sans patchnote. Format,
affichage et route : section « Nouveautés » de `.wikimasters/site/SPEC.md`.

Tout se fait dans le worktree `.wikimasters/` (branche `wikimasters`). S'il manque :
`git fetch origin wikimasters && git worktree add .wikimasters wikimasters`.

## 1. Ce qui part

```bash
git -C .wikimasters fetch -q origin wikimasters
git -C .wikimasters status -sb
git -C .wikimasters log --format='%h %ad %s' --date=iso origin/wikimasters..HEAD
```

- **Modifications non commitées** : les commiter d'abord, si l'utilisateur a demandé « commite et pousse ». Sinon,
  demander. Style des messages de la branche : en français, « Le classeur : … ». Identité : celle de la branche,
  `git -c user.name="Cedric PDP" -c user.email="171561900+Cedric-PDP@users.noreply.github.com" commit …`, jamais
  l'adresse de travail.
- **Branche en retard sur `origin`** : s'arrêter et le dire, sans fusion ni rebase de ma propre initiative.
- **Rien à pousser** : le dire et s'arrêter.
- **Tests** : si le code (`site/`) a changé depuis le dernier passage des tests dans la session, les relancer avant de
  pousser (README de la branche, « Développer et tester »). Pour le test d'interface (long, plusieurs minutes), prendre
  `TZ=Pacific/Honolulu` : il échoue près de minuit sur un libellé de date.

## 2. La patchnote

Lancer le skill `patchnote` (outil Skill) sur **les commits qui partent** : arguments
`commits origin/wikimasters..HEAD`, plus la session en cours pour le contexte. Un commit qui ne change rien de visible
pour les membres (tests, spec, outillage) n'y entre pas. Si aucun commit n'a d'effet visible, le dire et passer
directement au push, sans question.

Montrer la patchnote (version Markdown), puis demander avec AskUserQuestion :

- **« Pousser avec cette patchnote »** : l'entrée est ajoutée en tête de `versions`. Une version du même jour existe
  déjà : compléter ses rubriques plutôt que d'en créer une seconde avec le même `id`.
- **« Je la modifie d'abord »** : appliquer ses retouches, remontrer la patchnote, reposer la question.
- **« Pousser sans patchnote »** : sauter les étapes 3 et 4.

## 3. L'annonce dans le chat

Seulement si une patchnote a été ajoutée. Adresse du site : la mémoire du projet (« adresse du classeur »). Si elle
n'y est pas, la demander une fois (`https://classeur-wm.<sous-domaine>.workers.dev`), puis l'y écrire.

```bash
node .claude/skills/publier/check_news.mjs .wikimasters/site/public/nouveautes.json <adresse du site>
```

La ligne `chat :` compare la dernière annonce de `nouveautes.json` à `GET /api/chat/last`, l'heure du dernier message
d'un membre en ligne :

- **`DÉJÀ UNE ANNONCE`** : la dernière chose du fil est déjà une patchnote. Ne pas en ajouter (deux annonces de suite
  feraient doublon), et le dire en une ligne. Son lien mène à la page, où la nouvelle version sera en tête.
- **`PAS D'ANNONCE EN DERNIER`** : demander avec AskUserQuestion « Annoncer cette version dans le chat ? ». Si oui,
  ajouter à `chat` :
  `{"id": "<id de la version>", "at": "<heure UTC de maintenant, ISO>", "text": "Nouvelle version du classeur disponible", "version": "<id de la version>"}`.
  Si cet `id` existe déjà, ajouter un suffixe (`-2`). Le texte se change si l'utilisateur le demande, 300 caractères au
  plus.
- **`INCONNU`** : la route n'est pas encore en ligne (avant le premier push qui l'apporte), l'adresse est fausse ou le
  réseau est coupé. Le dire, puis poser quand même la question.

## 4. Vérifier, commiter, pousser

1. `node .claude/skills/publier/check_news.mjs .wikimasters/site/public/nouveautes.json` doit afficher `OK`. Il refuse
   aussi ce que la page écarterait en silence : lien externe, rubrique vide, date invalide.
2. Commiter `site/public/nouveautes.json` à part, avec la même identité :
   `Le classeur : nouveautés du <jour> (<titres des rubriques>)`, et « , annoncées dans le chat » si c'est le cas.
3. `git -C .wikimasters push origin wikimasters`.
4. Dire en trois lignes au plus :
   - ce qui est parti (premier et dernier sha) ;
   - si la patchnote et l'annonce sont publiées ;
   - que Cloudflare republie dans la minute (non vérifié en ligne), et qu'il faut recharger la page.

Répondre en français.
