// The readable battle log (sim/showdown-log.mjs): random battles of the
// user's teams through engine/battle.js with labels on, every turn told the
// Showdown way, and checked against the states:
//   - each mon's printed HP changes add up to its real change (in points),
//   - every label is understood (no raw engine text left over),
//   - faints are told exactly once, for the mons that fell,
//   - labels off: no snapshots in the label, and the outcomes are the same.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const Bt = await import(E("battle.js"));
const N = await import(E("next-in.js"));
const { buildTeam } = await import(E("showdown.js"));
const { rng } = await import(E("montecarlo.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));
const { makeDraw, seedOf } = await import(pathToFileURL(path.join(here, "../sim/draw.mjs")).href);
const { makeLog, stripMarks } = await import(pathToFileURL(path.join(here, "../sim/showdown-log.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const TEAMS = ["teams/user-test-team.txt", "teams/stall/Skarmory-Dusclops-Blissey(Bold).txt",
  "teams/perish/Gengar-Blissey(BrightPowder)-Suicune(Lefties).txt", "teams/mlsuicune.txt"]
  .map((f) => path.join(here, "..", f)).filter((f) => fs.existsSync(f));
const BATTLES = Number(process.env.LOG_BATTLES ?? 60);
const draw = makeDraw(11);
const pts = (pct, mon) => Math.round((Math.max(0, pct) * mon.stats.hp) / 100);
const hpOf = (s, side, i) => (side === "y" ? (s.youActive === i ? s.yourHpPct : s.youBench[i]?.hpPct) : (s.oppActive === i ? s.oppHpPct : s.oppBench?.[i]?.hpPct ?? 100));

let turns = 0, raw = 0, sumBad = 0, faintBad = 0, shown = 0, netBad = 0;
const rawSeen = new Set();
for (const file of TEAMS) {
  const team = buildTeam(fs.readFileSync(file, "utf8"));
  for (let k = 0; k < BATTLES; k++) {
    const n = 50 + k;
    const d = draw.drawBattle(n);
    const rand = rng(seedOf(11, "log", file, n));
    const oppTeam = d.keys.map((key, i) => L.buildFrontierOpponent(getOpponentConfig(key, { ability: d.abilities[i], ivTier: d.iv, allowUnreachableTier: true })));
    const B = { team, oppTeam, oppIds: d.keys.map(N.setId), rollSample: rand, labels: true };
    const LOG = makeLog(B, "Trainer");
    const pick = (xs) => { let u = rand() * xs.reduce((a, x) => a + x.p, 0); for (const x of xs) { u -= x.p; if (u <= 0) return x; } return xs[xs.length - 1]; };
    let s = Bt.battleStart(B, 0), result = null;
    LOG.start(s);
    for (let t = 0; t < 150 && !result; t++) {
      const bench = s.youBench.map((e, i) => (e && e.hpPct > 0 ? i : -1)).filter((i) => i >= 0);
      const action = bench.length && rand() < 0.2 ? { switchTo: bench[Math.floor(rand() * bench.length)] } : "stay";
      let r;
      try { r = pick(Bt.battleTurn(B, s, action)); } catch (e) { break; } // named engine throws (your Baton Pass, ...)
      const lines = LOG.turn(s, r.state, r.label, r.chose).flat();
      if (process.env.LOG_DUMP) fs.appendFileSync(process.env.LOG_DUMP, lines.join("\n") + "\n"); // LOG_DUMP=<file>: every line, to read
      turns++; shown += lines.length;
      // every printed HP change, per name
      const sums = new Map();
      for (const l of lines) {
        let m = l.match(/^\((.+?) (lost|restored) (\d+) HP, /);
        if (m) { sums.set(m[1], (sums.get(m[1]) ?? 0) + (m[2] === "lost" ? -1 : 1) * Number(m[3])); continue; }
        m = l.match(/^\((.+?): ([+-])(\d+) HP net/);
        if (m) sums.set(m[1], (sums.get(m[1]) ?? 0) + (m[2] === "-" ? -1 : 1) * Number(m[3]));
      }
      for (const [side, mons] of [["y", team], ["o", oppTeam]]) {
        mons.forEach((mon, i) => {
          const name = side === "y" ? mon.species : `The opposing ${mon.species}`;
          const real = pts(hpOf(r.state, side, i), mon) - pts(hpOf(s, side, i), mon);
          const said = sums.get(name) ?? 0;
          if (real !== said) { sumBad++; if (sumBad <= 5) console.log(`  HP sum: ${name} real ${real} said ${said} | ${stripMarks(r.label)}\n    ${lines.join("\n    ")}`); }
          const fell = hpOf(s, side, i) > 0 && !(hpOf(r.state, side, i) > 0);
          const told = lines.filter((l) => l === `${name} fainted!`).length;
          if (told !== (fell ? 1 : 0)) { faintBad++; if (faintBad <= 5) console.log(`  faint: ${name} fell ${fell} told ${told} | ${stripMarks(r.label)}`); }
        });
      }
      // a net end-of-turn line only follows two or more named causes
      lines.forEach((l, i) => {
        if (!/^\((.+?): [+-]\d+ HP net/.test(l)) return;
        const cause = (x) => /Leftovers!$|was hurt by|is buffeted|sapped by Leech Seed|afflicted by the curse/.test(x ?? "");
        if (!(cause(lines[i - 1]) && cause(lines[i - 2]))) { netBad++; if (netBad <= 3) console.log(`  net line without two causes:\n    ${lines.join("\n    ")}`); }
      });
      for (const l of lines) {
        if (/⟦|^\(|: (uses|loafs|is |hits|can't|flinches|must)/.test(l) && !/^\((.+?) (lost|restored) \d+ HP|^\((.+?): [+-]\d+ HP net/.test(l)) { raw++; rawSeen.add(l.replace(/\d+/g, "N")); }
      }
      s = r.state;
      if (r.outcome === "replace") {
        const c = s.youBench.map((e, i) => (e && e.hpPct > 0 ? i : -1)).filter((i) => i >= 0);
        const s1 = Bt.replaceYours(B, s, c[0]);
        LOG.replacement(s, s1);
        s = s1;
      } else if (r.outcome) result = r.outcome;
    }
  }
}
console.log(`  ${turns} turns, ${shown} lines`);
ok(turns > 1000, `enough turns played (${turns})`);
ok(sumBad === 0, `printed HP changes add up to the real ones (${sumBad} mismatches)`);
ok(faintBad === 0, `each faint told exactly once (${faintBad} mismatches)`);
ok(netBad === 0, `net HP lines only after two or more causes (${netBad})`);
ok(raw === 0, `no raw engine text left (${raw}: ${[...rawSeen].slice(0, 8).join(" | ")})`);

// labels off: no snapshots, same outcomes
{
  const team = buildTeam(fs.readFileSync(TEAMS[0], "utf8"));
  const d = draw.drawBattle(60);
  const oppTeam = d.keys.map((key, i) => L.buildFrontierOpponent(getOpponentConfig(key, { ability: d.abilities[i], ivTier: d.iv, allowUnreachableTier: true })));
  const on = { team, oppTeam, oppIds: d.keys.map(N.setId), labels: true };
  const off = { team, oppTeam, oppIds: d.keys.map(N.setId) };
  const s = Bt.battleStart(on, 0);
  const a = Bt.battleTurn(on, s, "stay"), b = Bt.battleTurn(off, s, "stay");
  ok(a.some((r) => /⟦/.test(r.label)), "labels on: snapshots in the label");
  ok(b.every((r) => !/⟦/.test(r.label ?? "")), "labels off: no snapshots");
  ok(a.length === b.length && a.every((r, i) => r.p === b[i].p && JSON.stringify(r.state) === JSON.stringify(b[i].state)), "labels change no outcome");
}

console.log(`test-showdown-log: ${pass}/${pass + fail}`);
if (fail) process.exit(1);
