// Threat scenarios (globalThis.STRESS payloads). `on:true` is added by the runner.
const F3 = [2, 5, 8];          // frozen 1 turn out of 3, from turn 2
const F2 = [2, 4, 6, 8, 10];   // variant: every other turn
const SHATTER = 40;            // Gel: breaking the ice deals 40 damage (tox_fr.json Frozen_E)
const SCENARIOS = [
  { id: 'base', stress: null, title: 'Baseline (wiki engine)' },
  // S-TAUNT: enemy #4 = Fleur de Vie-like permanent taunter
  { id: 'T600', stress: { taunt: { hp: 600 } }, title: 'S-TAUNT taunter 600 PV' },
  { id: 'T900', stress: { taunt: { hp: 900 } }, title: 'S-TAUNT taunter 900 PV' },
  { id: 'T1200', stress: { taunt: { hp: 1200 } }, title: 'S-TAUNT taunter 1200 PV (extra)' },
  { id: 'T600c', stress: { taunt: { hp: 600, noForce: true } }, title: 'control: 600 PV card, no taunt' },
  { id: 'T900c', stress: { taunt: { hp: 900, noForce: true } }, title: 'control: 900 PV card, no taunt' },
  { id: 'T1200c', stress: { taunt: { hp: 1200, noForce: true } }, title: 'control: 1200 PV card, no taunt' },
  // S-FREEZE: deck position p frozen on F3 (main) or F2 (variant)
  ...[0, 1, 2, 3].map(p => ({ id: 'F3p' + p, stress: { freeze: { idx: p, turns: F3, shatter: SHATTER } }, title: 'S-FREEZE 1/3 pos ' + p })),
  ...[0, 1, 2, 3].map(p => ({ id: 'F2p' + p, stress: { freeze: { idx: p, turns: F2, shatter: SHATTER } }, title: 'S-FREEZE 1/2 pos ' + p })),
  ...[0, 1, 2, 3].map(p => ({ id: 'F3n' + p, stress: { freeze: { idx: p, turns: F3, shatter: 0 } }, title: 'S-FREEZE 1/3 pos ' + p + ' without ice-break dmg' })),
  // timed freeze: enemy Gel of cooldown 3 (resp. 2), usable from turn 2, spent when the target's attack is ready
  ...[0, 1, 2, 3].map(p => ({ id: 'FT3p' + p, stress: { freeze: { idx: p, smart: true, cd: 3, from: 2, shatter: SHATTER } }, title: 'S-FREEZE timed, Gel CD 3, pos ' + p })),
  ...[0, 1, 2, 3].map(p => ({ id: 'FT2p' + p, stress: { freeze: { idx: p, smart: true, cd: 2, from: 2, shatter: SHATTER } }, title: 'S-FREEZE timed, Gel CD 2, pos ' + p })),
  // S-PREC: -20 precision points on all our cards
  { id: 'P20', stress: { precMalus: 20 }, title: 'S-PREC -20 precision' },
  { id: 'P10', stress: { precMalus: 10 }, title: 'S-PREC -10 (one Phare of Luminaire Abyssal #81, AoE -10 %)' },
  { id: 'P5', stress: { precMalus: 5 }, title: 'S-PREC -5 (one Imprécision talent: -20 on 1 random card of 4, expected value)' },
  // S-REFLECT: every enemy card has Renvoi (tox_fr.json: C 25 %, R 50 %, E 75 %, L 100 %)
  { id: 'RC', stress: { reflect: 0.25 }, title: 'S-REFLECT Renvoi commun 25 %' },
  { id: 'RR', stress: { reflect: 0.50 }, title: 'S-REFLECT Renvoi rare 50 % (extra)' },
  { id: 'RE', stress: { reflect: 0.75 }, title: 'S-REFLECT Renvoi épique 75 %' },
  { id: 'RL', stress: { reflect: 1.00 }, title: 'S-REFLECT Renvoi légendaire 100 % (extra)' },
  // realism: only ONE enemy card carries Renvoi épique (e.g. L'Épine d'Amour #106, innate Reflect_E 75 %).
  // Engine targeting = lowest HP then lowest index: idx 3 is the card our single-target hits reach last, idx 0 first.
  { id: 'R1E3', stress: { reflectOne: { idx: 3, pct: 0.75 } }, title: 'one enemy card with Renvoi E, attacked last' },
  { id: 'R1E0', stress: { reflectOne: { idx: 0, pct: 0.75 } }, title: 'one enemy card with Renvoi E, attacked first' },
  // sensitivity: order of our lifesteal vs the reflected damage of the same cast (engine default: heal first)
  { id: 'RCa', stress: { reflect: 0.25, lsMode: 'after' }, title: 'S-REFLECT 25 %, reflect lands then lifesteal' },
  { id: 'REa', stress: { reflect: 0.75, lsMode: 'after' }, title: 'S-REFLECT 75 %, reflect lands then lifesteal' },
  { id: 'RCn', stress: { reflect: 0.25, lsMode: 'net' }, title: 'S-REFLECT 25 %, lifesteal nets the reflect' },
  { id: 'REn', stress: { reflect: 0.75, lsMode: 'net' }, title: 'S-REFLECT 75 %, lifesteal nets the reflect' },
  // opponent-model sensitivity: enemy single-target hits focus our card at position p (engine: lowest current HP)
  ...[0, 1, 2, 3].map(p => ({ id: 'EF' + p, stress: { focusIdx: p }, title: 'sensitivity: enemy focuses pos ' + p })),
  ...[0, 1, 2, 3].map(p => ({ id: 'EFRE' + p, stress: { focusIdx: p, reflect: 0.75 }, title: 'sensitivity: enemy focuses pos ' + p + ' + Renvoi E 75 %' })),
  // extra combo: 900 PV taunter carrying Renvoi épique (only the taunter reflects)
  { id: 'T900RE', stress: { taunt: { hp: 900 }, reflectTaunter: 0.75 }, title: 'extra: taunter 900 PV + Renvoi épique on it' },
];
module.exports = { SCENARIOS, F3, F2, SHATTER };
