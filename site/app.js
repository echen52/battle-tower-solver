// ── app.js ─────────────────────────────────────────────────────────────────
// The page's DOM wiring. All battle logic is in ui-logic.js (pure) and the
// engine. The readout is cheap (well under a second), so it reruns on every
// change.

import { parseTeam, setChoices, setLabel, ivTierOdds, buildOpponent, buildPosition, readout, pct, STAGE_KEYS, brainFor, genderOf, trainerChoices, sameSpecies, rankAdvice, mergeParts } from "./ui-logic.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";
import { buildPlayerMon } from "../engine/team.js";

const $ = (id) => document.getElementById(id);
const STORE = "towerSolver.savedTeams"; // all echen52 Pages sites share one origin: the prefix keeps it apart
const STAGE_LABEL = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };
const STATUS_OPTIONS = [["", "Healthy"], ["poison", "Poison"], ["toxic", "Bad poison"], ["burn", "Burn"], ["paralysis", "Paralysis"], ["sleep", "Sleep"], ["freeze", "Freeze"]];

let teamCfgs = null;      // parsed configs
let monState = [];        // per team member: { hpPct, status, toxicTurns, sleepRest, slept, itemGone }
let active = 0;
const labelToKey = new Map();
const trainerByLabel = new Map(); // "Miriam (Cooltrainer)" -> trainer id
let trainerLabels = [];
let candTicks = new Set();        // the "Could be" sets ticked (the set out is always in)
let candFor = null;               // the set + trainer the ticks were made for

// ── small builders ─────────────────────────────────────────────────────────
const opt = (v, t, sel = false) => `<option value="${v}"${sel ? " selected" : ""}>${t}</option>`;
function stageGrid(el, prefix) {
  el.innerHTML = STAGE_KEYS.map((k) => `<span>${STAGE_LABEL[k]}</span><select class="trigger" id="${prefix}-${k}">${
    Array.from({ length: 13 }, (_, i) => i - 6).map((v) => opt(v, v > 0 ? `+${v}` : `${v}`, v === 0)).join("")}</select>`).join("");
}
const readStages = (prefix) => Object.fromEntries(STAGE_KEYS.map((k) => [k, Number($(`${prefix}-${k}`).value)]));
function statusRows(prefix) {
  return `<div class="field-row"><label for="${prefix}-status">Status</label><select class="trigger" id="${prefix}-status">${
    STATUS_OPTIONS.map(([v, t]) => opt(v, t)).join("")}</select></div>
  <div class="field-row" id="${prefix}-sleepRow" hidden><label title="The game hides how long a sleep lasts; the readout averages over every length still possible.">Asleep</label>
    <select class="trigger" id="${prefix}-sleepFrom">${opt("move", "from a move")}${opt("rest", "from Rest")}</select>
    <select class="trigger" id="${prefix}-slept">${[0, 1, 2, 3].map((n) => opt(n, `${n} turn${n === 1 ? "" : "s"} slept`)).join("")}</select></div>
  <div class="field-row" id="${prefix}-toxicRow" hidden><label>Bad poison</label>
    <select class="trigger" id="${prefix}-toxic">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => opt(n, n === 1 ? "next hit: 1/16" : `next hit: ${n}/16`)).join("")}</select></div>`;
}
function syncStatusRows(prefix) {
  const st = $(`${prefix}-status`).value;
  $(`${prefix}-sleepRow`).hidden = st !== "sleep";
  $(`${prefix}-toxicRow`).hidden = st !== "toxic";
}
function sideRows(el, side) {
  el.innerHTML = `
    <div class="field-row"><input type="checkbox" class="trigger" id="${side}-reflect" /><label for="${side}-reflect" class="chk-label">Reflect</label>
      <select class="trigger" id="${side}-reflectTurns">${[5, 4, 3, 2, 1].map((n) => opt(n, `${n} left`)).join("")}</select></div>
    <div class="field-row"><input type="checkbox" class="trigger" id="${side}-ls" /><label for="${side}-ls" class="chk-label">Light Screen</label>
      <select class="trigger" id="${side}-lsTurns">${[5, 4, 3, 2, 1].map((n) => opt(n, `${n} left`)).join("")}</select></div>
    <div class="field-row"><label for="${side}-spikes">Spikes</label><select class="trigger" id="${side}-spikes">${[0, 1, 2, 3].map((n) => opt(n, n ? `${n} layer${n > 1 ? "s" : ""}` : "None")).join("")}</select></div>`;
}

