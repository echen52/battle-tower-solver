# Mutation checks for engine/advise.js against tests/test-advise.mjs.
#   python tools/mutate-advise.py      (commit first)
import subprocess
F = "engine/advise.js"
MUT = [
  ("its stay weight dropped", "const w = opp.pStay * draw.p * o.p;", "const w = draw.p * o.p;"),
  ("Quick Claw draw weight dropped", "const w = opp.pStay * draw.p * o.p;", "const w = opp.pStay * o.p;"),
  ("Pursuit not doubled on your switch", 'L.resolveSingleAction(ctx, s0, "opp", "Pursuit", { pursuitSwitch: true })', 'L.resolveSingleAction(ctx, s0, "opp", "Pursuit", { pursuitSwitch: false })'),
  ("its move skipped after your switch", "const oppActs = !pursuit && sIn.yourHpPct > 0;", "const oppActs = false;"),
  ("your move skipped after its switch", "pursuit ? tctx.team[s.youActive].moves[0] : mv, sw.mon.moves[0], { loaf, order", "pursuit ? tctx.team[s.youActive].moves[0] : mv, sw.mon.moves[0], { loaf: { opp: \"switched\", you: \"switched\" }, order"),
  ("bench count not kept", "const keepCount = (st, before) => ({ ...st, oppUsablePartyMons: before.oppUsablePartyMons });", "const keepCount = (st) => st;"),
  ("taken: only the mon out at the end", "for (let i = 0; i < n; i++) {\n      const a = Math.max(0, yourHp(sBefore, i)), b = Math.max(0, yourHp(o.state, i));", "for (const i of [o.state.youActive]) {\n      const a = Math.max(0, yourHp(sBefore, i)), b = Math.max(0, yourHp(o.state, i));"),
  ("encore ignored in your options", 'if (s.youEncoredMove) out.push', 'if (false) out.push'),
]
orig = open(F, encoding="utf8", newline="").read()
caught = 0
for name, a, b in MUT:
    src = orig.replace("\r\n", "\n")
    assert a in src, name
    open(F, "w", encoding="utf8", newline="").write(src.replace(a, b, 1))
    try:
        r = subprocess.run(["node", "--max-old-space-size=4096", "tests/test-advise.mjs"], capture_output=True, text=True)
    finally:
        open(F, "w", encoding="utf8", newline="").write(orig)
    hit = r.returncode != 0
    caught += hit
    fails = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith("FAIL") or "Error" in l][:2]
    print(("CAUGHT " if hit else "MISSED ") + name, "|", " / ".join(fails)[:180], flush=True)
print(f"mutations caught {caught}/{len(MUT)}")
