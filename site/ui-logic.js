// ── ui-logic.js ────────────────────────────────────────────────────────────
// The page's "brains": pure functions, no DOM (app.js owns the DOM). Form
// values in, an engine position out; the engine's readout in, render-ready
// rows out. Every number comes from ../engine -- nothing here does battle math.

import * as L from "../engine/logic.js";
import { teamStart, buildPlayerMon } from "../engine/team.js";
import { parseShowdownTeam } from "../engine/showdown.js";
import { getOpponentConfig } from "../engine/opponent-adapter.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";
import { FRONTIER_TRAINERS } from "../engine/frontier-trainers.js";
import { trainerPrior, fixedIvs } from "../engine/next-in.js";
import { partyMix, oppReadout } from "../engine/tower.js";

export const STAGE_KEYS = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const HIGH_TIER = 849;

// ── the level mode ─────────────────────────────────────────────────────────
// Level 50, or Level 100 = Open Level with a level-100 team: the opponents are
// at your highest level, at least 60 (GetFrontierEnemyMonLevel,
// src/battle_tower.c:3247-3265), and the high-tier sets 850-881 can be drawn
// (the :1696 rejection is level-50 only). The trainers are the same. Your
// pasted Level lines are overridden by the button.
export const LEVELS = [50, 100];
const isOpen = (level) => level !== 50;

// ── your team ──────────────────────────────────────────────────────────────
export function parseTeam(text) {
  const cfgs = parseShowdownTeam(text);
  if (cfgs.length < 1 || cfgs.length > 3) throw new Error(`a Tower team is 1-3 Pokémon; this paste has ${cfgs.length}`);
  return cfgs;
}

// ── the Frontier Brain ─────────────────────────────────────────────────────
// Anabel comes at win streak 35 (Silver) and 70 (Gold) -- battle 7 of
// challenges 5 and 10 -- and with both symbols every 35 after 70
// (sFrontierBrainStreakAppearances[TOWER] = {35, 70, 35, 1},
// src/frontier_util.c:88). The page's challenge list stops at "8+", so only
// challenge 5 is picked for you; Gold (70, 105, ...) is picked by hand. A
// default only: holding Silver, streak 35 of a later run is a normal trainer.
export const BRAINS = ["Anabel Silver", "Anabel Gold"];
export const BRAIN_TEAMS_TOWER = {
  "Anabel Silver": ["Anabel Silver Alakazam", "Anabel Silver Entei", "Anabel Silver Snorlax"],
  "Anabel Gold": ["Anabel Gold Raikou", "Anabel Gold Latios", "Anabel Gold Snorlax"],
};
export function brainFor({ challenge, battle } = {}) {
  return battle === 7 && challenge === 5 ? "Anabel Silver" : null;
}

// ── the opponent's set list ────────────────────────────────────────────────
// The sets for the level mode, optionally only those a trainer drawn for this
// challenge and battle can have. brain: her three, in party order.
export function setChoices({ challenge, battle, bracketOnly = true, brain = null, level = 50 } = {}) {
  if (brain) return [...BRAIN_TEAMS_TOWER[brain]];
  const open = isOpen(level);
  let ids = null;
  if (bracketOnly && challenge && battle) {
    ids = new Set();
    for (const { id } of trainerPrior({ challenge, battle })) for (const m of FRONTIER_TRAINERS[id].monSet) if (open || m <= HIGH_TIER) ids.add(m);
  }
  // Integer index only: the pool also carries the Frontier Brain sets and a
  // duplicate "Mr. Mime 1-4" (index null) beside the indexed "MR_MIME 1-4".
  return Object.entries(FRONTIER_POOL)
    .filter(([, e]) => Number.isInteger(e.index) && (open || e.index <= HIGH_TIER) && !e.brain && (!ids || ids.has(e.index)))
    .map(([key]) => key)
    .sort((a, b) => setLabel(a).localeCompare(setLabel(b), undefined, { numeric: true }));
}
export const setLabel = (key) => key.replace(/^MR_MIME /, "Mr. Mime ");