const GENDER_MARK = { male: "♂", female: "♀", genderless: "no gender" };
const genderMark = (mon) => { const g = genderOf(mon); return g ? GENDER_MARK[g] : '<span title="Can be either: add (M) or (F) after the name in the paste. Only Attract and Cute Charm read it.">♂/♀?</span>'; };

// ── your team ──────────────────────────────────────────────────────────────
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } }
function storeSaved(m) { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private mode: not kept */ } }
function refreshSaved(select = "") {
  const m = loadSaved();
  $("savedTeams").innerHTML = opt("", "— Select a saved team —") + Object.keys(m).sort().map((k) => opt(k, k, k === select)).join("");
}
function useTeam(text) {
  $("teamError").textContent = "";
  try {
    teamCfgs = parseTeam(text);
    teamCfgs.forEach((c) => buildPlayerMon(c)); // fail on an unknown species / move now
  } catch (e) {
    teamCfgs = null; $("teamError").textContent = e.message; renderTeam(); return;
  }
  monState = teamCfgs.map(() => ({ hpPct: 100, status: "", toxicTurns: 1, sleepRest: false, slept: 0, itemGone: false }));
  active = 0;
  renderTeam();
  refresh();
}
function renderTeam() {
  const box = $("monCards");
  if (!teamCfgs) { box.innerHTML = ""; $("activeBlock").hidden = true; return; }
  box.innerHTML = teamCfgs.map((c, i) => `
    <div class="mon-card${i === active ? " out" : ""}" data-i="${i}">
      <div class="mc-head">
        <input type="radio" name="outMon" class="out-radio" id="out-${i}" value="${i}"${i === active ? " checked" : ""} />
        <label for="out-${i}" class="mc-name">${c.species}</label>
        <span class="mc-meta">${c.item ?? "no item"} · ${c.nature} · ${genderMark(buildPlayerMon(c))}</span>
      </div>
      <div class="field-row"><label for="m${i}-hp">HP %</label><input type="number" class="trigger" id="m${i}-hp" min="0" max="100" value="${monState[i].hpPct}" /><span class="hp-abs" id="m${i}-hpAbs"></span></div>
      ${statusRows(`m${i}`)}
      <div class="field-row"><input type="checkbox" class="trigger" id="m${i}-itemGone" /><label for="m${i}-itemGone" class="chk-label">Item used up</label></div>
    </div>`).join("");
  teamCfgs.forEach((_, i) => {
    $(`m${i}-status`).value = monState[i].status;
    $(`m${i}-itemGone`).checked = monState[i].itemGone;
    syncStatusRows(`m${i}`);
  });
  $("activeBlock").hidden = false;
  $("activeName").textContent = teamCfgs[active].species;
  // What the AI knows of the mon out: reset when another mon comes in.
  const moves = teamCfgs[active].moves;
  $("youLastMove").innerHTML = opt("", "None yet") + moves.map((m) => opt(m, m)).join("");
  $("youSeen").innerHTML = moves.map((m, j) => `<span class="seen-move"><input type="checkbox" class="trigger" id="seen-${j}" value="${m}" /><label for="seen-${j}" class="chk-label">${m}</label></span>`).join("");
  $("youFirstTurn").checked = true;
  syncHistoryRows();
}
// "Just came in": no move used yet, so nothing to remember.
function syncHistoryRows() {
  const fresh = $("youFirstTurn").checked;
  $("lastMoveRow").hidden = fresh; $("seenRow").hidden = fresh;
  // the last move is one the AI has seen
  const last = $("youLastMove").value;
  document.querySelectorAll("#youSeen input").forEach((el) => { if (el.value === last) el.checked = true; });
}
function readMons() {
  return teamCfgs.map((_, i) => ({
    hpPct: Math.max(0, Math.min(100, Number($(`m${i}-hp`).value) || 0)),
    status: $(`m${i}-status`).value,
    toxicTurns: Number($(`m${i}-toxic`).value),
    sleep: { rest: $(`m${i}-sleepFrom`).value === "rest", slept: Number($(`m${i}-slept`).value) },
    itemGone: $(`m${i}-itemGone`).checked,
  }));
}

