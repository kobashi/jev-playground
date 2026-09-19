/**
 * Does a session stay interesting?
 *
 * Two rounds of blind listening said the answers get dull, and both times the
 * cause was a monoculture: one template winning every turn, first `question`,
 * then `extend`. Both were visible in the output without anyone listening.
 * This turns that into numbers, so a change can be checked before it costs
 * someone an evening.
 *
 * It runs the app's own engine — a seed phrase, then each answer becomes the
 * next call, exactly as an automatic session does — and reports what varied.
 *
 * Run with `npm run eval:session`.
 */
import { createCaller } from "../src/proxy-client.js";
import { handleRespond } from "../src/respond.js";
import { loadPageEngine, type Note, type PageEngine, type Ranked } from "./page-engine.js";

const TURNS = Number(process.env.TURNS ?? 16);
const SESSIONS = Number(process.env.SESSIONS ?? 4);
/** Set NO_REPEAT=0 to show what the no-repeat rule is actually holding back. */
const NO_REPEAT = process.env.NO_REPEAT !== "0";
/**
 * CHAIN=1 feeds each answer back as the next call, which is what two engines
 * trading does. CHAIN=0 gives every turn a fresh short phrase instead, which
 * is what a person at the keyboard does — and the two produce different
 * answers, so which one is being measured matters.
 */
const CHAIN = process.env.CHAIN !== "0";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (v: number) => (v * 100).toFixed(0).padStart(3) + "%";

/** Transposition-invariant: the same shape moved elsewhere is the same shape. */
const shapeOf = (ns: Note[]): string => {
  const steps: number[] = [];
  for (let i = 1; i < ns.length; i++) steps.push((ns[i] as Note).degree - (ns[i - 1] as Note).degree);
  return steps.join(",");
};
const rhythmOf = (ns: Note[]): string => ns.map((n) => n.dur).join(",");
const mod = (n: number, m: number) => ((n % m) + m) % m;

interface Metrics {
  turns: number;
  intervalVariety: number;
  durationVariety: number;
  archRate: number;
  shortRate: number;
  travels: number;
  topStrategyShare: number;
  strategyEntropy: number;
  distinctShapes: number;
  distinctRhythms: number;
  consecutiveRepeats: number;
  resolutionRate: number;
  meanBeats: number;
  shares: Record<string, number>;
}

const measure = (engine: PageEngine, answers: Note[][], strategies: string[]): Metrics => {
  const len = engine.scaleLen();
  const counts: Record<string, number> = {};
  for (const s of strategies) counts[s] = (counts[s] ?? 0) + 1;
  const total = strategies.length;
  const shares: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) shares[k] = v / total;

  const probs = Object.values(shares);
  const entropy = -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0) /
    Math.log(Object.keys(engine.STRATEGIES).length);

  const shapes = answers.map(shapeOf);
  let repeats = 0;
  for (let i = 1; i < shapes.length; i++) if (shapes[i] === shapes[i - 1]) repeats++;

  const resolved = answers.filter((a) => {
    const last = a[a.length - 1];
    if (!last) return false;
    const m = mod(last.degree, len);
    return m === 0 || m === 2 || m === 4;
  }).length;

  // within one answer: does the phrase itself go anywhere?
  const within = answers.map((a) => {
    const steps: number[] = [];
    for (let i = 1; i < a.length; i++) steps.push(Math.abs((a[i] as Note).degree - (a[i - 1] as Note).degree));
    const degrees = a.map((n) => n.degree);
    const peak = degrees.indexOf(Math.max(...degrees));
    const trough = degrees.indexOf(Math.min(...degrees));
    return {
      intervals: steps.length ? new Set(steps).size / steps.length : 0,
      durations: new Set(a.map((n) => n.dur)).size / a.length,
      // a two-note phrase cannot turn inside itself, so it is counted apart
      short: a.length < 3,
      arch: (peak > 0 && peak < a.length - 1) || (trough > 0 && trough < a.length - 1),
      travels: a.length > 1 && (a[a.length - 1] as Note).degree !== (a[0] as Note).degree,
    };
  });
  const longEnough = within.filter((w) => !w.short);

  return {
    turns: total,
    intervalVariety: mean(within.map((w) => w.intervals)),
    durationVariety: mean(within.map((w) => w.durations)),
    archRate: longEnough.length ? longEnough.filter((w) => w.arch).length / longEnough.length : 0,
    shortRate: within.filter((w) => w.short).length / total,
    travels: within.filter((w) => w.travels).length / total,
    topStrategyShare: Math.max(...Object.values(shares)),
    strategyEntropy: entropy,
    distinctShapes: new Set(shapes).size / total,
    distinctRhythms: new Set(answers.map(rhythmOf)).size / total,
    consecutiveRepeats: shapes.length > 1 ? repeats / (shapes.length - 1) : 0,
    resolutionRate: resolved / total,
    meanBeats: answers.reduce((s, a) => s + engine.phraseLen(a), 0) / total,
    shares,
  };
};

