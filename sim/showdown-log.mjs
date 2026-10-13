// The readable battle log for --trace: each turn told the way Pokemon
// Showdown tells it ("Suicune used Surf!", "(The opposing Wailord lost 41 HP,
// 15.4% of its health!)"), between the solver's line and the bench line.
//
// Where it comes from: the engine's turn label (labels: true), which names each
// action in order -- move, hit / miss, crit, loaf, sleep -- and, after each
// action, a ⟦json⟧ snapshot of both mons (engine/logic.js traceMark: HP,
// stages, status, Substitute, confusion, infatuation, Leech Seed, Curse,
// weather). What an action did is the difference between the snapshot before
// it and the one after; the end of turn is the last snapshot against the
// state the turn ended in. Nothing is guessed: a change with no single cause
// (Leftovers and poison in the same end of turn) is printed as the net change
// with each cause named, and a label this file does not know is printed as is.
import { MOVES } from "../engine/move-data.js";
import { TYPE_CHART } from "../engine/type-data.js";

const MARK = /\s?⟦(.*?)⟧/g;
export const stripMarks = (label) => (label ?? "").replace(MARK, "");

const STAT = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
const RISE = ["", "rose!", "rose sharply!", "rose drastically!"];
const FALL = ["", "fell!", "harshly fell!", "severely fell!"];
// damage set by the move, not by the type chart (no effectiveness message)
const FIXED = new Set(["EFFECT_LEVEL_DAMAGE", "EFFECT_DRAGON_RAGE", "EFFECT_SONICBOOM", "EFFECT_SUPER_FANG", "EFFECT_OHKO", "EFFECT_ENDEAVOR",
  "EFFECT_PSYWAVE", "EFFECT_COUNTER", "EFFECT_MIRROR_COAT", "EFFECT_BIDE", "EFFECT_WEATHER_BALL"]);
const WEATHER_ON = { sun: "The sunlight turned harsh!", rain: "It started to rain!", sandstorm: "A sandstorm kicked up!", hail: "It started to hail!" };
const WEATHER_OFF = { sun: "The sunlight faded.", rain: "The rain stopped.", sandstorm: "The sandstorm subsided.", hail: "The hail stopped." };
const ENTRY_WEATHER = { Drizzle: "rain", Drought: "sun", "Sand Stream": "sandstorm" };

const pts = (pct, mon) => Math.round((Math.max(0, pct) * mon.stats.hp) / 100);
const ucfirst = (t) => t[0].toUpperCase() + t.slice(1);

// One side's snapshot from a battle state (the same fields as traceMark).
function snapOf(s, y) {
  return {
    hp: y ? s.yourHpPct : s.oppHpPct, st: y ? s.youStages : s.oppStages, status: y ? s.youStatus : s.oppStatus,
    sub: y ? s.youSubstituteHP : s.oppSubstituteHP, conf: y ? s.youConfused : s.oppConfused, att: y ? s.youAttracted : s.oppAttracted,
    seed: y ? s.youSeeded : s.oppSeeded, curse: y ? s.youCursed : s.oppCursed,
  };
}
// A mon coming off the bench: what it carries, nothing else.
const benchSnap = (e) => ({ hp: e?.hpPct ?? 100, st: {}, status: e?.status ?? null, sub: 0, conf: false, att: false, seed: false, curse: false });

