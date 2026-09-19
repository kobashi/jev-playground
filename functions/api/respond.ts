/**
 * Cloudflare Pages Function: the only place the Jev API key exists.
 *
 * The browser cannot hold the key, so every Jev call for the app passes
 * through here. The handler itself lives in src/respond.ts so it can be
 * tested without a runtime.
 */
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { handleRespond, RespondError } from "../../src/respond.js";

interface Env {
  /** Set with `wrangler pages secret put TYPESAFE_API_KEY`. */
  TYPESAFE_API_KEY: string;
  TYPESAFE_DEFAULT_MODEL?: string;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;

  if (!env.TYPESAFE_API_KEY) {
    return json({ error: "TYPESAFE_API_KEY is not configured on this deployment." }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request body is not valid JSON." }, 400);
  }

  const client = new TypeSafeClient({
    apiKey: env.TYPESAFE_API_KEY,
    defaultModel: env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest",
    timeout: 8000,
  });

  try {
    return json(await handleRespond(client, body), 200);
  } catch (error) {
    if (error instanceof RespondError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "The model call failed: " + message }, 502);
  }
};
