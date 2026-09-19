/**
 * Can Jev tell two plausible answers apart, not just a good one from a broken one?
 *
 * Every pair is asked twice, with the two candidates swapped, because a model
 * that always picks the first label would otherwise score 50% and look honest.
 *
 * Run with `npm run eval:pairs`.
 */
import { choice } from "@typesafe-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { createCaller, type SystemOneCaller } from "../src/proxy-client.js";
import { PAIRS, type Dimension, type Pair } from "./pairs.js";

const CONCURRENCY = 4;
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;

const NOTATION =
  "A note is a pitch name with its octave, a position and a length; C4 is middle C. " +
  "beat and dur are in quarter notes, counted from the start of the phrase.";

interface Trial {
  id: string;
  dimension: Dimension;
  betterLabel: "a" | "b";
  chosen: string;
  pBetter: number;
  confidence: number;
  inputTokens: number;
}

const runPool = async <T>(jobs: Array<() => Promise<T>>, width: number): Promise<T[]> => {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await (jobs[i] as () => Promise<T>)();
      process.stdout.write(".");
    }
  }));
  process.stdout.write("\n");
  return out;
};

const trial = async (client: SystemOneCaller, pair: Pair, betterLabel: "a" | "b"): Promise<Trial> => {
  const criteria = {
    a: betterLabel === "a" ? pair.better : pair.worse,
    b: betterLabel === "a" ? pair.worse : pair.better,
  };
  const ask = async () =>
    client.systemOne({
      state: { key: "C major", notation: NOTATION, call: pair.call },
      questions: {
        best: choice(
          "Which of these two is the better answer to the call? Judge it as one half of a " +
            "two-part musical conversation: the answer should relate to what the call did, " +
            "stay in the key, sit where the call left off, and be playable as a phrase.",
          criteria as unknown as Record<string, never>,
        ),
      },
    });

  let result;
  try {
    result = await ask();
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    result = await ask();
  }

  const probabilities = result.answers.best.probabilities as Record<string, number>;
  return {
    id: pair.id,
    dimension: pair.dimension,
    betterLabel,
    chosen: result.answers.best.choice,
    pBetter: probabilities[betterLabel] ?? 0,
    confidence: result.answers.best.confidence,
    inputTokens: result.usage.input_tokens,
  };
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0).padStart(3) + "%" : "  —");

const main = async (): Promise<void> => {
  const { client, mode } = createCaller();
  console.log("auth: " + mode);
  console.log(PAIRS.length + " pairs x 2 orders = " + PAIRS.length * 2 + " requests\n");

  const jobs: Array<() => Promise<Trial>> = [];
  for (const pair of PAIRS) {
    jobs.push(() => trial(client, pair, "a"));
    jobs.push(() => trial(client, pair, "b"));
  }

  const startedAt = Date.now();
  const trials = await runPool(jobs, CONCURRENCY);
  const tokens = trials.reduce((s, t) => s + t.inputTokens, 0);
  console.log("\n" + trials.length + " requests in " + ((Date.now() - startedAt) / 1000).toFixed(1) + "s, " +
    tokens.toLocaleString() + " input tokens, $" + (tokens * PRICE_PER_INPUT_TOKEN).toFixed(4) + "\n");

  const dimensions = [...new Set(PAIRS.map((p) => p.dimension))];
  console.log("dimension  | picked the better one | p(better) | both orders agree");
  console.log("-----------|-----------------------|-----------|------------------");
  for (const dimension of dimensions) {
    const rows = trials.filter((t) => t.dimension === dimension);
    const right = rows.filter((t) => t.chosen === t.betterLabel).length;
    const ids = [...new Set(rows.map((t) => t.id))];
    const agreed = ids.filter((id) => {
      const both = rows.filter((t) => t.id === id);
      return both.length === 2 && both.every((t) => t.chosen === t.betterLabel);
    }).length;
    const label = dimension === "control" ? "control*   " : (dimension + "          ").slice(0, 11);
    console.log(label + "| " + pct(right, rows.length) + " (" + right + "/" + rows.length + ")" +
      "           | " + mean(rows.map((t) => t.pBetter)).toFixed(2) + "      | " + agreed + "/" + ids.length);
  }

  const real = trials.filter((t) => t.dimension !== "control");
  console.log("\noverall (excluding controls): " +
    pct(real.filter((t) => t.chosen === t.betterLabel).length, real.length) +
    "   mean p(better) " + mean(real.map((t) => t.pBetter)).toFixed(2));

  const firstLabel = real.filter((t) => t.chosen === "a").length;
  console.log("position: label 'a' chosen " + pct(firstLabel, real.length) + " of the time" +
    " (50% means no order bias)");

  const controls = trials.filter((t) => t.dimension === "control");
  console.log("* controls hold two acceptable answers, so the interesting number is how far from" +
    " 0.50 they land: mean |p - 0.5| = " + mean(controls.map((t) => Math.abs(t.pBetter - 0.5))).toFixed(2) +
    ", mean confidence " + mean(controls.map((t) => t.confidence)).toFixed(2));

  console.log("\npairs where the two orders disagreed, or both went the wrong way:");
  const byId = new Map<string, Trial[]>();
  for (const t of real) byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  let clean = true;
  for (const [id, rows] of byId) {
    const right = rows.filter((t) => t.chosen === t.betterLabel).length;
    if (right === 2) continue;
    clean = false;
    const pair = PAIRS.find((p) => p.id === id) as Pair;
    console.log("  " + id.padEnd(6) + (right === 0 ? "wrong both ways" : "order-dependent") +
      "  p(better) " + rows.map((t) => t.pBetter.toFixed(2)).join(" / ") + "  — " + pair.why);
  }
  if (clean) console.log("  none");

  await mkdir("eval/results", { recursive: true });
  const file = "eval/results/pairs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  await writeFile(file, JSON.stringify({ ranAt: new Date().toISOString(), tokens, trials }, null, 2));
  console.log("\nraw results: " + file);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
