import subprocess, sys
F = "engine/tower.js"
MUT = [
  ("Encore before Struggle",
   "  if (legal.length === 1 && legal[0] === \"Struggle\" && !self.moves.includes(\"Struggle\")) return [{ p: 1, move: \"Struggle\", aiRan: false, refused: 0 }];\n  if (state[side + \"EncoredMove\"]) return [{ p: 1, move: state[side + \"EncoredMove\"], aiRan: false, refused: 0 }];",
   "  if (state[side + \"EncoredMove\"]) return [{ p: 1, move: state[side + \"EncoredMove\"], aiRan: false, refused: 0 }];\n  if (legal.length === 1 && legal[0] === \"Struggle\" && !self.moves.includes(\"Struggle\")) return [{ p: 1, move: \"Struggle\", aiRan: false, refused: 0 }];"),
  ("no selectable filter", "const ok = picks.filter((c) => legal.includes(c.move));", "const ok = picks;"),
  ("history not recorded", "const decided = L.aiDecisionState(state, side);", "const decided = state;"),
  ("switch ignored", "if (d.slot != null) { out.push({ p: d.p, kind: \"switch\", slot: d.slot }); continue; }", "if (d.slot != null) continue;"),
  ("no Quick Claw weight", "out.push({ p: d.p * draw.p * c.p,", "out.push({ p: d.p * c.p,"),
  ("seen not filtered", "let kept = dist.filter((d) => want.every((id) => d.slots.includes(id)));", "let kept = dist.slice();"),
  ("one ability only", "const choices = kn?.mon ? [{ p: 1, mon: kn.mon }] : buildReplacement(m.ids[i], m.ivs, level);", "const choices = kn?.mon ? [{ p: 1, mon: kn.mon }] : [{ p: 1, mon: buildReplacement(m.ids[i], m.ivs, level)[0].mon }];"),
  ("bench count stale", "oppUsablePartyMons: bench.filter((e) => e && e.hpPct > 0).length };", "};"),
]
orig = open(F, encoding="utf8", newline="").read()
caught = 0
for name, a, b in MUT:
    src = orig.replace("\r\n", "\n")
    assert a in src, name
    open(F, "w", encoding="utf8", newline="").write(src.replace(a, b, 1))
    r = subprocess.run(["node", "--max-old-space-size=4096", "tests/test-tower.mjs"], capture_output=True, text=True)
    hit = r.returncode != 0
    caught += hit
    fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")][:2]
    print(("CAUGHT " if hit else "MISSED ") + name, "|", " / ".join(fails)[:200], flush=True)
open(F, "w", encoding="utf8", newline="").write(orig)
print(f"mutations caught {caught}/{len(MUT)}")