// The trainer IV bands a set can come with in this bracket, most likely first
// (each trainer weighted by the chance it is drawn and has this set at all).
export function ivTierOdds(setKey, { challenge, battle, level = 50 } = {}) {
  const e = FRONTIER_POOL[setKey];
  if (e?.brain) return [{ iv: e.fixedIV, p: 1 }];
  if (!e || !challenge || !battle) return [];
  const by = new Map();
  for (const { id, p } of trainerPrior({ challenge, battle })) {
    const lv = FRONTIER_TRAINERS[id].monSet.filter((m) => isOpen(level) || m <= HIGH_TIER);
    const n = lv.filter((m) => m === e.index).length;
    if (!n) continue;
    const iv = fixedIvs(id);
    by.set(iv, (by.get(iv) ?? 0) + (p * n) / lv.length);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()].map(([iv, w]) => ({ iv, p: w / total })).sort((a, b) => b.p - a.p);
}

// gender: "male" / "female", or null (unknown: the engine splits each Attract
// by the species' odds).
export function buildOpponent({ setKey, ability, ivTier, gender = null, level = 50 }) {
  const e = FRONTIER_POOL[setKey];
  if (!e) throw new Error(`no Frontier set named "${setKey}"`);
  const ab = ability || (e.abilities.length === 1 ? e.abilities[0] : null);
  if (!ab) throw new Error(`${setKey} can have ${e.abilities.join(" or ")} -- pick one`);
  if (!isOpen(level) && Number.isInteger(e.index) && e.index > HIGH_TIER) throw new Error(`${setLabel(setKey)} only appears at Level 100 (Open Level)`);
  const mon = L.buildFrontierOpponent(getOpponentConfig(setKey, { level, ability: ab, ivTier, allowUnreachableTier: true }));
  return gender && mon.genderDist.length > 1 ? { ...mon, genderDist: [{ p: 1, gender }] } : mon;
}
export const genderOf = (mon) => (mon.genderDist.length === 1 ? mon.genderDist[0].gender : null);

const ATTRACTERS = (m) => m.moves.includes("Attract") || m.ability === "Cute Charm";
function genderNote(team, active, opp) {
  const you = team[active];
  if (!ATTRACTERS(opp) && !ATTRACTERS(you)) return null;
  const unknown = [genderOf(you) ? null : `your ${you.species} (add (M) or (F) after its name in the paste)`, genderOf(opp) ? null : `their ${opp.species} (set it in the Opponent panel)`].filter(Boolean);
  return unknown.length ? `Attract / Cute Charm in play and the gender of ${unknown.join(" and ")} is not set: each Attract is a coin toss on the species' odds.` : null;
}

// ── sleep ──────────────────────────────────────────────────────────────────
// The game hides a sleep's length: every counter still possible, equally likely.
export function sleepCounters({ rest = false, slept = 0 } = {}, mon) {
  const step = mon.ability === "Early Bird" ? 2 : 1;
  const rolls = rest ? [3] : [2, 3, 4, 5];
  const left = rolls.map((r) => r - slept * step).filter((c) => c >= 1);
  return left.length ? left : [1];
}

