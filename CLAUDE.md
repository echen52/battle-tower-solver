# CLAUDE.md — battle-tower-solver

Battle Tower (Emerald, singles) live advisor, then solver. Started 2026-10-12
from a brainstorm with the user: the Palace solver and Arena assistant minus
their facility layers ARE the Tower, because every Frontier facility runs the
same trainer AI (src/battle_ai_script_commands.c:371-372 -- CHECK_BAD_MOVE |
CHECK_VIABILITY | TRY_TO_FAINT for any BATTLE_TYPE_FRONTIER battle; Tower
singles = TRAINER | BATTLE_TOWER, battle_tower.c:2015/:2102, inside
BATTLE_TYPE_FRONTIER, constants/battle.h:91). The Palace only narrows which
moves the AI scores (:480-483) and adds loafing; the Arena only judges after.

Rule (user, standing): mechanics come from pokeemerald, cite file:line; never
invent or randomise behaviour.

## Plan (agreed 2026-10-12: live advisor first)

1. **Opponent-move readout** -- DONE (this commit series). For a position you
   enter, the opponent's action this turn: every move and every switch with
   its probability.
2. **REVISED (user, 2026-10-12): no full set posterior** -- the user's
   facilities-assistant already pins the set when the species is unique for
   the trainer. Instead, DONE: (a) a TRAINER PICKER (the trainer's own pool,
   its fixed IVs, its parties only) and (b) "COULD BE": the other sets of the
   species out, ticked, weighted by the trainer draw (partyMix's `mass`), the
   readout averaged over them; ability "Not seen (either)" averages abilities.
3. **1-2 turn advisor** -- ONE TURN DONE (2026-10-12; user: "this turn first,
   then two turns once the one-turn numbers look right"). engine/advise.js +
   the page's "Your options this turn" table (module worker,
   site/advise-worker.js). Per option: KO it / you faint / HP dealt / HP taken
   this turn, exact rolls (cap 4000 outcomes -> point estimate, flagged "~"),
   averaged over the readout's odds, the candidates and unknown sleep.
   RANKING (user, 2026-10-13): "chance to KO first (if outspeed) then least
   damage taken" -> advise.js better: pKOFirst (it faints before it attacks:
   logic.js neverActed, or its action was the switch), KO chances within
   KO_TIE = 1 point equal, then least HP taken; the page stars the top row.
   TWO TURNS DONE (2026-10-13; page: This turn / Two turns buttons -- user
   wants to pick per look; both results kept per position, so switching back
   redraws at once; number columns get a "2 turns" line, the follow-up shows
   as "then ..." under the option): advise.js playTwo -- each option,
   then in every position where both mons are still out and it did not
   switch / leave, your best reply by the same rule against the readout
   RERUN there. Turn-1 outcomes grouped: same state but HP, HP in 4% bands
   that never straddle an AI HP cutoff (AI_HP_EDGES, read off ai-program.js;
   uniform bands were 11 points off on Aerial Ace into Milotic: it Recovers
   below 70%), played from the band's most likely real outcome. Stated: the
   reply is picked knowing the world (candidate set, sleep counter).
4. **Full-battle solve** -- depth-limited search + playouts (palace-solver's
   solve-core / montecarlo machinery), maybe a streak sim.

## What is here

Forked verbatim from palace-solver @ c132607 (first commit 5f02619; see
docs/PROVENANCE.md). Tower changes since:

- `engine/tower.js` --
  `towerChoices(ctx, s, side, {qc})`: locks (no AI), AreAllMovesUnusable ->
  Struggle BEFORE Encore (battle_main.c:4183 then :4192; palace.js has them
  the other way round), Encore, else the AI over every slot. A pick that
  TrySetCantSelectMoveBattleScript refuses is re-asked (:4380-4388 returns to
  STATE_WAIT_ACTION_CHOSEN; the AI reruns) -> the distribution conditioned on
  selectable slots; throws if none can win (the ROM would loop).
  `oppActions(B, s)` = ShouldSwitch (should-switch.js) x Quick Claw draw x move.
  `partyMix({lead, seen, challenge, battle | brain, level, ivs})`: the exact
  party orderings (next-in.js teammateDist) holding every seen mon, filtered
  to the IVs entered. `oppReadout(...)`: the action summed over those parties
  and the unseen teammates' abilities (50/50, personality & 1).
- Candidate odds (site/ui-logic.js buildPosition): P(set k, ability a) is
  proportional to partyMix(...).mass / #abilities -- mass = sum over trainers (or the
  one known) of P(trainer) x P(lead k | trainer) x P(seen mons | trainer,
  lead k), with the IV filter; next-in.js teammateDist now returns that
  `mass` (the normaliser it used to divide out). Default ticks: every
  same-species set of a KNOWN trainer's pool; with no trainer only the set
  typed (bracket-wide would mix too much). engine/trainer-classes.js
  (generated, tools/gen-trainer-classes.mjs) names classes for the page.
- `engine/next-in.js`: Anabel's two teams added to BRAIN_TEAMS (frontier_util.c
  99-176; appearances {35, 70, 35, 1}, :88). Spenser's stay (inherited tests).
- `site/`: the Tower page (Palace layout, steel-blue theme; contrast in the
  styles.css header). No solve yet. Inputs beyond the Palace page's: Turn;
  your mon out -- "Just came in", Last move + "It hit" (-> youLastMove,
  oppLastLanded, which ShouldSwitch reads), "AI has seen" (-> youMoveHistory,
  BATTLE_HISTORY->usedMoves); their team -- "The one out is their lead" / their
  lead + HP, up to two "Also seen" + HP (0 = fainted). Removed: Palace low-HP
  mode, nature groups, Solve, "Just fainted". Saved teams: localStorage
  "towerSolver.savedTeams".
  Serve the repo root over http (`python -m http.server 8765`, then
  /site/index.html): ES modules, file:// will not do.

