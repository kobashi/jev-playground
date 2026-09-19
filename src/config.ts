import type { LogLevel } from "@typesafe-ai/sdk";

/** Read a trimmed environment value, treating blank as unset. */

/** Resolved settings for the Jev client, read from the environment. */
export interface JevConfig {
  apiKey: string;
  baseURL: string | undefined;
  defaultModel: string | undefined;
  logLevel: LogLevel | undefined;
  timeout: number | undefined;
}

/** Thrown when the environment does not carry the settings the client needs. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

const LOG_LEVELS = ["debug", "info", "warn", "error", "off"] as const;

export const readOptional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
};

const readLogLevel = (): LogLevel | undefined => {
  const value = readOptional("TYPESAFE_LOG_LEVEL");
  if (value === undefined) return undefined;
  const match = LOG_LEVELS.find((level) => level === value.toLowerCase());
  if (match === undefined) {
    throw new ConfigError(
      `TYPESAFE_LOG_LEVEL is "${value}"; expected one of ${LOG_LEVELS.join(", ")}.`,
    );
  }
  return match;
};

const readTimeout = (): number | undefined => {
  const value = readOptional("JEV_TIMEOUT_MS");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`JEV_TIMEOUT_MS is "${value}"; expected a positive number of milliseconds.`);
  }
  return parsed;
};

/**
 * Read the Jev settings from `process.env`, failing fast with a readable message.
 *
 * The SDK reads `TYPESAFE_API_KEY` on its own, but only reports a missing key once a
 * request is attempted. Resolving it here keeps startup failures away from request paths.
 */
export const loadConfig = (): JevConfig => {
  const apiKey = readOptional("TYPESAFE_API_KEY");
  if (apiKey === undefined) {
    throw new ConfigError(
      "TYPESAFE_API_KEY is not set. Copy .env.example to .env and fill in the key, or export it in the shell.",
    );
  }
  return {
    apiKey,
    baseURL: readOptional("TYPESAFE_BASE_URL"),
    defaultModel: readOptional("TYPESAFE_DEFAULT_MODEL"),
    logLevel: readLogLevel(),
    timeout: readTimeout(),
  };
};