// ── the position ───────────────────────────────────────────────────────────
// form = {
//   team: [config x1-3], active: index of your mon out,
//   mons: [{ hpPct, status, toxicTurns, sleep: { rest, slept }, itemGone }] per team member,
//   you: { stages, confused, subPct, firstTurn, lastMove (null = none yet), landed, seen: [moves] },
//   opp: { setKey, ability, ivTier, gender, hpPct, status, toxicTurns, sleep, itemGone, stages, confused, firstTurn },
//   party: { lead (pool key; null = the mon out is their lead), others: [{ setKey, hpPct }] (0-2, seen and benched) },
//   field: { weather, weatherTurns, you: { reflect, reflectTurns, lightScreen, lightScreenTurns, spikes }, opp: {...} },
//   run: { challenge, battle, brain, level, turn },
// }
// Returns { team, opp, start: [{ p, state }], mix, known, active, level, notes }.
const SCREEN_TURNS = 5;
const MAX_SLEEP_VARIANTS = 64;
export function buildPosition(form) {
  const notes = [];
  const run = form.run ?? {};
  const level = run.level ?? 50;
  if (!LEVELS.includes(level)) throw new Error(`level must be 50 or 100 (got ${level})`);
  if (form.team.some((cfg) => cfg.level !== level)) notes.push(`Read at level ${level} (the button above), whatever Level the paste gives.`);
  const team = form.team.map((cfg) => buildPlayerMon({ ...cfg, level }));
  const brain = run.brain ?? null;
  const active = form.opp.setKey;
  const lead = form.party?.lead || active;
  const others = (form.party?.others ?? []).filter((o) => o && o.setKey);
  const seenKeys = [lead, active, ...others.map((o) => o.setKey)];
  const distinct = [...new Set(seenKeys)];
  if (distinct.length !== seenKeys.length - (lead === active ? 1 : 0)) throw new Error("the same set is entered twice in their party");
  if (distinct.length > 3) throw new Error("their party has 3 Pokémon: more than 3 entered");
  if (brain) {
    const bt = BRAIN_TEAMS_TOWER[brain];
    for (const k of distinct) if (!bt.includes(k)) throw new Error(`${k} is not on ${brain}'s team (${bt.join(", ")})`);
    if (lead !== bt[0]) throw new Error(`Anabel always sends out ${FRONTIER_POOL[bt[0]].species} first`);
  } else for (const k of distinct) if (FRONTIER_POOL[k]?.brain) throw new Error(`${k} is a Frontier Brain set: pick the Brain battle`);
  const opp = buildOpponent({ ...form.opp, level });

  // Your side and the active opponent, as the team layer starts them.
  let s = teamStart({ team, opp, oppReserves: 2 }, form.active);
  const statusOf = (st) => (st === "toxic" ? "poison" : st || null);
  const mine = form.mons[form.active];
  const ov = {};
  ov.yourHpPct = mine.hpPct; ov.oppHpPct = form.opp.hpPct;
  ov.youStatus = statusOf(mine.status); ov.oppStatus = statusOf(form.opp.status);
  if (mine.status === "toxic") ov.youToxicCounter = Math.max(1, mine.toxicTurns ?? 1);
  if (form.opp.status === "toxic") ov.oppToxicCounter = Math.max(1, form.opp.toxicTurns ?? 1);
  for (const [side, st] of [["you", form.you.stages], ["opp", form.opp.stages]]) {
    if (st && STAGE_KEYS.some((k) => st[k])) ov[side + "Stages"] = Object.fromEntries(STAGE_KEYS.map((k) => [k, st[k] ?? 0]));
  }
  if (form.you.confused) ov.youConfused = form.you.confused === 1 ? true : form.you.confused;
  if (form.opp.confused) ov.oppConfused = form.opp.confused === 1 ? true : form.opp.confused;
  if (form.you.subPct > 0) ov.youSubstituteHP = Math.max(1, Math.round((form.you.subPct / 100) * team[form.active].stats.hp));
  if (mine.itemGone && team[form.active].item) { ov.youItemOverride = null; ov.youBerryConsumed = true; }
  if (form.opp.itemGone && opp.item) { ov.oppItemOverride = null; ov.oppBerryConsumed = true; }
  ov.oppMonFirstTurn = form.opp.firstTurn !== false;
  ov.youMonFirstTurn = form.you.firstTurn !== false;
  // What the AI remembers of your mon (BATTLE_HISTORY->usedMoves, cleared when
  // it came in) and the last move you used / that landed on it.
  const yourMoves = team[form.active].moves;
  const lastMove = form.you.lastMove || null;
  if (lastMove && !yourMoves.includes(lastMove)) throw new Error(`${team[form.active].species} does not know ${lastMove}`);
  const seen = (form.you.seen ?? []).filter((m) => yourMoves.includes(m));
  ov.youMoveHistory = seen.filter((m) => m !== lastMove).slice(0, 4); // the last move is recorded at the decision
  ov.youLastMove = lastMove;
  ov.oppLastLanded = lastMove && form.you.landed ? lastMove : null;
  ov.turn = Math.max(1, run.turn ?? 1);
  const f = form.field ?? {};
  if (f.weather) { ov.weatherType = f.weather; ov.weatherTurns = f.weatherTurns ?? null; }
  for (const side of ["you", "opp"]) {
    const sd = f[side] ?? {};
    ov[side + "ReflectTurns"] = sd.reflect ? (sd.reflectTurns ?? SCREEN_TURNS) : null;
    ov[side + "LightScreenTurns"] = sd.lightScreen ? (sd.lightScreenTurns ?? SCREEN_TURNS) : null;
    ov[side + "SpikesLayers"] = Math.max(0, Math.min(3, sd.spikes ?? 0));
  }
  s = { ...s, ...ov, youStages: ov.youStages ?? s.youStages, oppStages: ov.oppStages ?? s.oppStages };
  for (const k of ["youConfused", "oppConfused"]) if (k in ov) s[k] = ov[k];
  s.youBench = s.youBench.map((e, i) => {
    if (!e) return e;
    const m = form.mons[i];
    return { ...e, hpPct: m.hpPct, status: statusOf(m.status), toxic: m.status === "toxic",
      sleepTurns: null, ...(m.itemGone && team[i].item ? { itemOverride: null, berryConsumed: true } : {}) };
  });
  s.yourUsablePartyMons = s.youBench.filter((e) => e && e.hpPct > 0).length;

  // Sleep: one position per combination of counters still possible.
  let start = [{ p: 1, state: s }];
  const sleepers = [];
  if (s.youStatus === "sleep") sleepers.push({ key: "youSleepTurns", counters: sleepCounters(mine.sleep, team[form.active]) });
  if (s.oppStatus === "sleep") sleepers.push({ key: "oppSleepTurns", counters: sleepCounters(form.opp.sleep, opp) });
  for (const sl of sleepers) {
    start = start.flatMap((v) => sl.counters.map((c) => ({ p: v.p / sl.counters.length, state: { ...v.state, [sl.key]: c } })));
  }
  if (start.length > MAX_SLEEP_VARIANTS) throw new Error(`too many unknown sleep lengths at once (${start.length} combinations)`);
  if (start.length > 1) notes.push(`Sleep length unknown: averaged over ${start.length} possible counters.`);

  // Their party: what you have seen, the rest from the trainer draw.
  const lv = isOpen(level) ? { level } : {};
  if (!brain && !(run.challenge && run.battle)) throw new Error("pick the challenge and battle (they decide who the unseen teammates can be)");
  const mix = partyMix({ lead, seen: distinct.filter((k) => k !== lead), challenge: run.challenge, battle: run.battle, brain, ivs: form.opp.ivTier, ...lv });
  const known = { [active]: { mon: opp } };
  if (lead !== active) known[lead] = { hpPct: form.party.leadHpPct ?? 100 };
  for (const o of others) known[o.setKey] = { hpPct: o.hpPct ?? 100 };
  const unseen = 3 - distinct.length;
  if (unseen > 0 && !brain) notes.push(`Their ${unseen === 1 ? "last Pokémon is" : "other two are"} unknown: averaged over the ${mix.length.toLocaleString()} parties this trainer draw allows (which mon came in when is not used as evidence).`);
  const gn = genderNote(team, form.active, opp);
  if (gn) notes.push(gn);
  return { team, opp, start, mix, known, active, level: isOpen(level) ? level : 50, notes };
}

// ── the readout ────────────────────────────────────────────────────────────
// The opponent's action this turn over the start mix (unknown sleep lengths):
// { rows: [{ label, p, kind }], pSwitch, refused }.
export function readout(pos) {
  const acc = new Map();
  let pSwitch = 0, refused = 0;
  for (const { p, state } of pos.start) {
    const r = oppReadout({ team: pos.team, s: state, mix: pos.mix, known: pos.known, active: pos.active, level: pos.level });
    pSwitch += p * r.pSwitch;
    refused = Math.max(refused, r.refused);
    for (const x of r.rows) {
      const label = x.kind === "move" ? x.move : `Switch to ${setLabel(x.key)}`;
      const e = acc.get(label);
      if (e) e.p += p * x.p; else acc.set(label, { label, p: p * x.p, kind: x.kind });
    }
  }
  return { rows: [...acc.values()].sort((a, b) => b.p - a.p), pSwitch, refused };
}
export const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)}%`;
