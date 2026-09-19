/**
 * Items whose right answer is known by construction, in C major throughout.
 *
 * Two properties are asked of every phrase: which way it travels, and whether
 * it comes to rest. Direction is arithmetic — if Jev cannot do it, it is not
 * reading the notes at all, and nothing further matters. Cadence is the
 * judgment the app actually depends on.
 *
 * The two are deliberately decorrelated: phrases that rise and close, fall and
 * close, rise and stay open, and so on, all appear. Final durations overlap
 * between the classes too, so length alone cannot decide the cadence.
 */
import { seq, type Note } from "./music.js";

export type Direction = "rising" | "falling" | "level";

export interface PhraseItem {
  id: string;
  notes: Note[];
  direction: Direction;
  ended: boolean;
}

const phrase = (id: string, degrees: number[], finalDur: number, ended: boolean): PhraseItem => {
  const pairs = degrees.map((d, i) => [d, i === degrees.length - 1 ? finalDur : 0.5] as [number, number]);
  const notes = seq(pairs);
  const delta = (degrees.at(-1) as number) - (degrees[0] as number);
  const direction: Direction = delta >= 3 ? "rising" : delta <= -3 ? "falling" : "level";
  if (Math.abs(delta) === 2) throw new Error(id + " has an ambiguous direction");
  return { id, notes, direction, ended };
};

export const PHRASES: PhraseItem[] = [
  // falling, coming to rest on the tonic
  phrase("fc1", [7, 6, 5, 4, 3, 2, 1, 0], 1.5, true),
  phrase("fc2", [4, 3, 2, 1, 0], 1, true),
  phrase("fc3", [7, 5, 4, 2, 0], 2, true),
  phrase("fc4", [9, 7, 5, 4, 2, 0], 1.5, true),
  phrase("fc5", [6, 5, 4, 2, 0], 1, true),

  // rising, coming to rest on the octave
  phrase("rc1", [0, 1, 2, 3, 4, 5, 6, 7], 1.5, true),
  phrase("rc2", [0, 2, 4, 5, 7], 1, true),
  phrase("rc3", [-3, -1, 0, 2, 4, 7], 2, true),
  phrase("rc4", [0, 4, 2, 5, 7], 1.5, true),
  phrase("rc5", [-2, 0, 2, 4, 7], 1, true),

  // going nowhere, but landing
  phrase("lc1", [0, 2, 0, -2, 0], 1.5, true),
  phrase("lc2", [0, 4, 2, 4, 0], 1, true),
  phrase("lc3", [0, -2, -1, 1, 0], 2, true),
  phrase("lc4", [7, 9, 7, 5, 7], 1.5, true),
  phrase("lc5", [0, 2, 4, 2, 0], 1, true),

  // falling, left hanging
  phrase("fo1", [7, 6, 5, 4, 3], 0.5, false),
  phrase("fo2", [7, 5, 3, 1], 1, false),
  phrase("fo3", [6, 4, 2, 1], 0.5, false),
  phrase("fo4", [9, 7, 6, 4, 3], 1, false),
  phrase("fo5", [5, 4, 3, 2, 1], 0.5, false),

  // rising, left hanging
  phrase("ro1", [0, 1, 2, 3, 4, 5, 6], 0.5, false),
  phrase("ro2", [0, 2, 4, 6], 1, false),
  phrase("ro3", [-1, 0, 1, 2, 3], 0.5, false),
  phrase("ro4", [-2, 0, 2, 4, 6], 1, false),
  phrase("ro5", [1, 2, 3, 4, 5, 6], 0.5, false),

  // going nowhere, and not landing
  phrase("lo1", [1, 3, 5, 3, 1], 0.5, false),
  phrase("lo2", [3, 1, 4, 2, 3], 1, false),
  phrase("lo3", [6, 4, 6, 4, 6], 0.5, false),
  phrase("lo4", [1, 0, 2, 1], 1, false),
  phrase("lo5", [3, 5, 3, 5, 3], 0.5, false),
];

