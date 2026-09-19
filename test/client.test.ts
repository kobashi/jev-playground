import { choice, noul, score } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJevClient, DEFAULT_MODEL } from "../src/client.js";
import { ConfigError, loadConfig } from "../src/config.js";

const originalEnv = { ...process.env };

/** Capture the request the client sends and reply with a fixed body. */
const stubFetch = (body: unknown) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
};

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "test-key";
  delete process.env.TYPESAFE_BASE_URL;
  delete process.env.TYPESAFE_DEFAULT_MODEL;
  delete process.env.TYPESAFE_LOG_LEVEL;
  delete process.env.JEV_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("rejects a missing API key with an actionable message", () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/TYPESAFE_API_KEY is not set/);
  });

  it("rejects a log level outside the supported set", () => {
    process.env.TYPESAFE_LOG_LEVEL = "verbose";
    expect(() => loadConfig()).toThrow(/expected one of debug, info, warn, error, off/);
  });

  it("rejects a non-positive timeout", () => {
    process.env.JEV_TIMEOUT_MS = "0";
    expect(() => loadConfig()).toThrow(/positive number of milliseconds/);
  });

  it("treats blank optional values as unset", () => {
    process.env.TYPESAFE_BASE_URL = "   ";
    expect(loadConfig().baseURL).toBeUndefined();
  });
});

describe("createJevClient", () => {
  it("posts the state and questions to the System One route with the default model", async () => {
    const { fetch, calls } = stubFetch({
      model: DEFAULT_MODEL,
      answers: {
        category: {
          type: "choice",
          choice: "billing",
          confidence: 0.94,
          probabilities: { billing: 0.94, technical: 0.04, other: 0.02 },
        },
      },
      usage: { input_tokens: 42, output_tokens: 0 },
    });

    const client = createJevClient({ fetch });
    const result = await client.systemOne({
      state: { document: "I was charged twice." },
      questions: {
        category: choice("What is this ticket about?", {
          billing: null,
          technical: null,
          other: null,
        }),
      },
    });

    expect(result.answers.category.choice).toBe("billing");
    expect(result.answers.category.probabilities.billing).toBeCloseTo(0.94);
    expect(result.usage.input_tokens).toBe(42);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call?.init?.method).toBe("POST");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe("Bearer test-key");

    const sent = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe(DEFAULT_MODEL);
    expect(sent.state).toEqual({ document: "I was charged twice." });
    expect(sent.questions).toEqual({
      category: {
        type: "choice",
        instructions: "What is this ticket about?",
        criteria: { billing: null, technical: null, other: null },
      },
    });
  });

  it("honors the model named in the environment", async () => {
    process.env.TYPESAFE_DEFAULT_MODEL = "jev-1";
    const { fetch, calls } = stubFetch({
      model: "jev-1",
      answers: { needs_human: { type: "noul", noul: 0.81 } },
      usage: { input_tokens: 11, output_tokens: 0 },
    });

    const client = createJevClient({ fetch });
    const result = await client.systemOne({
      state: "escalate this",
      questions: { needs_human: noul("Does this need a human?") },
    });

    expect(result.answers.needs_human.noul).toBeCloseTo(0.81);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe("jev-1");
  });

  it("carries a score rubric through as an ordered list", async () => {
    const { fetch, calls } = stubFetch({
      model: DEFAULT_MODEL,
      answers: {
        urgency: {
          type: "score",
          score: 2.4,
          confidence: 0.67,
          legend: { 0: "low", 1: "medium", 2: "high" },
          probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 },
        },
      },
      usage: { input_tokens: 9, output_tokens: 0 },
    });

    const client = createJevClient({ fetch });
    const result = await client.systemOne({
      state: "the server is down",
      questions: { urgency: score("How urgent?", ["low", "medium", "high"]) },
    });

    expect(result.answers.urgency.score).toBeCloseTo(2.4);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.questions).toEqual({
      urgency: { type: "score", instructions: "How urgent?", criteria: ["low", "medium", "high"] },
    });
  });
});
