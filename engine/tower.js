// ── tower.js ───────────────────────────────────────────────────────────────
// The Battle Tower's action selection: what the opponent does this turn.
//
// The Tower runs the plain Frontier trainer AI. BattleAI_SetupFlags gives any
// BATTLE_TYPE_FRONTIER battle CHECK_BAD_MOVE | CHECK_VIABILITY | TRY_TO_FAINT
// (src/battle_ai_script_commands.c:371-372); a Tower singles battle is
// BATTLE_TYPE_TRAINER | BATTLE_TYPE_BATTLE_TOWER (src/battle_tower.c:2015,
// :2102), inside BATTLE_TYPE_FRONTIER (include/constants/battle.h:91). Where
// the Palace scores only the nature roll's group, the Tower scores every slot:
// BattleAI_SetupAIData(ALL_MOVES_MASK) (battle_ai_script_commands.c:483) -- so
// no palaceMask, no loafing, no low-HP latch. The rest is the engine as
// inherited: the interpreter, ShouldSwitch (should-switch.js, not Palace-gated:
// battle_controller_opponent.c:1540-1544), the replacement (next-in.js).
//
// One battler's turn, in the order the ROM asks (src/battle_main.c):
//   1. a charging / recharging / rampaging mon is never asked (:4160-4164);
//   2. the controller's action: the opponent's AI_TrySwitchOrUseItem
//      (ShouldSwitch) -- engine/should-switch.js oppSwitchOdds;
//   3. B_ACTION_USE_MOVE: AreAllMovesUnusable -> Struggle (:4183-4190), then
//      Encore -> the encored move (:4192-4198), else the AI picks a slot;
//   4. a picked slot TrySetCantSelectMoveBattleScript refuses (Disable,
//      Torment, Taunt, Imprison, a Choice lock, 0 PP) runs the "can't use"
//      selection script and returns to STATE_WAIT_ACTION_CHOSEN with
//      B_ACTION_USE_MOVE (:4380-4388), which asks the controller for a move
//      again: the AI reruns on the same state with fresh Random() draws. So
//      the move is the AI's distribution conditioned on a selectable slot.
//      (If no selectable slot can ever win, the ROM loops forever; that
//      throws here.)

import * as L from "./logic.js";
import { mirrorState } from "./mirror.js";
import { oppSwitchOdds } from "./should-switch.js";
import { quickClawDraws } from "./palace.js"; // facility-neutral: gRandomTurnNumber's Quick Claw draw
import { view as battleView } from "./battle.js";
import * as T from "./team.js";
import { FRONTIER_POOL } from "./frontier-pool.js";
import { trainerPrior, teammateDist, setId, poolEntry, buildReplacement, BRAIN_TEAMS } from "./next-in.js";

const other = (side) => (side === "you" ? "opp" : "you");

// ── 1. one battler's move ──────────────────────────────────────────────────
// [{ p, move, aiRan, refused }]: aiRan = BattleAI_ChooseMoveOrAction ran (so
// RecordLastUsedMoveByTarget recorded the target's last move); refused = the
// share of the AI's first picks that were unselectable and re-asked (shown,
// not used: the returned p are already conditioned).
// `qc` conditions the AI's speed read on the turn's Quick Claw draw.
export function towerChoices(ctx, state, side, { qc = false } = {}) {
  const ec = L.effectiveCtx(ctx, state);
  const self = ec[side], foe = ec[other(side)];
  const locked = state[side + "Charging"]?.move || state[side + "Recharge"]?.move || state[side + "Lock"]?.move;
  if (locked) return [{ p: 1, move: locked, aiRan: false, refused: 0 }];
  const legal = L.selectableMoves(self.moves, state, side, foe, side === "you" ? "you" : "the opponent");
  // AreAllMovesUnusable comes BEFORE the Encore check (:4183 then :4192).
  if (legal.length === 1 && legal[0] === "Struggle" && !self.moves.includes("Struggle")) return [{ p: 1, move: "Struggle", aiRan: false, refused: 0 }];
  if (state[side + "EncoredMove"]) return [{ p: 1, move: state[side + "EncoredMove"], aiRan: false, refused: 0 }];
  const decided = L.aiDecisionState(state, side);
  const picks = side === "opp"
    ? L.chooseOpponentMoves(ec.opp, ec.you, decided, { qc })
    : L.chooseOpponentMoves(ec.you, ec.opp, mirrorState(decided), { qc });
  const ok = picks.filter((c) => legal.includes(c.move));
  if (ok.length === picks.length) return picks.map((c) => ({ p: c.prob, move: c.move, aiRan: true, refused: 0 }));
  const mass = ok.reduce((a, c) => a + c.prob, 0);
  if (!(mass > 0)) throw new Error(`tower: the AI can only pick unselectable moves (${picks.map((c) => c.move).join(", ")}) -- the ROM would ask forever`);
  const refused = picks.filter((c) => !legal.includes(c.move)).reduce((a, c) => a + c.prob, 0);
  return ok.map((c) => ({ p: c.prob / mass, move: c.move, aiRan: true, refused }));
}

