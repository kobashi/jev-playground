/**
 * Run the app locally, for private use. Bound to loopback; do not expose it.
 *
 * With TYPESAFE_API_KEY in the environment it uses the SDK. Without one it
 * sends unauthenticated and lets an agent proxy attach the credential.
 */
import { resolve } from "node:path";
import { createCaller } from "../src/proxy-client.js";
import { createApp } from "../src/server.js";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = "127.0.0.1";

const { client, mode } = createCaller();

createApp(client, resolve(import.meta.dirname, "..", "web")).listen(PORT, HOST, () => {
  console.log("Trade Fours on http://" + HOST + ":" + PORT);
  console.log(mode === "key"
    ? "Jev: using TYPESAFE_API_KEY from this environment."
    : "Jev: no key here — sending unauthenticated for an agent proxy to authenticate.");
  console.log("Bound to " + HOST + " only. Do not expose this port.");
});
