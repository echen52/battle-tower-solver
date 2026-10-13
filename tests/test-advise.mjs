// The one-turn advisor (engine/advise.js).
//  1. its turn shapes against the inherited team layer, where the Palace's
//     choices are forced (Encore: palaceChoices and towerChoices both return
//     the encored move), so the two must produce the same successors:
//     move vs move = palaceTurn; your switch = team.js switchTurn (incl.
//     Pursuit on the leaver); its switch = battle.js oppSwitchTurn.
//  2. exact rolls vs the engine's drawn rolls (rollSample), sampled turn by
//     turn: P(KO) within 4 sd.
//  3. summarize on hand-made outcomes; yourOptions (lock, Encore, trapping).
//  4. ui-logic advise = the candidates' advice weighted by their odds.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const Bt = await import(E("battle.js"));
const N = await import(E("next-in.js"));
const P = await import(E("palace.js"));
const A = await import(E("advise.js"));
const TW = await import(E("tower.js"));
const SD = await import(E("showdown.js"));
const U = await import(pathToFileURL(path.join(here, "../site/ui-logic.js")).href);
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sum = (xs) => xs.reduce((a, x) => a + x.p, 0);
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (species, nature, moves, { ability, item = null } = {}) => L.buildMon({ species, level: 50, nature, moves, ability, item, ivs: IV, evs: {}, friendship: 255 });
const opp = (key, ability) => L.buildFrontierOpponent(getOpponentConfig(key, { ability, allowUnreachableTier: true }));
const ME = SD.parseShowdownTeam(`Swampert @ Leftovers
Ability: Torrent
Level: 50
EVs: 252 HP / 252 Def
Relaxed Nature
- Earthquake
- Surf
- Ice Beam
- Rest

Sceptile @ Lum Berry
Ability: Overgrow
Level: 50
EVs: 252 SpA / 252 Spe
Timid Nature
- Leaf Blade
- Giga Drain
- Thunderpunch
- Earthquake

Metagross @ Choice Band
Ability: Clear Body
Level: 50
EVs: 252 Atk / 252 HP
Adamant Nature
- Meteor Mash
- Earthquake
- Shadow Ball
- Aerial Ace`).map((c) => T.buildPlayerMon(c));

// successor multisets, compared on the fields both layers own
const STRIP = new Set(["youPalaceLowHp", "oppPalaceLowHp"]);
const canon = (st, drop = []) => JSON.stringify(st, (k, v) => (STRIP.has(k) || drop.includes(k) ? undefined : v));
function bag(outs, drop) {
  const m = new Map();
  for (const o of outs) { const k = canon(o.state, drop); m.set(k, (m.get(k) ?? 0) + o.p); }
  return m;
}
function sameBag(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, p] of a) if (!near(p, b.get(k) ?? -1, 1e-12)) return false;
  return true;
}