// ── the opponent ───────────────────────────────────────────────────────────
const levelNow = () => Number(document.querySelector('input[name="level"]:checked').value);
function runInputs() {
  const brain = $("brain").value || null;
  return { challenge: Number($("challenge").value), battle: Number($("battle").value), brain,
    trainerId: brain ? null : trainerByLabel.get($("trainer").value.trim()) ?? null,
    level: levelNow(), turn: Math.max(1, Number($("turn").value) || 1) };
}
// The trainers this battle can draw; a picked one no longer among them is cleared.
function refreshTrainerList() {
  const { challenge, battle, brain } = runInputs();
  const ts = trainerChoices({ challenge, battle });
  trainerByLabel.clear();
  for (const t of ts) trainerByLabel.set(t.label, t.id);
  trainerLabels = ts.map((t) => t.label);
  $("trainerRow").hidden = !!brain;
  if ($("trainer").value && !trainerByLabel.has($("trainer").value.trim())) combos.trainer.set("");
}
let setLabels = [];
function refreshSetList() {
  const { challenge, battle, brain, level, trainerId } = runInputs();
  const keys = setChoices({ challenge, battle, bracketOnly: $("bracketOnly").checked, brain, level, trainerId });
  $("bracketRow").hidden = !!brain || trainerId != null;
  labelToKey.clear();
  setLabels = keys.map((k) => { labelToKey.set(setLabel(k), k); return setLabel(k); });
  // keep every set resolvable by name even when filtered out of the list
  for (const k of Object.keys(FRONTIER_POOL)) if (!labelToKey.has(setLabel(k))) labelToKey.set(setLabel(k), k);
}
const keyOf = (label) => labelToKey.get(label.trim()) ?? null;
const combos = {};

// Brain on/off: the list becomes her three; her lead goes in the "out now"
// box (it is always her first), and a set that no longer fits is cleared.
function brainChanged() {
  const { brain, trainerId } = runInputs();
  refreshSetList();
  // with a Brain or a known trainer the list is that team / pool: a set outside it goes
  const narrow = !!brain || trainerId != null;
  for (const id of ["oppSet", "leadSet", "other1Set", "other2Set"]) {
    const cur = keyOf($(id).value);
    if (cur && (narrow ? !setLabels.includes(setLabel(cur)) : FRONTIER_POOL[cur].brain)) combos[id].set("");
  }
  if (brain && !keyOf($("oppSet").value)) { combos.oppSet.set(setLabels[0]); $("oppIsLead").checked = true; syncLeadRow(); }
  renderOppSet();
}
function syncLeadRow() { $("leadRow").hidden = $("oppIsLead").checked; }

