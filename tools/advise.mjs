// The one-turn advisor from the command line, on teams/user-test-team.txt:
//   node tools/advise.mjs "<set>" [challenge] [your last move, landed]
import { readFileSync } from "node:fs";
import * as U from "../site/ui-logic.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";
const [key = "Snorlax 3", chArg = "7", last = null] = process.argv.slice(2);
const challenge = Number(chArg);
const cfgs = U.parseTeam(readFileSync(new URL("../teams/user-test-team.txt", import.meta.url), "utf8"));
const e = FRONTIER_POOL[key];
const iv = U.ivTierOdds(key, { challenge, battle: 1 })[0]?.iv ?? 31;
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const form = {
  team: cfgs, active: 0, mons: cfgs.map(() => ({ hpPct: 100, status: "" })),
  you: { stages: zero, confused: 0, subPct: 0, firstTurn: !last, lastMove: last, landed: true, seen: last ? [last] : [] },
  opp: { setKey: key, ability: null, ivTier: iv, hpPct: 100, status: "", stages: zero, confused: 0, firstTurn: !last },
  party: { lead: null, others: [] }, field: {}, run: { challenge, battle: 1, turn: last ? 2 : 1 },
};
const pos = U.buildPosition(form);
const t0 = Date.now();
const rows = U.advise(pos);
console.log(`${key} vs ${cfgs[0].species}${last ? ` after ${last}` : ", turn 1"}: ${Date.now() - t0} ms`);
console.log("option".padEnd(24), "KO it", " you faint", " dealt", " taken", " leaves");
for (const r of rows) console.log(r.label.padEnd(24), r.error ? `-- ${r.error}` : [r.pKO, r.pFaint].map((x) => U.pct(x, 1).padStart(6)).join("    ") + "  " + [r.dealt, r.taken].map((x) => x.toFixed(1).padStart(6)).join(" ") + "  " + U.pct(r.pLeaves, 1).padStart(6) + (r.approx ? " ~" : ""));
