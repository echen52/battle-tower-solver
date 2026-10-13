// ── advise.js ──────────────────────────────────────────────────────────────
// The one-turn advisor: for each thing YOU can do this turn, what the turn
// does -- played out exactly (every damage roll, crit, accuracy and effect
// draw the engine enumerates) against every action the opponent's AI can take
// (tower.js: ShouldSwitch, then the move), weighted by its odds.
//
// The opponent is not an adversary here: its AI is a known random policy that
// does not see your choice this turn (both sides choose before the turn runs,
// src/battle_main.c HandleTurnActionSelectionState), so each of your options
// is scored against the SAME opponent distribution.
//
// Turn shapes (each ported from the team layer, with your action fixed and the
// opponent's choice from towerChoices instead of the Palace's):
//   move vs move     resolveTurn, one shared Quick Claw draw (palace.js
//                    quickClawDraws: gRandomTurnNumber decides the AI's speed
//                    read and the turn order together)
//   you switch       team.js switchTurn: your switch first; its move, chosen
//                    against the mon that left, lands on the newcomer; Pursuit
//                    hits the leaver at double power and is its whole turn
//   it switches      battle.js oppSwitchTurn: its switch first; your move lands
//                    on the newcomer; your Pursuit hits the leaver
//   both switch      yours, then its (battler order); no moves
//
// Stated limits (one turn, its team only partly known):
//   * Roar / Whirlwind on IT, and its Baton Pass, end the turn as "it leaves"
//     (the engine's oppDraggedOut with no team hook): who comes in is not
//     played, and a move of yours that would land on the newcomer is not.
//   * YOUR Baton Pass throws in the engine (the mid-turn party pick is not
//     modelled) -- that option is reported as not analysable.
//   * A turn whose exact roll enumeration passes ROLL_CAP outcomes is played
//     with the engine's 92.5% point-estimate roll instead, and flagged.

import * as L from "./logic.js";
import * as T from "./team.js";
import { quickClawDraws } from "./palace.js";
import { towerChoices } from "./tower.js";
import { oppSwitchIn } from "./battle.js";
import { setId } from "./next-in.js";
import { AI_CODE } from "./ai-program.js";

export const ROLL_CAP = 4000;

// ── your options ───────────────────────────────────────────────────────────
// [{ kind: "move", move, label } | { kind: "switch", j, label }].
// A charging / recharging / rampaging mon has no choice (battle_main.c:4160-
// 4164); Encore fixes the move but not the switch (:4192); otherwise every
// selectable move (Struggle when none, AreAllMovesUnusable) and every healthy
// teammate, when you can switch (team.js youCanSwitch, :4240-4256).
export function yourOptions(tctx, s) {
  const me = L.effectiveCtx({ you: tctx.team[s.youActive], opp: tctx.opp }, s).you;
  const locked = s.youCharging?.move || s.youRecharge?.move || s.youLock?.move;
  if (locked) return [{ kind: "move", move: locked, label: `${locked} (locked in)` }];
  const out = [];
  if (s.youEncoredMove) out.push({ kind: "move", move: s.youEncoredMove, label: `${s.youEncoredMove} (Encore)` });
  else {
    const legal = L.selectableMoves(me.moves, s, "you", tctx.opp, "you");
    for (const m of legal) out.push({ kind: "move", move: m, label: m });
  }
  if (T.youCanSwitch(tctx, s)) for (const j of T.aliveBench(s)) out.push({ kind: "switch", j, label: `Switch to ${tctx.team[j].species}` });
  return out;
}

// ── one option, played out ─────────────────────────────────────────────────
// opp = { pStay, switches: [{ p, key, mon, hpPct, status }] } (the readout's
// P(it uses a move) and its switch targets). tctx = { team, opp, oppReserves,
// activeKey }. Returns [{ p, state, theirs: [[before, after] HP% of each of
// its mons that was out], left }] summing to 1.
export function playOption(tctx, s, option, opp) {
  const ctx = T.engineCtx(tctx, s);
  const out = [];
  // first: it never got to attack this turn (it was knocked out before its
  // action, logic.js neverActed, or its action was the switch)
  const push = (p, state, theirs, first) => { if (p > 0) out.push({ p, state, theirs, left: !!state.oppDraggedOut, first }); };
  const hpOpp = s.oppHpPct;
  // its move this turn (it stays in)
  if (opp.pStay > 0) {
    for (const draw of quickClawDraws(ctx, s)) {
      for (const o of towerChoices(ctx, s, "opp", { qc: draw.qc })) {
        const s0 = o.aiRan ? L.aiDecisionState(s, "opp") : s;
        const w = opp.pStay * draw.p * o.p;
        if (option.kind === "move") {
          for (const r of L.resolveTurn(ctx, s0, option.move, o.move, { qc: draw.resolveQc })) push(w * r.p, r.state, [[hpOpp, r.state.oppHpPct]], r.neverActed === "opp");
        } else {
          for (const r of youSwitchTurn(tctx, ctx, s0, option.j, o.move, draw)) push(w * r.p, r.state, [[hpOpp, r.state.oppHpPct]], false);
        }
      }
    }
  }
  // its switch
  for (const sw of opp.switches) {
    for (const r of oppSwitchTurn(tctx, s, option, sw)) push(sw.p * r.p, r.state, r.theirs, true);
  }
  return out;
}