// ---------------------------------------------------------------------------
// Ranking: one answer a musician would accept, among five that are degenerate
// ---------------------------------------------------------------------------

export interface RankItem {
  id: string;
  call: Note[];
  candidates: Array<{ id: string; notes: Note[] }>;
  good: string;
}

const BAD: Record<string, (call: Note[]) => Note[]> = {
  /** Every note at once: no rhythm at all. */
  cluster: (call) => call.map((n) => ({ degree: n.degree, beat: 0, dur: 1 })),
  /** One pitch, hammered. */
  stuck: () => seq(Array.from({ length: 8 }, () => [3, 0.5] as [number, number])),
  /** Thrown between extremes of register. */
  leaps: () => seq([[-5, 0.5], [12, 0.5], [-5, 0.5], [12, 0.5], [-5, 0.5], [12, 1]]),
  /** Four times the length of the call, and aimless. */
  runaway: () => seq(Array.from({ length: 16 }, (_, i) => [(i * 5) % 13 - 4, 0.5] as [number, number])),
  /** A single short note, as if nothing was said. */
  fragment: () => seq([[6, 0.5]]),
  /** In the right register, but every interval a leap. */
  scramble: () => seq([[0, 0.5], [9, 0.5], [1, 0.5], [10, 0.5], [2, 0.5], [11, 1]]),
};

const BAD_NAMES = Object.keys(BAD);

const rank = (id: string, call: Note[], good: Note[], rotate: number): RankItem => {
  const bad = BAD_NAMES.slice(rotate % BAD_NAMES.length).concat(BAD_NAMES.slice(0, rotate % BAD_NAMES.length)).slice(0, 5);
  const all = bad.map((name) => (BAD[name] as (c: Note[]) => Note[])(call));
  const goodAt = rotate % 6;                      // move the good answer around, against position bias
  all.splice(goodAt, 0, good);
  return {
    id,
    call,
    candidates: all.map((notes, i) => ({ id: "c" + i, notes })),
    good: "c" + goodAt,
  };
};

export const RANKINGS: RankItem[] = [
  rank("k1", seq([[0, .5], [2, .5], [4, .5], [2, 1]]), seq([[4, .5], [5, .5], [4, .5], [2, 1]]), 0),
  rank("k2", seq([[4, .5], [2, .5], [0, 1]]), seq([[0, .5], [2, .5], [4, 1]]), 1),
  rank("k3", seq([[0, .5], [1, .5], [2, .5], [3, .5], [4, 1]]), seq([[4, .5], [3, .5], [2, .5], [1, .5], [0, 1]]), 2),
  rank("k4", seq([[2, 1], [4, 1], [2, 1]]), seq([[4, 1], [2, 1], [0, 1]]), 3),
  rank("k5", seq([[7, .5], [6, .5], [5, .5], [4, 1]]), seq([[4, .5], [3, .5], [2, .5], [0, 1]]), 4),
  rank("k6", seq([[0, .5], [4, .5], [2, .5], [5, 1]]), seq([[4, .5], [2, .5], [0, .5], [2, 1]]), 5),
  rank("k7", seq([[1, .5], [2, .5], [3, 1]]), seq([[3, .5], [2, .5], [0, 1]]), 0),
  rank("k8", seq([[0, 1], [2, .5], [4, .5], [5, .5], [4, 1]]), seq([[2, 1], [4, .5], [5, .5], [7, 1]]), 1),
  rank("k9", seq([[5, .5], [4, .5], [2, .5], [1, 1]]), seq([[2, .5], [1, .5], [0, 1]]), 2),
  rank("k10", seq([[0, .5], [2, .5], [0, .5], [4, 1]]), seq([[2, .5], [4, .5], [2, .5], [0, 1]]), 3),
  rank("k11", seq([[3, .5], [4, .5], [5, .5], [6, 1]]), seq([[7, .5], [5, .5], [4, .5], [2, 1]]), 4),
  rank("k12", seq([[7, 1], [5, .5], [4, 1]]), seq([[2, 1], [1, .5], [0, 1]]), 5),
];