// Filtering dropdown for the set pickers (as on the Arena page): focus shows
// the whole list, typing narrows it (names starting with the text first),
// arrows + Enter or a click pick, Escape closes. Picking fires a real
// "change". Leaving with text that is not a set puts back the last set picked
// -- or, with allowEmpty, leaves the box empty when the text was cleared.
function setupCombo(inputId, listId, { allowEmpty = false, source = () => setLabels, valid = keyOf } = {}) {
  const input = $(inputId), list = $(listId);
  let hi = -1, last = input.value;
  combos[inputId] = { set: (v) => { input.value = v; last = v; } };
  const close = () => { list.classList.remove("open"); list.innerHTML = ""; hi = -1; };
  const choose = (v) => { input.value = v; last = v; close(); input.dispatchEvent(new Event("change", { bubbles: true })); };
  const mark = (items) => { items.forEach((el, i) => el.classList.toggle("hi", i === hi)); if (hi >= 0) items[hi].scrollIntoView({ block: "nearest" }); };
  function render(all) {
    const q = all ? "" : input.value.trim().toLowerCase();
    const all_ = source();
    const starts = all_.filter((o) => o.toLowerCase().startsWith(q));
    const rest = q ? all_.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q)) : [];
    const matches = starts.concat(rest);
    hi = -1;
    list.innerHTML = matches.length ? matches.map((o) => `<div class="combo-item${o === last ? " cur" : ""}" data-value="${o}">${o}</div>`).join("")
      : '<div class="combo-empty">No matches</div>';
    list.classList.add("open");
    list.querySelectorAll(".combo-item").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(el.dataset.value); }));
    list.querySelector(".cur")?.scrollIntoView({ block: "nearest" });
  }
  input.addEventListener("focus", () => { input.select(); render(true); });
  input.addEventListener("click", () => { if (!list.classList.contains("open")) { input.select(); render(true); } });
  input.addEventListener("input", () => render(false));
  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll(".combo-item");
    if (e.key === "ArrowDown") { e.preventDefault(); if (!list.classList.contains("open")) render(true); else { hi = Math.min(hi + 1, items.length - 1); mark(items); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(hi - 1, -1); mark(items); }
    else if (e.key === "Enter") { const v = (items[hi] ?? items[0])?.dataset.value; if (v) { e.preventDefault(); choose(v); } }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(() => {
    close();
    if (allowEmpty && input.value.trim() === "") { if (last !== "") { last = ""; input.value = ""; input.dispatchEvent(new Event("change", { bubbles: true })); } return; }
    if (input.value !== last && !valid(input.value)) { input.value = last; input.dispatchEvent(new Event("change", { bubbles: true })); }
    else last = input.value;
  }, 150));
}
function renderOppSet() {
  const key = keyOf($("oppSet").value);
  const e = key ? FRONTIER_POOL[key] : null;
  const run = runInputs();
  $("oppCard").hidden = !e; $("oppAbilityRow").hidden = !e || e.abilities.length < 2; $("oppIvRow").hidden = !e;
  $("oppGenderRow").hidden = !e || !!genderOf(buildOpponent({ setKey: key, ability: e.abilities[0], ivTier: 31, level: 100 }));
  if (!e) return;
  $("oppCard").innerHTML = `<div class="sc-title">${setLabel(key)}</div>
    <div class="sc-meta"><b>${e.item ?? "no item"}</b> · <b>${e.nature}</b> · ${e.abilities.join(" / ")}</div>
    <div class="sc-meta">${e.moves.join(" · ")}</div>`;
  const prevAb = $("oppAbility").value;
  $("oppAbility").innerHTML = (e.abilities.length > 1 ? opt("", "Not seen (either)") : "") + e.abilities.map((a) => opt(a, a, a === prevAb)).join("");
  // The "Could be" ticks: reset for a new set or trainer -- every set of the
  // species in a known trainer's pool (honest doubt), else just the one typed.
  const forKey = `${key}|${run.trainerId}|${run.brain}`;
  if (candFor !== forKey) {
    candFor = forKey;
    const same = sameSpecies(key, run);
    candTicks = new Set(run.trainerId != null ? same : [key]);
  }
  renderCands(null);
  const odds = ivTierOdds(key, run);
  const prevIv = $("oppIv").value;
  if (e.brain) { $("oppIv").innerHTML = opt(e.fixedIV, `${e.fixedIV} (fixed: Frontier Brain)`, true); return; }
  if (run.trainerId != null) { $("oppIv").innerHTML = opt(odds[0].iv, `${odds[0].iv} (this trainer's)`, true); return; }
  const tiers = odds.length ? odds : (e.ivTiers ?? [31]).map((iv) => ({ iv, p: null }));
  $("oppIv").innerHTML = tiers.map((t, i) => opt(t.iv, `${t.iv}${t.p != null ? ` (${pct(t.p)}${i === 0 ? ", most likely" : ""})` : ""}`, String(t.iv) === prevIv)).join("");
}

