import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildQuestions,
  buildState,
  handleRespond,
  LIMITS,
  parseRequest,
  RespondError,
  type Candidate,
  type Note,
} from "../src/respond.js";

const note = (degree: number, beat: number, dur = 0.5): Note => ({ degree, beat, dur });

const body = (over: Record<string, unknown> = {}) => ({
  tonic: "C",
  scale: "major",
  call: [note(0, 0), note(2, 0.5), note(4, 1)],
  candidates: [
    { id: "c0", strategy: "imitate", notes: [note(0, 0), note(2, 0.5)] },
    { id: "c1", strategy: "invert", notes: [note(4, 0), note(2, 0.5)] },
  ] satisfies Candidate[],
  ...over,
});

const stubFetch = (payload: unknown) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
};

describe("parseRequest", () => {
  it("accepts a well-formed request", () => {
    const req = parseRequest(body());
    expect(req.call).toHaveLength(3);
    expect(req.candidates.map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it.each([
    ["a tonic outside the twelve", { tonic: "H" }, /tonic must be one of/],
    ["an unknown scale", { scale: "lydian" }, /scale must be one of/],
    ["an empty call", { call: [] }, /call must be a non-empty array/],
    ["no candidates", { candidates: [] }, /candidates must be a non-empty array/],
  ])("rejects %s", (_label, over, pattern) => {
    expect(() => parseRequest(body(over))).toThrow(pattern);
  });

  it("rejects a call longer than the limit", () => {
    const call = Array.from({ length: LIMITS.callNotes + 1 }, (_, i) => note(0, i * 0.5));
    expect(() => parseRequest(body({ call }))).toThrow(/the limit is 64/);
  });

  it("rejects more candidates than the limit", () => {
    const candidates = Array.from({ length: LIMITS.candidates + 1 }, (_, i) => ({
      id: "c" + i, strategy: "imitate", notes: [note(0, 0)],
    }));
    expect(() => parseRequest(body({ candidates }))).toThrow(/the limit is 24/);
  });

  it("rejects duplicate candidate ids, which would collide as choice labels", () => {
    const candidates = [
      { id: "same", strategy: "imitate", notes: [note(0, 0)] },
      { id: "same", strategy: "invert", notes: [note(4, 0)] },
    ];
    expect(() => parseRequest(body({ candidates }))).toThrow(/duplicate/);
  });

  it("rejects a candidate id that is not label-safe", () => {
    const candidates = [{ id: "a b", strategy: "imitate", notes: [note(0, 0)] }];
    expect(() => parseRequest(body({ candidates }))).toThrow(/must be 1-16 characters/);
  });

  it.each([
    ["a non-integer degree", { degree: 1.5, beat: 0, dur: 1 }],
    ["a degree out of range", { degree: 99, beat: 0, dur: 1 }],
    ["a negative beat", { degree: 0, beat: -1, dur: 1 }],
    ["a zero duration", { degree: 0, beat: 0, dur: 0 }],
    ["an infinite beat", { degree: 0, beat: Infinity, dur: 1 }],
  ])("rejects %s", (_label, bad) => {
    expect(() => parseRequest(body({ call: [bad] }))).toThrow(/outside the allowed ranges/);
  });

  it("rejects a body that is not an object", () => {
    expect(() => parseRequest("nope")).toThrow(RespondError);
  });
});

describe("buildQuestions", () => {
  it("asks only for judgments, with every candidate as a choice label", () => {
    const q = buildQuestions(parseRequest(body()));
    expect(Object.keys(q).sort()).toEqual(["all_broken", "best", "ended", "feel"]);
    expect(q.best?.type).toBe("choice");
    expect(Object.keys((q.best as { criteria: object }).criteria)).toEqual(["c0", "c1"]);
    expect(q.ended?.type).toBe("noul");
    expect(q.all_broken?.type).toBe("noul");
  });

  it("carries each candidate through as pitch names, not scale degrees", () => {
    const q = buildQuestions(parseRequest(body()));
    const criteria = (q.best as unknown as { criteria: Record<string, Array<{ note: string }>> }).criteria;
    expect(criteria.c1).toEqual([
      { note: "G4", beat: 0, dur: 0.5 },
      { note: "E4", beat: 0.5, dur: 0.5 },
    ]);
  });

  it("does not ask for anything the client can count for itself", () => {
    const q = buildQuestions(parseRequest(body()));
    for (const banned of ["count", "range", "density", "length", "contour"]) {
      expect(Object.keys(q)).not.toContain(banned);
    }
  });
});

describe("buildState", () => {
  it("spells out the notation next to the phrase", () => {
    const state = buildState(parseRequest(body()));
    expect(state.key).toBe("C major");
    expect(state.notation).toMatch(/C4 is middle C/);
    expect(state.call).toEqual([
      { note: "C4", beat: 0, dur: 0.5 },
      { note: "E4", beat: 0.5, dur: 0.5 },
      { note: "G4", beat: 1, dur: 0.5 },
    ]);
  });

  it("names the octave above the tonic as the tonic, which degree 7 hid", () => {
    const state = buildState(parseRequest(body({ call: [note(7, 0, 1)] })));
    expect(state.call[0]?.note).toBe("C5");
  });

  it("follows the key and the scale", () => {
    const minor = buildState(parseRequest(body({ tonic: "A", scale: "minor", call: [note(2, 0, 1)] })));
    expect(minor.call[0]?.note).toBe("C5");
    const blues = buildState(parseRequest(body({ tonic: "C", scale: "blues", call: [note(3, 0, 1)] })));
    expect(blues.call[0]?.note).toBe("F#4");
  });
});

describe("handleRespond", () => {
  it("sends one System One request and returns the answers", async () => {
    const { fetch, calls } = stubFetch({
      model: "jev-latest",
      answers: {
        ended: { type: "noul", noul: 0.82 },
        feel: { type: "choice", choice: "straight", confidence: 0.7, probabilities: { straight: 0.7, swung: 0.1, sparse: 0.1, busy: 0.1 } },
        best: { type: "choice", choice: "c1", confidence: 0.61, probabilities: { c0: 0.39, c1: 0.61 } },
        all_broken: { type: "noul", noul: 0.04 },
      },
      usage: { input_tokens: 310, output_tokens: 0 },
    });

    const client = new TypeSafeClient({ apiKey: "test-key", fetch });
    const result = await handleRespond(client, body());

    expect(result.model).toBe("jev-latest");
    expect(result.usage.input_tokens).toBe(310);
    expect((result.answers.best as { choice: string }).choice).toBe("c1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, any>;
    expect(sent.state.key).toBe("C major");
    expect(Object.keys(sent.questions).sort()).toEqual(["all_broken", "best", "ended", "feel"]);
    expect(Object.keys(sent.questions.best.criteria)).toEqual(["c0", "c1"]);
  });

  it("rejects a bad request before spending a call", async () => {
    const { fetch, calls } = stubFetch({});
    const client = new TypeSafeClient({ apiKey: "test-key", fetch });
    await expect(handleRespond(client, body({ scale: "lydian" }))).rejects.toThrow(RespondError);
    expect(calls).toHaveLength(0);
  });
});
