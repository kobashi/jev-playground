import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SystemOneCaller } from "../src/proxy-client.js";
import { createApp } from "../src/server.js";

const answers = {
  model: "jev-latest",
  answers: {
    ended: { type: "noul", noul: 0.8 },
    feel: { type: "choice", choice: "straight", confidence: 0.6, probabilities: { straight: 0.6, swung: 0.2, sparse: 0.1, busy: 0.1 } },
    best: { type: "choice", choice: "c1", confidence: 0.6, probabilities: { c0: 0.4, c1: 0.6 } },
    all_broken: { type: "noul", noul: 0.02 },
  },
  usage: { input_tokens: 200, output_tokens: 0 },
};

const seen: Array<{ state: unknown; questions: Questions }> = [];
let failNext: Error | null = null;

const client: SystemOneCaller = {
  async systemOne<Q extends Questions>(req: { state: unknown; questions: Q }) {
    seen.push(req);
    if (failNext) { const err = failNext; failNext = null; throw err; }
    return answers as unknown as SystemOneResult<Q>;
  },
};

const body = {
  tonic: "C",
  scale: "major",
  call: [{ degree: 0, beat: 0, dur: 0.5 }],
  candidates: [
    { id: "c0", strategy: "imitate", notes: [{ degree: 0, beat: 0, dur: 0.5 }] },
    { id: "c1", strategy: "invert", notes: [{ degree: 4, beat: 0, dur: 0.5 }] },
  ],
};

let base = "";
const server = createApp(client, "web");

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done())));
});

const post = (payload: unknown, path = "/api/respond") =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

describe("the local server", () => {
  it("answers a well-formed request and passes the phrase through", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { answers: { best: { choice: string } }; usage: { input_tokens: number } };
    expect(json.answers.best.choice).toBe("c1");
    expect(json.usage.input_tokens).toBe(200);
    expect((seen.at(-1)?.state as { key: string }).key).toBe("C major");
  });

  it("rejects a bad payload with its own status, not a 502", async () => {
    const res = await post({ ...body, scale: "lydian" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/scale must be one of/);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/not valid JSON/);
  });

  it("refuses anything but POST on the endpoint", async () => {
    const res = await fetch(base + "/api/respond");
    expect(res.status).toBe(405);
  });

  it("serves the page at the root", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/<title>Trade Fours<\/title>/);
  });

  it("does not serve files outside the web root", async () => {
    const res = await fetch(base + "/../package.json");
    expect([403, 404]).toContain(res.status);
    expect(await res.text()).not.toMatch(/jev-playground/);
  });

  it("turns an upstream failure into a 502 rather than a crash", async () => {
    failNext = new Error("upstream exploded");
    const res = await post(body);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/upstream exploded/);
  });
});
