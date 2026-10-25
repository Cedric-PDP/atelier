# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

L'utilisateur et un petit cercle d'amis qui jouent à WikiMasters (wiki-masters.com, cartes tirées des articles de
Wikipédia en français). Ils ouvrent le classeur sur ordinateur et sur téléphone, et veulent **tout** pouvoir y faire
depuis les deux : consulter, créer et réorganiser des collections, poser des tags, discuter, comparer avec les amis.

## Product Purpose

Suivre sa collection WikiMasters hors du jeu : cartes avec tags personnels, collections à compléter (cases vides),
rareté et cote des cartes, partage et échanges entre amis, chat commun. Outil personnel, sans lien avec le jeu.

## Positioning

Un classeur à intercalaires pour un petit groupe d'amis, alimenté par la lecture du jeu faite par le serveur avec un compte
du jeu relié une fois, qui croise la collection avec les catégories et les pages de Wikipédia.

## Operating Context

- Synchronisation par le serveur : le membre relie son compte du jeu une fois (fenêtre privée, favori « Relier » ou cookie à coller), puis le classeur lit collection (toutes les 10 min) et marché (20 min) sur n'importe quel appareil, téléphone compris ; « Rafraîchir » au clic.
- Accès par lien personnel (`#cle=…`), pas de mot de passe ; chaque vue a sa propre adresse (`#/…`).
- Sections : Collections (albums), Mes cartes, Entre amis, Marché, Chat, Synchro, Réglages, Nouveautés.
- Liste de souhaits du jeu : Réglages propose le compte complet (toutes les collections, futures comprises) ou le choix par collection. Les choix individuels sont conservés entre les modes ; les souhaits qui ne sont plus demandés sont retirés.
- Auto-tag : une collection peut être synchronisée avec un tag existant du jeu, dans les deux sens (ajouts et retraits), sur un seul exemplaire. Fonctionne côté serveur, y compris sans navigateur ouvert.

## Capabilities and Constraints

- Vue 3 runtime depuis cdnjs, rendu en fonctions `h()`, sans build ; CSP stricte (pas de style en ligne).
- Thème sombre par défaut, clair quand le système le demande.
- **Version web (ordinateur) figée** : toute refonte mobile se fait sous media query, sans changer le rendu large.
- Vocabulaire : « collections » = listes de l'utilisateur ; « catégories » = catégories de Wikipédia (une source).

## Brand Commitments

Nom « Le classeur ». Identité actuelle (sombre, lueur émeraude, Outfit + Inter, couleurs de rareté C/PC/R/SR/UR/L,
cartes de jeu 5:7) gardée ; sur mobile, libre adaptation pour coller aux usages d'une app.

## Product Principles

- Tout est faisable sur téléphone : rien n'est retiré, au pire rangé un niveau plus bas.
- La navigation suit les standards d'app mobile : barre du bas, retour en haut à gauche, feuilles qui montent du bas.
- Le contenu (cartes, albums, messages) d'abord ; le texte d'aide en second.
