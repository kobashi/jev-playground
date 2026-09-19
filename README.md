# jev-playground

An application built on [Jev](https://typesafe.ai/), TypeSafe AI's first *System One*
model. Jev does not generate text: it takes a block of state and a set of typed
questions, evaluates them in parallel, and returns values drawn only from the schema
you defined, each with calibrated probabilities and a confidence.

This repository holds the client plumbing, a live smoke check, and the tests that
cover them. The application itself is not written yet.

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