// ── 1. turn shapes vs the team layer (both choices forced by Encore) ───────
{
  // B: your three vs a Tyranitar (Pursuit) leading Slaking / Lapras.
  const ttar = mk("Tyranitar", "Adamant", ["Pursuit", "Crunch", "Earthquake", "Rock Slide"], { ability: "Sand Stream" });
  const B = { team: ME, oppTeam: [ttar, opp("Spenser Silver Slaking"), opp("Spenser Silver Lapras", "Water Absorb")], oppIds: [N.setId("Tyranitar 1"), N.setId("Spenser Silver Slaking"), N.setId("Spenser Silver Lapras")] };
  const s0 = { ...Bt.battleStart(B, 0), turn: 2, youMonFirstTurn: false, oppMonFirstTurn: false };
  const tctx = { team: ME, opp: ttar, oppReserves: 2, activeKey: "Tyranitar 1" };
  const view = Bt.view(B, s0);
  for (const oMove of ["Crunch", "Pursuit"]) {
    const s = { ...s0, youEncoredMove: "Surf", youEncoreTurns: 3, oppEncoredMove: oMove, oppEncoreTurns: 3 };
    // move vs move = palaceTurn
    const a = A.playOption(tctx, s, { kind: "move", move: "Surf" }, { pStay: 1, switches: [] });
    const b = P.palaceTurn(T.engineCtx(view, s), s, { ctxOf: (st) => T.engineCtx(view, st) });
    ok(near(sum(a), 1) && sameBag(bag(a), bag(b)), `move vs move (its ${oMove}) = palaceTurn (${a.length} outcomes)`);
    // your switch = team.js switchTurn
    const c = A.playOption(tctx, s, { kind: "switch", j: 1 }, { pStay: 1, switches: [] });
    const d = T.teamTurn(view, s, { switchTo: 1 });
    ok(near(sum(c), 1) && sameBag(bag(c), bag(d)), `your switch vs its ${oMove} = team.js switchTurn (${c.length} outcomes)`);
  }
  // Pursuit really doubled on the leaver: Swampert's HP after Pursuit-on-switch < after Crunch's
  {
    const s = { ...s0, oppEncoredMove: "Pursuit", oppEncoreTurns: 3 };
    const out = A.playOption(tctx, s, { kind: "switch", j: 2 }, { pStay: 1, switches: [] });
    ok(out.every((o) => o.state.youActive === 2 || o.state.yourHpPct <= 0) && out.some((o) => o.state.youBench[0].hpPct < 100) && out.every((o) => o.state.yourHpPct === 100 || o.state.youActive !== 2 || o.state.oppHpPct <= 0),
      "Pursuit on your switch hits the leaver, not the newcomer");
  }

  // Pursuit's damage counts as taken though the mon hit has left the field.
  {
    const s = { ...s0, oppEncoredMove: "Pursuit", oppEncoreTurns: 3 };
    const out = A.playOption(tctx, s, { kind: "switch", j: 2 }, { pStay: 1, switches: [] });
    const want = out.reduce((a, o) => a + o.p * (100 - Math.max(0, o.state.youBench[0].hpPct)) + o.p * (100 - Math.max(0, o.state.yourHpPct)), 0);
    const x = A.summarize(s, out);
    ok(x.taken > 0 && near(x.taken, want, 1e-9), `taken counts the leaver's Pursuit damage (${x.taken.toFixed(1)}% expected)`);
  }
  // a mixed turn: P(stay) x its move + P(switch) x the switch, outcome by outcome
  {
    const s = { ...s0, oppEncoredMove: "Crunch", oppEncoreTurns: 3 };
    const sw = { p: 0.3, key: "Spenser Silver Slaking", mon: B.oppTeam[1], hpPct: 100, status: null };
    const mix = A.playOption(tctx, s, { kind: "move", move: "Surf" }, { pStay: 0.7, switches: [sw] });
    const st = A.playOption(tctx, s, { kind: "move", move: "Surf" }, { pStay: 1, switches: [] });
    const so = A.playOption(tctx, s, { kind: "move", move: "Surf" }, { pStay: 0, switches: [{ ...sw, p: 1 }] });
    const want = new Map();
    for (const [w, outs] of [[0.7, st], [0.3, so]]) for (const [k, p] of bag(outs)) want.set(k, (want.get(k) ?? 0) + w * p);
    ok(near(sum(mix), 1, 1e-12) && sameBag(bag(mix), want), `a mixed turn = 0.7 x its move + 0.3 x its switch (${mix.length} outcomes)`);
  }

  // its switch = battle.js oppSwitchTurn: Perish count 0 makes ShouldSwitch
  // switch with certainty (to GetMostSuitable's pick); your move forced by Encore.
  const sp = { ...s0, youEncoredMove: "Earthquake", youEncoreTurns: 3, oppPerishCount: 0 };
  L.setVf(sp, "oppPerishSonged", true);
  const odds = (await import(E("should-switch.js"))).oppSwitchOdds(B, sp);
  ok(odds.length === 1 && odds[0].p === 1 && odds[0].slot != null, `Perish at 0: it switches for sure (to slot ${odds[0].slot})`);
  const j = odds[0].slot;
  const bt = Bt.battleTurn(B, sp, "stay");
  const mine = A.playOption(tctx, sp, { kind: "move", move: "Earthquake" }, { pStay: 0, switches: [{ p: 1, key: B.oppIds[j] === N.setId("Spenser Silver Slaking") ? "Spenser Silver Slaking" : "Spenser Silver Lapras", mon: B.oppTeam[j], hpPct: 100, status: null }] });
  // battle.js keeps the newcomer in slot j, advise.js in slot 1: compare off the party layout,
  // on the outcomes where nothing fainted (battle.js settles faints with a replacement)
  const drop = ["oppActive", "oppBench"];
  const alive = (o) => o.state.yourHpPct > 0 && o.state.oppHpPct > 0;
  if (!sameBag(bag(mine.filter(alive), drop), bag(bt.filter(alive), drop))) {
    const A1 = [...bag(mine.filter(alive), drop)], B1 = [...bag(bt.filter(alive), drop)];
    console.log("  sizes", A1.length, B1.length, "p", A1.map((x) => x[1].toFixed(4)).join(","), "|", B1.map((x) => x[1].toFixed(4)).join(","));
    const a0 = JSON.parse(A1[0][0]), b0 = JSON.parse(B1[0][0]);
    for (const k of new Set([...Object.keys(a0), ...Object.keys(b0)])) if (JSON.stringify(a0[k]) !== JSON.stringify(b0[k])) console.log("  diff", k, JSON.stringify(a0[k]), JSON.stringify(b0[k]));
  }
  ok(sameBag(bag(mine.filter(alive), drop), bag(bt.filter(alive), drop)) && near(sum(mine.filter((o) => !alive(o))), sum(bt.filter((o) => !alive(o))), 1e-12),
    `its switch (Perish) vs your Earthquake = battle.js oppSwitchTurn (${mine.length} outcomes)`);
  // both switch
  const both = A.playOption(tctx, sp, { kind: "switch", j: 1 }, { pStay: 0, switches: [{ p: 1, key: N.poolEntry(B.oppIds[j]).key, mon: B.oppTeam[j], hpPct: 100 }] });
  const bt2 = Bt.battleTurn(B, { ...sp, youEncoredMove: null, youEncoreTurns: null }, { switchTo: 1 });
  ok(sameBag(bag(both.filter(alive), [...drop, "youEncoredMove", "youEncoreTurns"]), bag(bt2.filter(alive), [...drop, "youEncoredMove", "youEncoreTurns"])), "both switch = battle.js (yours first, no moves)");
}

