// The Tower layer (engine/tower.js): the opponent's action with no Palace mask.
//  1. corpus: Frontier-vs-Frontier walks played with towerChoices for both
//     sides -- every distribution sums to 1, only selectable moves come out,
//     an unforced one IS the interpreter's pick (no mask), and the player's
//     side equals the mirrored opponent's.
//  2. the forced paths in source order (lock, Struggle before Encore, Encore)
//     and the selectable-slot rule (Disable, Choice lock, 0 PP).
//  3. oppActions = ShouldSwitch x (Quick Claw draw x move).
//  4. partyMix vs teammateDist; the Brain; the IV filter; errors.
//  5. the readout against the literal FillTrainerParty loop (rejection-
//     sampled parties, abilities drawn) through oppActions.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const TW = await import(E("tower.js"));
const N = await import(E("next-in.js"));
const SS = await import(E("should-switch.js"));
const T = await import(E("team.js"));
const { mirrorState, mirrorCtx } = await import(E("mirror.js"));
const { FRONTIER_POOL } = await import(E("frontier-pool.js"));
const { FRONTIER_TRAINERS } = await import(E("frontier-trainers.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e;
const sum = (xs) => xs.reduce((a, x) => a + x.p, 0);
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (species, nature, moves, { ability, item = null } = {}) =>
  L.buildMon({ species, level: 50, nature, moves, ability, item, ivs: IV, evs: {}, friendship: 255 });
const frontier = (key, ability = FRONTIER_POOL[key].abilities[0]) => L.buildFrontierOpponent(getOpponentConfig(key, { ability, allowUnreachableTier: true }));
const key = (cs) => JSON.stringify(cs.map((c) => [c.move, c.aiRan, Math.round(c.p * 2 ** 40)]).sort());

// ── 1. corpus ──────────────────────────────────────────────────────────────
{
  let x = 11;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const draw = (cs) => { let u = r() * sum(cs); for (const c of cs) { u -= c.p; if (u <= 0) return c; } return cs[cs.length - 1]; };
  const names = Object.keys(FRONTIER_POOL).filter((n) => FRONTIER_POOL[n].lv50Legal);
  const mkF = (n) => L.buildMon({ ...getOpponentConfig(n, { ability: pick(FRONTIER_POOL[n].abilities) }), friendship: 255 });
  let pos = 0, sumBad = 0, illegal = 0, notInterp = 0, mirrorBad = 0, forced = 0, refusedPos = 0, throwsN = 0;
  const throwKinds = new Map();
  for (let i = 0; i < 300; i++) {
    const you = mkF(pick(names)), opp = mkF(pick(names));
    const ctx = { you, opp, noLabels: true };
    let s = L.buildStartState({ you, opp });
    for (let d = 0; d < 5 && s.yourHpPct > 0 && s.oppHpPct > 0; d++) {
      pos++;
      let yc, oc;
      try {
        oc = TW.towerChoices(ctx, s, "opp");
        yc = TW.towerChoices(ctx, s, "you");
        const ec = L.effectiveCtx(ctx, s);
        const legalO = L.selectableMoves(ec.opp.moves, s, "opp", ec.you, "the opponent");
        if (!near(sum(oc), 1, 1e-9) || !near(sum(yc), 1, 1e-9)) sumBad++;
        if (oc.some((c) => !legalO.includes(c.move) && c.move !== "Struggle")) illegal++;
        if (oc[0].aiRan) {
          if (oc[0].refused > 1e-9) refusedPos++;
          else {
            const interp = L.chooseOpponentMoves(ec.opp, ec.you, L.aiDecisionState(s, "opp"), { qc: false });
            if (key(oc) !== key(interp.map((c) => ({ move: c.move, aiRan: true, p: c.prob })))) notInterp++;
          }
        } else forced++;
        if (key(yc) !== key(TW.towerChoices(mirrorCtx(ctx), mirrorState(s), "opp"))) mirrorBad++;
        let st = s;
        const y = draw(yc), o = draw(oc);
        if (y.aiRan) st = L.aiDecisionState(st, "you");
        if (o.aiRan) st = L.aiDecisionState(st, "opp");
        s = draw(L.resolveTurn(ctx, st, y.move, o.move)).state;
      } catch (e) {
        throwsN++;
        const k = e.message.slice(0, 70);
        throwKinds.set(k, (throwKinds.get(k) ?? 0) + 1);
        break;
      }
    }
  }
  ok(sumBad === 0, `corpus: every choice sums to 1 (${sumBad} off of ${pos})`);
  ok(illegal === 0, `corpus: only selectable moves come out (${illegal} positions with one that is not)`);
  ok(notInterp === 0, `corpus: an unforced, unrefused choice IS the interpreter's (no mask) (${notInterp} differ)`);
  ok(mirrorBad === 0, `corpus: the player's choice == the mirrored opponent's (${pos - mirrorBad}/${pos})`);
  ok(pos > 800, `corpus: enough positions (${pos})`);
  console.log(`  corpus: ${pos} positions, ${forced} forced, ${refusedPos} with a refused first pick, ${throwsN} named throws${throwsN ? ": " + [...throwKinds].map(([k, n]) => `${n}x ${k}`).join(" | ") : ""}`);
}

// ── 2. forced paths and the selectable-slot rule ───────────────────────────
{
  const you = mk("Snorlax", "Adamant", ["Body Slam", "Earthquake", "Shadow Ball", "Curse"], { ability: "Thick Fat" });
  const opp = mk("Starmie", "Timid", ["Surf", "Thunderbolt", "Ice Beam", "Recover"], { ability: "Natural Cure" });
  const ctx = { you, opp, noLabels: true };
  const s0 = { ...L.buildStartState({ you, opp }), turn: 3, youMonFirstTurn: false, oppMonFirstTurn: false };
  const free = TW.towerChoices(ctx, s0, "opp");
  ok(free.every((c) => c.aiRan) && near(sum(free), 1), "free choice: the AI ran");
  // Disable: the disabled slot never comes out.
  const top = free[0].move;
  const dis = TW.towerChoices(ctx, { ...s0, oppDisabledMove: top, oppDisableTurns: 3 }, "opp");
  ok(!dis.some((c) => c.move === top) && near(sum(dis), 1), `Disable on ${top}: never picked`);
  // Choice lock: only the locked move.
  const band = mk("Starmie", "Timid", ["Surf", "Thunderbolt", "Ice Beam", "Recover"], { ability: "Natural Cure", item: "Choice Band" });
  const cb = TW.towerChoices({ ...ctx, opp: band }, { ...s0, oppChoiceLock: "Ice Beam" }, "opp");
  ok(cb.length === 1 && cb[0].move === "Ice Beam" && cb[0].aiRan, "Choice lock: only the locked move (the AI still ran)");
  // 0 PP on a slot: never picked.
  const pp = TW.towerChoices(ctx, { ...s0, oppPP: [0, 15, 10, 5] }, "opp");
  ok(!pp.some((c) => c.move === "Surf"), "a slot with 0 PP is never picked");
  // Encore: the encored move, no AI.
  const enc = TW.towerChoices(ctx, { ...s0, oppEncoredMove: "Recover", oppEncoreTurns: 3 }, "opp");
  ok(enc.length === 1 && enc[0].move === "Recover" && !enc[0].aiRan, "Encore: the encored move, AI not asked");
  // AreAllMovesUnusable before Encore (src/battle_main.c:4183 then :4192):
  // encored into a move with 0 PP and nothing else selectable -> Struggle.
  const st = TW.towerChoices(ctx, { ...s0, oppEncoredMove: "Recover", oppEncoreTurns: 3, oppPP: [10, 10, 10, 0] }, "opp");
  ok(st.length === 1 && st[0].move === "Struggle" && !st[0].aiRan, `Encore on a 0-PP move: Struggle first (${JSON.stringify(st)})`);
  // A rampage lock: the move, no AI.
  const lk = TW.towerChoices(ctx, { ...s0, oppLock: { kind: "rampage", move: "Surf", turnsLeft: 1 } }, "opp");
  ok(lk.length === 1 && lk[0].move === "Surf" && !lk[0].aiRan, "a lock: the locked move, AI not asked");
}

// ── 3. oppActions = ShouldSwitch x move ────────────────────────────────────
{
  const team = [mk("Metagross", "Adamant", ["Meteor Mash", "Earthquake", "Shadow Ball", "Aerial Ace"], { ability: "Clear Body", item: "Choice Band" })];
  const keys = ["Snorlax 3", "Charizard 3", "Starmie 3"];
  const B = { team, oppTeam: keys.map((k) => frontier(k)), oppIds: keys.map(N.setId) };
  const base = L.buildStartState({ you: team[0], opp: B.oppTeam[0], yourUsablePartyMons: 0, oppUsablePartyMons: 2 });
  const s = { ...base, youActive: 0, youBench: [null], oppActive: 0, oppBench: [null, T.freshEntry(B.oppTeam[1]), T.freshEntry(B.oppTeam[2])],
    turn: 2, youMonFirstTurn: false, oppMonFirstTurn: false, youLastMove: "Earthquake", oppLastLanded: "Earthquake" };
  const acts = TW.oppActions(B, s);
  const sw = SS.oppSwitchOdds(B, s);
  const pStay = sw.filter((d) => d.slot == null).reduce((a, d) => a + d.p, 0);
  const pSw = acts.filter((a) => a.kind === "switch").reduce((a, r) => a + r.p, 0);
  ok(near(sum(acts), 1, 1e-12), "oppActions sums to 1");
  ok(pSw > 0 && near(pSw, 1 - pStay, 1e-12), `P(switch) = ShouldSwitch's (${pSw.toFixed(6)})`);
  ok(acts.some((a) => a.kind === "switch" && a.slot === 1), "Earthquake landed: Charizard (immune, Fire vs Steel) is a switch target");
  const ctx = T.engineCtx({ team, opp: B.oppTeam[0], oppReserves: 2 }, s);
  const mv = TW.towerChoices(ctx, s, "opp");
  const bad = mv.filter((c) => !near(acts.find((a) => a.kind === "move" && a.move === c.move)?.p ?? 0, pStay * c.p, 1e-12));
  ok(bad.length === 0, "each move row = P(stay) x the AI's choice");
}

// ── 4. partyMix ────────────────────────────────────────────────────────────
{
  const q = { lead: "Snorlax 3", challenge: 7, battle: 1 };
  const all = TW.partyMix(q);
  const td = N.teammateDist(N.trainerPrior({ challenge: 7, battle: 1 }), N.setId("Snorlax 3"));
  ok(all.length === td.length && near(sum(all), 1, 1e-9) && all.every((m) => m.ids[0] === N.setId("Snorlax 3")), `no evidence: the teammate distribution itself (${all.length} orderings)`);
  const seen = TW.partyMix({ ...q, seen: ["Starmie 3"] });
  const st = N.setId("Starmie 3");
  const want = td.filter((d) => d.slots.includes(st)), tot = want.reduce((a, d) => a + d.p, 0);
  ok(seen.length === want.length && near(sum(seen), 1, 1e-9) && seen.every((m) => m.ids.includes(st)), `seen Starmie 3: the orderings holding it, renormalised (${seen.length})`);
  ok(near(seen[0].p, want[0].p / tot, 1e-12), "renormalised by the kept mass");
  // a lead two IV bands can bring at challenge 7, battle 1 (trainers 18 / 21)
  const two = Object.keys(FRONTIER_POOL).filter((k) => Number.isInteger(FRONTIER_POOL[k].index) && FRONTIER_POOL[k].index <= 849)
    .map((k) => { try { return { k, m: TW.partyMix({ ...q, lead: k }) }; } catch { return null; } })
    .find((x) => x && new Set(x.m.map((m) => m.ivs)).size > 1);
  const ivs = [...new Set(two.m.map((m) => m.ivs))];
  const one = TW.partyMix({ ...q, lead: two.k, ivs: ivs[0] });
  ok(ivs.length > 1 && one.length < two.m.length && one.every((m) => m.ivs === ivs[0]) && near(sum(one), 1, 1e-9), `IV filter keeps one trainer band (${two.k}: ${ivs.join("/")} -> ${ivs[0]})`);
  ok(throws(() => TW.partyMix({ ...q, ivs: 2 }), /no trainer here/), "an IV no trainer here gives throws");
  ok(throws(() => TW.partyMix({ ...q, seen: ["Snorlax 4"] }), /cannot be/), "a second Snorlax cannot be a teammate (species clause)");
  const an = TW.partyMix({ lead: "Anabel Gold Raikou", seen: ["Anabel Gold Snorlax"], brain: "Anabel Gold" });
  ok(an.length === 1 && an[0].p === 1 && an[0].ivs === 31, "Anabel Gold: her fixed team, IVs 31");
}

console.log(`${fail ? "FAIL" : "ok"}  tower (1-4): ${pass}/${pass + fail}`);

// ── 5. readout vs the literal loop ─────────────────────────────────────────
{
  const lead = "Snorlax 3", ch = 7, iv = 18;
  const team = [mk("Metagross", "Adamant", ["Meteor Mash", "Earthquake", "Shadow Ball", "Aerial Ace"], { ability: "Clear Body", item: "Choice Band" })];
  const leadMon = frontier(lead);
  const base = { ...L.buildStartState({ you: team[0], opp: leadMon, yourUsablePartyMons: 0, oppUsablePartyMons: 2 }),
    youActive: 0, youBench: [null], turn: 2, youMonFirstTurn: false, oppMonFirstTurn: false, youLastMove: "Earthquake", oppLastLanded: "Earthquake" };
  const mix = TW.partyMix({ lead, challenge: ch, battle: 1, ivs: iv });
  const ro = TW.oppReadout({ team, s: base, mix, known: { [lead]: { mon: leadMon } }, active: lead });
  ok(near(sum(ro.rows), 1, 1e-9), "readout sums to 1");
  // Rejection sampling: trainer uniform in the range, the ROM's draw loop,
  // kept when slot 0 is the lead and the trainer's IVs are 18; unseen
  // teammates' abilities 50/50.
  let seed = 4242;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 24691) >>> 0) >>> 8;
  const prior = N.trainerPrior({ challenge: ch, battle: 1 });
  const leadId = N.setId(lead);
  const join = (m, chosen) => { const e = N.poolEntry(m); return m <= 849 && chosen.every((c) => { const o = N.poolEntry(c); return o.species !== e.species && !(o.item && o.item === e.item) && c !== m; }); };
  const acc = new Map();
  let kept = 0, drawn = 0;
  const N_KEEP = 6000;
  while (kept < N_KEEP) {
    drawn++;
    const t = FRONTIER_TRAINERS[prior[rnd() % prior.length].id];
    if (N.fixedIvs(t.id) !== iv) continue;
    const chosen = [];
    while (chosen.length < 3) { const m = t.monSet[rnd() % t.monSet.length]; if (join(m, chosen)) chosen.push(m); }
    if (chosen[0] !== leadId) continue;
    kept++;
    const mons = [leadMon, ...chosen.slice(1).map((id) => { const f = N.buildReplacement(id, iv); return f[f.length > 1 ? rnd() & 1 : 0].mon; })];
    const B = { team, oppTeam: mons, oppIds: chosen };
    const s = { ...base, oppActive: 0, oppBench: [null, T.freshEntry(mons[1]), T.freshEntry(mons[2])] };
    for (const a of TW.oppActions(B, s)) {
      const k = a.kind === "move" ? a.move : N.poolEntry(chosen[a.slot]).key;
      acc.set(k, (acc.get(k) ?? 0) + a.p);
    }
  }
  let worstZ = 0, worstK = "";
  for (const r of ro.rows) {
    const k = r.kind === "move" ? r.move : r.key;
    const est = (acc.get(k) ?? 0) / kept;
    // conservative sd: each kept party contributes a value in [0, 1]
    const sd = Math.sqrt(Math.max(r.p * (1 - r.p), 1e-6) / kept);
    const z = Math.abs(est - r.p) / sd;
    if (z > worstZ) { worstZ = z; worstK = `${k} exact ${r.p.toFixed(4)} sampled ${est.toFixed(4)}`; }
  }
  const extra = [...acc.keys()].filter((k) => !ro.rows.some((r) => (r.kind === "move" ? r.move : r.key) === k));
  ok(extra.length === 0, `no sampled action missing from the readout (${extra.join(", ")})`);
  ok(worstZ < 4, `readout vs ${kept} literal-loop parties (${drawn} drawn): worst |z| ${worstZ.toFixed(2)} (${worstK})`);
  console.log(`  readout: P(switch) ${ro.pSwitch.toFixed(4)}, ${ro.rows.length} rows; sampled P(switch) ${([...acc].filter(([k]) => FRONTIER_POOL[k]).reduce((a, [, v]) => a + v, 0) / kept).toFixed(4)}`);
}

console.log(`${fail ? "FAIL" : "ok"}  tower: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
