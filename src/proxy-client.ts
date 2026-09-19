/**
 * A System One caller for environments where an agent proxy holds the key.
 *
 * Claude Code cloud environments can store an API credential that the proxy
 * attaches to matching hosts *after* the request leaves the sandbox. The key
 * never reaches this process, so there is nothing to put in an Authorization
 * header — and sending a placeholder one risks colliding with the header the
 * proxy adds. This client therefore sends none and lets the proxy authenticate.
 *
 * Use `createSdkClient` instead wherever the key is actually present, such as a
 * developer machine with TYPESAFE_API_KEY in its environment.
 */
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { createJevClient } from "./client.js";
import { readOptional } from "./config.js";

/** The one call `handleRespond` needs, so either client can serve it. */
export interface SystemOneCaller {
  systemOne<Q extends Questions>(request: {
    state: unknown;
    questions: Q;
    model?: string;
  }): PromiseLike<SystemOneResult<Q>>;
}

/** The fetch shape this client uses: it always passes a string URL. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProxyClientConfig {
  baseURL?: string;
  model?: string;
  timeout?: number;
  fetch?: FetchLike;
}

/** Thrown when the API answers with a non-2xx status. */
export class ProxyCallError extends Error {
  override name = "ProxyCallError";
  readonly status: number;
  constructor(status: number, body: string) {
    super("System One returned HTTP " + status + (body ? " — " + body.slice(0, 200) : ""));
    this.status = status;
  }
}

export const createProxyClient = (config: ProxyClientConfig = {}): SystemOneCaller => {
  const baseURL = (config.baseURL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  const model = config.model ?? "jev-latest";
  const timeout = config.timeout ?? 10000;
  const doFetch = config.fetch ?? globalThis.fetch;

  return {
    async systemOne<Q extends Questions>(request: { state: unknown; questions: Q; model?: string }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await doFetch(baseURL + "/v1/systemone", {
          method: "POST",
          // deliberately no Authorization header: the agent proxy supplies it
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...request, model: request.model ?? model }),
          signal: controller.signal,
        });
        if (!res.ok) throw new ProxyCallError(res.status, await res.text());
        return (await res.json()) as SystemOneResult<Q>;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};

/**
 * Pick a client from what the environment offers: the SDK when the key is here,
 * the proxy when it is not. Returns which route it took, so callers can say so
 * rather than leave it ambiguous.
 */
export const createCaller = (config: ProxyClientConfig = {}): { client: SystemOneCaller; mode: "key" | "proxy" } => {
  if (readOptional("TYPESAFE_API_KEY")) {
    return { client: createJevClient(), mode: "key" };
  }
  const baseURL = readOptional("TYPESAFE_BASE_URL");
  const model = readOptional("TYPESAFE_DEFAULT_MODEL");
  return {
    client: createProxyClient({
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(model === undefined ? {} : { model }),
      ...config,
    }),
    mode: "proxy",
  };
};
