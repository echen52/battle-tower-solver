# Mutation checks for the trainer picker / candidate weighting (site/ui-logic.js,
# engine/tower.js, engine/next-in.js) against tests/test-ui-logic.mjs.
#   python tools/mutate-ui.py      (commit first: each file is restored from memory)
import subprocess
MUT_UI = [
  ("site/ui-logic.js", "uniform candidate weights", "w: mix.mass / abilities.length,", "w: 1 / abilities.length,"),
  ("site/ui-logic.js", "trainer ignored in the party draw", "challenge: run.challenge, battle: run.battle, trainerId, brain, ivs,", "challenge: run.challenge, battle: run.battle, brain, ivs,"),
  ("site/ui-logic.js", "IVs not from the trainer", "trainerId != null ? fixedIvs(trainerId) : form.opp.ivTier", "form.opp.ivTier"),
  ("site/ui-logic.js", "trainer pool ignored in the set list", "if (trainerId != null) ids = new Set(trainerPool(trainerId, level));", "if (false) ids = null;"),
  ("engine/tower.js", "mass drops the seen/IV filter", "{ mass: dist.mass * total }", "{ mass: dist.mass }"),
  ("engine/next-in.js", "mass without the trainer prior", "return Object.assign([...merged.values()], { mass: total });", "return Object.assign([...merged.values()], { mass: 1 });"),
]
caught = 0
for f, name, a, b in MUT_UI:
    orig = open(f, encoding="utf8", newline="").read()
    src = orig.replace("\r\n", "\n")
    assert a in src, name
    open(f, "w", encoding="utf8", newline="").write(src.replace(a, b, 1))
    try:
        r = subprocess.run(["node", "tests/test-ui-logic.mjs"], capture_output=True, text=True)
    finally:
        open(f, "w", encoding="utf8", newline="").write(orig)
    hit = r.returncode != 0
    caught += hit
    fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")][:2]
    print(("CAUGHT " if hit else "MISSED ") + name, "|", " / ".join(fails)[:180], flush=True)
print(f"mutations caught {caught}/{len(MUT_UI)}")
