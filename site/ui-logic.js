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
import { TRAINER_CLASS_NAMES } from "../engine/trainer-classes.js";
import { yourOptions, adviseOption } from "../engine/advise.js";

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

// ── the trainer ────────────────────────────────────────────────────────────
// The trainers this challenge and battle can draw (GetRandomScaledFrontier
// TrainerId's range, next-in.js trainerPrior), labelled as the game names them
// before the battle: "Miriam (Cooltrainer)" -- name + class, because a name
// alone is not unique (checked: name + class is unique in every bracket).
const titleCase = (s) => s.toLowerCase().replace(/(^|[ -])([a-z])/g, (_, a, b) => a + b.toUpperCase());
export const trainerLabel = (id) => { const t = FRONTIER_TRAINERS[id]; return `${titleCase(t.name)} (${TRAINER_CLASS_NAMES[t.cls]})`; };
export function trainerChoices({ challenge, battle } = {}) {
  if (!challenge || !battle) return [];
  return trainerPrior({ challenge, battle }).map(({ id }) => ({ id, label: trainerLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
// The trainer's drawable pool at this level: monSet ids (duplicates kept --
// FillTrainerParty draws monSet[Random() % n]), high tier only at Open Level.
const trainerPool = (id, level) => FRONTIER_TRAINERS[id].monSet.filter((m) => isOpen(level) || m <= HIGH_TIER);

// ── the opponent's set list ────────────────────────────────────────────────
// The sets for the level mode: a trainer's own pool when you know the
// trainer; else optionally only those a trainer drawn for this challenge and
// battle can have. brain: her three, in party order.
export function setChoices({ challenge, battle, bracketOnly = true, brain = null, level = 50, trainerId = null } = {}) {
  if (brain) return [...BRAIN_TEAMS_TOWER[brain]];
  const open = isOpen(level);
  let ids = null;
  if (trainerId != null) ids = new Set(trainerPool(trainerId, level));
  else if (bracketOnly && challenge && battle) {
    ids = new Set();
    for (const { id } of trainerPrior({ challenge, battle })) for (const m of trainerPool(id, level)) ids.add(m);
  }
  // Integer index only: the pool also carries the Frontier Brain sets and a
  // duplicate "Mr. Mime 1-4" (index null) beside the indexed "MR_MIME 1-4".
  return Object.entries(FRONTIER_POOL)
    .filter(([, e]) => Number.isInteger(e.index) && (open || e.index <= HIGH_TIER) && !e.brain && (!ids || ids.has(e.index)))
    .map(([key]) => key)
    .sort((a, b) => setLabel(a).localeCompare(setLabel(b), undefined, { numeric: true }));
}
export const setLabel = (key) => key.replace(/^MR_MIME /, "Mr. Mime ");
// The other sets of the same species the pool holds (the "it's one of these"
// list), the set itself included, in set order.
export function sameSpecies(setKey, opts = {}) {
  const sp = FRONTIER_POOL[setKey]?.species;
  if (!sp || opts.brain) return setKey ? [setKey] : [];
  return setChoices({ ...opts, bracketOnly: true }).filter((k) => FRONTIER_POOL[k].species === sp);
}

// The trainer IV bands a set can come with in this bracket, most likely first
// (each trainer weighted by the chance it is drawn and has this set at all).
// A known trainer: its one value (GetFrontierTrainerFixedIvs).
export function ivTierOdds(setKey, { challenge, battle, level = 50, trainerId = null } = {}) {
  const e = FRONTIER_POOL[setKey];
  if (e?.brain) return [{ iv: e.fixedIV, p: 1 }];
  if (trainerId != null) return [{ iv: fixedIvs(trainerId), p: 1 }];
  if (!e || !challenge || !battle) return [];
  const by = new Map();
  for (const { id, p } of trainerPrior({ challenge, battle })) {
    const lv = trainerPool(id, level);
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
//   opp: { setKey, candidates ([pool keys of the same species it could be,
//          setKey among them]; omitted = setKey only), ability (null = not seen:
//          each of the set's abilities equally likely), ivTier, gender, hpPct,
//          status, toxicTurns, sleep, itemGone, stages, confused, firstTurn },
//   party: { lead (pool key; null = the mon out is their lead), leadHpPct, others: [{ setKey, hpPct }] (0-2) },
//   field: { weather, weatherTurns, you: { reflect, reflectTurns, lightScreen, lightScreenTurns, spikes }, opp: {...} },
//   run: { challenge, battle, trainerId (null = not known), brain, level, turn },
// }
// Returns { team, cands, setOdds, excluded, opp, active, level, notes }:
//   cands     [{ key, ability, w, opp, start: [{ p, state }], mix, known }], the
//             w summing to 1: each candidate set and ability weighted by the
//             prior chance of what you have seen given it (partyMix's mass:
//             the trainer draw makes this set the mon out, with the seen mons
//             and IVs), x 1 / its number of abilities when the ability is not seen
//   setOdds   [{ key, p }] the same, summed over abilities, most likely first
//   excluded  [{ key, why }] candidates the evidence rules out
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
  const trainerId = brain ? null : (run.trainerId ?? null);
  const primary = form.opp.setKey;
  if (!FRONTIER_POOL[primary]) throw new Error(`no Frontier set named "${primary}"`);
  const candidates = [...new Set([primary, ...(form.opp.candidates ?? [])])];
  for (const k of candidates) {
    if (!FRONTIER_POOL[k]) throw new Error(`no Frontier set named "${k}"`);
    if (FRONTIER_POOL[k].species !== FRONTIER_POOL[primary].species) throw new Error(`${k} is not a ${FRONTIER_POOL[primary].species}: the candidates are sets of the mon out`);
  }
  const lead = form.party?.lead || null; // null: the mon out IS their lead
  const others = (form.party?.others ?? []).filter((o) => o && o.setKey);
  const fixed = [...(lead ? [lead] : []), ...others.map((o) => o.setKey)];
  if (new Set(fixed).size !== fixed.length) throw new Error("the same set is entered twice in their party");
  if (fixed.length > 2) throw new Error("their party has 3 Pokémon: more than 3 entered");
  for (const k of fixed) if (FRONTIER_POOL[k].species === FRONTIER_POOL[primary].species) throw new Error(`${setLabel(k)}: a party never has two ${FRONTIER_POOL[k].species} (FillTrainerParty's species check)`);
  if (brain) {
    const bt = BRAIN_TEAMS_TOWER[brain];
    for (const k of [...candidates, ...fixed]) if (!bt.includes(k)) throw new Error(`${k} is not on ${brain}'s team (${bt.join(", ")})`);
    if ((lead ?? primary) !== bt[0]) throw new Error(`Anabel always sends out ${FRONTIER_POOL[bt[0]].species} first`);
  } else for (const k of [...candidates, ...fixed]) if (FRONTIER_POOL[k]?.brain) throw new Error(`${k} is a Frontier Brain set: pick the Brain battle`);
  if (!brain && trainerId == null && !(run.challenge && run.battle)) throw new Error("pick the challenge and battle (they decide who the unseen teammates can be)");
  // A known trainer gives all its mons one IV value (GetFrontierTrainerFixedIvs).
  const ivs = brain ? FRONTIER_POOL[primary].fixedIV : trainerId != null ? fixedIvs(trainerId) : form.opp.ivTier;
  const lv = isOpen(level) ? { level } : {};

  const cands = [], excluded = [];
  for (const key of candidates) {
    const e = FRONTIER_POOL[key];
    if (form.opp.ability && !e.abilities.includes(form.opp.ability)) { excluded.push({ key, why: `cannot have ${form.opp.ability}` }); continue; }
    let mix;
    try {
      mix = partyMix({ lead: lead ?? key, seen: [...(lead ? [key] : []), ...others.map((o) => o.setKey)], challenge: run.challenge, battle: run.battle, trainerId, brain, ivs, ...lv });
    } catch (err) { excluded.push({ key, why: err.message.replace(/^tower: /, "") }); continue; }
    const abilities = form.opp.ability ? [form.opp.ability] : e.abilities;
    for (const ability of abilities) {
      const opp = buildOpponent({ ...form.opp, setKey: key, ability, ivTier: ivs, level });
      const known = { [key]: { mon: opp } };
      if (lead) known[lead] = { hpPct: form.party.leadHpPct ?? 100 };
      for (const o of others) known[o.setKey] = { hpPct: o.hpPct ?? 100 };
      cands.push({ key, ability, w: mix.mass / abilities.length, opp, start: startMix(form, team, opp, run, notes), mix, known });
    }
  }
  if (!cands.length) throw new Error(`none of the sets entered fits what you have seen: ${excluded.map((x) => `${setLabel(x.key)} ${x.why}`).join("; ")}`);
  const total = cands.reduce((a, c) => a + c.w, 0);
  for (const c of cands) c.w /= total;
  const by = new Map();
  for (const c of cands) by.set(c.key, (by.get(c.key) ?? 0) + c.w);
  const setOdds = [...by.entries()].map(([key, p]) => ({ key, p })).sort((a, b) => b.p - a.p);

  const unseen = 3 - 1 - fixed.length;
  if (unseen > 0 && !brain) notes.push(`Their ${unseen === 1 ? "last Pokémon is" : "other two are"} unknown: averaged over the parties ${trainerId != null ? "this trainer" : "this challenge's trainers"} can draw (which mon came in when is not used as evidence).`);
  if (!form.opp.ability && cands.some((c) => FRONTIER_POOL[c.key].abilities.length > 1)) notes.push("Ability not set: each of its abilities is equally likely.");
  const gn = genderNote(team, form.active, cands[0].opp);
  if (gn) notes.push(gn);
  return { team, cands, setOdds, excluded, opp: cands[0].opp, active: primary, level: isOpen(level) ? level : 50, notes: [...new Set(notes)] };
}

// The position for one candidate mon out: your side, its side, the field;
// one entry per combination of unknown sleep counters.
function startMix(form, team, opp, run, notes) {
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

  let start = [{ p: 1, state: s }];
  const sleepers = [];
  if (s.youStatus === "sleep") sleepers.push({ key: "youSleepTurns", counters: sleepCounters(mine.sleep, team[form.active]) });
  if (s.oppStatus === "sleep") sleepers.push({ key: "oppSleepTurns", counters: sleepCounters(form.opp.sleep, opp) });
  for (const sl of sleepers) {
    start = start.flatMap((v) => sl.counters.map((c) => ({ p: v.p / sl.counters.length, state: { ...v.state, [sl.key]: c } })));
  }
  if (start.length > MAX_SLEEP_VARIANTS) throw new Error(`too many unknown sleep lengths at once (${start.length} combinations)`);
  if (start.length > 1) notes.push(`Sleep length unknown: averaged over ${start.length} possible counters.`);
  return start;
}

// ── the readout ────────────────────────────────────────────────────────────
// The opponent's action this turn over the candidates and each one's start
// mix: { rows: [{ label, p, kind }], pSwitch, refused }.
export function readout(pos) {
  const acc = new Map();
  let pSwitch = 0, refused = 0;
  for (const c of pos.cands) {
    for (const { p, state } of c.start) {
      const w = c.w * p;
      const r = oppReadout({ team: pos.team, s: state, mix: c.mix, known: c.known, active: c.key, level: pos.level });
      pSwitch += w * r.pSwitch;
      refused = Math.max(refused, r.refused);
      for (const x of r.rows) {
        const label = x.kind === "move" ? x.move : `Switch to ${setLabel(x.key)}`;
        const e = acc.get(label);
        if (e) e.p += w * x.p; else acc.set(label, { label, p: w * x.p, kind: x.kind });
      }
    }
  }
  return { rows: [...acc.values()].sort((a, b) => b.p - a.p), pSwitch, refused };
}

export const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)}%`;

// ── the advisor (one turn) ─────────────────────────────────────────────────
// Each of your options this turn, played out against the opponent's action
// odds (engine/advise.js), averaged over the candidates and the start mix.
// Returns [{ label, kind, pKO, pFaint, dealt, taken, pLeaves, approx, cover }]
// in the order your options come (moves, then switches); cover < 1 when the
// option is not available against every candidate (e.g. a trapping ability).
export function advise(pos) {
  const acc = new Map();
  for (const c of pos.cands) {
    const reserves = 2 - Object.entries(c.known).filter(([k, v]) => k !== c.key && v.hpPct === 0).length;
    for (const { p, state } of c.start) {
      const w = c.w * p;
      const r = oppReadout({ team: pos.team, s: state, mix: c.mix, known: c.known, active: c.key, level: pos.level });
      const opp = { pStay: 1 - r.pSwitch, switches: r.switchForms };
      const tctx = { team: pos.team, opp: c.opp, oppReserves: reserves, activeKey: c.key };
      for (const o of yourOptions(tctx, state)) {
        let x;
        try { x = adviseOption(tctx, state, o, opp); } catch (e) { x = { error: e.message }; }
        const e = acc.get(o.label) ?? { label: o.label, kind: o.kind, cover: 0, pKO: 0, pFaint: 0, dealt: 0, taken: 0, pLeaves: 0, approx: false, error: null };
        e.cover += w;
        if (x.error) e.error = x.error;
        else { for (const k of ["pKO", "pFaint", "dealt", "taken", "pLeaves"]) e[k] += w * x[k]; e.approx ||= x.approx; }
        acc.set(o.label, e);
      }
    }
  }
  return [...acc.values()].map((e) => {
    if (e.error) return { label: e.label, kind: e.kind, error: e.error, cover: e.cover };
    const n = (v) => v / e.cover;
    return { ...e, pKO: n(e.pKO), pFaint: n(e.pFaint), dealt: n(e.dealt), taken: n(e.taken), pLeaves: n(e.pLeaves) };
  });
}
