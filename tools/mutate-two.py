# Mutation checks for the ranking, the two-turn advisor and the readout's reuse
# (engine/logic.js neverActed, engine/advise.js, engine/tower.js) against
# tests/test-two-turn.mjs.
#   python tools/mutate-two.py      (commit first: each file is restored from memory; ~2 min a mutant)
import subprocess, sys
MUT = [
  ("engine/logic.js", "no neverActed marker", "if (secondActorHp <= 0) for (let i = n0; i < results.length; i++) results[i].neverActed = order[1];", "if (false) for (let i = n0; i < results.length; i++) results[i].neverActed = order[1];"),
  ("engine/advise.js", "KO first ignored in the ranking", "if (Math.abs(a.pKOFirst - b.pKOFirst) > KO_TIE) return a.pKOFirst > b.pKOFirst;", "if (Math.abs(a.pKOFirst - b.pKOFirst) > 1) return a.pKOFirst > b.pKOFirst;"),
  ("engine/advise.js", "most taken wins the tie", "  return a.taken < b.taken;\n}", "  return a.taken > b.taken;\n}"),
  ("engine/advise.js", "bands ignore the AI cutoffs", "while (i < AI_HP_EDGES.length && AI_HP_EDGES[i] <= a) i++; return i; };", "while (i < AI_HP_EDGES.length && AI_HP_EDGES[i] <= a) i++; return 0; };"),
  ("engine/advise.js", "turn 1 counted in every slice", "if (part && part[0] !== 0) for", "if (false) for"),
  ("engine/advise.js", "turn 2 after its switch", "!o.left && o.theirs.length === 1 && o.theirs[0][1] > 0", "!o.left && o.theirs[0][1] > 0"),
  ("engine/advise.js", "first reply, not the best", "if (!best || better(x, best.x)) best = { o2, x };", "if (!best) best = { o2, x };"),
  ("engine/advise.js", "a KO after its switch is not first", "push(sw.p * r.p, r.state, r.theirs, true);", "push(sw.p * r.p, r.state, r.theirs, false);"),
  ("engine/tower.js", "plan key without Natural Cure's half", "return `${half}|${JSON.stringify(", "return `|${JSON.stringify("),
  ("engine/tower.js", "stay mass by slot only", "const k = `${x.slot}|${x.usable}`, e = stay.get(k);", "const k = `${x.slot}`, e = stay.get(k);"),
]
# python tools/mutate-two.py [name substring ...] runs only those
sel = sys.argv[1:]
MUT = [m for m in MUT if not sel or any(x in m[1] for x in sel)]
caught = 0
for f, name, a, b in MUT:
    orig = open(f, encoding="utf8", newline="").read()
    src = orig.replace("\r\n", "\n")
    assert a in src, name
    open(f, "w", encoding="utf8", newline="").write(src.replace(a, b, 1))
    try:
        r = subprocess.run(["node", "tests/test-two-turn.mjs"], capture_output=True, text=True)
    finally:
        open(f, "w", encoding="utf8", newline="").write(orig)
    hit = r.returncode != 0
    caught += hit
    fails = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith("FAIL") or "Error" in l][:2]
    print(("CAUGHT " if hit else "MISSED ") + name, "|", " / ".join(fails)[:200], flush=True)
print(f"mutations caught {caught}/{len(MUT)}")
