/**
 * The local server: the page, plus the one endpoint it calls.
 *
 * Nothing here is meant to face the internet. `/api/respond` has no
 * authentication, so the entry point binds to loopback only.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { SystemOneCaller } from "./proxy-client.js";
import { handleRespond, RespondError } from "./respond.js";

export const MAX_BODY = 512 * 1024;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new RespondError("The request body is larger than " + MAX_BODY + " bytes.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const serveStatic = async (res: ServerResponse, root: string, urlPath: string): Promise<void> => {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Bad request");
    return;
  }
  const file = resolve(join(root, normalize(rel) === "/" ? "index.html" : normalize(rel)));
  if (file !== root && !file.startsWith(root + "/")) {     // never serve outside the root
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, "index.html") : file;
    const size = info.isDirectory() ? (await stat(target)).size : info.size;
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "content-length": size,
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
};

/** Build the server without listening, so tests can drive it on any port. */
export const createApp = (client: SystemOneCaller, webRoot: string): Server => {
  const root = resolve(webRoot);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/respond") {
      if (req.method !== "POST") { sendJson(res, 405, { error: "Use POST." }); return; }
      void (async () => {
        try {
          const raw = await readBody(req);
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            throw new RespondError("The request body is not valid JSON.");
          }
          sendJson(res, 200, await handleRespond(client, body));
        } catch (error) {
          if (error instanceof RespondError) { sendJson(res, error.status, { error: error.message }); return; }
          const message = error instanceof Error ? error.message : String(error);
          console.error("respond failed:", message);
          sendJson(res, 502, { error: "The model call failed: " + message });
        }
      })();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Method not allowed");
      return;
    }
    void serveStatic(res, root, url.pathname);
  });
};
