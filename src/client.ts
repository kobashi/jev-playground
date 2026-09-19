import { TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { loadConfig } from "./config.js";

/** Model route used when neither the environment nor the caller names one. */
export const DEFAULT_MODEL = "jev-latest";

/**
 * Build a client from the environment, with explicit overrides taking precedence.
 *
 * Pass `fetch` to drive the client from a test double instead of the network.
 */
export const createJevClient = (overrides: TypeSafeClientConfig = {}): TypeSafeClient => {
  const config = loadConfig();
  return new TypeSafeClient({
    apiKey: config.apiKey,
    defaultModel: config.defaultModel ?? DEFAULT_MODEL,
    ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
    ...(config.logLevel === undefined ? {} : { logLevel: config.logLevel }),
    ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
    ...overrides,
  });
};
