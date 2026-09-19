/**
 * Load the app's own engine out of the page, so an eval measures the code that
 * actually runs rather than a copy of it.
 *
 * `web/index.html` is one standalone file with its script inline, so there is
 * nothing to import. This slices out everything up to the rendering section —
 * the constants, the generators, the ranker, the pool builder — and evaluates
 * it. Anything below that line touches the DOM and is deliberately left out.
 */
import { readFileSync } from "node:fs";

export interface Note {
  degree: number;
  beat: number;
  dur: number;
}

export interface Candidate {
  id: string;
  strategy: string;
  notes: Note[];
}

export interface Interpretation {
  count: number;
  len: number;
  bars: number;
  range: number;
  density: number;
  dir: "rising" | "falling" | "level";
  closed: boolean;
  lastDeg: number;
}

export interface Ranked {
  itp: Interpretation;
  strat: { pick: string; probs: Record<string, number> };
  cands: Note[][];
  probs: number[];
  idx: number;
  response: Note[];
  source?: string;
}

export interface PageEngine {
  state: { tonic: string; scale: string; bpm: number };
  session: { lastStrategy: string | null };
  STRATEGIES: Record<string, string>;
  SCALES: Record<string, { label: string; steps: number[] }>;
  TONICS: string[];
  interpret(call: Note[]): Interpretation;
  respond(call: Note[]): Ranked;
  candidatePool(call: Note[], itp: Interpretation): Candidate[];
  fromJev(pool: Candidate[], data: unknown, itp: Interpretation): Ranked;
  scaleLen(): number;
  clampDeg(d: number): number;
  phraseLen(ns: Note[]): number;
}

const CUT = "// ---------------------------------------------------------------------------\n// Rendering";

export const loadPageEngine = (pagePath = "web/index.html"): PageEngine => {
  const html = readFileSync(pagePath, "utf8");
  const script = (html.split("<script>\n")[1] ?? "").split("\n</script>")[0] ?? "";
  if (!script) throw new Error("no inline script found in " + pagePath);
  const body = script.slice(0, script.indexOf(CUT)).replace(/^\(\(\) => \{\n/, "");
  if (!body) throw new Error("could not find the rendering boundary in " + pagePath);

  const g = globalThis as Record<string, unknown>;
  g.document ??= { querySelector: () => null, hidden: false };

  const exported =
    "\nreturn { state, session, STRATEGIES, SCALES, TONICS, interpret, respond, " +
    "candidatePool, fromJev, scaleLen, clampDeg, phraseLen };\n";
  return new Function(body + exported)() as PageEngine;
};