// Your switch to j; its move `oMove` was chosen against the mon that left.
function youSwitchTurn(tctx, ctx, s0, j, oMove, draw) {
  const out = [];
  const pursuit = oMove === "Pursuit" && s0.oppHpPct > 0 && s0.oppStatus !== "sleep" && s0.oppStatus !== "freeze" && !L.vf(s0, "oppTruantLoaf");
  const before = pursuit ? L.resolveSingleAction(ctx, s0, "opp", "Pursuit", { pursuitSwitch: true }) : [{ p: 1, state: s0 }];
  for (const b of before) {
    if (b.state.oppHpPct <= 0) { out.push({ p: b.p, state: b.state }); continue; }
    const sIn = T.switchIn(tctx, b.state, j, { firstTurn: 2 });
    const ctxIn = T.engineCtx(tctx, sIn);
    const oppActs = !pursuit && sIn.yourHpPct > 0;
    const loaf = { you: "switched", opp: oppActs ? null : "switched" };
    for (const r of L.resolveTurn(ctxIn, sIn, tctx.team[j].moves[0], oppActs ? oMove : tctx.opp.moves[0], { qc: draw.resolveQc, loaf, order: ["you", "opp"] })) {
      out.push({ p: b.p * r.p, state: r.state });
    }
  }
  return out;
}

// It switches to sw.mon. The position as battle.js holds it: its mon out in
// slot 0, the newcomer in slot 1 with the HP / status it has on the bench.
function oppSwitchTurn(tctx, s, option, sw) {
  const B = { team: tctx.team, oppTeam: [tctx.opp, sw.mon], oppIds: [setId(tctx.activeKey), setId(sw.key)] };
  const s1 = { ...s, oppActive: 0, oppBench: [null, { ...T.freshEntry(sw.mon), hpPct: sw.hpPct ?? 100, status: sw.status ?? null }] };
  const hp0 = s1.oppHpPct, hp1 = s1.oppBench[1].hpPct;
  // the newcomer's own team-layer context (no hooks: a drag on it ends the turn as "it leaves")
  const ctxFor = (st) => T.engineCtx({ team: tctx.team, opp: sw.mon, oppReserves: tctx.oppReserves, exactRoll: tctx.exactRoll, rollOutcomeCap: tctx.rollOutcomeCap }, st);
  const theirs = (st) => [[hp0, st.oppActive === 1 ? st.oppBench[0].hpPct : st.oppHpPct], [hp1, st.oppActive === 1 ? st.oppHpPct : hp1]];
  const out = [];
  if (option.kind === "switch") {
    // both switch: yours, then its (battler order); no moves; the turn's end
    const sa = T.switchIn(tctx, s1, option.j, { firstTurn: 2 });
    const sb = keepCount(oppSwitchIn(B, sa, 1, { firstTurn: 2 }), s1);
    for (const r of L.resolveTurn(ctxFor(sb), sb, tctx.team[sb.youActive].moves[0], sw.mon.moves[0], { loaf: { you: "switched", opp: "switched" }, order: ["you", "opp"] })) {
      out.push({ p: r.p, state: r.state, theirs: theirs(r.state) });
    }
    return out;
  }
  const ctx = T.engineCtx(tctx, s1);
  const mv = option.move;
  const pursuit = mv === "Pursuit" && s1.yourHpPct > 0 && s1.youStatus !== "sleep" && s1.youStatus !== "freeze" && !L.vf(s1, "youTruantLoaf");
  const before = pursuit ? L.resolveSingleAction(ctx, s1, "you", "Pursuit", { pursuitSwitch: true }) : [{ p: 1, state: s1 }];
  for (const b of before) {
    if (b.state.oppHpPct <= 0) { out.push({ p: b.p, state: b.state, theirs: [[hp0, b.state.oppHpPct], [hp1, hp1]] }); continue; }
    const sIn = keepCount(oppSwitchIn(B, b.state, 1, { firstTurn: 2 }), s1);
    const loaf = { opp: "switched", you: pursuit ? "switched" : null };
    for (const r of L.resolveTurn(ctxFor(sIn), sIn, pursuit ? tctx.team[s.youActive].moves[0] : mv, sw.mon.moves[0], { loaf, order: ["opp", "you"] })) {
      out.push({ p: b.p * r.p, state: r.state, theirs: theirs(r.state) });
    }
  }
  return out;
}

