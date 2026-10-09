// 1.21 wave: realistic scenarios first, then the upper bound, then freeze / precision / taunt.
const SHATTER = 60; // 1.21: Frozen_E value 60 ("brise la glace et lui inflige 60 dégâts"), was 40 in 1.20
const F3 = [2, 5, 8];
const SCEN121 = [
  { id: 'base', stress: null },
  { id: 'R1E', stress: { reflectOne: { idx: 0, pct: 0.75 } } },
  { id: 'R1L', stress: { reflectOne: { idx: 0, pct: 1.00 } } },
  { id: 'RE4', stress: { reflect: 0.75 } },
  ...[0, 1, 2, 3].map(p => ({ id: 'F3p' + p, stress: { freeze: { idx: p, turns: F3, shatter: SHATTER } } })),
  ...[0, 1, 2, 3].map(p => ({ id: 'FT3p' + p, stress: { freeze: { idx: p, smart: true, cd: 3, from: 2, shatter: SHATTER } } })),
  // thaw variant (coordinator, 2nd message): an ally heal of another living card, else a shop Tox (even turn), frees it
  ...[0, 1, 2, 3].map(p => ({ id: 'FD3p' + p, stress: { freeze: { idx: p, turns: F3, shatter: SHATTER, thaw: true } } })),
  ...[0, 1, 2, 3].map(p => ({ id: 'FDT3p' + p, stress: { freeze: { idx: p, smart: true, cd: 3, from: 2, shatter: SHATTER, thaw: true } } })),
  { id: 'P20', stress: { precMalus: 20 } },
  { id: 'T900', stress: { taunt: { hp: 900 } } },
];
const DESC = {
  R1E: "Renvoi épique (75 %) sur UNE seule carte ennemie : celle que nos attaques ciblées touchent en premier (ordre du moteur : PV les plus bas, puis index → index 0). Renvoi = 75 % des dégâts réellement subis par cette carte, renvoyés sans résistance à notre carte attaquante. Nos AoE ne lui en envoient qu'1/4.",
  R1L: "Renvoi légendaire (100 %) sur la même carte unique (index 0).",
  RE4: "Renvoi épique (75 %) sur les 4 cartes ennemies dès le tour 1 : borne haute (il faudrait 4 achats en boutique, épiques vers le tour 6).",
  Fz3: "Gel de notre pire carte 1 tour sur 3 : pire des 4 cartes × 2 schémas. Schéma fixe : tours 2, 5, 8. Schéma « Gel CD 3 minuté » : dès le tour 2, dépensé quand la carte a une attaque prête. La carte gelée ne lance rien ce tour-là ; ses passifs restent actifs. Bris de glace : 60 dégâts bruts (1.21).",
  Fz3d: "Gel + dégel par le joueur (mêmes 2 schémas, pire des 4 cartes). Au début de notre tour, si une autre carte vivante a un soin d'allié prêt (heals non vide, cible ally/allAllies/randomAlly), on le lance d'abord sur la carte gelée : elle reçoit le soin, prend 60 dégâts et agit normalement ; le soin est consommé (recharge lancée). Sinon, un tour de boutique (tour pair) l'achat d'un Tox la libère contre 60 dégâts. Sinon elle reste gelée ce tour-là.",
  P20: "Précision −20 points sur nos 4 cartes tout le match, en espérance comme le moteur (×0,8 sur chaque coup, toutes nos capacités ont 100 de précision) ; gen/buffs portés par une attaque réduits pareil, soins intacts.",
  T900: "Provocateur permanent à 900 PV (type Fleur de Vie, résistances du profil) à la place d'une carte ennemie : nos attaques mono-cible (enemy/randomEnemy, hors Brut) doivent le frapper tant qu'il vit ; AoE non redirigées.",
};
module.exports = { SCEN121, DESC, SHATTER };
