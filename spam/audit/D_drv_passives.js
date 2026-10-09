// Agent D driver (runs inside the wiki engine vm via scripts/sim_lab2.js).
// Quantifies, in wiki-score units, (1) losing passives to an opponent's Disparition (removes LAST passive),
// (2) the price/gain of slotting counter Tox on the player's decks. No talents (player has none unlocked).
(() => {
  const ID = { 3: "50807128-85af-472d-b2f7-59737a9a03b4", 12: "6428d28c-4897-46e4-bcc5-5165484fda2b", 69: "e030e28b-0ba3-4c9e-932b-d7c333cadf26", 102: "def9a313-f174-4e62-b4b8-1086d28bd09e", 103: "f55c5b0a-9493-4e19-b3fe-5eac4c281a1f", 116: "feb27db8-e8a5-4ff3-8c30-fc76927965ee", 117: "5721ea5f-5978-4328-8874-28abc283f6b8", 156: "3c5cc4d2-1692-4da7-81ae-eb853c91327f", 160: "76ecb89a-1b3d-4683-b076-5ea3fc20f91a", 227: "4dc96cb5-d342-4ef6-8808-fcc79c63690b", 238: "6598bdc6-b5f4-47a8-be11-761422965f71" };
  const decks = { chimere: [103, 238, 156, 117], zero: [102, 116, 12, 69], alt3_103_117_238: [3, 103, 117, 238], alt69_160_227_238: [69, 160, 227, 238] };
  const L = (num, added, removed) => ({ cardId: ID[num], added: added || [], removed: removed || [] });
  const variants = {
    chimere: {
      base: null,
      vanish1_chimere_loses_Mimetisme: [L(238, [], ['Mimetisme_R'])],
      vanish2_chimere_loses_Mimetisme_and_Vampirisme: [L(238, [], ['Mimetisme_R', 'Life Steal_E'])],
      chimere_loses_Vampirisme_only: [L(238, [], ['Life Steal_E'])],
      vanish1_oeil_loses_CoeurEau: [L(156, [], ['CoeurEau_C'])],
      vanish2_oeil_loses_both: [L(156, [], ['CoeurEau_C', 'Berserk_C'])],
      chimere_Immunity_replaces_Mimetisme: [L(238, ['Immunity_E'], ['Mimetisme_R'])],
      chimere_Tenacite_replaces_Mimetisme: [L(238, ['Tenacite_C'], ['Mimetisme_R'])],
      chimere_PhoenixC_replaces_Mimetisme: [L(238, ['Phoenix_C'], ['Mimetisme_R'])],
      chimere_PhoenixR_replaces_Mimetisme: [L(238, ['Phoenix_R'], ['Mimetisme_R'])],
      chimere_ShieldC_replaces_Mimetisme: [L(238, ['Shield_C'], ['Mimetisme_R'])],
      lame_Brut_free: [L(103, ['Brut_R'])],
      lame_Immunity_free: [L(103, ['Immunity_E'])],
      keria_Immunity_free: [L(117, ['Immunity_E'])],
      keria_Tenacite_free: [L(117, ['Tenacite_C'])],
      lame_Tenacite_free: [L(103, ['Tenacite_C'])],
      lame_Frozen_free: [L(103, ['Frozen_E'])],
      keria_Frozen_free: [L(117, ['Frozen_E'])],
    },
    zero: {
      base: null,
      vanish1_murmures_loses_Multiplicator: [L(102, [], ['Multiplicator_R'])],
      vanish1_hibernatus_loses_Chance: [L(12, [], ['Chance_C'])],
      vanish1_scorch_loses_PrimitiveHeal: [L(69, [], ['Primitive heal_C'])],
      prisonniere_Brut_free: [L(116, ['Brut_R'])],
      scorch_Brut_free: [L(69, ['Brut_R'])],
      prisonniere_Immunity_free: [L(116, ['Immunity_E'])],
      scorch_Immunity_free: [L(69, ['Immunity_E'])],
      scorch_Tenacite_free: [L(69, ['Tenacite_C'])],
      prisonniere_Frozen_free: [L(116, ['Frozen_E'])],
    },
    alt3_103_117_238: { base: null, vanish2_chimere: [L(238, [], ['Mimetisme_R', 'Life Steal_E'])] },
    alt69_160_227_238: { base: null, vanish2_chimere: [L(238, [], ['Mimetisme_R', 'Life Steal_E'])] },
  };
  const res = {};
  for (const [mk, model] of Object.entries(MODELS)) {
    const I = ht(model); res[mk] = {};
    for (const [dk, nums] of Object.entries(decks)) {
      const sel = nums.map(n => ({ id: ID[n], talentId: null }));
      res[mk][dk] = {};
      let base = null;
      for (const [vk, lo] of Object.entries(variants[dk])) {
        let r;
        try { r = I.evaluate(sel, { optimize: false, suggestions: false, shop: false, loadout: lo }); }
        catch (e) { res[mk][dk][vk] = { error: String(e.message || e) }; continue; }
        if (vk === 'base') base = r.score;
        res[mk][dk][vk] = { score: Math.round(r.score), ttk: r.ttk, deltaPct: base ? Math.round(1000 * (r.score - base) / base) / 10 : 0 };
      }
    }
  }
  OUT.res = res;
})();
