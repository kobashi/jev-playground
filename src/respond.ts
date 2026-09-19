/**
 * The Jev half of the jam: it judges, it never generates.
 *
 * The browser builds a pool of candidate answers locally and posts them here.
 * This module turns one pool into one `systemOne` request, so a turn costs a
 * single round trip. Arithmetic the client can do for itself — note counts,
 * range, contour — is deliberately not asked; only judgments are.
 */
import { choice, noul, type Questions } from "@typesafe-ai/sdk";
import type { SystemOneCaller } from "./proxy-client.js";

/** A note as the app models it: a scale degree, and a position and length in beats. */
export interface Note {
  degree: number;
  beat: number;
  dur: number;
  /** Every field is a number, which is what makes a note a plain JSON value. */
  [field: string]: number;
}

/** One candidate answer, tagged with the strategy that produced it. */
export interface Candidate {
  id: string;
  strategy: string;
  notes: Note[];
}

export interface RespondRequest {
  call: Note[];
  candidates: Candidate[];
  tonic: string;
  scale: string;
}

export interface RespondResult {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

/** A rejected request, carrying the status the endpoint should return. */
export class RespondError extends Error {
  override name = "RespondError";
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const SCALES = ["major", "minor", "dorian", "mixolydian", "pentatonic", "blues"];

/** Bounds that keep one request small enough to stay cheap and quick. */
export const LIMITS = {
  callNotes: 64,
  candidates: 24,
  candidateNotes: 64,
  idLength: 16,
  degree: 24,
  beat: 64,
  dur: 32,
};

const isNote = (v: unknown): v is Note => {
  if (!v || typeof v !== "object") return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.degree === "number" && Number.isInteger(n.degree) && Math.abs(n.degree) <= LIMITS.degree &&
    typeof n.beat === "number" && Number.isFinite(n.beat) && n.beat >= 0 && n.beat <= LIMITS.beat &&
    typeof n.dur === "number" && Number.isFinite(n.dur) && n.dur > 0 && n.dur <= LIMITS.dur
  );
};

const notes = (v: unknown, max: number, where: string): Note[] => {
  if (!Array.isArray(v) || v.length < 1) throw new RespondError(where + " must be a non-empty array of notes.");
  if (v.length > max) throw new RespondError(where + " holds " + v.length + " notes; the limit is " + max + ".");
  for (const n of v) if (!isNote(n)) throw new RespondError(where + " contains a note outside the allowed ranges.");
  return v as Note[];
};

/** Reject anything the endpoint should not spend a Jev call on. */
export const parseRequest = (body: unknown): RespondRequest => {
  if (!body || typeof body !== "object") throw new RespondError("The request body must be a JSON object.");
  const b = body as Record<string, unknown>;

  if (typeof b.tonic !== "string" || !TONICS.includes(b.tonic)) {
    throw new RespondError("tonic must be one of " + TONICS.join(", ") + ".");
  }
  if (typeof b.scale !== "string" || !SCALES.includes(b.scale)) {
    throw new RespondError("scale must be one of " + SCALES.join(", ") + ".");
  }

  const call = notes(b.call, LIMITS.callNotes, "call");

  if (!Array.isArray(b.candidates) || b.candidates.length < 1) {
    throw new RespondError("candidates must be a non-empty array.");
  }
  if (b.candidates.length > LIMITS.candidates) {
    throw new RespondError("candidates holds " + b.candidates.length + "; the limit is " + LIMITS.candidates + ".");
  }

  const seen = new Set<string>();
  const candidates = b.candidates.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new RespondError("candidates[" + i + "] must be an object.");
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || !/^[A-Za-z0-9_-]{1,16}$/.test(c.id)) {
      throw new RespondError("candidates[" + i + "].id must be 1-16 characters of A-Z, a-z, 0-9, _ or -.");
    }
    if (seen.has(c.id)) throw new RespondError("candidates[" + i + "].id is a duplicate: " + c.id);
    seen.add(c.id);
    if (typeof c.strategy !== "string" || c.strategy.length > 32) {
      throw new RespondError("candidates[" + i + "].strategy must be a short string.");
    }
    return { id: c.id, strategy: c.strategy, notes: notes(c.notes, LIMITS.candidateNotes, "candidates[" + i + "].notes") };
  });

  return { call, candidates, tonic: b.tonic, scale: b.scale };
};

/**
 * Ask only what counts as a judgment. Whether a phrase came to rest and which
 * answer is the most musical are judgments; how many notes it holds is not.
 */
export const buildQuestions = (req: RespondRequest): Questions => {
  const criteria: Record<string, Note[]> = {};
  for (const c of req.candidates) criteria[c.id] = c.notes;

  return {
    ended: noul("Has the call come to rest, or is it left hanging?", {
      true: "It lands. The player has finished and is waiting to be answered.",
      false: "It is left open, mid-thought, and wants to continue.",
    }),
    feel: choice("What is the rhythmic character of the call?", {
      straight: "Even subdivisions, squarely on the grid.",
      swung: "Uneven, long-short eighths.",
      sparse: "Few notes, a lot of space between them.",
      busy: "Dense and driving, little space.",
    }),
    best: choice(
      "Which candidate is the most musical answer to this call? Judge it as one half of a two-part conversation: the answer should relate to what the call did, not merely avoid mistakes.",
      criteria,
    ),
    all_broken: noul("Are all of these candidates broken as answers to this call?", {
      true: "None of them relate to the call or hold the key.",
      false: "At least one of them works.",
    }),
  };
};

/** The state block Jev reads, with the notation spelled out alongside it. */
export const buildState = (req: RespondRequest) => ({
  key: req.tonic + " " + req.scale,
  notation:
    "A note is a scale degree, a position and a length. degree indexes the scale, 0 is the tonic " +
    "and 7 is the octave above it; negative degrees fall below the tonic. beat and dur are in " +
    "quarter notes, counted from the start of the phrase.",
  call: req.call,
});

/** Validate, ask Jev once, and hand back the raw answers. */
export const handleRespond = async (
  client: SystemOneCaller,
  body: unknown,
): Promise<RespondResult> => {
  const req = parseRequest(body);
  const result = await client.systemOne({
    state: buildState(req),
    questions: buildQuestions(req),
  });

  return {
    model: result.model,
    answers: result.answers as Record<string, unknown>,
    usage: result.usage,
  };
};