// ── 2. the opponent's whole action, its team known ─────────────────────────
// B = { team, oppTeam: [3 mons], oppIds } (engine/battle.js); s carries
// youActive/youBench and oppActive/oppBench. Returns
// [{ p, kind: "move", move } | { p, kind: "switch", slot }], summed over the
// Quick Claw draw. ShouldSwitch draws nothing the Quick Claw draw decides, so
// P(switch) and P(move | qc) multiply.
export function oppActions(B, s) {
  const ctx = T.engineCtx(battleView(B, s), s);
  const out = [];
  for (const d of oppSwitchOdds(B, s)) {
    if (d.slot != null) { out.push({ p: d.p, kind: "switch", slot: d.slot }); continue; }
    for (const draw of quickClawDraws(ctx, s)) {
      for (const c of towerChoices(ctx, s, "opp", { qc: draw.qc })) out.push({ p: d.p * draw.p * c.p, kind: "move", move: c.move, refused: c.refused });
    }
  }
  return merge(out, (r) => (r.kind === "move" ? `m|${r.move}` : `s|${r.slot}`));
}
function merge(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r), e = m.get(k);
    if (e) e.p += r.p; else m.set(k, { ...r });
  }
  return [...m.values()].sort((a, b) => b.p - a.p);
}

// ── 3. who the unseen teammates can be ─────────────────────────────────────
// The opponent's party as ordered frontier ids [slot 0 = lead, 1, 2], with
// each ordering's probability and the trainer's IVs: FillTrainerParty's exact
// distribution (next-in.js teammateDist, conditioned on the lead), kept where
// every mon you have SEEN is in the party. Not used as evidence (stated): the
// order they came in, and that GetMostSuitableMonToSwitchInto or ShouldSwitch
// chose a seen mon over the others. A Frontier Brain's team is fixed.
//   lead  pool key of slot 0;  seen  other pool keys seen (0-2)
//   ivs   the IVs you entered for the mon out (one value per trainer): keeps
//         only the trainers that give it; null = no filter
//   trainerId  the trainer, when you know who it is (else the bracket's draw)
// The returned array carries `mass`: the prior probability of everything
// conditioned on (this lead, the seen mons in the party, the IVs) -- so two
// candidate sets for the same mon can be weighed against each other by it.
// A Brain's mass is 1 (her team is certain).
export function partyMix({ lead, seen = [], challenge, battle, trainerId, brain = null, level = 50, ivs = null } = {}) {
  if (!FRONTIER_POOL[lead]) throw new Error(`tower: no Frontier set named "${lead}"`);
  for (const k of seen) if (!FRONTIER_POOL[k]) throw new Error(`tower: no Frontier set named "${k}"`);
  if (new Set([lead, ...seen]).size !== 1 + seen.length) throw new Error("tower: a set is listed twice in the party");
  if (seen.length > 2) throw new Error("tower: a party has 3 Pokémon");
  if (brain) {
    const t = BRAIN_TEAMS[brain];
    if (!t) throw new Error(`tower: no Frontier Brain team "${brain}"`);
    if (lead !== t[0]) throw new Error(`${brain.split(" ")[0]} always sends out ${FRONTIER_POOL[t[0]].species} first`);
    for (const k of seen) if (!t.includes(k)) throw new Error(`${k} is not on ${brain}'s team`);
    return Object.assign([{ p: 1, ids: t.map(setId), ivs: FRONTIER_POOL[t[0]].fixedIV }], { mass: 1 });
  }
  if (FRONTIER_POOL[lead].brain) throw new Error(`tower: ${lead} is a Frontier Brain set -- pick the Brain battle`);
  const open = level !== 50;
  const dist = teammateDist(trainerPrior({ challenge, battle, trainerId }), setId(lead), { open });
  const want = seen.map(setId);
  let kept = dist.filter((d) => want.every((id) => d.slots.includes(id)));
  if (!kept.length) throw new Error(`tower: ${seen.join(" and ")} cannot be ${lead}'s teammate${seen.length > 1 ? "s" : ""} here`);
  if (ivs != null) {
    const byIv = kept.filter((d) => d.ivs === ivs);
    if (!byIv.length) throw new Error(`tower: no trainer here with this party gives IVs ${ivs} (possible: ${[...new Set(kept.map((d) => d.ivs))].join(", ")})`);
    kept = byIv;
  }
  const total = kept.reduce((a, d) => a + d.p, 0);
  return Object.assign(kept.map((d) => ({ p: d.p / total, ids: [setId(lead), ...d.slots], ivs: d.ivs })), { mass: dist.mass * total });
}

