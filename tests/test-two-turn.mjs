// The ranking and the two-turn advisor (engine/advise.js better / playTwo,
// site/ui-logic.js rankAdvice / mergeParts), and the readout's reuse
// (engine/tower.js switchPlan / plans).
//  1. "KO first": logic.js marks an outcome neverActed exactly when the
//     engine's own text says the second actor never acted, knocked out;
//     pKOFirst <= pKO, = pKO when you outspeed, < pKO when you do not.
//  2. the ranking rule on hand-made rows.
//  3. the readout with its switch half reused (plans) = the readout party by
//     party, on start positions and on turn-1 outcomes, a Natural Cure
//     sleeper on both sides of half HP included.
//  4. playTwo against a brute force written here: every turn-1 outcome
//     played on its own (no HP bands), the readout rerun, your best reply by
//     the rule. Tiny bands = brute force exactly; the default bands within
//     a stated tolerance -- on Aerial Ace into Milotic, where Milotic's AI
//     Recovers below 70% and uniform bands were 11 points off.
//  5. the page's slices add up to the whole (mergeParts).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const A = await import(E("advise.js"));
const TW = await import(E("tower.js"));
const { AI_CODE } = await import(E("ai-program.js"));
const U = await import(pathToFileURL(path.join(here, "../site/ui-logic.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const cfgs = U.parseTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8")); // Metagross, Latios, Swampert
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const formOf = (key, challenge, o = {}, active = 0) => ({ team: cfgs, active, mons: cfgs.map(() => ({ hpPct: 100, status: "" })),
  you: { stages: zero, confused: 0, subPct: 0, firstTurn: true, lastMove: null, landed: true, seen: [] },
  opp: { setKey: key, ability: null, ivTier: U.ivTierOdds(key, { challenge, battle: 1 })[0].iv, hpPct: 100, status: "", stages: zero, confused: 0, firstTurn: true, ...o },
  party: { lead: null, others: [] }, field: {}, run: { challenge, battle: 1, turn: 1 } });
// one candidate's pieces: its tctx, start state, readout (plain or reused)
function world(form) {
  const pos = U.buildPosition(form), c = pos.cands[0];
  const plans = new Map();
  const base = { team: pos.team, mix: c.mix, known: c.known, active: c.key, level: pos.level };
  const ro = (st, o = {}) => TW.oppReadout({ ...base, s: st, ...o });
  const opp = (st, o) => { const r = ro(st, o); return { pStay: 1 - r.pSwitch, switches: r.switchForms }; };
  return { pos, c, s: c.start[0].state, tctx: { team: pos.team, opp: c.opp, oppReserves: 2, activeKey: c.key }, ro, opp, plans };
}
const EXACT = { exactRoll: true, rollOutcomeCap: A.ROLL_CAP };

// ── 1. KO first ────────────────────────────────────────────────────────────
{
  const w = world(formOf("Milotic 4", 8, { hpPct: 30 }));
  let n = 0, agree = 0, marked = 0;
  for (const yourMove of ["Meteor Mash", "Earthquake"]) for (const oppMove of ["Surf", "Recover", "Mirror Coat"]) {
    const ctx = T.engineCtx({ ...w.tctx, ...EXACT, labels: true }, w.s);
    for (const r of L.resolveTurn(ctx, w.s, yourMove, oppMove)) {
      n++;
      const said = /opp never acts — KO/.test(r.label) && r.state.oppHpPct <= 0;
      if ((r.neverActed === "opp") === said) agree++;
      if (r.neverActed === "opp") marked++;
    }
  }
  ok(n > 0 && agree === n && marked > 0, `neverActed = the engine's "opp never acts — KO" on all ${n} outcomes (${marked} marked)`);
  const mm = A.adviseOption(w.tctx, w.s, { kind: "move", move: "Meteor Mash" }, w.opp(w.s));
  console.log(`  Metagross Meteor Mash into Milotic 30%: KO ${U.pct(mm.pKO, 1)}, KO first ${U.pct(mm.pKOFirst, 1)}`);
  ok(mm.pKO > 0.5 && near(mm.pKOFirst, mm.pKO), "Metagross outspeeds Milotic: every KO is a KO first");
  // Swampert (slower) into a hurt Salamence: it moves first, so its KOs come after its hit
  const ws = world(formOf("Salamence 7", 8, { hpPct: 15 }, 2));
  const ib = A.adviseOption(ws.tctx, ws.s, { kind: "move", move: "Ice Beam" }, ws.opp(ws.s));
  console.log(`  Swampert Ice Beam into Salamence 15%: KO ${U.pct(ib.pKO, 1)}, KO first ${U.pct(ib.pKOFirst, 1)}`);
  ok(ib.pKO > 0.5 && ib.pKOFirst < ib.pKO - 0.3, "Salamence outspeeds Swampert: KO first well below KO");
  const rows = A.yourOptions(w.tctx, w.s).map((o) => A.adviseOption(w.tctx, w.s, o, w.opp(w.s)));
  ok(rows.every((r) => r.pKOFirst <= r.pKO + 1e-12), "KO first never above KO");
}

// ── 2. the ranking rule ────────────────────────────────────────────────────
{
  const r = (label, pKOFirst, taken) => ({ label, pKOFirst, taken, pKO: pKOFirst });
  const ranked = U.rankAdvice([r("a", 0.5, 30), r("b", 0.505, 10), r("c", 0.2, 0), { label: "d", error: "x" }, r("e", 0.9, 80)]);
  ok(ranked.map((x) => x.label).join() === "e,b,a,c,d", `KO first, then least taken within 1 point, errors last (${ranked.map((x) => x.label).join()})`);
  ok(ranked[0].best && ranked.filter((x) => x.best).length === 1, "one best, the top");
  ok(A.better(r("x", 0.3, 50), r("y", 0.28, 0)) && !A.better(r("x", 0.3, 50), r("y", 0.295, 0)), "a 2-point KO lead beats any damage; a half-point one does not");
}

// ── 3. the readout, reused = party by party ────────────────────────────────
{
  const sameReadout = (a, b) => {
    const m = (r) => new Map(r.rows.map((x) => [x.kind === "move" ? `m|${x.move}` : `s|${x.key}`, x.p]));
    const ma = m(a), mb = m(b);
    const f = (r) => new Map(r.switchForms.map((x) => [`${x.key}|${x.mon.ability}`, x.p]));
    const fa = f(a), fb = f(b);
    return ma.size === mb.size && [...ma].every(([k, p]) => near(p, mb.get(k) ?? -1, 1e-12)) && near(a.refused, b.refused, 1e-12)
      && fa.size === fb.size && [...fa].every(([k, p]) => near(p, fb.get(k) ?? -1, 1e-12));
  };
  let n = 0, same = 0, switchy = 0;
  for (const [key, ch, o, act] of [["Milotic 4", 8, {}, 0], ["Snorlax 3", 7, {}, 0], ["Salamence 7", 8, {}, 2], ["Starmie 7", 8, { ability: "Natural Cure", status: "sleep", sleep: { rest: false, slept: 1 } }, 0]]) {
    let w;
    try { w = world(formOf(key, ch, o, act)); } catch (e) { ok(false, `${key}: ${e.message}`); continue; }
    const states = [w.s];
    for (const opt of A.yourOptions(w.tctx, w.s)) {
      const outs = A.playOption({ ...w.tctx, ...EXACT }, w.s, opt, w.opp(w.s)).filter((x) => x.theirs.length === 1 && x.state.oppHpPct > 0 && x.state.yourHpPct > 0 && !x.left);
      for (let i = 0; i < outs.length; i += Math.max(1, Math.floor(outs.length / 6))) states.push(outs[i].state);
    }
    if (key === "Starmie 7") states.push({ ...w.s, oppHpPct: 60 }, { ...w.s, oppHpPct: 40 }); // both sides of Natural Cure's half
    for (const st of states) {
      n++;
      const plain = w.ro(st, { cache: false }), reused = w.ro(st, { plans: w.plans });
      if (sameReadout(plain, reused)) same++;
      if (plain.pSwitch > 0) switchy++;
    }
  }
  ok(n > 40 && same === n, `readout with the switch half reused = party by party on ${same}/${n} positions (${switchy} with switches)`);
}

// ── 4. playTwo vs brute force ──────────────────────────────────────────────
// The brute force: every turn-1 outcome where both are still out and it did
// not switch or leave, merged only when the WHOLE state is the same (the
// per-turn damage record aside); the readout rerun; the best reply by `better`.
const DROP = new Set(["youDamageTaken", "oppDamageTaken"]);
function brute(w, option) {
  const outs = A.playOption({ ...w.tctx, ...EXACT }, w.s, option, w.opp(w.s));
  const acc = { ...A.summarize(w.s, outs), pPlayed: 0 };
  const by = new Map();
  for (const o of outs) {
    if (o.left || o.theirs.length !== 1 || o.theirs[0][1] <= 0 || o.state.yourHpPct <= 0) continue;
    const k = JSON.stringify(o.state, (key, v) => (DROP.has(key) ? undefined : v === undefined ? "~u" : v));
    const e = by.get(k); if (e) e.p += o.p; else by.set(k, { p: o.p, st: o.state });
  }
  for (const { p, st } of by.values()) {
    const opp = w.opp(st, { plans: w.plans });
    let best = null;
    for (const o2 of A.yourOptions(w.tctx, st)) {
      let x; try { x = A.adviseOption(w.tctx, st, o2, opp); } catch { continue; }
      if (!best || A.better(x, best)) best = x;
    }
    acc.pPlayed += p;
    for (const k of ["pKO", "pKOFirst", "pFaint", "dealt", "taken"]) acc[k] += p * best[k];
  }
  return { ...acc, states: by.size };
}
{
  const w = world(formOf("Milotic 4", 8));
  const ro = (st) => w.opp(st, { plans: w.plans });
  for (const label of ["Switch to Swampert", "Earthquake", "Aerial Ace"]) {
    const option = A.yourOptions(w.tctx, w.s).find((o) => o.label === label);
    const b = brute(w, option);
    const tiny = A.playTwo(w.tctx, w.s, option, w.opp(w.s), ro, { width: 1e-9 });
    const dflt = A.playTwo(w.tctx, w.s, option, w.opp(w.s), ro);
    const f = (x) => `KO first ${(100 * x.pKOFirst).toFixed(2)} taken ${x.taken.toFixed(2)}`;
    console.log(`  ${label}: brute (${b.states} positions) ${f(b)} | bands ${A.HP_BAND}% (${dflt.groups}) ${f(dflt)}`);
    ok(["pKO", "pKOFirst", "pFaint", "dealt", "taken", "pPlayed"].every((k) => near(tiny[k], b[k], 1e-9)), `${label}: tiny bands = brute force exactly`);
    ok(near(dflt.pKOFirst, b.pKOFirst, 0.01) && near(dflt.pKO, b.pKO, 0.01) && near(dflt.taken, b.taken, 1) && near(dflt.dealt, b.dealt, 1) && near(dflt.pPlayed, b.pPlayed, 1e-9),
      `${label}: ${A.HP_BAND}% bands within 1 point of brute force`);
  }
  const edgesOk = AI_CODE.filter((c) => c.op === "if_hp_less_than").every((c) => A.AI_HP_EDGES.includes(c.a.param1))
    && AI_CODE.filter((c) => c.op === "if_hp_more_than").every((c) => A.AI_HP_EDGES.includes(c.a.param1 + 1));
  ok(edgesOk && A.AI_HP_EDGES.includes(70), `band edges = every AI HP cutoff (${A.AI_HP_EDGES.join(",")})`);

  // a turn 1 that always ends the count: nothing left for turn 2
  const wk = world(formOf("Milotic 4", 8, { hpPct: 1 }));
  const mm = A.yourOptions(wk.tctx, wk.s).find((o) => o.label === "Meteor Mash");
  const one = A.adviseOption(wk.tctx, wk.s, mm, wk.opp(wk.s)), two = A.playTwo(wk.tctx, wk.s, mm, wk.opp(wk.s), (st) => wk.opp(st));
  ok(two.pKO >= one.pKO - 1e-12 && two.pKO - one.pKO <= two.pPlayed + 1e-12 && two.pPlayed < 0.3 && near(two.pPlayed + one.pKO + one.pFaint, 1, 0.1),
    `Milotic at 1%: turn 1 counted once, turn 2 only where it was missed (KO ${U.pct(one.pKO, 1)} -> ${U.pct(two.pKO, 1)}, played ${U.pct(two.pPlayed, 1)})`);
}

// a position where it switches (Snorlax after a landed Earthquake): turn 2 is
// not played after its switch, and a KO there counts as first (it never attacked)
{
  const f = formOf("Snorlax 3", 7, { firstTurn: false });
  const w = world({ ...f, you: { ...f.you, firstTurn: false, lastMove: "Earthquake", landed: true, seen: ["Earthquake"] }, run: { ...f.run, turn: 2 } });
  const opp0 = w.opp(w.s);
  const option = A.yourOptions(w.tctx, w.s).find((o) => o.label === "Switch to Latios");
  const outs = A.playOption({ ...w.tctx, ...EXACT }, w.s, A.yourOptions(w.tctx, w.s).find((o) => o.label === "Earthquake"), opp0);
  const sw = outs.filter((o) => o.theirs.length === 2);
  ok(opp0.switches.length > 0 && sw.length > 0 && sw.every((o) => o.first === true), `its switch: ${sw.length} outcomes, all "it never attacked" (P(switch) ${U.pct(1 - opp0.pStay, 1)})`);
  const b = brute(w, option);
  const tiny = A.playTwo(w.tctx, w.s, option, opp0, (st) => w.opp(st, { plans: w.plans }), { width: 1e-9 });
  ok(["pKO", "pKOFirst", "pFaint", "dealt", "taken", "pPlayed"].every((k) => near(tiny[k], b[k], 1e-9)) && b.pPlayed < 1 - 1e-6,
    `with switches: tiny bands = brute force exactly, turn 2 only where it stayed (played ${U.pct(b.pPlayed, 1)})`);
}

// ── 5. slices add up ───────────────────────────────────────────────────────
{
  const pos = U.buildPosition(formOf("Milotic 4", 8));
  const whole = U.advise(pos, { turns: 2, only: ["Earthquake", "Switch to Latios"] });
  const merged = U.mergeParts([0, 1, 2].map((k) => U.advise(pos, { turns: 2, only: ["Earthquake", "Switch to Latios"], part: [k, 3] })));
  const sameRow = (a, b) => a && b && ["pKO", "pKOFirst", "pFaint", "dealt", "taken", "pLeaves", "pPlayed", "cover"].every((k) => near(a[k], b[k], 1e-9))
    && a.follow.length === b.follow.length && a.follow.every(([l, q], i) => b.follow[i][0] === l && near(q, b.follow[i][1], 1e-9));
  ok(whole.length === 2 && whole.every((r) => sameRow(r, merged.find((m) => m.label === r.label))), "three slices merged = the whole");
  ok(whole.every((r) => r.follow.reduce((a, [, q]) => a + q, 0) <= r.pPlayed + 1e-9), "follow-ups share out the played mass");
}

console.log(`${fail ? "FAIL" : "ok"}  two-turn: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
