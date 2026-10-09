## 7. Catalogue par famille (vue victime)

Dans les tableaux, « Type » vaut ACT (compétence active), PAS (passif de départ) ou TAL (talent : un seul actif par
carte, choisi avant le match). « Poss. » indique si la carte est dans la collection du joueur. Les familles (a) à (e)
sont détaillées ligne par ligne. Les familles (f) à (h) sont condensées par compétence ou talent ; les textes complets
sont dans `C_actives.json`.

**Avertissement transversal (FAIT, `tox_fr.json`).** La boutique peut donner **à n'importe quelle carte adverse** :
Disparition (L, 180), Éternité (L, 220), Gel (É, 150), Immunité (É, 90), Bomba (É, 130), Provocation (R, 70),
Brut (R, 65), Fumée (R, 50), Érosion (C/É) et Mimétisme (R, 50). Les familles (a) à (c) peuvent donc apparaître
hors des cartes listées ici, mais seulement après un achat, à partir du tour 2.

**Notes de lecture par famille (FAITS + INFÉRENCES)**

**(a) Retrait d'une carte**
- **Absorbe (#123).** INFÉRENCE (confiance haute) : la cible est libre. Le texte dit « Absorbe une carte » sans
  restriction, et l'incident l'a vu prendre une carte adverse.
- **Corne 25 / Corne 75 (#139).** Le texte dit « La cible » ; le camp visé n'est pas encodé.
- **Disparition passive.** Elle n'agit que si la carte frappe :
  - #56 Lisa : Courant aléatoire, CD 2, une cible aléatoire ;
  - #115 Aidan : Paie-torche, CD 3, coûte 10 Feu, cible choisie ;
  - #140 Souris des blés : aucune attaque (Épidémie soigne un allié). INFÉRENCE : passif sans effet sur nous.
- **Bombe-8.** Le Tox Bomba de la boutique (É) inflige « 500 dégâts bruts à une carte adverse aléatoire quand cette
  carte meurt ». Le talent applique ce passif au tour 8.

**(b) Déni d'action**
- **Gel**, règle du wiki : « ne peut pas agir jusqu'à la fin du prochain tour adverse ; un autre dégât, un soin ou
  un nouveau Tox brise la glace et inflige 40 dégâts » (60 en 1.21).
- **Éternité**, règle : « allonge d'un tour toutes les recharges de la cible ». INFÉRENCE (confiance moyenne) : c'est
  un retard ponctuel d'un tour, pas un +1 permanent. Les mots « Purge cancels a lengthening » vont dans ce sens.

**(c) Ciblage**
- Le moteur, côté nous, ne redirige vers notre provocateur que la part mono-cible des dégâts adverses. La part de
  zone (21 %) reste répartie (`fe()`, l. 831-855).
- INFÉRENCE (confiance moyenne-haute) : en jeu aussi, une attaque de zone ou aléatoire n'est **pas** redirigée par une
  Provocation. Elle « cible » déjà toutes les cartes.

**(f) Survie adverse**
- **Sursaut Vital** (#123, #160, #193) n'a aucune limite « une fois par partie » dans son texte. INFÉRENCE (confiance
  basse) : il peut se déclencher à chaque début de tour où la carte est sous 10 %.