// The "Could be" list: every set of the species out in the pool, ticked or
// not, with its odds once the readout has them (setOdds; null = not yet).
function renderCands(setOdds) {
  const key = keyOf($("oppSet").value);
  const same = key ? sameSpecies(key, runInputs()) : [];
  $("candBlock").hidden = same.length < 2;
  if (same.length < 2) return;
  const pOf = (k) => setOdds?.find((x) => x.key === k)?.p;
  $("candList").innerHTML = same.map((k) => {
    const e = FRONTIER_POOL[k], on = k === key || candTicks.has(k), p = pOf(k);
    return `<div class="cand-row${on ? "" : " out"}"><input type="checkbox" class="trigger cand-tick" id="cand-${e.index}" data-key="${k}"${on ? " checked" : ""}${k === key ? " disabled" : ""} />
      <span class="cand-p">${on && p != null ? pct(p) : ""}</span><label for="cand-${e.index}" class="cand-name">${setLabel(k)}</label>
      <span class="cand-meta">${e.item ?? "no item"} · ${e.moves.join(" / ")}</span></div>`;
  }).join("");
}

// ── the form ───────────────────────────────────────────────────────────────
function readForm() {
  if (!teamCfgs) throw new Error("Paste your team and press “Use team”.");
  const oppKey = keyOf($("oppSet").value);
  if (!oppKey) throw new Error("Pick the opponent's set.");
  const side = (s) => ({ reflect: $(`${s}-reflect`).checked, reflectTurns: Number($(`${s}-reflectTurns`).value),
    lightScreen: $(`${s}-ls`).checked, lightScreenTurns: Number($(`${s}-lsTurns`).value), spikes: Number($(`${s}-spikes`).value) });
  const fresh = $("youFirstTurn").checked;
  const hp = (id) => Math.max(0, Math.min(100, Number($(id).value)));
  let lead = null;
  if (!$("oppIsLead").checked) {
    lead = keyOf($("leadSet").value);
    if (!lead) throw new Error("Pick their lead (or tick “The one out is their lead”).");
  }
  const others = [1, 2].map((n) => ({ setKey: keyOf($(`other${n}Set`).value), hpPct: hp(`other${n}Hp`) })).filter((o) => o.setKey);
  return {
    team: teamCfgs, active, mons: readMons(),
    you: { stages: readStages("ys"), confused: Number($("youConfused").value), subPct: Number($("youSub").value) || 0,
      firstTurn: fresh, lastMove: fresh ? null : $("youLastMove").value || null, landed: $("youLanded").checked,
      seen: fresh ? [] : [...document.querySelectorAll("#youSeen input:checked")].map((el) => el.value) },
    opp: { setKey: oppKey, candidates: sameSpecies(oppKey, runInputs()).filter((k) => k === oppKey || candTicks.has(k)), ability: $("oppAbility").value || null, ivTier: Number($("oppIv").value) || 31, gender: $("oppGender").value || null,
      hpPct: Math.max(1, Math.min(100, Number($("oppHp").value) || 100)),
      status: $("o-status").value, toxicTurns: Number($("o-toxic").value),
      sleep: { rest: $("o-sleepFrom").value === "rest", slept: Number($("o-slept").value) },
      itemGone: $("oppItemGone").checked, stages: readStages("os"), confused: Number($("oppConfused").value),
      firstTurn: $("oppFirstTurn").checked },
    party: { lead, leadHpPct: hp("leadHp"), others },
    field: { weather: $("weather").value, weatherTurns: $("weatherTurns").value ? Number($("weatherTurns").value) : null, you: side("you"), opp: side("opp") },
    run: runInputs(),
  };
}

