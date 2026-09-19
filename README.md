# jev-playground

An application built on [Jev](https://typesafe.ai/), TypeSafe AI's first *System One*
model. Jev does not generate text: it takes a block of state and a set of typed
questions, evaluates them in parallel, and returns values drawn only from the schema
you defined, each with calibrated probabilities and a confidence.

This repository holds the app, the Jev client plumbing, a live smoke check, and the
tests that cover them. The app runs today; the Jev calls are not wired in yet.

## The app

`web/index.html` is a call-and-response jam: play a phrase, and a continuation
comes back. It is one standalone file with no build step and no dependencies —
Web Audio for sound, Web MIDI when a device is present, and a computer keyboard
or on-screen pads otherwise.

```sh
python3 -m http.server 5173 --directory web   # then open http://localhost:5173
```

Opening `web/index.html` directly works too, but Web MIDI needs `localhost` or
HTTPS, so the server is the better path when a controller is plugged in.

### Timing

One transport clock runs for the whole session, starting on the first note.
Input is quantized against it, so the player and the answer share a grid.

Nothing is computed at the moment the answer is due. `runSpeculation()` rebuilds
the answer on every note-on and note-off — including notes still held — so a
finished response is always waiting. When the turn ends, the answer enters on
the next whole beat, scheduled into the audio clock about 90ms ahead rather than
played at "now", and notes are handed over on a 180ms lookahead.

The turn ends after half a beat of rest, or at the two-bar line even if the
player keeps going. Playing again during an answer yields the floor: the
unscheduled remainder is dropped.

Measured in Chromium, from the last key release to the answer entering: 0.46 to
1.08 beats, always on the beat. The spread is just where the release fell
against the grid.

That shape is what makes Jev droppable. `computeResponse()` is already
awaited, already fired mid-phrase, and already guards against a reply that
arrives after a newer note, so a 70-500ms round trip hides inside the phrase
instead of landing in the gap.

### Seats and engines

Two seats trade phrases. Each seat is a person, the local heuristics, or Jev,
and any combination works: play against either engine, or set both seats to an
engine and watch them trade with nobody at the keyboard. Only one seat can be a
person, because there is only one keyboard.

Both engines return the same result shape — candidates, a probability for each,
a strategy distribution — so the sampling, the readout and the guards are shared.
Candidates are always generated locally. Jev ranks them; it never writes notes.

| Engine | Where the decision happens |
| --- | --- |
| `local` | `interpret()`, `chooseStrategy()` and `rank()` in the page |
| `jev` | one `systemOne` call behind `POST /api/respond` |

The Jev path sends a pool spanning every strategy and asks one question set:
did the call come to rest, what is its rhythmic character, which candidate
answers it best, and are they all broken. Arithmetic the page can do for
itself — note counts, range, contour, density — is deliberately not asked. A
strategy's weight then falls out of the answer: it is the probability mass its
own candidates carry.

If the Jev call fails, that turn falls back to the local engine rather than
dropping the beat, the failure is shown, and three in a row stop an automatic
session.

### Keeping an automatic session finite

Two engines answering each other will loop given the chance, so the session is
bounded from several directions at once:

| Guard | Limit |
| --- | --- |
| Exchanges per session | 16 |
| Engine calls per session | 48 |
| Speculations per human turn (Jev) | 6 |
| Consecutive engine failures | 3 |
| Cycle rescues before stopping | 3 |
| Hidden tab | stops the session |

Cycle detection is the one that matters musically. Every phrase is reduced to a
signature; if the sampled answer repeats anything from the last six phrases,
the sampler walks down the probabilities for one that does not. That rescue is
allowed three times, and a session where *every* candidate repeats stops
immediately — that is the fixed point where one engine copies the other forever.

Verified two ways: 3000 simulated sessions in Node, every one terminating with a
reason (worst case 17 iterations, 16 engine calls), and a real local-vs-local
session in Chromium that ran to the 16-exchange cap and stopped by itself with
no page errors.

## Publishing

The deciding constraint is that the Jev API key cannot reach the browser. That
rules out a static-only host once Jev is wired in.

| Target | Works? | Why |
| --- | --- | --- |
| Cloudflare Pages + Functions | Yes | `functions/api/respond.ts` holds the key as a secret binding; `web/` is served as static assets. |
| GitHub Pages | Only without Jev | No server side, so the key would have to be typed in by each visitor. |
| Claude Artifact | Only without Jev | No secret storage, and its CSP blocks calls to the API. Good for the skeleton. |

The local engine needs none of that, so the page runs anywhere today; choosing
a Jev seat on a host without the function shows the failure and falls back.

```sh
npx wrangler pages secret put TYPESAFE_API_KEY
npm run deploy
```

`npm run dev:web` serves the page and the function together for local work.

**The endpoint is unauthenticated.** Anyone who can reach a public deployment
can spend the account's Jev budget through it. Request size is capped — 64 notes
per phrase, 24 candidates — and the questions are built server side so callers
cannot supply their own, but that bounds each call rather than the number of
them. Put access control or a rate limit in front of it before handing the URL
out.

Neither the function nor the deployment has been run: there is no API key and
no Cloudflare account in the environment this was written in. `src/respond.ts`
is covered by tests against an injected fetch, so the request it builds is
verified; the deploy itself is not.

## Setup

Node.js 22 or newer.

```sh
npm install
cp .env.example .env   # then fill in TYPESAFE_API_KEY
```

The key comes from the TypeSafe console; Jev is in early access behind a waitlist as
of September 2026, so an account may not have one yet. Everything but `npm run smoke`
works without a key.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run check` | Typecheck, then run the tests. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Unit tests. No network, no API key. |
| `npm run smoke` | One real request against the API. Billable. |

`npm run smoke` loads `.env` if present and prints the answers, the per-label
probabilities, the latency, and the token usage.

## Layout

```
src/config.ts    Environment settings, validated at startup
src/client.ts    createJevClient() — the configured TypeSafeClient
src/index.ts     Public surface, re-exporting the SDK's question builders
scripts/smoke.ts Live check against the API
test/            Unit tests driven by an injected fetch
```

`createJevClient` accepts the SDK's own client options as overrides, so passing
`{ fetch }` drives it from a test double instead of the network. That is how the
tests run without a key.

## The three question types

Every question carries `instructions` (text, a JSON object, an array, or `null`) and
`criteria` describing the outcomes. `null` leaves an outcome undescribed.

```ts
import { choice, noul, score } from "@typesafe-ai/sdk";

choice("What is this ticket about?", {   // one of N labels, up to 255
  billing: "Charges, refunds, invoices, or subscriptions.",
  technical: "The product is broken.",
  other: null,
});

score("How urgent is this?", [           // a 2–10 level ordered rubric, indexed from 0
  "Can wait a week.",
  "Should be handled today.",
  "Needs someone right now.",
]);

noul("Does this need a human?", {        // yes/no, returned as a probability
  true: "A person must read it first.",
  false: "An automated reply would resolve it.",
});
```

Answers come back keyed by question name, typed from the question that produced them:
`choice` yields the selected label plus `probabilities` and `confidence`, `score`
yields an expected value that may fall between rubric levels plus its `legend`, and
`noul` yields `noul`, the probability of yes.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | — | Required. |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Model route. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | API root. |
| `TYPESAFE_LOG_LEVEL` | `warn` | `debug` logs request bodies, which include your state. |
| `JEV_TIMEOUT_MS` | `10000` | Per-attempt timeout. The SDK retries twice by default. |

`loadConfig()` rejects a missing key, an unknown log level, and a non-positive timeout
at startup rather than on the first request.

## Notes

Output tokens are not billed, so cost tracks the size of the state you send. Sending
one state with many questions is cheaper than one request per question, and the model
evaluates them in parallel anyway.
