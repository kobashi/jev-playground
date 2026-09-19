import type { Questions } from "@typesafe-ai/sdk";
import { noul } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaller, createProxyClient, ProxyCallError } from "../src/proxy-client.js";

const originalEnv = { ...process.env };

const reply = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

const answer = {
  model: "jev-latest",
  answers: { ok: { type: "noul", noul: 0.7 } },
  usage: { input_tokens: 12, output_tokens: 0 },
};

const questions = { ok: noul("Is it so?") } satisfies Questions;

beforeEach(() => {
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_BASE_URL;
  delete process.env.TYPESAFE_DEFAULT_MODEL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("createProxyClient", () => {
  it("sends no Authorization header, because the proxy supplies it", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply(answer);
    });

    await createProxyClient({ fetch }).systemOne({ state: "x", questions });

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("posts to the System One route with the model resolved", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return reply(answer);
    });

    const result = await createProxyClient({ fetch }).systemOne({ state: { a: 1 }, questions });

    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.init?.method).toBe("POST");
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe("jev-latest");
    expect(sent.state).toEqual({ a: 1 });
    expect(result.answers.ok.noul).toBeCloseTo(0.7);
  });

  it("lets an explicit model on the request win", async () => {
    const calls: Array<{ init: RequestInit | undefined }> = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      return reply(answer);
    });
    await createProxyClient({ fetch, model: "jev-1" }).systemOne({ state: "x", questions, model: "jev-2" });
    expect(JSON.parse(String(calls[0]?.init?.body)).model).toBe("jev-2");
  });

  it("trims a trailing slash from the base URL", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => { calls.push(url); return reply(answer); });
    await createProxyClient({ fetch, baseURL: "https://example.test/" }).systemOne({ state: "x", questions });
    expect(calls[0]).toBe("https://example.test/v1/systemone");
  });

  it("raises the status when the API refuses", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("no credential attached", { status: 401 }));
    const client = createProxyClient({ fetch });
    await expect(client.systemOne({ state: "x", questions })).rejects.toThrow(ProxyCallError);
    await expect(client.systemOne({ state: "x", questions })).rejects.toMatchObject({ status: 401 });
  });
});

describe("createCaller", () => {
  it("uses the proxy when no key is present here", () => {
    expect(createCaller().mode).toBe("proxy");
  });

  it("uses the SDK when the key is present", () => {
    process.env.TYPESAFE_API_KEY = "test-key";
    expect(createCaller().mode).toBe("key");
  });

  it("treats a blank key as absent", () => {
    process.env.TYPESAFE_API_KEY = "   ";
    expect(createCaller().mode).toBe("proxy");
  });

  it("honours the base URL from the environment on the proxy path", async () => {
    process.env.TYPESAFE_BASE_URL = "https://staging.test";
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => { calls.push(url); return reply(answer); });
    await createCaller({ fetch }).client.systemOne({ state: "x", questions });
    expect(calls[0]).toBe("https://staging.test/v1/systemone");
  });
});