// ── the advisor ────────────────────────────────────────────────────────────
// In module workers (site/advise-worker.js). This turn's numbers always, in
// one worker; the two-turn numbers when "Two turns" is picked, one job per
// (option, slice) over a small pool. Both are kept for the position, so the
// This turn / Two turns buttons switch between them without working anything
// out again. A new position supersedes the last: only its answers are drawn,
// and a pool still busy with an old one is stopped.
let adviceWorker = null, adviceId = 0, pool = [];
// cur = { id, form, one, two, error, twoRunning, progress } for the latest position
let cur = null;
const POOL = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
const TWO_KEY = "towerSolver.twoTurns";
const twoMode = () => $("turns2").checked;
function newWorker() { return new Worker(new URL("./advise-worker.js", import.meta.url), { type: "module" }); }
function stopPool() { for (const w of pool) w.terminate(); pool = []; }
function requestAdvice(form) {
  if (!adviceWorker) {
    adviceWorker = newWorker();
    adviceWorker.onerror = (e) => { e.preventDefault?.(); if (cur) { cur.error = e.message || "the advisor failed to load"; showAdvice(); } };
  }
  const id = ++adviceId;
  stopPool();
  cur = { id, form, one: null, two: null, error: null, twoRunning: false, progress: 0 };
  showAdvice();
  adviceWorker.onmessage = (e) => {
    if (!cur || e.data.id !== cur.id) return;
    if (e.data.error) cur.error = e.data.error; else cur.one = e.data.rows;
    showAdvice();
  };
  adviceWorker.postMessage({ id, form, turns: 1 });
}
// Draw what the picked mode needs, starting the two-turn work if it is wanted
// and not yet under way.
function showAdvice() {
  if (!cur) return;
  if (cur.error) return renderAdvice({ error: cur.error });
  if (twoMode() && cur.two) return renderAdvice({ rows: cur.two, turns: 2 });
  if (!cur.one) { $("adviceNote").textContent = "Working out each option…"; return; }
  if (!twoMode()) return renderAdvice({ rows: cur.one, turns: 1 });
  if (!cur.twoRunning) requestTwo(cur);
  renderAdvice({ rows: cur.one, turns: 1, pending: true });
}
function requestTwo(c) {
  const labels = c.one.filter((r) => !r.error).map((r) => r.label);
  if (!labels.length) { c.two = c.one; return; }
  c.twoRunning = true;
  // one job per (option, slice): every option in POOL slices, so a heavy one
  // is spread over the whole pool too
  const queue = labels.flatMap((label) => Array.from({ length: POOL }, (_, k) => ({ label, part: [k, POOL] })));
  const total = queue.length, parts = [];
  const fail = (msg) => { if (cur === c) { stopPool(); c.error = msg; showAdvice(); } };
  const next = (w) => {
    const job = queue.shift();
    if (job) w.postMessage({ id: c.id, form: c.form, turns: 2, only: [job.label], part: job.part });
  };
  pool = Array.from({ length: Math.min(POOL, queue.length) }, () => {
    const w = newWorker();
    w.onerror = (e) => { e.preventDefault?.(); fail(e.message || "the advisor failed to load"); };
    w.onmessage = (e) => {
      if (cur !== c || e.data.id !== c.id) return;
      if (e.data.error) return fail(e.data.error);
      parts.push(e.data.rows);
      c.progress = Math.round((100 * parts.length) / total);
      if (parts.length === total) {
        stopPool();
        const merged = new Map(mergeParts(parts).map((r) => [r.label, r]));
        c.two = [...labels.map((l) => merged.get(l)), ...c.one.filter((r) => r.error)];
        c.twoRunning = false;
      } else next(w);
      if (twoMode()) showAdvice();
    };
    return w;
  });
  for (const w of pool) next(w);
}
const fmtHp = (x) => `${x.toFixed(0)}%`;
const fmtP = (x) => pct(x, x > 0 && x < 0.01 ? 1 : 0);
function renderAdvice({ rows, error, turns = 1, pending = false }) {
  const body = $("adviceTable").querySelector("tbody");
  $("adviceTable").classList.toggle("two-turns", turns === 2);
  $("adviceHead").textContent = turns === 2 ? "Your options over two turns" : "Your options this turn";
  if (error) { body.innerHTML = ""; $("adviceNote").textContent = error; return; }
  const ranked = rankAdvice(rows);
  body.innerHTML = ranked.map((r) => r.error
    ? `<tr><td>${r.label}</td><td colspan="5" class="pm">not analysable: ${r.error}</td></tr>`
    : `<tr${r.best ? ' class="best"' : ""}><td>${r.best ? "★ " : ""}${r.label}${r.approx ? ' <span class="pm" title="Too many damage-roll outcomes to list: played with the average roll.">~</span>' : ""}${turns === 2 ? `<span class="then-line" title="Your best reply next turn, and how often it is the best (it depends on how this turn goes)">then ${thenText(r)}</span>` : ""}</td>
      <td>${fmtP(r.pKOFirst)}</td><td>${fmtP(r.pKO)}</td><td>${fmtP(r.pFaint)}</td><td>${fmtHp(r.dealt)}</td><td>${fmtHp(r.taken)}</td></tr>`).join("");
  const notes = [];
  if (pending) notes.push(`Looking two turns ahead: ${cur?.progress ?? 0}%… (this turn's numbers meanwhile)`);
  if (turns === 2) notes.push("Turn 2 is played where both Pokémon are still out and it did not switch; a KO, a faint or its switch ends the count at turn 1.");
  if (rows.some((r) => r.pLeaves > 0)) notes.push("Roar / Whirlwind / Baton Pass that make it leave end the count there (who comes in is not played).");
  if (rows.some((r) => r.cover < 0.999 && !r.error)) notes.push("Some options are not open against every set it could be (a trapping ability).");
  $("adviceNote").textContent = notes.join(" ");
}
// every follow-up with how often it is the best reply, most often first;
// those under 1% are only counted
function thenText(r) {
  if (!r.follow?.length) return "—";
  const shown = r.follow.filter(([, q], i) => i === 0 || q >= 0.01), small = r.follow.length - shown.length;
  return shown.map(([l, q]) => `${l} ${pct(q)}`).join(", ") + (small ? `, +${small} under 1%` : "");
}

