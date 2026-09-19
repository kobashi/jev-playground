/**
 * Does Jev read symbolic music, and does the encoding change the answer?
 *
 * Three encodings, two tasks. Direction is the control: it is arithmetic, so a
 * model that cannot do it is not reading the notes. Cadence and ranking are the
 * judgments the app leans on.
 *
 * Run with `npm run eval`. Every request is billable; the whole sweep is a
 * fraction of a cent.
 */
import { choice, noul } from "@typesafe-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { createCaller, type SystemOneCaller } from "../src/proxy-client.js";
import { PHRASES, RANKINGS, type Direction } from "./dataset.js";
import { encodePhrase, ENCODINGS, LEGEND, type Encoding } from "./music.js";

const CONCURRENCY = 4;
const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000;

interface PhraseResult {
  kind: "phrase";
  encoding: Encoding;
  id: string;
  expectedDirection: Direction;
  gotDirection: string;
  directionConfidence: number;
  expectedEnded: boolean;
  endedProbability: number;
  inputTokens: number;
}

interface RankResult {
  kind: "rank";
  encoding: Encoding;
  id: string;
  expected: string;
  got: string;
  goodProbability: number;
  allBroken: number;
  inputTokens: number;
}

type Result = PhraseResult | RankResult;

const runPool = async <T>(jobs: Array<() => Promise<T>>, width: number): Promise<T[]> => {
  const out = new Array<T>(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(width, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await (jobs[i] as () => Promise<T>)();
      process.stdout.write(".");
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return out;
};

/** One retry, because a single dropped connection should not void the sweep. */
const withRetry = async <T>(job: () => Promise<T>): Promise<T> => {
  try {
    return await job();
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    return await job();
  }
};

const phraseJob = (client: SystemOneCaller, encoding: Encoding, item: (typeof PHRASES)[number]) =>
  withRetry(async (): Promise<PhraseResult> => {
    const { answers, usage } = await client.systemOne({
      state: {
        key: "C major",
        notation: LEGEND[encoding],
        phrase: encodePhrase(item.notes, encoding),
      },
      questions: {
        direction: choice("Overall, where does this phrase travel between its first note and its last?", {
          rising: "It ends clearly higher than it began.",
          falling: "It ends clearly lower than it began.",
          level: "It ends at about the height it began.",
        }),
        ended: noul("Has the phrase come to rest, or is it left hanging?", {
          true: "It lands. It sounds finished and invites an answer.",
          false: "It is left open, mid-thought, and wants to continue.",
        }),
      },
    });
    return {
      kind: "phrase",
      encoding,
      id: item.id,
      expectedDirection: item.direction,
      gotDirection: answers.direction.choice,
      directionConfidence: answers.direction.confidence,
      expectedEnded: item.ended,
      endedProbability: answers.ended.noul,
      inputTokens: usage.input_tokens,
    };
  });

const rankJob = (client: SystemOneCaller, encoding: Encoding, item: (typeof RANKINGS)[number]) =>
  withRetry(async (): Promise<RankResult> => {
    const criteria: Record<string, unknown> = {};
    for (const c of item.candidates) criteria[c.id] = encodePhrase(c.notes, encoding);

    const { answers, usage } = await client.systemOne({
      state: {
        key: "C major",
        notation: LEGEND[encoding],
        call: encodePhrase(item.call, encoding),
      },
      questions: {
        best: choice(
          "Which candidate is the most musical answer to this call? Judge it as one half of a " +
            "two-part conversation: the answer should relate to what the call did, stay in the key, " +
            "and be playable as a phrase.",
          criteria as Record<string, never>,
        ),
        all_broken: noul("Are all of these candidates broken as answers to this call?", {
          true: "None of them work as a musical answer.",
          false: "At least one of them works.",
        }),
      },
    });
    const probabilities = answers.best.probabilities as Record<string, number>;
    return {
      kind: "rank",
      encoding,
      id: item.id,
      expected: item.good,
      got: answers.best.choice,
      goodProbability: probabilities[item.good] ?? 0,
      allBroken: answers.all_broken.noul,
      inputTokens: usage.input_tokens,
    };
  });

const pct = (n: number, d: number) => (d === 0 ? "—" : ((n / d) * 100).toFixed(0).padStart(3) + "%");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const main = async (): Promise<void> => {
  const { client, mode } = createCaller();
  console.log("auth: " + mode);
  console.log(
    ENCODINGS.length + " encodings x (" + PHRASES.length + " phrases + " + RANKINGS.length + " rankings) = " +
    ENCODINGS.length * (PHRASES.length + RANKINGS.length) + " requests",
  );

  const jobs: Array<() => Promise<Result>> = [];
  for (const encoding of ENCODINGS) {
    for (const item of PHRASES) jobs.push(() => phraseJob(client, encoding, item));
    for (const item of RANKINGS) jobs.push(() => rankJob(client, encoding, item));
  }

  const startedAt = Date.now();
  const results = await runPool(jobs, CONCURRENCY);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  const tokens = results.reduce((sum, r) => sum + r.inputTokens, 0);
  console.log("\n" + results.length + " requests in " + seconds + "s, " +
    tokens.toLocaleString() + " input tokens, $" + (tokens * PRICE_PER_INPUT_TOKEN).toFixed(4) + "\n");

  console.log("encoding | direction | cadence | separation      | ranking | p(good) | all_broken");
  console.log("---------|-----------|---------|-----------------|---------|---------|-----------");
  for (const encoding of ENCODINGS) {
    const phrases = results.filter((r): r is PhraseResult => r.kind === "phrase" && r.encoding === encoding);
    const ranks = results.filter((r): r is RankResult => r.kind === "rank" && r.encoding === encoding);

    const dirOk = phrases.filter((r) => r.gotDirection === r.expectedDirection).length;
    const endOk = phrases.filter((r) => (r.endedProbability >= 0.5) === r.expectedEnded).length;
    const closed = mean(phrases.filter((r) => r.expectedEnded).map((r) => r.endedProbability));
    const open = mean(phrases.filter((r) => !r.expectedEnded).map((r) => r.endedProbability));
    const rankOk = ranks.filter((r) => r.got === r.expected).length;

    console.log(
      encoding.padEnd(8) + " | " + pct(dirOk, phrases.length) + "      | " + pct(endOk, phrases.length) +
      "    | " + closed.toFixed(2) + " vs " + open.toFixed(2) + "    | " + pct(rankOk, ranks.length) +
      "    | " + mean(ranks.map((r) => r.goodProbability)).toFixed(2) + "    | " +
      mean(ranks.map((r) => r.allBroken)).toFixed(2),
    );
  }

  console.log("\ndirection errors by expected class:");
  for (const encoding of ENCODINGS) {
    const wrong = results.filter(
      (r): r is PhraseResult => r.kind === "phrase" && r.encoding === encoding && r.gotDirection !== r.expectedDirection,
    );
    console.log("  " + encoding.padEnd(7) + (wrong.length
      ? wrong.map((r) => r.id + " " + r.expectedDirection + "->" + r.gotDirection).join(", ")
      : "none"));
  }

  console.log("\ncadence errors (expected / p(ended)):");
  for (const encoding of ENCODINGS) {
    const wrong = results.filter(
      (r): r is PhraseResult => r.kind === "phrase" && r.encoding === encoding && (r.endedProbability >= 0.5) !== r.expectedEnded,
    );
    console.log("  " + encoding.padEnd(7) + (wrong.length
      ? wrong.map((r) => r.id + " " + (r.expectedEnded ? "closed" : "open") + "/" + r.endedProbability.toFixed(2)).join(", ")
      : "none"));
  }

  await mkdir("eval/results", { recursive: true });
  const file = "eval/results/" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  await writeFile(file, JSON.stringify({ ranAt: new Date().toISOString(), tokens, results }, null, 2));
  console.log("\nraw results: " + file);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