// The two-slot party above does not hold its third mon, so the switch-in's
// recount (the mirrored team.js switchIn) would miss it. A switch does not
// change how many healthy teammates stand behind the mon out: keep the count.
const keepCount = (st, before) => ({ ...st, oppUsablePartyMons: before.oppUsablePartyMons });

// ── the numbers ────────────────────────────────────────────────────────────
// From the outcomes of one option: pKO (one of its mons that was out faints),
// pKOFirst (that, before it attacked you this turn),
// pFaint (one of yours faints), dealt / taken (expected HP lost, in % of each
// mon's max, summed over the mons that were out), pLeaves (it was forced out
// or Baton Passed: not played further).
const yourHp = (st, i) => (i === st.youActive ? st.yourHpPct : st.youBench[i]?.hpPct ?? 0);
export function summarize(sBefore, outcomes) {
  const n = sBefore.youBench.length;
  const acc = { p: 0, pKO: 0, pKOFirst: 0, pFaint: 0, dealt: 0, taken: 0, pLeaves: 0 };
  for (const o of outcomes) {
    let taken = 0, faint = false;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, yourHp(sBefore, i)), b = Math.max(0, yourHp(o.state, i));
      taken += Math.max(0, a - b);
      if (a > 0 && b <= 0) faint = true;
    }
    let dealt = 0, ko = false;
    for (const [a0, b0] of o.theirs) {
      const a = Math.max(0, a0), b = Math.max(0, b0);
      dealt += Math.max(0, a - b);
      if (a > 0 && b <= 0) ko = true;
    }
    acc.p += o.p; acc.taken += o.p * taken; acc.dealt += o.p * dealt;
    if (faint) acc.pFaint += o.p;
    if (ko) acc.pKO += o.p;
    if (ko && o.first) acc.pKOFirst += o.p;
    if (o.left) acc.pLeaves += o.p;
  }
  return acc;
}

// One option's numbers, with the exact rolls when they fit under ROLL_CAP and
// the point estimate otherwise (approx: true). Throws other engine errors.
export function adviseOption(tctx, s, option, opp) {
  try {
    return { ...summarize(s, playOption({ ...tctx, exactRoll: true, rollOutcomeCap: ROLL_CAP }, s, option, opp)), approx: false };
  } catch (e) {
    if (!/too many outcomes/.test(e.message)) throw e;
    return { ...summarize(s, playOption({ ...tctx, exactRoll: false, rollOutcomeCap: undefined }, s, option, opp)), approx: true };
  }
}

// ── ranking (the user's rule, 2026-10-13) ──────────────────────────────────
// "Chance to KO first (if outspeed), then least damage taken": the higher
// pKOFirst ranks first; KO chances within KO_TIE of each other count as equal
// and the one taking less HP wins.
export const KO_TIE = 0.01;
export function better(a, b) {
  if (Math.abs(a.pKOFirst - b.pKOFirst) > KO_TIE) return a.pKOFirst > b.pKOFirst;
  return a.taken < b.taken;
}

