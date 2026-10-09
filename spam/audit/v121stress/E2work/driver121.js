// Evaluated INSIDE the v1.21 engine's vm context. v1.21 top-level names: J (one match, q in v1.20), Y (match
// score, J in v1.20), X (mean, Y in v1.20), Z (engine aggregate, X in v1.20), d (9 profiles), pt (selection ->
// entries), ht (public API), o (config; o.opponent.dpsByTurn = abstract opponent damage per turn).
(() => {
  try {
    const M = MODELS.x1, PROFILES = d, PLAYERS = [1, 2];
    const DPS0 = o.opponent.dpsByTurn.slice();
    const CHECK = { n: 0, max: 0 }; OUT.offenseRecomputeCheck = CHECK;
    const r1 = v => Math.round(v * 10) / 10;
    // same loop order / summation as the engine's Z(): profiles outer, players [1,2] inner, X() = sum/len
    const runDeck = entries => {
      const ms = [];
      for (const prof of PROFILES) for (const p of PLAYERS) {
        globalThis.__stLast = null;
        const r = J(entries, { opponent: prof, player: p });
        const st = globalThis.__stLast;
        const sc = Y(r);
        // NET: offense recomputed with the HP the enemy gained that turn subtracted from useful damage (same turn
        // weights 1.5-0.5*t/n), floored at 0; unchanged for won matches (offense then depends on ttk only)
        let net = sc;
        if (st && r.kills < 4) {
          const U = st.s.usefulByTurn, A = st.addedByTurn, n = U.length, Mx = o.opponent.totalHp, tot = st.s.opp.totalHp;
          let Cg = 0, Cn = 0;
          for (let t = 0; t < n; t++) { const w8 = 1.5 - .5 * (t + 1) / n; Cg += U[t] * w8; Cn += (U[t] - A[t]) * w8; }
          const offG = 3 * Math.min(Cg * (Mx / tot), Mx), offN = 3 * Math.min(Math.max(0, Cn) * (Mx / tot), Mx);
          CHECK.n++; CHECK.max = Math.max(CHECK.max, Math.abs(offG - r.offense));
          net = sc - r.offense + offN;
        }
        ms.push({ sc, net, p, kills: r.kills, eLeft: prof.cardHp * 4 + (st ? st.s.stHp : 0) - r.dmgTotal, info: st ? st.info : null });
      }
      const sum = f => ms.reduce((a, m) => a + f(m), 0);
      const agg = { score: X(ms.map(m => m.sc)), net: r1(X(ms.map(m => m.net))), sP1: r1(X(ms.filter(m => m.p === 1).map(m => m.sc))), sP2: r1(X(ms.filter(m => m.p === 2).map(m => m.sc))), wins: ms.filter(m => m.kills >= 4).length, eLeft: Math.round(sum(m => m.eLeft) / ms.length) };
      if (ms[0].info) agg.noop = sum(m => m.info.absorbNoop);
      return agg;
    };
    const res = [];
    let api = null;
    for (const dk of JOB.decks) {
      const entries = pt(dk.ids.map(id => ({ id, talentId: null })), M.cards);
      const o1 = { key: dk.key, sc: {} };
      for (const sc of JOB.scenarios) {
        globalThis.STRESS = sc.stress || null;
        if (sc.dps) o.opponent.dpsByTurn = DPS0.map(v => v * sc.dps);
        let a;
        try { a = runDeck(entries); } finally { o.opponent.dpsByTurn = DPS0; }
        if (sc.exact) a.exact = a.score;
        a.score = r1(a.score);
        o1.sc[sc.name] = a;
      }
      globalThis.STRESS = null;
      if (JOB.checkX) {
        o1.zScore = Z(entries, {}).score;
        api = api || ht(M);
        o1.evalScore = api.evaluate(dk.ids.map(id => ({ id, talentId: null })), { optimize: false, suggestions: false, shop: false }).score;
      }
      res.push(o1);
    }
    OUT.res = res;
    OUT.dpsRestored = JSON.stringify(o.opponent.dpsByTurn) === JSON.stringify(DPS0);
  } catch (e) { OUT.err = String(e && e.stack || e).slice(0, 1500); }
})();
