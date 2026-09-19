/**
 * Three ways to hand the same phrase to a model, so the eval can find out
 * whether the encoding changes what Jev hears.
 */

export interface Note {
  degree: number;
  beat: number;
  dur: number;
  [field: string]: number;
}

/** C major, the one key the eval uses, so every note is a natural. */
export const STEPS = [0, 2, 4, 5, 7, 9, 11];
export const TONIC_MIDI = 60;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export const degreeToMidi = (degree: number): number =>
  TONIC_MIDI + Math.floor(degree / STEPS.length) * 12 + (STEPS[mod(degree, STEPS.length)] as number);

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const midiToName = (midi: number): string =>
  (NAMES[mod(midi, 12)] as string) + String(Math.floor(midi / 12) - 1);

const ABC_PITCH = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];

/** ABC pitch: octave 4 is upper case, 5 is lower case, then commas and primes. */
export const midiToAbc = (midi: number): string => {
  const raw = ABC_PITCH[mod(midi, 12)] as string;
  const accidental = raw.length > 1 ? raw.slice(0, -1) : "";
  const letter = raw.slice(-1);
  const octave = Math.floor(midi / 12) - 1;
  if (octave <= 4) return accidental + letter + ",".repeat(4 - octave);
  return accidental + letter.toLowerCase() + "'".repeat(octave - 5);
};

export type Encoding = "degree" | "named" | "abc";

export const ENCODINGS: Encoding[] = ["degree", "named", "abc"];

/** What each encoding needs said about itself, alongside the phrase. */
export const LEGEND: Record<Encoding, string> = {
  degree:
    "A note is a scale degree, a position and a length. degree indexes the scale, 0 is the tonic " +
    "and 7 is the octave above it; negative degrees fall below the tonic. beat and dur are in " +
    "quarter notes, counted from the start of the phrase.",
  named:
    "A note is a pitch name with its octave, a position and a length, for example C4 is middle C. " +
    "beat and dur are in quarter notes, counted from the start of the phrase.",
  abc:
    "The phrase is written in ABC notation. L:1/8 sets the unit note length, so a bare letter is " +
    "an eighth note and a following digit multiplies it. Upper case is the octave from middle C " +
    "up, lower case the octave above that, and a bar line separates measures.",
};

export const encodePhrase = (notes: Note[], encoding: Encoding): unknown => {
  if (encoding === "degree") {
    return notes.map((n) => ({ degree: n.degree, beat: n.beat, dur: n.dur }));
  }
  if (encoding === "named") {
    return notes.map((n) => ({ note: midiToName(degreeToMidi(n.degree)), beat: n.beat, dur: n.dur }));
  }

  const parts: string[] = [];
  let bar = 0;
  for (const n of notes) {
    if (Math.floor(n.beat / 4) > bar) {
      parts.push("|");
      bar = Math.floor(n.beat / 4);
    }
    const eighths = Math.max(1, Math.round(n.dur * 2));
    parts.push(midiToAbc(degreeToMidi(n.degree)) + (eighths === 1 ? "" : String(eighths)));
  }
  return "X:1\nL:1/8\nK:C\n" + parts.join(" ");
};

/** Build a phrase from (degree, duration) pairs, laying them end to end. */
export const seq = (pairs: Array<[number, number]>): Note[] => {
  let beat = 0;
  return pairs.map(([degree, dur]) => {
    const note = { degree, beat, dur };
    beat += dur;
    return note;
  });
};