// ── 2. exact rolls vs drawn rolls ──────────────────────────────────────────
{
  const meta = ME[2];
  const snor = opp("Snorlax 3", "Thick Fat");
  const s = { ...L.buildStartState({ you: meta, opp: snor, yourUsablePartyMons: 2, oppUsablePartyMons: 2 }), youActive: 2, youBench: [T.freshEntry(ME[0]), T.freshEntry(ME[1]), null],
    oppHpPct: 70, yourHpPct: 60 };
  const tctx = { team: ME, opp: snor, oppReserves: 2, activeKey: "Snorlax 3" };
  const opt = { kind: "move", move: "Meteor Mash" };
  const ex = A.summarize(s, A.playOption({ ...tctx, exactRoll: true }, s, opt, { pStay: 1, switches: [] }));
  let seed = 99;
  const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const draw = (cs) => { let u = rand() * sum(cs); for (const c of cs) { u -= c.p; if (u <= 0) return c; } return cs[cs.length - 1]; };
  const ctx0 = T.engineCtx(tctx, s);
  let ko = 0; const n = 4000;
  for (let i = 0; i < n; i++) {
    const d = draw(P.quickClawDraws(ctx0, s));
    const o = draw(TW.towerChoices(ctx0, s, "opp", { qc: d.qc }));
    const s0 = o.aiRan ? L.aiDecisionState(s, "opp") : s;
    const r = draw(L.resolveTurn({ ...T.engineCtx(tctx, s0), rollSample: rand }, s0, opt.move, o.move, { qc: d.resolveQc }));
    if (r.state.oppHpPct <= 0) ko++;
  }
  const est = ko / n, sd = Math.sqrt(Math.max(ex.pKO * (1 - ex.pKO), 1e-4) / n);
  ok(ex.pKO > 0.05 && ex.pKO < 0.95 && Math.abs(est - ex.pKO) < 4 * sd, `Meteor Mash into Snorlax at 70%: exact P(KO) ${(100 * ex.pKO).toFixed(2)}% vs ${n} drawn turns ${(100 * est).toFixed(2)}%`);
  const pt = A.summarize(s, A.playOption({ ...tctx, exactRoll: false }, s, opt, { pStay: 1, switches: [] }));
  ok(Math.abs(pt.pKO - ex.pKO) > 0.01, `the exact rolls matter here: point estimate ${(100 * pt.pKO).toFixed(1)}% vs exact ${(100 * ex.pKO).toFixed(1)}%`);
}

