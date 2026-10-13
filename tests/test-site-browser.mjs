// The page (site/), in a real headless Chromium, against the engine.
//
// Serves battle-tower-solver/ over http (the page imports ../engine/*.js as ES
// modules, so file:// will not do) and drives it through its own controls:
// paste the user's team, pick the bracket and the opponent, enter what the AI
// has seen. The expected bars are ui-logic.js readout() run here in Node on
// the same form -- a page that builds the position differently fails. Plus:
// the set dropdown, Anabel's battle, a saved team over a reload, no page error.
//
// Playwright comes from the Arena solver's install (battle_arena_assistant/
// battle_arena_sim/node_modules), whose Chromium is already downloaded.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const require = createRequire(path.resolve(ROOT, "../battle_arena_assistant/battle_arena_sim/package.json"));
const { chromium } = require("playwright");
const U = await import(pathToFileURL(path.join(ROOT, "site/ui-logic.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const TEAM = fs.readFileSync(path.join(ROOT, "teams/user-test-team.txt"), "utf8");
const cfgs = U.parseTeam(TEAM);
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const fullMons = () => cfgs.map(() => ({ hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false }));
const oppForm = (o) => ({ ability: null, hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, stages: zero, confused: 0, firstTurn: true, gender: null, ...o });
const field = { weather: "", weatherTurns: null, you: { spikes: 0 }, opp: { spikes: 0 } };
const barsOf = (page) => page.$$eval("#oppChoices .cb-row", (rows) => rows.map((r) => [r.querySelector("span").textContent, r.querySelector(".cb-p").textContent]));
const expectBars = (r) => r.rows.slice(0, 10).map((x) => [x.label, U.pct(x.p, x.p < 0.01 && x.p > 0 ? 1 : 0)]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// the advice table, once the worker has answered; and the same rows from Node
const adviceOf = async (page) => {
  await page.waitForFunction(() => !/Working|Looking/.test(document.getElementById("adviceNote").textContent) && document.querySelectorAll("#adviceTable tbody tr").length > 0, null, { timeout: 180000 });
  return page.$$eval("#adviceTable tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
};
const fmt = (x) => U.pct(x, x > 0 && x < 0.01 ? 1 : 0);
// ranked (★ on the best), KO first / KO it / you faint / dealt / taken, and
// with two turns the follow-up most often picked ("then ..." under the option)
const thenOf = (r) => !r.follow?.length ? "—" : `${r.follow[0][0]} ${U.pct(r.follow[0][1])}${r.follow.length > 1 ? ` +${r.follow.length - 1}` : ""}`;
const expectAdvice = (form, turns = 1) => U.rankAdvice(U.advise(U.buildPosition(form), { turns })).map((r) => [(r.best ? "★ " : "") + r.label + (r.approx ? " ~" : "") + (turns === 2 ? `then ${thenOf(r)}` : ""),
  fmt(r.pKOFirst), fmt(r.pKO), fmt(r.pFaint), `${r.dealt.toFixed(0)}%`, `${r.taken.toFixed(0)}%`]);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/site/index.html`);
  ok(errors.length === 0, `loads with no error (${errors.join("; ")})`);
  ok((await page.title()) === "Battle Tower Solver" && await page.isChecked("#level50"), "title; Level 50 on by default");

  await page.fill("#teamText", TEAM);
  await page.click("#parseTeam");
  ok(await page.locator(".mon-card").count() === 3, "three mon cards after 'Use team'");
  ok(await page.locator("#lastMoveRow").isHidden() && await page.locator("#seenRow").isHidden(), "just came in: no last-move / seen inputs");
  await page.selectOption("#challenge", "7");
  await page.selectOption("#battle", "1");
  await page.click("#oppSet"); await page.keyboard.type("snorlax 3"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  ok(await page.inputValue("#oppSet") === "Snorlax 3" && (await page.textContent("#oppCard")).includes("Snorlax 3"), "set picked from the dropdown");
  const listed = await (async () => { await page.click("#oppSet"); const n = await page.locator("#oppSetList .combo-item").count(); await page.click("h1"); await page.waitForTimeout(300); return n; })();
  ok(listed === U.setChoices({ challenge: 7, battle: 1 }).length, `focus lists the bracket's ${listed} sets`);
  const ivTop = U.ivTierOdds("Snorlax 3", { challenge: 7, battle: 1 })[0].iv;
  ok((await page.locator("#oppIv option").first().textContent()).startsWith(String(ivTop)), `IVs default to the bracket's most likely (${ivTop})`);
  await page.selectOption("#oppAbility", "Thick Fat"); await page.waitForTimeout(500);

  // Turn 1: the bars = readout() on the same form.
  const form1 = { team: cfgs, active: 0, mons: fullMons(), you: { stages: zero, confused: 0, subPct: 0, firstTurn: true, lastMove: null, landed: true, seen: [] },
    opp: oppForm({ setKey: "Snorlax 3", ability: "Thick Fat", ivTier: ivTop }), party: { lead: null, leadHpPct: 100, others: [] }, field, run: { challenge: 7, battle: 1, turn: 1, level: 50 } };
  const r1 = U.readout(U.buildPosition(form1));
  const b1 = await barsOf(page);
  ok(b1.length > 0 && same(b1, expectBars(r1)), `turn-1 bars = readout (${b1.map((b) => b.join(" ")).join(", ")})`);
  ok((await page.textContent("#switchLine")).includes("does not switch"), "turn 1: no switch line");
  const adv1 = await adviceOf(page), want1 = expectAdvice(form1);
  ok(adv1.length === 6 && same(adv1, want1), `advice table = Node's advise (${adv1.map((r) => `${r[0]} ${r[1]}`).join(", ")})`);
  ok(adv1[0][0].startsWith("★ ") && adv1.filter((r) => r[0].startsWith("★")).length === 1, "one ★, on the top row");
  // Two turns: the worker pool's merged table = Node's advise(turns 2), ranked.
  await page.click("label[for=turns2]"); await page.waitForTimeout(400);
  const adv2 = await adviceOf(page), want2 = expectAdvice(form1, 2);
  ok(same(adv2, want2), `two turns: table = Node's (${adv2.map((r) => `${r[0]} ${r[1]}`).join(", ")})`);
  const heads = () => page.$$eval("#adviceTable th", (ths) => ths.filter((t) => t.offsetParent).map((t) => t.innerText.trim().replace(/\s+/g, " ")).join(" | "));
  ok(await page.locator("#adviceTable .then-line").first().isVisible() && (await page.textContent("#adviceHead")).includes("two turns")
    && (await heads()) === "Option | KO first 2 turns | KO it 2 turns | You faint 2 turns | Dealt 2 turns | Taken 2 turns", `two turns: headings say so (${await heads()})`);
  // back to this turn: drawn at once from what was kept (no "Working")
  await page.click("label[for=turns1]");
  const adv1b = await page.$$eval("#adviceTable tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  ok(same(adv1b, want1) && await page.locator("#adviceTable .then-line").count() === 0 && (await heads()) === "Option | KO first | KO it | You faint | Dealt | Taken", "This turn: back at once, one-turn headings");
  await page.click("label[for=turns2]");
  const adv2b = await page.$$eval("#adviceTable tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  ok(same(adv2b, want2), "Two turns again: back at once, nothing worked out again");
  await page.click("label[for=turns1]");

  // Turn 2 after your Earthquake hit: switch rows appear, amber, and match.
  await page.fill("#turn", "2");
  await page.uncheck("#youFirstTurn"); await page.uncheck("#oppFirstTurn");
  await page.selectOption("#youLastMove", "Earthquake"); await page.waitForTimeout(600);
  ok(await page.isChecked("#seen-1"), "the last move is ticked as seen");
  const form2 = { ...form1, you: { ...form1.you, firstTurn: false, lastMove: "Earthquake", landed: true, seen: ["Earthquake"] },
    opp: { ...form1.opp, firstTurn: false }, run: { ...form1.run, turn: 2 } };
  const r2 = U.readout(U.buildPosition(form2));
  const b2 = await barsOf(page);
  if (!same(b2, expectBars(r2))) console.log("  page", JSON.stringify(b2), "| node", JSON.stringify(expectBars(r2)), "| notes", await page.textContent("#notes"));
  ok(r2.pSwitch > 0 && same(b2, expectBars(r2)), `after Earthquake: bars = readout, P(switch) ${(100 * r2.pSwitch).toFixed(1)}%`);
  ok(await page.locator("#oppChoices .cb-switch").count() === r2.rows.slice(0, 10).filter((x) => x.kind === "switch").length, "switch rows are marked");
  ok((await page.textContent("#switchLine")).includes(U.pct(r2.pSwitch, 1)), "the switch total line");

  // An other seen: typed, its HP; the mix narrows to parties holding it.
  const mate = r2.rows.find((x) => x.kind === "switch").label.replace("Switch to ", "");
  await page.click("#other1Set"); await page.keyboard.type(mate.toLowerCase()); await page.keyboard.press("Enter");
  await page.fill("#other1Hp", "50"); await page.waitForTimeout(600);
  const form3 = { ...form2, party: { lead: null, leadHpPct: 100, others: [{ setKey: mate, hpPct: 50 }] } };
  const r3 = U.readout(U.buildPosition(form3));
  ok(same(await barsOf(page), expectBars(r3)), `with ${mate} seen at 50%: bars = readout`);
  await page.fill("#other1Set", ""); await page.click("h1"); await page.waitForTimeout(600);
  ok(same(await barsOf(page), expectBars(r2)), "clearing the other seen restores the readout");

  // A known trainer whose pool holds several sets of one species: the set
  // list narrows to its pool, the IVs are its own, every same-species set is
  // ticked with its odds, and the bars = readout over them.
  const N = await import(pathToFileURL(path.join(ROOT, "engine/next-in.js")).href);
  const { FRONTIER_POOL } = await import(pathToFileURL(path.join(ROOT, "engine/frontier-pool.js")).href);
  const pick = N.trainerPrior({ challenge: 7, battle: 1 }).map(({ id }) => {
    const keys = U.setChoices({ trainerId: id });
    const sp = keys.map((k) => FRONTIER_POOL[k].species).find((x, i, a) => a.indexOf(x) !== i);
    return sp ? { id, keys, same: keys.filter((k) => FRONTIER_POOL[k].species === sp) } : null;
  }).find(Boolean);
  await page.fill("#other1Set", ""); await page.fill("#turn", "1"); await page.check("#youFirstTurn"); await page.check("#oppFirstTurn");
  await page.click("#trainer"); await page.keyboard.type(U.trainerLabel(pick.id).toLowerCase()); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  ok(await page.inputValue("#trainer") === U.trainerLabel(pick.id) && await page.locator("#bracketRow").isHidden(), `trainer picked: ${U.trainerLabel(pick.id)}`);
  ok(await page.inputValue("#oppSet") === "", "the set out (not in its pool) is cleared");
  await page.click("#oppSet");
  ok(await page.locator("#oppSetList .combo-item").count() === pick.keys.length, `the set list is its pool (${pick.keys.length})`);
  await page.keyboard.type(pick.same[0].toLowerCase()); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  ok((await page.textContent("#oppIv")).startsWith(`${N.fixedIvs(pick.id)} (this trainer`), `IVs: the trainer's (${N.fixedIvs(pick.id)})`);
  const ticked = await page.$$eval("#candList .cand-tick", (els) => els.filter((e) => e.checked).map((e) => e.dataset.key));
  ok(ticked.join() === pick.same.join(), `could be: all of ${pick.same.join(", ")} ticked`);
  const formT = { ...form1, opp: oppForm({ setKey: pick.same[0], candidates: pick.same, ability: null, ivTier: N.fixedIvs(pick.id) }), run: { challenge: 7, battle: 1, turn: 1, level: 50, trainerId: pick.id } };
  const posT = U.buildPosition(formT), rT = U.readout(posT);
  ok(same(await adviceOf(page), expectAdvice(formT)), "advice over the candidates = Node's");
  ok(same(await barsOf(page), expectBars(rT)), `bars = readout over the candidates (${(await barsOf(page)).map((b) => b.join(" ")).join(", ")})`);
  const shown = await page.$$eval("#candList .cand-row", (rows) => rows.map((r) => r.querySelector(".cand-p").textContent));
  ok(shown.join() === pick.same.map((k) => U.pct(posT.setOdds.find((x) => x.key === k).p)).join(), `odds shown: ${shown.join(", ")}`);
  await page.uncheck(`#cand-${FRONTIER_POOL[pick.same[1]].index}`); await page.waitForTimeout(700);
  const rU = U.readout(U.buildPosition({ ...formT, opp: { ...formT.opp, candidates: pick.same.filter((k) => k !== pick.same[1]) } }));
  ok(same(await barsOf(page), expectBars(rU)), `unticking ${pick.same[1]}: bars = readout without it`);
  await page.fill("#trainer", ""); await page.click("h1"); await page.waitForTimeout(500);
  ok(await page.locator("#bracketRow").isVisible(), "clearing the trainer brings the bracket filter back");

  // Anabel: challenge 5, battle 7 -- picked for you, her lead, IVs fixed.
  await page.selectOption("#challenge", "5"); await page.selectOption("#battle", "7"); await page.waitForTimeout(600);
  ok(await page.inputValue("#brain") === "Anabel Silver" && await page.inputValue("#oppSet") === "Anabel Silver Alakazam"
    && (await page.textContent("#oppIv")).startsWith("24 (fixed") && await page.locator("#bracketRow").isHidden(), "challenge 5 battle 7: Anabel Silver, Alakazam, IV 24 fixed");
  const abA = await page.inputValue("#oppAbility");
  const formA = { ...form1, opp: oppForm({ setKey: "Anabel Silver Alakazam", ability: abA || null, ivTier: 24 }), run: { challenge: 5, battle: 7, turn: 1, brain: "Anabel Silver", level: 50 } }; // turn 1 again: the trainer section reset it
  const rA = U.readout(U.buildPosition(formA));
  ok(same(await barsOf(page), expectBars(rA)), `Anabel's Alakazam: bars = readout (${(await barsOf(page)).map((b) => b.join(" ")).join(", ")})`);

  // A saved team survives a reload.
  await page.fill("#teamName", "test team");
  await page.click("#saveTeam");
  await page.reload();
  ok((await page.$$eval("#savedTeams option", (o) => o.map((x) => x.value))).includes("test team"), "saved team listed after a reload");
  ok(errors.length === 0, `no page error at any point (${errors.join("; ")})`);
} finally {
  await browser.close();
  server.close();
}
console.log(`${fail ? "FAIL" : "ok"}  site-browser: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
