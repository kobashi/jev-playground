/**
 * Two plausible answers, differing in exactly one musical principle.
 *
 * "Which answer is better" has no ground truth in general, so none is claimed.
 * Each pair instead isolates one thing a musician would not argue about — a
 * note outside the key, an answer three times too long, a phrase that ignores
 * the beat — and holds register, length, rhythm and contour as close to equal
 * as the comparison allows. Per-dimension accuracy then says which properties
 * Jev is sensitive to, and which it is blind to.
 *
 * Pitch names throughout, because the first eval showed that is what Jev reads
 * best, and because a chromatic note cannot be written as a scale degree.
 */

export interface NamedNote {
  note: string;
  beat: number;
  dur: number;
  [field: string]: string | number;
}

/** `[name, duration]` laid end to end, or `[name, duration, beat]` placed exactly. */
type Spec = Array<[string, number] | [string, number, number]>;

const ph = (spec: Spec): NamedNote[] => {
  let cursor = 0;
  return spec.map((entry) => {
    const [note, dur, beat] = entry as [string, number, number | undefined];
    const at = beat ?? cursor;
    cursor = at + dur;
    return { note, beat: at, dur };
  });
};

export type Dimension =
  | "in-key"
  | "resolution"
  | "register"
  | "length"
  | "motif"
  | "stepwise"
  | "on-grid"
  | "control";

export interface Pair {
  id: string;
  dimension: Dimension;
  call: NamedNote[];
  better: NamedNote[];
  worse: NamedNote[];
  why: string;
}

