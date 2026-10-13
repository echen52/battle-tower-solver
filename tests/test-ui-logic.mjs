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
const st = (form) => U.buildPosition(form).cands[0].start[0].state;

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
  ok(sl.cands[0].start.length === 4 && sl.cands[0].start.every((x) => near(x.p, 1 / 4)) && sl.cands[0].start.map((x) => x.state.oppSleepTurns).join() === "1,2,3,4", "unknown sleep length (rolled 2-5, 1 turn slept): counters 1-4, equal mix");
}

// ── their party ────────────────────────────────────────────────────────────
{
  const p = U.buildPosition(base());
  const m = TW.partyMix({ lead: "Snorlax 3", challenge: 7, battle: 1, ivs: 18 });
  ok(p.cands.length === 1 && p.cands[0].mix.length === m.length && p.cands[0].mix.every((x, i) => x.ids.join() === m[i].ids.join() && near(x.p, m[i].p)), `the one out is their lead: partyMix on it (${m.length} parties)`);
  ok(Object.keys(p.cands[0].known).join() === "Snorlax 3" && p.cands[0].known["Snorlax 3"].mon === p.opp, "known: the mon out, as built");
  const q = U.buildPosition(base({ opp: { ...base().opp, setKey: "Starmie 3", ability: "Natural Cure" }, party: { lead: "Snorlax 3", leadHpPct: 0, others: [] } }));
  ok(q.cands[0].mix.every((x) => x.ids[0] === N.setId("Snorlax 3") && x.ids.includes(N.setId("Starmie 3"))) && q.cands[0].known["Snorlax 3"].hpPct === 0 && q.cands[0].known["Starmie 3"].mon,
    "lead given: parties led by it holding the mon out; its HP carried (0 = fainted)");
  const r = U.buildPosition(base({ party: { lead: null, others: [{ setKey: "Starmie 3", hpPct: 60 }] } }));
  ok(r.cands[0].mix.every((x) => x.ids.includes(N.setId("Starmie 3"))) && r.cands[0].known["Starmie 3"].hpPct === 60, "an other seen: kept in every party, its HP carried");
  ok(throws(() => U.buildPosition(base({ party: { lead: null, others: [{ setKey: "Starmie 3", hpPct: 60 }, { setKey: "Starmie 3", hpPct: 60 }] } })), /twice/), "the same set twice throws");
  ok(throws(() => U.buildPosition(base({ party: { lead: null, others: [{ setKey: "Snorlax 4", hpPct: 60 }] } })), /never has two Snorlax/), "a second mon of the species out throws (species clause)");
  ok(throws(() => U.buildPosition(base({ run: { battle: 1 } })), /challenge and battle/), "no challenge: throws (the unseen teammates need it)");
  ok(throws(() => U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Alakazam", ability: null, ivTier: 24 } })), /Brain set/), "a Brain set without the Brain battle throws");
  const an = U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Entei", ability: null, ivTier: 24 }, party: { lead: "Anabel Silver Alakazam", others: [] }, run: { brain: "Anabel Silver", turn: 1 } }));
  ok(an.cands.every((c) => c.mix.length === 1) && an.cands[0].mix[0].ids.join() === ["Anabel Silver Alakazam", "Anabel Silver Entei", "Anabel Silver Snorlax"].map(N.setId).join(), "Anabel: her fixed party");
  ok(throws(() => U.buildPosition(base({ opp: { ...base().opp, setKey: "Anabel Silver Entei", ability: null, ivTier: 24 }, run: { brain: "Anabel Silver" } })), /always sends out Alakazam/), "Anabel's lead is always Alakazam");
}

// ── the readout ────────────────────────────────────────────────────────────
{
  const form = base({ you: { stages: zero, confused: 0, subPct: 0, firstTurn: false, lastMove: "Earthquake", landed: true, seen: [] }, run: { challenge: 7, battle: 1, turn: 2 }, opp: { ...base().opp, firstTurn: false } });
  const p = U.buildPosition(form);
  const r = U.readout(p);
  const c0 = p.cands[0], d = TW.oppReadout({ team: p.team, s: c0.start[0].state, mix: c0.mix, known: c0.known, active: c0.key, level: p.level });
  ok(near(r.rows.reduce((a, x) => a + x.p, 0), 1, 1e-9) && near(r.pSwitch, d.pSwitch, 1e-12) && r.pSwitch > 0, `readout = oppReadout (P(switch) ${(100 * r.pSwitch).toFixed(2)}%)`);
  ok(d.rows.every((x) => near(r.rows.find((y) => y.label === (x.kind === "move" ? x.move : `Switch to ${U.setLabel(x.key)}`))?.p ?? -1, x.p, 1e-12)), "every row carried, switch rows labelled by set");
  const sl = U.buildPosition(base({ opp: { ...base().opp, status: "sleep", sleep: { rest: false, slept: 0 } } }));
  const rs = U.readout(sl);
  let want = 0;
  for (const { p: w, state } of sl.cands[0].start) want += w * (TW.oppReadout({ team: sl.team, s: state, mix: sl.cands[0].mix, known: sl.cands[0].known, active: sl.active }).rows.find((x) => x.move === "Mega Kick")?.p ?? 0);
  ok(near(rs.rows.find((x) => x.label === "Mega Kick")?.p ?? 0, want, 1e-12), "readout over an unknown sleep length: the mix's weighted average");
}

// ── the trainer ────────────────────────────────────────────────────────────
const { FRONTIER_TRAINERS } = await import(pathToFileURL(path.join(here, "../engine/frontier-trainers.js")).href);
const { FRONTIER_POOL } = await import(pathToFileURL(path.join(here, "../engine/frontier-pool.js")).href);
{
  const ts = U.trainerChoices({ challenge: 7, battle: 1 });
  const ids = N.trainerPrior({ challenge: 7, battle: 1 }).map((t) => t.id);
  ok(ts.length === ids.length && new Set(ts.map((t) => t.label)).size === ts.length && ts.every((t) => ids.includes(t.id)), `trainer list: the bracket's ${ts.length} trainers, labels unique`);
  ok(U.trainerLabel(225) === "Miriam (Cooltrainer)", `label as the game names them (${U.trainerLabel(225)})`);
  // a trainer at 7/1 whose pool holds two sets of one species
  const two = ids.map((id) => {
    const keys = U.setChoices({ trainerId: id });
    const sp = keys.map((k) => FRONTIER_POOL[k].species).find((x, i, a) => a.indexOf(x) !== i);
    return sp ? { id, keys, pair: keys.filter((k) => FRONTIER_POOL[k].species === sp) } : null;
  }).find(Boolean);
  const pool = FRONTIER_TRAINERS[two.id].monSet.filter((m) => m <= 849);
  ok(two.keys.length === new Set(pool).size && two.keys.every((k) => pool.includes(FRONTIER_POOL[k].index)), `a trainer's set list = its own pool (${U.trainerLabel(two.id)}: ${two.keys.length} sets)`);
  ok(U.ivTierOdds(two.pair[0], { trainerId: two.id }).map((x) => `${x.iv}:${x.p}`).join() === `${N.fixedIvs(two.id)}:1`, "a known trainer: its one IV value");
  ok(U.sameSpecies(two.pair[0], { trainerId: two.id }).join() === two.pair.join(), `same species in its pool: ${two.pair.join(", ")}`);

  // Trainer known, one candidate: partyMix on that trainer, IVs forced to its value.
  const sp = FRONTIER_POOL[two.pair[0]];
  const opp = (o) => ({ ...base().opp, setKey: two.pair[0], ability: null, ivTier: 3, ...o });
  const run = { challenge: 7, battle: 1, turn: 1, trainerId: two.id };
  const p1 = U.buildPosition(base({ opp: opp(), run }));
  const m1 = TW.partyMix({ lead: two.pair[0], challenge: 7, battle: 1, trainerId: two.id, ivs: N.fixedIvs(two.id) });
  ok(p1.cands.length === sp.abilities.length && p1.cands[0].mix.length === m1.length && p1.cands.every((c) => near(c.w, 1 / sp.abilities.length)),
    `trainer known: its parties only (${m1.length}), each ability equally likely when not set`);
  ok(JSON.stringify(p1.opp.stats) === JSON.stringify(U.buildOpponent({ setKey: two.pair[0], ability: p1.cands[0].ability, ivTier: N.fixedIvs(two.id) }).stats),
    `IVs from the trainer (${N.fixedIvs(two.id)}), not the box (3)`);

  // Both candidates, trainer known: P(set) = its share of the trainer's pool
  // (FillTrainerParty's lead draw is monSet[Random() % n]).
  const p2 = U.buildPosition(base({ opp: opp({ candidates: two.pair }), run }));
  const cnt = (k) => pool.filter((m) => m === FRONTIER_POOL[k].index).length;
  const wantShare = cnt(two.pair[0]) / two.pair.reduce((a, k) => a + cnt(k), 0);
  ok(near(p2.setOdds.reduce((a, x) => a + x.p, 0), 1, 1e-12) && near(p2.setOdds.find((x) => x.key === two.pair[0]).p, wantShare, 1e-12),
    `two candidates, trainer known: odds = pool shares (${two.pair.map((k) => `${k} ${cnt(k)}`).join(", ")})`);
  // The readout = the weighted readouts of each candidate alone.
  const r2 = U.readout(p2);
  const parts = two.pair.map((k) => ({ w: p2.setOdds.find((x) => x.key === k).p, r: U.readout(U.buildPosition(base({ opp: opp({ setKey: k }), run }))) }));
  const labels = new Set(parts.flatMap((x) => x.r.rows.map((y) => y.label)));
  ok([...labels].every((l) => near(r2.rows.find((y) => y.label === l)?.p ?? 0, parts.reduce((a, x) => a + x.w * (x.r.rows.find((y) => y.label === l)?.p ?? 0), 0), 1e-12)),
    "the readout over candidates = their readouts, weighted by the odds");

  // No trainer: P(set) prop. to sum over the bracket's trainers with these IVs of
  // P(trainer) x its pool share.
  const ivs = U.ivTierOdds(two.pair[0], { challenge: 7, battle: 1 })[0].iv;
  const p3 = U.buildPosition(base({ opp: opp({ candidates: two.pair, ivTier: ivs }), run: { challenge: 7, battle: 1, turn: 1 } }));
  const prior = N.trainerPrior({ challenge: 7, battle: 1 }).filter((t) => N.fixedIvs(t.id) === ivs);
  const massOf = (k) => prior.reduce((a, t) => { const pl = FRONTIER_TRAINERS[t.id].monSet.filter((m) => m <= 849); return a + t.p * pl.filter((m) => m === FRONTIER_POOL[k].index).length / pl.length; }, 0);
  const viable = two.pair.filter((k) => massOf(k) > 0);
  const want3 = massOf(two.pair[0]) / viable.reduce((a, k) => a + massOf(k), 0);
  ok(near(p3.setOdds.find((x) => x.key === two.pair[0])?.p ?? 0, want3, 1e-9), `two candidates, bracket: odds from the trainer draw (${two.pair[0]} ${(100 * want3).toFixed(1)}%)`);

  // An ability one candidate cannot have rules it out; nothing left throws.
  const abOnly = (k) => FRONTIER_POOL[k].abilities;
  const distinctAb = abOnly(two.pair[0]).find((a) => !abOnly(two.pair[1]).includes(a));
  if (distinctAb) {
    const p4 = U.buildPosition(base({ opp: opp({ candidates: two.pair, ability: distinctAb }), run }));
    ok(p4.setOdds.every((x) => abOnly(x.key).includes(distinctAb)) && p4.excluded.some((x) => x.key === two.pair[1]), `ability ${distinctAb} rules ${two.pair[1]} out`);
  }
  ok(throws(() => U.buildPosition(base({ opp: opp({ candidates: [two.pair[0], "Starmie 3"] }), run })), /is not a/), "a candidate of another species throws");
}

console.log(`${fail ? "FAIL" : "ok"}  ui-logic: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