Not yet Tower-adapted (stated): engine/team.js, battle.js, solve*.js,
montecarlo*.js, score.js and sim/ still play PALACE turns (palace.js). They
are untouched until step 3 swaps the player's nature-driven choice for a
chosen action.

Advisor turn shapes (advise.js), each ported with your action fixed and the
opponent's from towerChoices: move vs move (resolveTurn, shared Quick Claw
draw), your switch (team.js switchTurn, Pursuit on the leaver), its switch
(battle.js oppSwitchTurn on a two-slot party [mon out, newcomer], with
oppUsablePartyMons kept -- the two-slot recount would miss the third), both
switch. Limits: YOUR Roar / Whirlwind and ITS Baton Pass end the count as "it leaves" (no team hook: who comes in is not
played); YOUR Baton Pass throws (not ported) -> "not analysable".

Speed (two turns): the readout's switch half is built once per position
SHAPE (tower.js switchPlan; `plans` reuses it across HP -- ShouldSwitch reads
HP only in Natural Cure's half test, which is in the key) and its move half
once per (slot, healthy count) -- the move AI reads the bench only as that
count (logic.js:4413/:4684). aiTypeCalc memoised. The page splits each
option into POOL slices (playTwo part [k, n], ui-logic mergeParts) over a
worker pool. Typical position: 4-30 s of CPU in all, divided by the pool.

## Tests -- `bash tools/run-suite.sh`

New / replaced:
| test | what it pins |
|---|---|
| test-tower | 30: corpus (903 positions, 300 Frontier-vs-Frontier walks played with towerChoices both sides): sums, only selectable moves, unforced = the interpreter with no mask, player side = mirrored opponent; forced paths in source order (lock, Struggle-before-Encore, Encore), Disable / Choice lock / 0 PP; oppActions = ShouldSwitch x move; partyMix vs teammateDist, seen filter, IV filter, Anabel, errors; history (Protect seen -> SolarBeam down, AI_CV_ChargeUpMove), an unseen teammate's ability (Arcanine 3 Flash Fire, worked form by form), bench count (Baton Pass -10 with no usable teammate); readout vs 6,000 parties from the LITERAL FillTrainerParty loop (rejection-sampled, abilities drawn) within 4 sd |
| test-ui-logic | 43: every page input onto its engine field; party inputs -> partyMix / known; readout = oppReadout over the sleep mix; trainer list / labels / pool / IVs; candidate odds = pool shares (trainer known), = the bracket draw worked by hand, moved by a seen teammate (worked trainer by trainer); readout over candidates = their weighted readouts. tools/mutate-ui.py 6/6 |
| test-two-turn | 20: neverActed = the engine's "opp never acts — KO" text; KO first = KO when you outspeed, 0 when outsped; the ranking on hand rows; readout with reuse = party by party on 40+ positions (turn-1 outcomes, a Natural Cure sleeper either side of half); playTwo with tiny bands = a brute force written in the test exactly, 4% bands within 1 point (Aerial Ace into Milotic: 10.05 vs 10.34 KO first); a switching position (turn 2 only where it stayed; a KO after its switch counts as first); slices add up. tools/mutate-two.py 9/10 -- the miss (stay mass keyed by slot only) is equivalent here: every party of a mix holds every seen mon at its entered HP, so the healthy count never varies within a readout |
| test-advise | 19: move vs move = palaceTurn, your switch = team.js switchTurn (Crunch and Pursuit), its switch = battle.js oppSwitchTurn (Perish 0 forces it), both switch -- all with both choices forced by Encore so the Palace layer's choices equal the Tower's; a mixed stay/switch turn; Pursuit damage counted on the leaver; exact rolls vs 4,000 turns with drawn rolls (Meteor Mash into Snorlax 70%: exact 70.4% KO; point estimate differs); summarize by hand; options (Encore, recharge, fainted mate, Shadow Tag); advise over three candidates = weighted. tools/mutate-advise.py 8/8 |
| test-site-browser | 35 (+9 trainer / candidates, advice table = Node one turn and two turns, the buttons switch back and forth without recomputing, the headings): the page in headless Chromium (Playwright from battle_arena_sim/node_modules): bars = Node readout at turn 1, after a landed Earthquake (switch rows), with an "also seen" mon, after clearing it, at Anabel's battle; saved team over a reload; no page error |

Mutations (tools/mutate-tower.py, tower.js): 6/8 caught. The 2 missed are
equivalent: (a) skipping aiDecisionState inside towerChoices -- buildAiView
already records the target's last move (recordTargetMoveHistory), so the
choice cannot change; (b) dropping the selectable-slot filter -- the re-ask
branch was reached 0 times in 903 corpus positions (limited slots start at
score 0, legal ones near 100). Browser test: re-planting a real page bug
(HP lookup) fails 9 checks.

CLI: `node tools/readout.mjs "Snorlax 3" 7 Earthquake` (the readout on the
test team, optionally after your landed move).

Workflow rule (inherited): commit before any mutation check.
TOOLING: core.autocrlf rewrites to CRLF; edit with Python (normalise, edit,
restore) or the Edit tool, not `sed -i`.

## Known gaps (stated, not silent)

- Evidence not used: the order their mons came in, and that GetMostSuitable /
  ShouldSwitch picked a seen mon over the others (same limit as palace-solver).
- The mon out's set and ability are what you enter -- step 2 replaces that
  with a posterior.
- Trainers already fought this challenge are not excluded (needs history).
- The AI's view of YOUR held item is HOLD_EFFECT_NONE in every reachable state
  (inherited F2b: BATTLE_HISTORY itemEffects is never written in singles here).
- Doubles / multi: not modelled.
