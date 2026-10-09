// Evaluated INSIDE the engine's vm context. Engine top-level bindings used: q (one match), J (match score),
// Y (mean), d (the 9 opponent profiles), pt (selection -> entries), X (engine aggregate), ht (public API).
(() => {
  try {
    const M = MODELS.x1, PROFILES = d, PLAYERS = [1, 2];
    const CHECK = { n: 0, max: 0 }; OUT.offenseRecomputeCheck = CHECK;
    const r1 = v => Math.round(v * 10) / 10;
    // Same loop order and summation as the engine's X(): profiles outer, players [1,2] inner, Y() = sum/len.
    const runDeck = entries => {
      const ms = [];
      for (const prof of PROFILES) for (const p of PLAYERS) {
        globalThis.__stLast = null;
        const r = q(entries, { opponent: prof, player: p });
        const st = globalThis.__stLast;
        // enemy HP still standing after the 10 simulated turns (abstract pool + HP added by absorb/heal/revive)
        const eLeft = prof.cardHp * 4 + (st ? st.s.stHp : 0) - r.dmgTotal;
        const sc = J(r);
        // NET score: the engine's offense when the match is not over is 3*min(C*M/totalHp, M) with
        // C = sum_t usefulDamage_t * (1.5 - 0.5*t/n). Net = same formula with HP the enemy GAINED (absorb gain,
        // heal, revive) subtracted from that turn's useful damage. Matches already won (over) are unchanged.
        let net = sc;
        if (st && r.kills < 4) {
          const U = st.s.usefulByTurn, A = st.addedByTurn, n = U.length, Mx = o.opponent.totalHp, tot = st.s.opp.totalHp;
          let Cg = 0, Cn = 0;
          for (let t = 0; t < n; t++) { const w = 1.5 - .5 * (t + 1) / n; Cg += U[t] * w; Cn += (U[t] - A[t]) * w; }
          const offG = 3 * Math.min(Cg * (Mx / tot), Mx), offN = 3 * Math.min(Math.max(0, Cn) * (Mx / tot), Mx); // floor: no progress below zero
          CHECK.n++; CHECK.max = Math.max(CHECK.max, Math.abs(offG - r.offense));
          net = sc - r.offense + offN;
        }
        ms.push({ sc, net, p, ttk: r.ttk, kills: r.kills, od: r.ownDeaths, eLeft, hpLeft: r.hpLeft, info: st ? st.info : null });
      }
      const score = Y(ms.map(m => m.sc));
      const sum = f => ms.reduce((a, m) => a + f(m), 0);
      const agg = {
        score, net: r1(Y(ms.map(m => m.net))), nP1: r1(Y(ms.filter(m => m.p === 1).map(m => m.net))), nP2: r1(Y(ms.filter(m => m.p === 2).map(m => m.net))), sP1: r1(Y(ms.filter(m => m.p === 1).map(m => m.sc))), sP2: r1(Y(ms.filter(m => m.p === 2).map(m => m.sc))),
        ttk: r1(sum(m => m.ttk) / ms.length), kills: r1(sum(m => m.kills) / ms.length), own: r1(sum(m => m.od) / ms.length),
        wins: ms.filter(m => m.kills >= 4).length,
        eLeft: Math.round(sum(m => m.eLeft) / ms.length), hpLeft: Math.round(sum(m => m.hpLeft) / ms.length),
      };
      if (ms[0].info) {
        agg.absorbed = sum(m => m.info.absorbed); agg.noop = sum(m => m.info.absorbNoop);
        agg.cd = sum(m => m.info.cdReset); agg.set = sum(m => m.info.setHp);
        agg.healed = r1(sum(m => m.info.healed) / ms.length); agg.rev = sum(m => m.info.revived);
      }
      return agg;
    };
    const res = [];
    let api = null;
    for (const dk of JOB.decks) {
      const entries = pt(dk.ids.map(id => ({ id, talentId: null })), M.cards);
      const o1 = { key: dk.key, sc: {} };
      for (const sc of JOB.scenarios) {
        globalThis.STRESS = sc.stress || null;
        const a = runDeck(entries);
        if (sc.exact) a.exact = a.score;
        a.score = r1(a.score);
        o1.sc[sc.name] = a;
      }
      globalThis.STRESS = null;
      if (JOB.checkX) {
        // engine aggregate and public API on the same deck, STRESS off
        o1.xScore = X(entries, {}).score;
        api = api || ht(M);
        o1.evalScore = api.evaluate(dk.ids.map(id => ({ id, talentId: null })), { optimize: false, suggestions: false, shop: false }).score;
      }
      res.push(o1);
    }
    OUT.res = res;
  } catch (e) { OUT.err = String(e && e.stack || e).slice(0, 1500); }
})();
