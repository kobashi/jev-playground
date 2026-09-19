/**
 * Build a short listening test: the same calls, answered by two versions of
 * the page, ranked the same way.
 *
 * The earlier tests were built by capturing browser traffic, which quietly
 * introduced two biases — only trials where the rankers disagreed were kept,
 * and the no-repeat rule was driven by a stub rather than by real picks. This
 * takes both arms through the same harness instead, keeps every trial, and
 * tracks the session state each arm would really have.
 *
 * Run with `npm run eval:ab`; BEFORE names the page to compare against.
 */
import { writeFileSync } from "node:fs";
import { createCaller } from "../src/proxy-client.js";
import { handleRespond } from "../src/respond.js";
import { loadPageEngine, type Note, type PageEngine } from "./page-engine.js";

const COUNT = Number(process.env.COUNT ?? 8);
const BEFORE = process.env.BEFORE ?? "";
const OUT = process.env.OUT ?? "eval/results/ab.json";

interface Option {
  who: "now" | "before";
  notes: Note[];
  meta: string;
}

interface Trial {
  id: string;
  kind: "era";
  tonic: string;
  scale: string;
  call: Note[];
  opts: Option[];
}

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

const main = async (): Promise<void> => {
  if (!BEFORE) throw new Error("set BEFORE to the page to compare against");
  const { client, mode } = createCaller();
  const now = loadPageEngine();
  const before = loadPageEngine(BEFORE);
  console.log("auth: " + mode + "   " + COUNT + " calls, both arms ranked by Jev");

  let seed = 20260919;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const calls = Array.from({ length: COUNT }, () => seedPhrase(now, rnd));

  const answer = async (engine: PageEngine, call: Note[]) => {
    const itp = engine.interpret(call);
    const pool = engine.candidatePool(call, itp);
    if (!pool.length) return { notes: engine.respond(call).response, strategy: "local" };
    const data = await handleRespond(client, {
      call, candidates: pool, tonic: engine.state.tonic, scale: engine.state.scale,
    });
    const r = engine.fromJev(pool, data, itp);
    return { notes: r.cands[r.idx] as Note[], strategy: r.strat.pick };
  };

  now.session.lastStrategy = null;
  before.session.lastStrategy = null;
  const trials: Trial[] = [];
  for (const [k, call] of calls.entries()) {
    const a = await answer(now, call);
    const b = await answer(before, call);
    now.session.lastStrategy = a.strategy;
    before.session.lastStrategy = b.strategy;
    const opts: Option[] = [
      { who: "now", notes: a.notes, meta: a.strategy },
      { who: "before", notes: b.notes, meta: b.strategy },
    ];
    if (k % 2 === 1) opts.reverse();                 // strict alternation
    trials.push({
      id: "ab-" + (k + 1), kind: "era",
      tonic: now.state.tonic, scale: now.state.scale, call, opts,
    });
    process.stdout.write(".");
  }

  writeFileSync(OUT, JSON.stringify(trials, null, 2));
  const tally = (who: string) => {
    const m: Record<string, number> = {};
    for (const t of trials) {
      const o = t.opts.find((x: Option) => x.who === who);
      if (o) m[o.meta] = (m[o.meta] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([s, c]) => s + " x" + c).join(", ");
  };
  console.log("\nnow:    " + tally("now"));
  console.log("before: " + tally("before"));
  console.log("written to " + OUT);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
