// The page's form -> engine position (site/ui-logic.js buildPosition), field
// by field; the party inputs -> partyMix / known; the readout = the engine's
// oppReadout over the start mix. (The browser test compares the page with
// Node on the SAME buildPosition, so a wrong mapping would pass there -- this
// file is what pins the mapping.)
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const U = await import(pathToFileURL(path.join(here, "../site/ui-logic.js")).href);
const TW = await import(pathToFileURL(path.join(here, "../engine/tower.js")).href);
const N = await import(pathToFileURL(path.join(here, "../engine/next-in.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e;

const cfgs = U.parseTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const mon = (o = {}) => ({ hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, ...o });
const base = (o = {}) => ({
  team: cfgs, active: 0, mons: cfgs.map(() => mon()),
  you: { stages: zero, confused: 0, subPct: 0, firstTurn: true, lastMove: null, landed: true, seen: [] },
  opp: { setKey: "Snorlax 3", ability: "Thick Fat", ivTier: 18, hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, stages: zero, confused: 0, firstTurn: true },
  party: { lead: null, leadHpPct: 100, others: [] },
  field: { weather: "", weatherTurns: null, you: { spikes: 0 }, opp: { spikes: 0 } },
  run: { challenge: 7, battle: 1, turn: 1 }, ...o,
});
const st = (form) => U.buildPosition(form).start[0].state;

// ── the team, the opponent, the Brain ──────────────────────────────────────
{
  ok(throws(() => U.parseTeam(""), /1-3/), "a team is 1-3 Pokémon");
  const p = U.buildPosition(base());
  const o18 = U.buildOpponent({ setKey: "Snorlax 3", ability: "Thick Fat", ivTier: 18 }), o31 = U.buildOpponent({ setKey: "Snorlax 3", ability: "Thick Fat", ivTier: 31 });
  ok(p.opp.species === "Snorlax" && p.opp.ability === "Thick Fat" && JSON.stringify(p.opp.stats) === JSON.stringify(o18.stats) && o18.stats.hp < o31.stats.hp,
    `opponent built at the chosen IVs (HP ${o18.stats.hp} at 18, ${o31.stats.hp} at 31)`);
  ok(p.team.length === 3 && p.team[0].species === "Metagross", "your team built");
  ok(U.brainFor({ challenge: 5, battle: 7 }) === "Anabel Silver" && U.brainFor({ challenge: 5, battle: 6 }) === null && U.brainFor({ challenge: 8, battle: 7 }) === null,
    "Anabel Silver picked at challenge 5 battle 7 only (Gold is by hand)");
  ok(U.setChoices({ brain: "Anabel Gold" }).join() === "Anabel Gold Raikou,Anabel Gold Latios,Anabel Gold Snorlax", "Anabel Gold's list: her three, party order");
  const lv = U.setChoices({ challenge: 8, battle: 1 }), open = U.setChoices({ challenge: 8, battle: 1, level: 100 });
  ok(lv.length > 0 && open.length > lv.length && !lv.some((k) => /Anabel|Spenser/.test(k)), `set list: ${lv.length} at Lv 50, ${open.length} at Open (high-tier sets), no Brain sets`);
}

// ── your mon out ───────────────────────────────────────────────────────────
{
  const s = st(base({ mons: [mon({ hpPct: 40, status: "toxic", toxicTurns: 3 }), mon({ hpPct: 0 }), mon({ hpPct: 70, status: "burn" })] }));
  ok(s.yourHpPct === 40 && s.youStatus === "poison" && s.youToxicCounter === 3, "HP / bad poison and its counter");
  ok(s.youBench[1].hpPct === 0 && s.youBench[2].hpPct === 70 && s.youBench[2].status === "burn" && s.yourUsablePartyMons === 1,
    "bench HP / status, and the usable count the AI reads (fainted ones out)");
  const s2 = st(base({ you: { stages: { ...zero, atk: 2, spe: -1 }, confused: 3, subPct: 25, firstTurn: true, lastMove: null, landed: true, seen: [] } }));
  ok(s2.youStages.atk === 2 && s2.youStages.spe === -1 && s2.youConfused === 3 && s2.youSubstituteHP === Math.round(0.25 * U.buildPosition(base()).team[0].stats.hp),
    "stages, confusion index, Substitute HP");
  const s3 = st(base({ mons: [mon({ itemGone: true }), mon(), mon()] }));
  ok(s3.youItemOverride === null && s3.youBerryConsumed === true, "item used up");
}

// ── what the AI remembers ──────────────────────────────────────────────────
{
  const fresh = st(base());
  ok(fresh.youMonFirstTurn === true && fresh.youLastMove === null && fresh.youMoveHistory.length === 0 && fresh.oppLastLanded === null && fresh.turn === 1,
    "just came in: no last move, no history, turn 1");
  const used = st(base({ you: { stages: zero, confused: 0, subPct: 0, firstTurn: false, lastMove: "Earthquake", landed: true, seen: ["Earthquake", "Meteor Mash"] }, run: { challenge: 7, battle: 1, turn: 4 } }));
  ok(used.youMonFirstTurn === false && used.youLastMove === "Earthquake" && used.oppLastLanded === "Earthquake" && used.turn === 4,
    "last move, landed, turn");
  ok(used.youMoveHistory.join() === "Meteor Mash", "seen moves -> history; the last move is left to the decision's record (no duplicate)");
  const missed = st(base({ you: { stages: zero, confused: 0, subPct: 0, firstTurn: false, lastMove: "Earthquake", landed: false, seen: [] } }));
  ok(missed.youLastMove === "Earthquake" && missed.oppLastLanded === null, "a move that missed: recorded, not landed");
  ok(throws(() => U.buildPosition(base({ you: { stages: zero, firstTurn: false, lastMove: "Surf", seen: [] } })), /does not know Surf/), "a last move it does not know throws");
}

// ── the opponent and the field ─────────────────────────────────────────────
{
  const s = st(base({ opp: { ...base().opp, hpPct: 55, status: "paralysis", stages: { ...zero, def: 1 }, confused: 1, itemGone: true, firstTurn: false } }));
  ok(s.oppHpPct === 55 && s.oppStatus === "paralysis" && s.oppStages.def === 1 && s.oppConfused === true && s.oppItemOverride === null && s.oppMonFirstTurn === false,
    "opponent HP / status / stages / confusion / item / first turn");
  const f = st(base({ field: { weather: "rain", weatherTurns: 3, you: { reflect: true, reflectTurns: 2, spikes: 1 }, opp: { lightScreen: true, spikes: 3 } } }));
  ok(f.weatherType === "rain" && f.weatherTurns === 3 && f.youReflectTurns === 2 && f.youSpikesLayers === 1 && f.oppLightScreenTurns === 5 && f.oppSpikesLayers === 3,
    "weather + turns, screens + turns (default 5), Spikes");
  const sl = U.buildPosition(base({ opp: { ...base().opp, status: "sleep", sleep: { rest: false, slept: 1 } } }));
  ok(sl.start.length === 4 && sl.start.every((x) => near(x.p, 1 / 4)) && sl.start.map((x) => x.state.oppSleepTurns).join() === "1,2,3,4", "unknown sleep length (rolled 2-5, 1 turn slept): counters 1-4, equal mix");
}

// ── their party ────────────────────────────────────────────────────────────
{
  const p = U.buildPosition(base());
  const m = TW.partyMix({ lead: "Snorlax 3", challenge: 7, battle: 1, ivs: 18 });
  ok(p.mix.length === m.length && p.mix.every((x, i) => x.ids.join() === m[i].ids.join() && near(x.p, m[i].p)), `the one out is their lead: partyMix on it (${m.length} parties)`);
  ok(Object.keys(p.known).join() === "Snorlax 3" && p.known["Snorlax 3"].mon === p.opp, "known: the mon out, as built");
  const q = U.buildPosition(base({ opp: { ...base().opp, setKey: "Starmie 3", ability: "Natural Cure" }, party: { lead: "Snorlax 3", leadHpPct: 0, others: [] } }));
  ok(q.mix.every((x) => x.ids[0] === N.setId("Snorlax 3") && x.ids.includes(N.setId("Starmie 3"))) && q.known["Snorlax 3"].hpPct === 0 && q.known["Starmie 3"].mon,
    "lead given: parties led by it holding the mon out; its HP carried (0 = fainted)");
  const r = U.buildPosition(base({ party: { lead: null, others: [{ setKey: "Starmie 3", hpPct: 60 }] } }));
  ok(r.mix.every((x) => x.ids.includes(N.setId("Starmie 3"))) && r.known["Starmie 3"].hpPct === 60, "an other seen: kept in every party, its HP carried");
  ok(throws(() => U.buildPosition(base({ party: { lead: null, others: [{ setKey: "Snorlax 3", hpPct: 60 }] } })), /twice/), "the same set twice throws");
  ok(throws(() => U.buildPosition(base({ run: { battle: 1 } })), /challenge and battle/), "no challenge: throws (the unseen teammates need it)");
  ok(throws(() => U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Alakazam", ability: null, ivTier: 24 } })), /Brain set/), "a Brain set without the Brain battle throws");
  const an = U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Entei", ability: null, ivTier: 24 }, party: { lead: "Anabel Silver Alakazam", others: [] }, run: { brain: "Anabel Silver", turn: 1 } }));
  ok(an.mix.length === 1 && an.mix[0].ids.join() === ["Anabel Silver Alakazam", "Anabel Silver Entei", "Anabel Silver Snorlax"].map(N.setId).join(), "Anabel: her fixed party");
  ok(throws(() => U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Entei", ability: null, ivTier: 24 }, run: { brain: "Anabel Silver" } })), /always sends out Alakazam/), "Anabel's lead is always Alakazam");
}

// ── the readout ────────────────────────────────────────────────────────────
{
  const form = base({ you: { stages: zero, confused: 0, subPct: 0, firstTurn: false, lastMove: "Earthquake", landed: true, seen: [] }, run: { challenge: 7, battle: 1, turn: 2 }, opp: { ...base().opp, firstTurn: false } });
  const p = U.buildPosition(form);
  const r = U.readout(p);
  const d = TW.oppReadout({ team: p.team, s: p.start[0].state, mix: p.mix, known: p.known, active: p.active, level: p.level });
  ok(near(r.rows.reduce((a, x) => a + x.p, 0), 1, 1e-9) && near(r.pSwitch, d.pSwitch, 1e-12) && r.pSwitch > 0, `readout = oppReadout (P(switch) ${(100 * r.pSwitch).toFixed(2)}%)`);
  ok(d.rows.every((x) => near(r.rows.find((y) => y.label === (x.kind === "move" ? x.move : `Switch to ${U.setLabel(x.key)}`))?.p ?? -1, x.p, 1e-12)), "every row carried, switch rows labelled by set");
  const sl = U.buildPosition(base({ opp: { ...base().opp, status: "sleep", sleep: { rest: false, slept: 0 } } }));
  const rs = U.readout(sl);
  let want = 0;
  for (const { p: w, state } of sl.start) want += w * (TW.oppReadout({ team: sl.team, s: state, mix: sl.mix, known: sl.known, active: sl.active }).rows.find((x) => x.move === "Mega Kick")?.p ?? 0);
  ok(near(rs.rows.find((x) => x.label === "Mega Kick")?.p ?? 0, want, 1e-12), "readout over an unknown sleep length: the mix's weighted average");
}

console.log(`${fail ? "FAIL" : "ok"}  ui-logic: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
