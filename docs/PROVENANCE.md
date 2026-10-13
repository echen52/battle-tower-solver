# Engine provenance

`engine/` (and `site/`, `tests/`, `tools/`, `sim/`, `teams/`) are forked from
`palace-solver/` at commit **c132607** (main, 2026-10-09): the Battle Palace
engine, itself a fork of the Battle Arena engine at 04ee03b (see
`PROVENANCE-palace.md` -- ROM-differential-tested; the AI interpreter
reproduces 3,872 / 3,873 ROM decisions).

The first commit of this repo is that tree verbatim (`git archive c132607`;
engine md5s in `fork-base-md5.txt`). Every later change is a Tower change and
is reviewable as a diff against that commit.

Why the Palace engine is the right base: every Frontier facility runs the
same trainer AI. BattleAI_SetupFlags gives any BATTLE_TYPE_FRONTIER battle
CHECK_BAD_MOVE | CHECK_VIABILITY | TRY_TO_FAINT
(src/battle_ai_script_commands.c:371-372), and a Tower singles battle is
BATTLE_TYPE_TRAINER | BATTLE_TYPE_BATTLE_TOWER (src/battle_tower.c:2015,
:2102), which BATTLE_TYPE_FRONTIER includes (include/constants/battle.h:91).
The Palace differs only in WHICH moves the AI may score
(BattleAI_SetupAIData(palaceFlags >> 4) vs ALL_MOVES_MASK, :480-483) and in
the loafing turns; the Arena only in the judging after the turn.