export const PAIRS: Pair[] = [
  // one note outside the key, everything else identical
  { id: "key1", dimension: "in-key", why: "F#4 is not in C major",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["G4", .5], ["F#4", .5], ["E4", .5], ["C4", 1]]) },
  { id: "key2", dimension: "in-key", why: "Eb4 is not in C major",
    call: ph([["E4", .5], ["G4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1]]),
    worse: ph([["F4", .5], ["D#4", .5], ["D4", .5], ["C4", 1]]) },
  { id: "key3", dimension: "in-key", why: "Bb4 is not in C major",
    call: ph([["C4", .5], ["E4", .5], ["G4", .5], ["C5", 1]]),
    better: ph([["B4", .5], ["A4", .5], ["G4", .5], ["E4", 1]]),
    worse: ph([["A#4", .5], ["A4", .5], ["G4", .5], ["E4", 1]]) },
  { id: "key4", dimension: "in-key", why: "Ab4 is not in C major",
    call: ph([["G4", .5], ["A4", .5], ["B4", .5], ["C5", 1]]),
    better: ph([["C5", .5], ["B4", .5], ["A4", .5], ["G4", 1]]),
    worse: ph([["C5", .5], ["B4", .5], ["G#4", .5], ["G4", 1]]) },

  // the call has landed, so the answer should land too
  { id: "res1", dimension: "resolution", why: "answers a closed call by stopping on the supertonic",
    call: ph([["G4", .5], ["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1.5]]),
    better: ph([["E4", .5], ["F4", .5], ["G4", .5], ["E4", .5], ["C4", 1.5]]),
    worse: ph([["E4", .5], ["F4", .5], ["G4", .5], ["E4", .5], ["D4", 1.5]]) },
  { id: "res2", dimension: "resolution", why: "stops on the leading tone instead of resolving",
    call: ph([["A4", .5], ["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1.5]]),
    better: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", .5], ["C5", 1.5]]),
    worse: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", .5], ["B4", 1.5]]) },
  { id: "res3", dimension: "resolution", why: "ends a beat away from the tonic it was heading for",
    call: ph([["E4", .5], ["D4", .5], ["C4", 1.5]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1.5]]),
    worse: ph([["G4", .5], ["F4", .5], ["E4", .5], ["F4", 1.5]]) },
  { id: "res4", dimension: "resolution", why: "ends on the supertonic above",
    call: ph([["C5", .5], ["G4", .5], ["E4", .5], ["C4", 1.5]]),
    better: ph([["E4", .5], ["G4", .5], ["A4", .5], ["G4", .5], ["C5", 1.5]]),
    worse: ph([["E4", .5], ["G4", .5], ["A4", .5], ["G4", .5], ["D5", 1.5]]) },

  // the same phrase, two octaves from where the call left off
  { id: "reg1", dimension: "register", why: "the same answer two octaves below the call",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["A4", .5], ["G4", .5], ["F4", .5], ["E4", 1]]),
    worse: ph([["A2", .5], ["G2", .5], ["F2", .5], ["E2", 1]]) },
  { id: "reg2", dimension: "register", why: "the same answer two octaves above the call",
    call: ph([["G4", .5], ["A4", .5], ["B4", .5], ["C5", 1]]),
    better: ph([["B4", .5], ["A4", .5], ["G4", .5], ["E4", 1]]),
    worse: ph([["B6", .5], ["A6", .5], ["G6", .5], ["E6", 1]]) },
  { id: "reg3", dimension: "register", why: "drops two octaves for no reason",
    call: ph([["E4", .5], ["F4", .5], ["G4", .5], ["A4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["D4", 1]]),
    worse: ph([["G2", .5], ["F2", .5], ["E2", .5], ["D2", 1]]) },
  { id: "reg4", dimension: "register", why: "jumps two octaves up for no reason",
    call: ph([["C5", .5], ["B4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1]]),
    worse: ph([["F6", .5], ["E6", .5], ["D6", .5], ["C6", 1]]) },

  // the answer, verbatim, two to four times over: only the length differs
  { id: "len1", dimension: "length", why: "the same answer three times over",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", .5], ["G4", .5], ["F4", .5],
               ["E4", .5], ["C4", .5], ["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]) },
  { id: "len2", dimension: "length", why: "the same answer three times over",
    call: ph([["E4", .5], ["G4", .5], ["C5", 1]]),
    better: ph([["C5", .5], ["G4", .5], ["E4", 1]]),
    worse: ph([["C5", .5], ["G4", .5], ["E4", .5], ["C5", .5], ["G4", .5], ["E4", .5],
               ["C5", .5], ["G4", .5], ["E4", 1]]) },
  { id: "len3", dimension: "length", why: "the same answer four times over",
    call: ph([["G4", .5], ["F4", .5], ["E4", 1]]),
    better: ph([["E4", .5], ["F4", .5], ["G4", 1]]),
    worse: ph([["E4", .5], ["F4", .5], ["G4", .5], ["E4", .5], ["F4", .5], ["G4", .5],
               ["E4", .5], ["F4", .5], ["G4", .5], ["E4", .5], ["F4", .5], ["G4", 1]]) },
  { id: "len4", dimension: "length", why: "the same answer three times over",
    call: ph([["C4", 1], ["E4", 1]]),
    better: ph([["G4", 1], ["E4", 1]]),
    worse: ph([["G4", 1], ["E4", 1], ["G4", 1], ["E4", 1], ["G4", 1], ["E4", 1]]) },
  { id: "len5", dimension: "length", why: "the same answer twice over",
    call: ph([["A4", .5], ["G4", .5], ["F4", 1]]),
    better: ph([["F4", .5], ["G4", .5], ["A4", 1]]),
    worse: ph([["F4", .5], ["G4", .5], ["A4", .5], ["F4", .5], ["G4", .5], ["A4", 1]]) },
  { id: "len6", dimension: "length", why: "the same answer four times over",
    call: ph([["D4", .5], ["E4", .5], ["F4", .5], ["E4", 1]]),
    better: ph([["B4", .5], ["A4", .5], ["G4", .5], ["A4", 1]]),
    worse: ph([["B4", .5], ["A4", .5], ["G4", .5], ["A4", .5], ["B4", .5], ["A4", .5],
               ["G4", .5], ["A4", .5], ["B4", .5], ["A4", .5], ["G4", .5], ["A4", .5],
               ["B4", .5], ["A4", .5], ["G4", .5], ["A4", 1]]) },

  // Same interval sizes in both answers, in the same order of magnitude and
  // register: only whether the contour echoes the call's shape differs. The
  // first version of this dimension let the unrelated answer be a smooth
  // stepwise line, which Jev independently prefers, so it measured nothing.
  { id: "mot1", dimension: "motif", why: "same intervals, contour does not echo the call",
    call: ph([["C4", .5], ["E4", .5], ["D4", .5], ["F4", 1]]),
    better: ph([["E4", .5], ["G4", .5], ["F4", .5], ["A4", 1]]),
    worse: ph([["E4", .5], ["G4", .5], ["A4", .5], ["F4", 1]]) },
  { id: "mot2", dimension: "motif", why: "same intervals, the turn figure is gone",
    call: ph([["G4", .5], ["F4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["E4", .5], ["D4", .5], ["F4", .5], ["E4", 1]]),
    worse: ph([["E4", .5], ["D4", .5], ["C4", .5], ["E4", 1]]) },
  { id: "mot3", dimension: "motif", why: "same intervals, the repeated-note opening is gone",
    call: ph([["C4", .5], ["C4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["D4", .5], ["D4", .5], ["F4", .5], ["A4", 1]]),
    worse: ph([["D4", .5], ["F4", .5], ["A4", .5], ["A4", 1]]) },
  { id: "mot4", dimension: "motif", why: "same steps, the neighbour figure is gone",
    call: ph([["E4", .5], ["D4", .5], ["C4", .5], ["D4", 1]]),
    better: ph([["A4", .5], ["G4", .5], ["F4", .5], ["G4", 1]]),
    worse: ph([["A4", .5], ["G4", .5], ["A4", .5], ["B4", 1]]) },
  { id: "mot5", dimension: "motif", why: "same intervals, reordered so the shape is lost",
    call: ph([["C4", .5], ["G4", .5], ["E4", .5], ["F4", 1]]),
    better: ph([["D4", .5], ["A4", .5], ["F4", .5], ["G4", 1]]),
    worse: ph([["D4", .5], ["E4", .5], ["B4", .5], ["G4", 1]]) },
  { id: "mot6", dimension: "motif", why: "same intervals, the rise-then-fall is inverted away",
    call: ph([["E4", .5], ["F4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["A4", .5], ["C5", .5], ["B4", 1]]),
    worse: ph([["G4", .5], ["F4", .5], ["A4", .5], ["B4", 1]]) },

  // every interval a leap, in the same register and to the same length
  { id: "step1", dimension: "stepwise", why: "all sixths where the call moved by step",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["F4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["C4", .5], ["A4", .5], ["D4", .5], ["B4", 1]]) },
  { id: "step2", dimension: "stepwise", why: "jagged leaps against a stepwise call",
    call: ph([["G4", .5], ["A4", .5], ["B4", .5], ["C5", 1]]),
    better: ph([["B4", .5], ["A4", .5], ["G4", .5], ["E4", 1]]),
    worse: ph([["B4", .5], ["D4", .5], ["A4", .5], ["C4", 1]]) },
  { id: "step3", dimension: "stepwise", why: "leaps in both directions with no line",
    call: ph([["E4", .5], ["F4", .5], ["G4", .5], ["A4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["D4", 1]]),
    worse: ph([["A4", .5], ["C4", .5], ["G4", .5], ["D4", 1]]) },
  { id: "step4", dimension: "stepwise", why: "a saw-tooth instead of a line",
    call: ph([["C5", .5], ["B4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1]]),
    worse: ph([["F4", .5], ["D5", .5], ["E4", .5], ["C5", 1]]) },

  // the same notes, placed off the beat
  { id: "grid1", dimension: "on-grid", why: "the same notes, none of them on a beat",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["G4", .5, 0], ["F4", .5, 0.35], ["E4", .5, 0.9], ["C4", 1, 1.4]]) },
  { id: "grid2", dimension: "on-grid", why: "drifts away from the pulse",
    call: ph([["E4", .5], ["G4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1]]),
    worse: ph([["F4", .5, 0], ["E4", .5, 0.42], ["D4", .5, 1.07], ["C4", 1, 1.63]]) },
  { id: "grid3", dimension: "on-grid", why: "lands between the beats throughout",
    call: ph([["G4", .5], ["F4", .5], ["E4", 1]]),
    better: ph([["E4", .5], ["F4", .5], ["G4", 1]]),
    worse: ph([["E4", .5, 0.13], ["F4", .5, 0.68], ["G4", 1, 1.21]]) },
  { id: "grid4", dimension: "on-grid", why: "no note falls on a beat",
    call: ph([["C4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["G4", .5, 0.27], ["E4", .5, 0.81], ["C4", 1, 1.33]]) },

  // both answers are fine: a confident pick here is a pick on noise
  { id: "ctl1", dimension: "control", why: "both land on a chord tone, both stepwise",
    call: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    better: ph([["G4", .5], ["F4", .5], ["E4", .5], ["C4", 1]]),
    worse: ph([["G4", .5], ["A4", .5], ["G4", .5], ["E4", 1]]) },
  { id: "ctl2", dimension: "control", why: "two equally ordinary descents",
    call: ph([["E4", .5], ["G4", .5], ["A4", .5], ["G4", 1]]),
    better: ph([["F4", .5], ["E4", .5], ["D4", .5], ["C4", 1]]),
    worse: ph([["A4", .5], ["G4", .5], ["F4", .5], ["E4", 1]]) },
  { id: "ctl3", dimension: "control", why: "rise or fall, both answer the call",
    call: ph([["G4", .5], ["F4", .5], ["E4", .5], ["D4", 1]]),
    better: ph([["C4", .5], ["D4", .5], ["E4", .5], ["G4", 1]]),
    worse: ph([["E4", .5], ["D4", .5], ["C4", .5], ["E4", 1]]) },
  { id: "ctl4", dimension: "control", why: "both take up the arpeggio",
    call: ph([["C4", .5], ["E4", .5], ["G4", .5], ["E4", 1]]),
    better: ph([["D4", .5], ["F4", .5], ["A4", .5], ["F4", 1]]),
    worse: ph([["G4", .5], ["E4", .5], ["C4", .5], ["E4", 1]]) },
];