// ── two turns ──────────────────────────────────────────────────────────────
// Each option this turn, then -- in every position it leads to where both
// mons are still out -- your best reply next turn by the same rule, against
// the AI's odds IN THAT POSITION (readoutAt(state) -> { pStay, switches }: the
// readout rerun, so a hurt mon's switch or Rest shows up).
//
// The turn-1 outcomes are grouped: the same position apart from HP, with each
// mon's HP in the same band, plays turn 2 once, from its most likely member (a
// real outcome, not an average). Stated approximation. A band is HP_BAND wide
// AND never straddles an HP cutoff the AI script tests (if_hp_less_than /
// more_than / equal, on the AI's own integer percent, ai-interpreter.js:91-94
// -- e.g. Recover below 70%): both sides of a cutoff can play very differently.
// Turn 2 is not played when it ends the turn-1 count: a mon of either side
// fainted, it switched (its newcomer's team context is the readout's, not
// rebuilt here) or it left (Roar / Baton Pass). Those branches count turn 1
// only; `pPlayed` is the share where turn 2 was played.
// Your turn-2 reply is picked knowing the world (the candidate set, its sleep
// counter) -- stated: by turn 2 you have seen its first move.
export const HP_BAND = 4;
const SKIP = new Set(["yourHpPct", "oppHpPct", "hpPct", "youDamageTaken", "oppDamageTaken"]);
const shapeKey = (st) => JSON.stringify(st, (k, v) => (SKIP.has(k) ? undefined : v === undefined ? "~u" : v));
const band = (x, w = HP_BAND) => Math.floor(Math.max(0, x) / w);
// The cutoffs, read off the generated AI program: hp < x splits at x, hp > x
// at x + 1, hp == x at x and x + 1.
export const AI_HP_EDGES = (() => {
  const e = new Set();
  for (const c of AI_CODE) {
    const x = c.a?.param1;
    if (typeof x !== "number") continue;
    if (c.op === "if_hp_less_than") e.add(x);
    else if (c.op === "if_hp_more_than") e.add(x + 1);
    else if (c.op === "if_hp_equal" || c.op === "if_hp_not_equal") { e.add(x); e.add(x + 1); }
  }
  return [...e].sort((a, b) => a - b);
})();
// the AI's percent of a state's HP (aiMonView rounds to whole HP, logic.js:4315;
// Cmd_if_hp_* floors 100 * hp / maxHP, ai-interpreter.js:75)
const aiPct = (pct, maxHp) => Math.floor((100 * Math.max(0, Math.round((pct / 100) * maxHp))) / maxHp);
const region = (pct, maxHp) => { const a = aiPct(pct, maxHp); let i = 0; while (i < AI_HP_EDGES.length && AI_HP_EDGES[i] <= a) i++; return i; };
const hpBand = (pct, maxHp, w) => `${region(pct, maxHp)}.${band(pct, w)}`;
const benchHp = (st) => st.youBench.reduce((a, e) => a + Math.max(0, e?.hpPct ?? 0), 0);
const continues = (o) => !o.left && o.theirs.length === 1 && o.theirs[0][1] > 0 && o.state.yourHpPct > 0;

// part = [k, n]: only every n-th group from the k-th, and turn 1's own numbers
// only in part 0 -- so the n parts' numbers add up to the whole (the page
// spreads one option over several workers).
export function playTwo(tctx, s, option, opp, readoutAt, { width = HP_BAND, part = null } = {}) {
  let approx = false, outs;
  try { outs = playOption({ ...tctx, exactRoll: true, rollOutcomeCap: ROLL_CAP }, s, option, opp); }
  catch (e) {
    if (!/too many outcomes/.test(e.message)) throw e;
    approx = true;
    outs = playOption({ ...tctx, exactRoll: false, rollOutcomeCap: undefined }, s, option, opp);
  }
  const acc = { ...summarize(s, outs), approx, pPlayed: 0, groups: 0, follow: new Map() };
  if (part && part[0] !== 0) for (const k of ["pKO", "pKOFirst", "pFaint", "dealt", "taken", "pLeaves"]) acc[k] = 0;
  const groups = new Map();
  for (const o of outs) {
    if (!continues(o)) continue;
    const st = o.state;
    const k = `${shapeKey(st)}|${hpBand(st.yourHpPct, tctx.team[st.youActive].stats.hp, width)}|${hpBand(st.oppHpPct, tctx.opp.stats.hp, width)}|${band(benchHp(st), width)}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { p: o.p, rep: o });
    else { g.p += o.p; if (o.p > g.rep.p) g.rep = o; }
  }
  acc.groups = groups.size;
  let gi = -1;
  for (const g of groups.values()) {
    if (part && ++gi % part[1] !== part[0]) continue;
    const s1 = g.rep.state;
    const opp1 = readoutAt(s1);
    let best = null;
    for (const o2 of yourOptions(tctx, s1)) {
      let x;
      try { x = adviseOption(tctx, s1, o2, opp1); } catch { continue; } // e.g. your Baton Pass: not a reply
      if (!best || better(x, best.x)) best = { o2, x };
    }
    if (!best) continue;
    acc.pPlayed += g.p;
    for (const k of ["pKO", "pKOFirst", "pFaint", "dealt", "taken", "pLeaves"]) acc[k] += g.p * best.x[k];
    acc.approx ||= best.x.approx;
    acc.follow.set(best.o2.label, (acc.follow.get(best.o2.label) ?? 0) + g.p);
  }
  return acc;
}