// HP numbers next to the % boxes, and the readout -- on every change.
function refresh() {
  if (teamCfgs) teamCfgs.forEach((c, i) => {
    const mon = buildPlayerMon({ ...c, level: levelNow() });
    const hp = Math.max(0, Math.min(100, Number($(`m${i}-hp`).value) || 0));
    $(`m${i}-hpAbs`).textContent = `${Math.round((hp / 100) * mon.stats.hp)}/${mon.stats.hp}`;
  });
  try {
    const key = keyOf($("oppSet").value);
    if (key) {
      const o = buildOpponent({ setKey: key, ability: $("oppAbility").value || FRONTIER_POOL[key].abilities[0], ivTier: Number($("oppIv").value) || 31, gender: $("oppGender").value || null, level: levelNow() });
      $("oppHpAbs").textContent = `${Math.round(((Number($("oppHp").value) || 100) / 100) * o.stats.hp)}/${o.stats.hp}`;
    }
    const form = readForm();
    const pos = buildPosition(form);
    const r = readout(pos);
    requestAdvice(form);
    renderCands(pos.setOdds);
    $("oppChoices").innerHTML = r.rows.slice(0, 10).map((x) => `<div class="cb-row${x.kind === "switch" ? " cb-switch" : ""}"><div class="cb-name"><div class="cb-fill" style="width:${(100 * x.p).toFixed(1)}%"></div><span>${x.label}</span></div><div class="cb-p">${pct(x.p, x.p < 0.01 && x.p > 0 ? 1 : 0)}</div></div>`).join("")
      + (r.rows.length > 10 ? `<div class="notes">+ ${r.rows.length - 10} more, together ${pct(r.rows.slice(10).reduce((a, x) => a + x.p, 0), 1)}</div>` : "");
    $("switchLine").textContent = r.pSwitch > 0 ? `Switches out: ${pct(r.pSwitch, 1)} in all` : "It does not switch out this turn.";
    $("notes").textContent = pos.notes.join(" ") + (r.refused > 0 ? ` Its AI first picked a move it cannot use ${pct(r.refused, 1)} of the time; the game asks it again, so those turns are shared out over the rest.` : "");
  } catch (e) {
    $("oppChoices").innerHTML = ""; $("switchLine").textContent = "";
    $("adviceTable").querySelector("tbody").innerHTML = ""; $("adviceNote").textContent = ""; adviceId++; stopPool(); cur = null;
    $("notes").textContent = e.message;
  }
}