const seedPhrase = (engine: PageEngine, rnd: () => number): Note[] => {
  const steps = [1, 2, -1, 2, -2, 3];
  const n = 3 + Math.floor(rnd() * 3);
  const out: Note[] = [];
  let beat = 0, degree = 0;
  for (let i = 0; i < n; i++) {
    const dur = [0.5, 0.5, 1][Math.floor(rnd() * 3)] as number;
    out.push({ degree: engine.clampDeg(degree), beat, dur });
    beat += dur;
    degree = engine.clampDeg(degree + (steps[Math.floor(rnd() * steps.length)] as number));
  }
  return out;
};

type Ranker = (call: Note[]) => Promise<Ranked>;

const runSession = async (engine: PageEngine, rank: Ranker, rnd: () => number) => {
  engine.session.lastStrategy = null;          // a fresh session says nothing twice running
  let call = seedPhrase(engine, rnd);
  const answers: Note[][] = [];
  const strategies: string[] = [];

  for (let turn = 0; turn < TURNS; turn++) {
    const r = await rank(call);
    const answer = r.cands[r.idx] ?? r.response;
    if (!answer || !answer.length) break;
    answers.push(answer);
    strategies.push(r.strat.pick);
    engine.session.lastStrategy = NO_REPEAT ? r.strat.pick : null;
    call = CHAIN ? answer : seedPhrase(engine, rnd);
  }
  return measure(engine, answers, strategies);
};



const main = async (): Promise<void> => {
  // PAGE lets the same harness run an older copy of the page, with the same
  // seeds, so a change can be compared against what it replaced.
  const engine = loadPageEngine(process.env.PAGE ?? "web/index.html");
  const { client, mode } = createCaller();
  console.log("auth: " + mode + "   " + SESSIONS + " sessions x " + TURNS + " turns per ranker\n");

  const rankers: Record<string, Ranker> = {
    local: async (call) => engine.respond(call),
    jev: async (call) => {
      const itp = engine.interpret(call);
      const pool = engine.candidatePool(call, itp);
      if (!pool.length) return engine.respond(call);
      const data = await handleRespond(client, {
        call, candidates: pool, tonic: engine.state.tonic, scale: engine.state.scale,
      });
      return engine.fromJev(pool, data, itp);
    },
  };

  const results: Record<string, Metrics[]> = {};
  for (const [name, rank] of Object.entries(rankers)) {
    results[name] = [];
    for (let s = 0; s < SESSIONS; s++) {
      let seed = 1000 + s * 7919;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      (results[name] as Metrics[]).push(await runSession(engine, rank, rnd));
      process.stdout.write(".");
    }
  }
  process.stdout.write("\n\n");

  const rows: Array<[string, (m: Metrics) => number, string]> = [
    ["one strategy's share", (m) => m.topStrategyShare, "lower is better — this is the monoculture"],
    ["strategy spread", (m) => m.strategyEntropy, "higher is better"],
    ["distinct shapes", (m) => m.distinctShapes, "higher is better"],
    ["distinct rhythms", (m) => m.distinctRhythms, "higher is better"],
    ["repeats the last shape", (m) => m.consecutiveRepeats, "lower is better"],
    ["lands on a chord tone", (m) => m.resolutionRate, "the resolution complaint"],
    ["-- within one answer --", () => Number.NaN, ""],
    ["interval variety", (m) => m.intervalVariety, "1.00 = every step a different size"],
    ["duration variety", (m) => m.durationVariety, "1.00 = every note a different length"],
    ["turns, of those able to", (m) => m.archRate, "phrases of three notes or more"],
    ["too short to turn", (m) => m.shortRate, "two notes or fewer"],
    ["ends away from its start", (m) => m.travels, "the phrase goes somewhere"],
  ];

  console.log("metric                  | local | Jev   | note");
  console.log("------------------------|-------|-------|------");
  for (const [label, pick, note] of rows) {
    const l = mean((results.local as Metrics[]).map(pick));
    if (Number.isNaN(l)) { console.log(label); continue; }
    console.log(
      label.padEnd(23) + " | " + pct(l) + "  | " +
      pct(mean((results.jev as Metrics[]).map(pick))) + "  | " + note,
    );
  }

  for (const name of ["local", "jev"]) {
    const all: Record<string, number> = {};
    for (const m of results[name] as Metrics[]) {
      for (const [k, v] of Object.entries(m.shares)) all[k] = (all[k] ?? 0) + v / SESSIONS;
    }
    console.log("\n" + name + " picks: " + Object.entries(all).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => k + " " + (v * 100).toFixed(0) + "%").join(", "));
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