// ── 3. summarize, options ──────────────────────────────────────────────────
{
  const sB = { youActive: 0, yourHpPct: 80, youBench: [null, { hpPct: 50 }], oppHpPct: 60 };
  const outs = [
    { p: 0.5, state: { youActive: 0, yourHpPct: 30, youBench: [null, { hpPct: 50 }] }, theirs: [[60, 0]], left: false },
    { p: 0.25, state: { youActive: 1, yourHpPct: 0, youBench: [{ hpPct: 80 }, null] }, theirs: [[60, 40]], left: false },
    { p: 0.25, state: { youActive: 0, yourHpPct: 80, youBench: [null, { hpPct: 50 }] }, theirs: [[60, 60]], left: true },
  ];
  const x = A.summarize(sB, outs);
  ok(near(x.pKO, 0.5) && near(x.pFaint, 0.25) && near(x.taken, 0.5 * 50 + 0.25 * 50) && near(x.dealt, 0.5 * 60 + 0.25 * 20) && near(x.pLeaves, 0.25),
    `summarize by hand (KO ${x.pKO}, faint ${x.pFaint}, taken ${x.taken}, dealt ${x.dealt}, leaves ${x.pLeaves})`);

  const snor = opp("Snorlax 3", "Thick Fat");
  const base = { ...L.buildStartState({ you: ME[0], opp: snor, yourUsablePartyMons: 2, oppUsablePartyMons: 2 }), youActive: 0, youBench: [null, T.freshEntry(ME[1]), T.freshEntry(ME[2])] };
  const tctx = { team: ME, opp: snor, oppReserves: 2, activeKey: "Snorlax 3" };
  const lab = (s, t = tctx) => A.yourOptions(t, s).map((o) => o.label).join(",");
  ok(lab(base) === "Earthquake,Surf,Ice Beam,Rest,Switch to Sceptile,Switch to Metagross", `options: every move, every switch (${lab(base)})`);
  ok(lab({ ...base, youEncoredMove: "Surf", youEncoreTurns: 2 }) === "Surf (Encore),Switch to Sceptile,Switch to Metagross", "Encore: the move fixed, switches still open");
  ok(lab({ ...base, youRecharge: { move: "Hyper Beam" } }) === "Hyper Beam (locked in)", "recharging: no choice");
  ok(lab({ ...base, youBench: [null, { ...T.freshEntry(ME[1]), hpPct: 0 }, T.freshEntry(ME[2])] }) === "Earthquake,Surf,Ice Beam,Rest,Switch to Metagross", "a fainted teammate is not an option");
  const wob = mk("Wobbuffet", "Bold", ["Counter", "Mirror Coat", "Safeguard", "Destiny Bond"], { ability: "Shadow Tag" });
  ok(lab(base, { ...tctx, opp: wob }) === "Earthquake,Surf,Ice Beam,Rest", "Shadow Tag: no switches");
}

// ── 4. ui-logic advise = candidates weighted ───────────────────────────────
{
  const cfgs = U.parseTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
  const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
  const tid = N.trainerPrior({ challenge: 7, battle: 1 }).map((t) => t.id).find((id) => U.trainerLabel(id) === "Hank (Bug Maniac)");
  const form = (o) => ({ team: cfgs, active: 0, mons: cfgs.map(() => ({ hpPct: 100, status: "" })),
    you: { stages: zero, confused: 0, subPct: 0, firstTurn: true, lastMove: null, landed: true, seen: [] },
    opp: { setKey: "Armaldo 1", ability: null, ivTier: 18, hpPct: 100, status: "", stages: zero, confused: 0, firstTurn: true, ...o },
    party: { lead: null, others: [] }, field: {}, run: { challenge: 7, battle: 1, turn: 1, trainerId: tid } });
  const pos = U.buildPosition(form({ candidates: ["Armaldo 1", "Armaldo 2", "Armaldo 3"] }));
  const all = U.advise(pos);
  const parts = ["Armaldo 1", "Armaldo 2", "Armaldo 3"].map((k) => ({ w: pos.setOdds.find((x) => x.key === k).p, rows: U.advise(U.buildPosition(form({ setKey: k }))) }));
  const okW = all.every((r) => ["pKO", "pFaint", "dealt", "taken"].every((f) => near(r[f], parts.reduce((a, x) => a + x.w * x.rows.find((y) => y.label === r.label)[f], 0), 1e-9)));
  ok(all.length === 6 && okW && all.every((r) => near(r.cover, 1)), `advise over Hank's three Armaldo = their advice weighted (${all.map((r) => `${r.label} KO ${U.pct(r.pKO, 1)}`).join("; ")})`);
}

console.log(`${fail ? "FAIL" : "ok"}  advise: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