// ── start ──────────────────────────────────────────────────────────────────
function init() {
  $("challenge").innerHTML = Array.from({ length: 8 }, (_, i) => opt(i + 1, i === 7 ? "8+" : String(i + 1))).join("");
  $("battle").innerHTML = Array.from({ length: 7 }, (_, i) => opt(i + 1, String(i + 1))).join("");
  stageGrid($("youStages"), "ys"); stageGrid($("oppStages"), "os");
  $("oppStatusRows").innerHTML = statusRows("o");
  sideRows($("youSide"), "you"); sideRows($("oppSide"), "opp");
  refreshSaved();
  setupCombo("oppSet", "oppSetList"); setupCombo("leadSet", "leadSetList");
  setupCombo("other1Set", "other1SetList", { allowEmpty: true }); setupCombo("other2Set", "other2SetList", { allowEmpty: true });
  setupCombo("trainer", "trainerList", { allowEmpty: true, source: () => trainerLabels, valid: (v) => trainerByLabel.has(v.trim()) });
  refreshTrainerList(); refreshSetList();
  try { if (localStorage.getItem(TWO_KEY) === "1") $("turns2").checked = true; } catch { /* not kept */ }
  for (const id of ["turns1", "turns2"]) $(id).addEventListener("change", () => {
    try { localStorage.setItem(TWO_KEY, twoMode() ? "1" : "0"); } catch { /* not kept */ }
    showAdvice(); // the numbers for this position are kept: nothing is worked out again
  });
  $("candList").addEventListener("change", (e) => {
    if (!e.target.classList.contains("cand-tick")) return;
    if (e.target.checked) candTicks.add(e.target.dataset.key); else candTicks.delete(e.target.dataset.key);
  });

  $("parseTeam").addEventListener("click", () => useTeam($("teamText").value));
  $("saveTeam").addEventListener("click", () => {
    const name = $("teamName").value.trim();
    if (!name) { $("teamError").textContent = "Give the team a name to save it."; return; }
    try { parseTeam($("teamText").value); } catch (e) { $("teamError").textContent = e.message; return; }
    const m = loadSaved(); m[name] = $("teamText").value; storeSaved(m); refreshSaved(name);
  });
  $("savedTeams").addEventListener("change", () => {
    const t = loadSaved()[$("savedTeams").value];
    if (t) { $("teamText").value = t; $("teamName").value = $("savedTeams").value; useTeam(t); }
  });
  $("deleteTeam").addEventListener("click", () => {
    const k = $("savedTeams").value; if (!k) return;
    const m = loadSaved(); delete m[k]; storeSaved(m); refreshSaved();
  });
  $("monCards").addEventListener("change", (e) => {
    if (e.target.name === "outMon") {
      monState = readMons().map((m, i) => ({ ...monState[i], ...m, sleepRest: m.sleep.rest, slept: m.sleep.slept }));
      active = Number(e.target.value);
      renderTeam();
      teamCfgs.forEach((_, i) => { $(`m${i}-hp`).value = monState[i].hpPct; $(`m${i}-sleepFrom`).value = monState[i].sleepRest ? "rest" : "move"; $(`m${i}-slept`).value = monState[i].slept; $(`m${i}-toxic`).value = monState[i].toxicTurns; });
    }
    for (let i = 0; teamCfgs && i < teamCfgs.length; i++) syncStatusRows(`m${i}`);
  });
  for (const ev of ["input", "change"]) document.addEventListener(ev, (e) => {
    if (!e.target.classList?.contains("trigger") && e.target.name !== "outMon") return;
    if (e.target.id === "o-status") syncStatusRows("o");
    if (e.target.id === "youFirstTurn" || e.target.id === "youLastMove") syncHistoryRows();
    if (e.target.id === "oppIsLead") syncLeadRow();
    if (e.target.id === "oppSet" && e.type === "change") $("oppGender").value = ""; // a new mon
    if (["challenge", "battle"].includes(e.target.id) && e.type === "change") $("brain").value = brainFor(runInputs()) ?? "";
    if (["challenge", "battle", "brain"].includes(e.target.id)) { refreshTrainerList(); brainChanged(); }
    else if (e.target.id === "trainer" && e.type === "change") brainChanged();
    else if (e.target.id === "bracketOnly" || e.target.name === "level") refreshSetList();
    if (["oppSet", "challenge", "battle", "trainer"].includes(e.target.id) || e.target.name === "level") renderOppSet();
    clearTimeout(refresh.t); refresh.t = setTimeout(refresh, 120);
  });
}
init();