export function makeLog(B, trainer) {
  const yName = (i) => B.team[i].species;
  const oName = (i, mid = false) => `${mid ? "the" : "The"} opposing ${B.oppTeam[i].species}`;

  function effectiveness(attacker, move, defender) {
    const md = MOVES[move];
    if (!md || FIXED.has(md.effect) || !(md.power > 0)) return null;
    const type = move === "Hidden Power" ? attacker.hiddenPower?.type : md.type;
    if (!type) return null;
    if (type === "Ground" && defender.ability === "Levitate") return 0;
    return defender.types.reduce((m, t) => m * (TYPE_CHART[type]?.[t] ?? 1), 1);
  }

  // What changed on one side between two snapshots, as Showdown lines.
  // ctx: { name, mon, cause } -- cause "rest" | "eot" | "entry" | null
  function diffLines(a, b, { name, mon, rest = false, skipHp = false }) {
    const out = [];
    const lname = name.startsWith("The ") ? "t" + name.slice(1) : name;
    if (!a.sub && b.sub > 0) out.push(`${name} put in a substitute!`);
    if (a.sub > 0 && b.sub > 0 && b.sub < a.sub) out.push(`The substitute took damage for ${lname}!`);
    if (a.sub > 0 && !b.sub) out.push(`${name}'s substitute faded!`);
    if (!skipHp) {
      const d = pts(b.hp, mon) - pts(a.hp, mon);
      if (d) out.push(`(${name} ${d < 0 ? "lost" : "restored"} ${Math.abs(d)} HP, ${(Math.abs(d) * 100 / mon.stats.hp).toFixed(1)}% of its health!)`);
    }
    if (a.status !== b.status) {
      if (b.status === "sleep") out.push(rest ? `${name} slept and became healthy!` : `${name} fell asleep!`);
      else if (b.status === "toxic") out.push(`${name} was badly poisoned!`);
      else if (b.status === "poison") out.push(`${name} was poisoned!`);
      else if (b.status === "burn") out.push(`${name} was burned!`);
      else if (b.status === "paralysis") out.push(`${name} is paralyzed! It may be unable to move!`);
      else if (b.status === "freeze") out.push(`${name} was frozen solid!`);
      else if (a.status === "sleep") out.push(`${name} woke up!`);
      else if (a.status === "freeze") out.push(`${name} thawed out!`);
      else if (a.status) out.push(`${name} was cured of its ${a.status === "toxic" ? "poison" : a.status}!`);
    }
    for (const k of Object.keys(STAT)) {
      const d = (b.st?.[k] ?? 0) - (a.st?.[k] ?? 0);
      if (d) out.push(`${name}'s ${STAT[k]} ${d > 0 ? RISE[Math.min(3, d)] : FALL[Math.min(3, -d)]}`);
    }
    if (!a.conf && b.conf) out.push(`${name} became confused!`);
    if (a.conf && !b.conf && b.hp > 0) out.push(`${name} snapped out of its confusion!`);
    if (!a.att && b.att) out.push(`${name} fell in love!`);
    if (!a.seed && b.seed) out.push(`${name} was seeded!`);
    if (!a.curse && b.curse) out.push(`${name} was cursed!`);
    if (a.hp > 0 && b.hp <= 0) out.push(`${name} fainted!`);
    return out;
  }
  const weatherLines = (a, b) => (a === b ? [] : b ? [WEATHER_ON[b] ?? `The weather became ${b}.`] : [WEATHER_OFF[a] ?? `The ${a} ended.`]);

  // One turn. s0: the state it began in; s1: the state it ended in (after the
  // opponent's replacement, if its mon fell); label / chose: battleTurn's.
  function turn(s0, s1, label, chose) {
    const blocks = [];
    let yi = s0.youActive, oi = s0.oppActive;
    let prev = { y: snapOf(s0, true), o: snapOf(s0, false), w: s0.weatherType ?? null };
    const names = () => ({ y: yName(yi), o: oName(oi), ym: B.team[yi], om: B.oppTeam[oi] });
    // a mon entering mid-turn: what it carries -- off the bench, or (dragged
    // straight back in) as it left the field at the start of this turn
    const enterY = (j) => benchSnap(j === s0.youActive ? { hpPct: s0.yourHpPct, status: s0.youStatus } : s0.youBench[j]);
    const enterO = (j) => benchSnap(j === s0.oppActive ? { hpPct: s0.oppHpPct, status: s0.oppStatus } : s0.oppBench?.[j]);

    // the label: pieces "; "-separated, a ⟦snapshot⟧ after each action
    const parts = [];
    let last = 0;
    for (const m of (label ?? "").matchAll(MARK)) {
      parts.push({ text: label.slice(last, m.index), mark: JSON.parse(m[1]) });
      last = m.index + m[0].length;
    }
    const tail = label ? label.slice(last) : "";
    // a mon forced off mid-turn (engine/logic.js continueAfterDrag, the
    // opponent's Baton Pass): the newcomer is the one the turn ended with
    const NOTE = /^\((dragged out|opponent dragged out|Baton Pass|opponent leaves the field)\)\s*/;
    const notes = (text) => {
      let m;
      while ((m = text.match(NOTE))) {
        if (m[1] === "dragged out" && s1.youActive !== yi) {
          const j = s1.youActive;
          blocks.push([`${yName(j)} was dragged out!`]);
          yi = j; prev = { ...prev, y: enterY(j) };
        } else if ((m[1] === "opponent dragged out" || m[1] === "Baton Pass") && s1.oppActive != null && s1.oppActive !== oi) {
          const j = s1.oppActive;
          blocks.push([m[1] === "Baton Pass" ? `${oName(oi)} passed to a teammate! ${trainer} sent out ${B.oppTeam[j].species}!` : `${oName(j)} was dragged out!`]);
          // Baton Pass carries the stages
          oi = j; prev = { ...prev, o: { ...enterO(j), ...(m[1] === "Baton Pass" ? { st: prev.o.st } : {}) } };
        } else blocks.push([`(${m[1]})`]);
        text = text.slice(m[0].length).trim();
      }
      return text;
    };
    // a switch by choice (yours, theirs): told, and the newcomer's snapshot is
    // what it carries off the bench
    const switchPiece = (pc) => {
      let m;
      if ((m = pc.match(/^(?:you )?switch to (.+?)( \(Pursuit\))?$/))) {
        const j = B.team.findIndex((x, k) => x.species === m[1] && k !== yi);
        blocks.push([`${yName(yi)}, come back!`, `Go! ${m[1]}!`]);
        yi = j; prev = { ...prev, y: enterY(j) };
        return true;
      }
      if ((m = pc.match(/^they switch to (.+?)( \(Pursuit\))?$/))) {
        const j = B.oppTeam.findIndex((x, k) => x.species === m[1] && k !== oi);
        blocks.push([`${trainer} withdrew ${B.oppTeam[oi].species}!`, `${trainer} sent out ${m[1]}!`]);
        oi = j; prev = { ...prev, o: enterO(j) };
        return true;
      }
      return false;
    };
    for (const { text: text0, mark } of parts) {
      const text = notes(text0.trim());
      const pieces = text.split(";").map((t) => t.trim()).filter(Boolean);
      let lines = [];
      for (const pc of pieces) {
        if (!switchPiece(pc)) lines = lines.concat(action(pc, prev, mark, chose));
      }
      if (lines.length) blocks.push(lines);
      prev = { y: mark.y, o: mark.o, w: mark.w };
    }
    // anything after the last snapshot that is not the KO note
    const extra = notes(tail.replace(/\((you|opp) never acts — KO\)/g, "").trim())
      .split(";").map((t) => t.trim()).filter(Boolean).filter((pc) => !switchPiece(pc));
    if (extra.length) blocks.push([`(${extra.join("; ")})`]);

    // end of turn: the last snapshot against where the turn ended
    const eot = [];
    // an opponent's replacement's Intimidate is told with its entry, not here
    const replaced = s1.oppActive !== oi && s1.oppActive != null;
    const endY0 = s1.youActive === yi ? snapOf(s1, true) : benchSnap(s1.youBench[yi]);
    const endY = replaced && s1.youActive === yi ? { ...endY0, st: prev.y.st } : endY0;
    const endO = s1.oppActive === oi ? snapOf(s1, false) : benchSnap(s1.oppBench?.[oi]);
    eot.push(...weatherLines(prev.w, s1.weatherType ?? null));
    eot.push(...eotSide(prev.y, endY, yName(yi), B.team[yi], s1.weatherType, s1.youActive === yi));
    eot.push(...eotSide(prev.o, endO, oName(oi), B.oppTeam[oi], s1.weatherType, s1.oppActive === oi));
    if (eot.length) blocks.push(eot);

    // the opponent's replacement after a faint
    if (replaced) {
      const ni = s1.oppActive, nm = B.oppTeam[ni];
      const lines = [`${trainer} sent out ${nm.species}!`, ...entryLines(nm, oName(ni), endY, endY0, yName(yi), B.team[yi], s1.youActive === yi)];
      blocks.push(lines);
    }
    return blocks;

    function action(pc, a, b, chose) {
      const m0 = pc.match(/^(You|Opp)(?::| )\s*(.*)$/);
      if (!m0) return [pc];
      const y = m0[1] === "You", body = m0[2];
      const n = names();
      const me = y ? n.y : n.o, foe = y ? n.o : n.y;
      const meMon = y ? n.ym : n.om, foeMon = y ? n.om : n.ym;
      const lfoe = foe.startsWith("The ") ? "t" + foe.slice(1) : foe;
      const [ma, mb, fa, fb] = y ? [a.y, b.y, a.o, b.o] : [a.o, b.o, a.y, b.y];
      const out = [];
      const both = (opts = {}) => [...diffLines(fa, fb, { name: foe, mon: foeMon }), ...diffLines(ma, mb, { name: me, mon: meMon, ...opts })];
      let m;
      if (body === "(switched in)") {
        // entry: Spikes on the newcomer, its ability on the foe
        const hurt = diffLines(ma, mb, { name: me, mon: meMon });
        if (pts(mb.hp, meMon) < pts(ma.hp, meMon)) out.push(`${me} was hurt by the spikes!`);
        out.push(...hurt);
        if (meMon.ability === "Intimidate" && (fb.st?.atk ?? 0) < (fa.st?.atk ?? 0)) out.push(`[${me}'s Intimidate]`);
        out.push(...diffLines(fa, fb, { name: foe, mon: foeMon }));
        out.push(...weatherLines(a.w, b.w));
        return out;
      }
      if ((m = body.match(/^loafs \(Palace\)(.*)$/))) {
        const plain = /loafed: plain/.test(y ? chose?.you ?? "" : chose?.opp ?? "");
        out.push(plain ? `${me} can't use its chosen move! (Palace)` : `${me} appears incapable of using its power!`);
        return out.concat(both());
      }
      if (/^is asleep and can't move/.test(body)) return [`${me} is fast asleep.`, ...both()];
      if (/^is fully paralyzed and can't move/.test(body)) return [`${me} is paralyzed! It can't move!`, ...both()];
      if (/^is frozen solid and can't move/.test(body)) return [`${me} is frozen solid!`, ...both()];
      if (/^is fully paralyzed\/frozen and can't move/.test(body)) return [`${me} can't move!`, ...both()];
      if (/^is immobilized by love and can't move/.test(body)) return [`${me} is in love with ${lfoe}!`, `${me} is immobilized by love!`, ...both()];
      if (/^hits itself in confusion/.test(body)) return [`${me} is confused!`, "It hurt itself in its confusion!", ...both()];
      if (/^flinches/.test(body)) return [`${me} flinched and couldn't move!`, ...both()];
      if (/^is loafing around/.test(body)) return [`${me} is loafing around!`, ...both()];
      if (/^must recharge/.test(body)) return [`${me} must recharge!`, ...both()];
      if (/^is storing energy/.test(body)) return [`${me} is storing energy!`, ...both()];
      if ((m = body.match(/^can't use the disabled (.+)$/))) return [`${me}'s ${m[1]} is disabled!`, ...both()];
      if ((m = body.match(/^can't use (.+) after the taunt$/))) return [`${me} can't use ${m[1]} after the taunt!`, ...both()];
      if ((m = body.match(/^can't use the sealed (.+)$/))) return [`${me} can't use its sealed ${m[1]}!`, ...both()];
      if ((m = body.match(/^uses (.+?)(?: -> (.+?))?(?: \((hits|MISSES|hits (\d+)x)\))?((?: \([^()]*\))*)$/))) {
        const [, move, called, res, nHits, notes] = m;
        out.push(`${me} used ${move}!`);
        const used = called ?? move;
        if (called) out.push(`${me} used ${called}!`);
        if (res === "MISSES") { out.push(`${foe} avoided the attack!`); return out.concat(both()); }
        if (res) {
          const eff = effectiveness(meMon, used, foeMon);
          if (eff === 0) { out.push(`It doesn't affect ${lfoe}...`); return out.concat(both()); }
          if (nHits) out.push(`The Pokémon was hit ${nHits} time${nHits === "1" ? "" : "s"}!`);
          if (/critical hit/.test(notes)) out.push("A critical hit!");
          if (eff > 1) out.push("It's super effective!");
          else if (eff != null && eff < 1) out.push("It's not very effective...");
          if (MOVES[used]?.effect === "EFFECT_OHKO" && fb.hp <= 0) out.push("It's a one-hit KO!");
        }
        return out.concat(both({ rest: used === "Rest" }), weatherLines(a.w, b.w));
      }
      return [`${me}: ${body}`, ...both()];
    }
  }

  // End-of-turn effects on one side: each cause the state shows, then the HP.
  function eotSide(a, b, name, mon, weather, stillIn) {
    if (!(a.hp > 0)) return [];
    const d = pts(b.hp, mon) - pts(a.hp, mon);
    const causes = [];
    if (d > 0 && mon.item === "Leftovers") causes.push(`${name} restored a little HP using its Leftovers!`);
    if (d < 0 && (a.status === "poison" || a.status === "toxic")) causes.push(`${name} was hurt by poison!`);
    if (d < 0 && a.status === "burn") causes.push(`${name} was hurt by its burn!`);
    if (d < 0 && weather === "sandstorm" && !mon.types.some((t) => ["Rock", "Ground", "Steel"].includes(t))) causes.push(`${name} is buffeted by the sandstorm!`);
    if (d < 0 && weather === "hail" && !mon.types.includes("Ice")) causes.push(`${name} is buffeted by the hail!`);
    if (d < 0 && a.seed) causes.push(`${name}'s health is sapped by Leech Seed!`);
    if (d < 0 && a.curse) causes.push(`${name} is afflicted by the curse!`);
    const out = [...causes];
    const pct = (x) => (Math.abs(x) * 100 / mon.stats.hp).toFixed(1);
    if (d && causes.length <= 1) out.push(`(${name} ${d < 0 ? "lost" : "restored"} ${Math.abs(d)} HP, ${pct(d)}% of its health!)`);
    else if (d) out.push(`(${name}: ${d > 0 ? "+" : "-"}${Math.abs(d)} HP net, ${pct(d)}% of its health, from the above together)`);
    const rest = diffLines(a, b, { name, mon, skipHp: true });
    return out.concat(stillIn ? rest : rest.filter((l) => /fainted|woke|thawed|cured|poisoned|burned|paralyzed|frozen|asleep/.test(l)));
  }

  // A newcomer's entry ability on the mon facing it (a before, b after).
  function entryLines(mon, name, a, b, foeName, foeMon, foeIn) {
    const out = [];
    if (foeIn && mon.ability === "Intimidate" && (b.st?.atk ?? 0) < (a.st?.atk ?? 0)) out.push(`[${name}'s Intimidate]`, `${foeName}'s Attack ${FALL[1]}`);
    if (ENTRY_WEATHER[mon.ability]) out.push(`[${name}'s ${mon.ability}]`);
    return out;
  }

  // Battle start: both leads out, their entry abilities.
  function start(s) {
    const yi = s.youActive, oi = s.oppActive;
    const fresh = { st: {} };
    const out = [`${trainer} sent out ${B.oppTeam[oi].species}!`, `Go! ${yName(yi)}!`];
    out.push(...entryLines(B.team[yi], yName(yi), fresh, snapOf(s, false), oName(oi), B.oppTeam[oi], true));
    out.push(...entryLines(B.oppTeam[oi], oName(oi), fresh, snapOf(s, true), yName(yi), B.team[yi], true));
    if (s.weatherType) out.push(WEATHER_ON[s.weatherType] ?? `The weather is ${s.weatherType}.`);
    return out;
  }

  // Your replacement after a faint (s0 before it, s1 after; the opponent's own
  // replacement, if its mon fell too, is already in s1).
  function replacement(s0, s1) {
    const out = [`Go! ${yName(s1.youActive)}!`];
    const ym = B.team[s1.youActive];
    if (s0.oppActive === s1.oppActive) {
      out.push(...entryLines(ym, yName(s1.youActive), snapOf(s0, false), snapOf(s1, false), oName(s1.oppActive), B.oppTeam[s1.oppActive], true));
    } else {
      out.push(`${trainer} sent out ${B.oppTeam[s1.oppActive].species}!`);
      if (ym.ability === "Intimidate" && (s1.oppStages?.atk ?? 0) < 0) out.push(`[${yName(s1.youActive)}'s Intimidate]`, `${oName(s1.oppActive)}'s Attack ${FALL[1]}`);
      if (B.oppTeam[s1.oppActive].ability === "Intimidate" && (s1.youStages?.atk ?? 0) < 0) out.push(`[${oName(s1.oppActive)}'s Intimidate]`, `${yName(s1.youActive)}'s Attack ${FALL[1]}`);
    }
    if ((s0.weatherType ?? null) !== (s1.weatherType ?? null)) out.push(...weatherLines(s0.weatherType ?? null, s1.weatherType ?? null));
    return out;
  }

  return { turn, start, replacement };
}
