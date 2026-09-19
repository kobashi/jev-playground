# jev-playground

An application built on [Jev](https://typesafe.ai/), TypeSafe AI's first *System One*
model. Jev does not generate text: it takes a block of state and a set of typed
questions, evaluates them in parallel, and returns values drawn only from the schema
you defined, each with calibrated probabilities and a confidence.

This repository holds the app, the Jev client plumbing, the local server that
keeps the key out of the browser, a live smoke check, and the tests that cover
them. It runs privately on loopback and is not deployed anywhere.

## The app

`web/index.html` is a call-and-response jam: play a phrase, and a continuation
comes back. It is one standalone file with no build step and no dependencies —
Web Audio for sound, Web MIDI when a device is present, and a computer keyboard
or on-screen pads otherwise.

```sh
npm install
npm run serve        # http://127.0.0.1:5173
```

`npm run serve` serves the page and the one endpoint it calls, bound to
127.0.0.1 only. Opening `web/index.html` as a file works too, but then only the
local engine does — a Jev seat needs the endpoint, and Web MIDI needs
`localhost` or HTTPS.

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

## Running it privately

This is not deployed anywhere and is not meant to be. The deciding constraint is
that the Jev API key cannot reach the browser, so a seat set to Jev needs
something server side; `npm run serve` is that something, on loopback.

**`/api/respond` has no authentication.** On loopback that is fine. Exposed, it
would let anyone spend the account's Jev budget — at roughly 3 KB of JSON per
call, a trial balance goes quickly. Do not put this behind a tunnel or a public
port without putting real access control in front of it first.

### Where the key lives

`createCaller()` picks a route from what the environment offers, and says which
one it took at startup:

| Route | When | How it authenticates |
| --- | --- | --- |
| `key` | `TYPESAFE_API_KEY` is set | the SDK sends `Authorization: Bearer …` |
| `proxy` | no key present | nothing is sent; an agent proxy attaches the credential after the request leaves |

The proxy route exists for Claude Code cloud environments, which can hold an
API credential that never enters the sandbox. Sending a placeholder
`Authorization` header there risks colliding with the one the proxy adds, so
`createProxyClient` deliberately sends none — and a test asserts that.

On a development machine, put the key in `.env` instead (it is gitignored):

```sh
cp .env.example .env     # then fill in TYPESAFE_API_KEY
npm run serve
```

### Node and an HTTP proxy

Node's built-in `fetch` ignores `HTTPS_PROXY` unless told to read it, so in a
sandbox that routes egress through a proxy the call fails with the proxy's own
403 while `curl` to the same host succeeds. `npm run smoke` and `npm run serve`
therefore set `NODE_USE_ENV_PROXY=1` (Node 22.21 or newer). It does nothing
where no proxy variables are set, so it is safe on a development machine.

### Measured against the live API

One turn with a Jev seat, taken from three rounds through the real page:

| | |
| --- | --- |
| Input tokens per turn | 1831, 2172, 2090 — about **2,000** |
| Latency | 742ms cold, then **264–287ms** |
| Model | `jev-latest` resolves to `jev-1.13.0` |

At $0.042 per million input tokens and no charge for output, a turn costs about
$0.000085, so a $5 trial balance is roughly 58,000 turns, or 1,200 automatic
sessions at the 48-call cap. Cost is not the constraint here.

`jev-preview` also exists, described as "should be better in most ways". Set
`TYPESAFE_DEFAULT_MODEL` to try it.

One thing the live runs surfaced: `all_broken` came back at **0.41–0.44** every
round. Jev is not confident the local generator's pool contains a good answer.
That is a finding about the generator, not the plumbing, and it is what the
eval should look into first.

### What has been verified

`npm run check` covers 44 tests: payload validation, the questions built from
it, the proxy client's headers, and the server's routes and failure paths.

Beyond that, the whole chain has been run end to end against a stand-in for
`api.typesafe.ai`: the real server in proxy mode, the real page in Chromium with
a Jev seat, one request reaching the upstream on `/v1/systemone` carrying four
questions and fourteen candidates, **no `Authorization` header on it**, and the
answer arriving back in the readout with the upstream's token count.

The real API has now been called too: the smoke check answers correctly
(`billing` at confidence 1.000 on a double-charge complaint), and three rounds
through the real page were answered by Jev with no fallback and no page errors.