// ── 4. the readout: the opponent's action over what you do not know ────────
// pos = {
//   team, s           your team and the position (team.js state: youActive,
//                     youBench, the active opponent's fields); s.oppActive /
//                     s.oppBench / s.oppUsablePartyMons are filled in here
//   mix               partyMix(...)
//   known: { key: { mon?, hpPct?, status? } }   the mons you have seen: the
//                     ACTIVE one's built mon (ability / IVs / gender as you
//                     entered them) is required; a benched one's HP / status
//                     (default: healthy, full HP)
//   active            pool key of the mon out
//   level             the opponents' level (unseen teammates are built at it)
// }
// Unseen teammates are built from their set with each ability equally likely
// (personality & 1; buildReplacement). Returns { rows, pSwitch } with rows
// [{ p, kind: "move", move } | { p, kind: "switch", key, species }], switches
// merged by set, and `refused` (the share of first AI picks re-asked);
// switchForms [{ p, key, mon, hpPct, status }] -- the same switches split by the
// newcomer's built form (its ability), for playing the switch out (advise.js).
export function oppReadout({ team, s, mix, known, active, level = 50 }) {
  const activeId = setId(active);
  if (!known[active]?.mon) throw new Error("tower: the mon out needs its built mon (known[active].mon)");
  const acc = new Map(), forms_ = new Map();
  let refused = 0;
  for (const m of mix) {
    const slot = m.ids.indexOf(activeId);
    if (slot < 0) throw new Error(`tower: ${active} is not in a party of the mix`);
    // every ability combination of the unseen teammates, equally likely
    let forms = [{ p: m.p, mons: [] }];
    for (let i = 0; i < 3; i++) {
      const key = poolEntry(m.ids[i]).key;
      const kn = known[key];
      const choices = kn?.mon ? [{ p: 1, mon: kn.mon }] : buildReplacement(m.ids[i], m.ivs, level);
      forms = forms.flatMap((f) => choices.map((c) => ({ p: f.p * c.p, mons: [...f.mons, c.mon] })));
    }
    for (const f of forms) {
      const bench = f.mons.map((mon, i) => {
        if (i === slot) return null;
        const kn = known[poolEntry(m.ids[i]).key];
        return { ...T.freshEntry(mon), hpPct: kn?.hpPct ?? 100, status: kn?.status ?? null };
      });
      const st = { ...s, oppActive: slot, oppBench: bench, oppUsablePartyMons: bench.filter((e) => e && e.hpPct > 0).length };
      const B = { team, oppTeam: f.mons, oppIds: m.ids };
      for (const r of oppActions(B, st)) {
        const k = r.kind === "move" ? `m|${r.move}` : `s|${m.ids[r.slot]}`;
        const e = acc.get(k);
        if (e) e.p += f.p * r.p;
        else acc.set(k, r.kind === "move" ? { p: f.p * r.p, kind: "move", move: r.move }
          : { p: f.p * r.p, kind: "switch", key: poolEntry(m.ids[r.slot]).key, species: f.mons[r.slot].species });
        if (r.kind === "move") refused = Math.max(refused, r.refused ?? 0);
        else {
          const key = poolEntry(m.ids[r.slot]).key, mon = f.mons[r.slot], fk = `${key}|${mon.ability}`;
          const g = forms_.get(fk);
          if (g) g.p += f.p * r.p;
          else forms_.set(fk, { p: f.p * r.p, key, mon, hpPct: bench[r.slot].hpPct, status: bench[r.slot].status });
        }
      }
    }
  }
  const rows = [...acc.values()].sort((a, b) => b.p - a.p);
  return { rows, pSwitch: rows.filter((r) => r.kind === "switch").reduce((a, r) => a + r.p, 0), refused,
    switchForms: [...forms_.values()].sort((a, b) => b.p - a.p) };
}
