// The opponent's readout from the command line, on teams/user-test-team.txt
// (its first mon out, everyone healthy):
//   node tools/readout.mjs "<set>" [challenge] [your last move, landed]
// e.g. node tools/readout.mjs "Snorlax 3" 7 Earthquake
import { readFileSync } from "node:fs";
import * as U from "../site/ui-logic.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";

const [key = "Snorlax 3", chArg = "7", last = null] = process.argv.slice(2);
const challenge = Number(chArg);
const cfgs = U.parseTeam(readFileSync(new URL("../teams/user-test-team.txt", import.meta.url), "utf8"));
const e = FRONTIER_POOL[key];
if (!e) throw new Error(`no Frontier set named "${key}"`);
const iv = U.ivTierOdds(key, { challenge, battle: 1 })[0]?.iv ?? 31;
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const form = {
  team: cfgs, active: 0, mons: cfgs.map(() => ({ hpPct: 100, status: "" })),
  you: { stages: zero, confused: 0, subPct: 0, firstTurn: !last, lastMove: last, landed: true, seen: last ? [last] : [] },
  opp: { setKey: key, ability: e.abilities[0], ivTier: iv, hpPct: 100, status: "", stages: zero, confused: 0, firstTurn: !last },
  party: { lead: null, others: [] }, field: {}, run: { challenge, battle: 1, turn: last ? 2 : 1 },
};
const t0 = Date.now();
const pos = U.buildPosition(form);
const r = U.readout(pos);
console.log(`${key} (${e.abilities[0]}, IVs ${iv}) vs ${cfgs[0].species}${last ? ` after ${last}` : ", turn 1"}: ${pos.mix.length} parties, ${Date.now() - t0} ms, P(switch) ${U.pct(r.pSwitch, 1)}`);
for (const x of r.rows.slice(0, 12)) console.log(U.pct(x.p, 2).padStart(7), x.label);
