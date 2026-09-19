# jev-playground

A call-and-response music app built to find out whether [Jev](https://typesafe.ai/)
— TypeSafe AI's first *System One* model — can carry a musical judgment.

Jev does not generate text. It takes a block of state and a set of typed
questions, evaluates them in parallel, and returns values drawn only from the
schema you defined, each with a calibrated probability. So it cannot write a
melody. The question this repository set out to answer is whether it can
**choose** one.

Everything below was measured. Where a measurement turned out to be wrong, the
correction is here too — that happened more than once.

## Try it without cloning

- **[Trade Fours](https://claude.ai/artifact/PHX9eSLqJpPiaf6TKaEnMx)** — the app,
  playable in a browser. A published page has no backend, so this is the local
  engine only: the Jev seat needs `npm run serve` and a key.
- **[Jev Reads Music](https://claude.ai/artifact/LvQXvM5HPn3UVUwzMZwb7w)** — the
  findings, with the numbers behind them.

## Running it

Node.js 22 or newer. Nothing is deployed; this runs on loopback.

```sh
npm install
npm run serve        # http://127.0.0.1:5173
```

Opening `web/index.html` as a file works for the local engine, but a Jev seat
needs the endpoint, and Web MIDI needs `localhost` or HTTPS.

**`/api/respond` has no authentication.** On loopback that is fine. Exposed, it
would let anyone spend the account's Jev budget at roughly 2,200 input tokens a
call. Put access control in front of it before it leaves your machine.

### Where the key lives

`createCaller()` picks a route from what the environment offers and says which
at startup:

| Route | When | How it authenticates |
| --- | --- | --- |
| `key` | `TYPESAFE_API_KEY` is set | the SDK sends `Authorization: Bearer …` |
| `proxy` | no key present | nothing is sent; an agent proxy attaches the credential after the request leaves |

The proxy route exists for Claude Code cloud environments, which hold an API
credential that never enters the sandbox. Sending a placeholder `Authorization`
header there risks colliding with the one the proxy adds, so `createProxyClient`
sends none, and a test asserts it. On a development machine, put the key in
`.env` instead (gitignored).

One trap: **Node's built-in `fetch` ignores `HTTPS_PROXY` unless told to read
it**, so in a sandbox that routes egress through a proxy the call fails with the
proxy's own 403 while `curl` to the same host succeeds. Every script here sets
`NODE_USE_ENV_PROXY=1`, which is inert where no proxy is configured.

## How the app works

Two seats trade phrases. Each seat is a person, the local heuristics, or Jev,
and any combination works — including two engines trading with nobody at the
keyboard. Only one seat can be a person, because there is one keyboard.

**Timing.** One transport clock runs for the whole session. Input is quantized
against it, and nothing is computed when an answer is due: the answer is
rebuilt on every note-on and note-off, including notes still held, so a
finished response is always waiting. It enters on the next whole beat,
scheduled into the audio clock about 90ms ahead. Measured from the last key
release to the answer entering: 0.46 to 1.08 beats, always on the beat.

That shape is what makes Jev droppable. A 264–287ms round trip hides inside the
phrase instead of landing in the gap.

**Both engines return the same result shape** — candidates, a probability for
each, a strategy distribution — so sampling, the readout and the guards are
shared. Candidates are always generated locally. Jev ranks them; it never
writes notes. A failed Jev call falls back to the local engine for that turn
and says so.

**An automatic session always ends.** Sixteen exchanges, 48 engine calls, six
speculations per human turn, three consecutive failures, a hidden tab. The
musical guard is cycle detection: every phrase is reduced to a signature, and
an answer repeating anything from the last six phrases sends the sampler down
the probabilities for one that does not. Three rescues, then it stops; a pool
where every candidate repeats stops at once. Verified two ways — 3000 simulated
sessions in Node, all terminating with a reason, and a real local-vs-local
session in Chromium that ran to the cap and stopped by itself.

## What we learned about Jev

### It reads symbolic music

This was the open question the project started with, and it is settled. Asked
which way a phrase travels between its first note and its last — arithmetic, so
a model that cannot do it is not reading the notes — Jev scores **97–100%**
whichever way the notes are written.

### How you write the notes changes what it hears

The same phrases, in three encodings, 126 requests:

| Encoding | Direction | Cadence | p(ended): closed vs open | Ranking |
| --- | --- | --- | --- | --- |
| `degree` — `{degree: 7}` | 97% | **63%** | 0.67 vs 0.47 | 100% |
| `named` — `{note: "C5"}` | 100% | **97%** | 0.83 vs 0.33 | 100% |
| `abc` — `K:C  C2 D2 E4` | 97% | 77% | 0.66 vs 0.41 | 100% |

A 34-point swing on the judgment the app depends on. Every failure the degree
encoding made on a closed phrase was a phrase ending on degree 7 — the tonic an
octave up, which `7` hides behind a large number and `C5` does not. Its
0.67-against-0.47 separation is barely a signal.

**The app sends pitch names because of this.** The conversion happens server
side; the browser's wire format is unchanged.

### It is sure about constraints and unsure about conversation

Pairs of answers that would both pass a glance, differing in exactly one
musical principle, each asked twice with the candidates swapped:

| Dimension | Picked the better one | p(better) |
| --- | --- | --- |
| Note outside the key | 100% | 0.99 |
| Register continuity | 100% | 0.94 |
| Falls on the beat | 100% | 0.85 |
| Resolves the cadence | 100% | 0.83 |
| Moves by step, not leap | 100% | 0.78 |
| Length matches the call | 92% | 0.65 |
| **Echoes the call's shape** | **75%** | **0.64** |

94% overall, with label `a` chosen exactly 50% of the time. Key, register and
timing are near-certainties. Whether an answer takes up the shape the call just
made is its weakest dimension — and that is the one that makes a trade feel
like a reply.

### It does not invent confidence

Four of those pairs hold two answers that are both fine. There Jev lands 0.15
from an even split, at 0.31 confidence. Asked something with no right answer,
it says so. For a judge, that matters as much as the scores.

### On a real pool it chooses — but not the same thing

Ten pools captured from the running app, put to Jev and to the local ranker
side by side:

| | max p(top pick) | Normalised entropy |
| --- | --- | --- |
| Jev | 0.222 | 0.845 |
| Local ranker | 0.248 | 0.843 |
| Indifference | 0.072 | 1.000 |

Three times the mass of an even split across fourteen candidates, consistently.
But top-pick agreement is **1 in 10**, and the rank correlation is **0.21**. Two
rankers, both making a real choice, on nearly unrelated grounds.

The softness is a feature here: the app samples from the distribution rather
than taking the argmax, so a soft preference gives variety while still tilting.

### What it costs

`jev-latest` resolves to `jev-1.13.0`. About **2,200 input tokens** a turn at
$0.042 per million, output not charged — roughly **$0.000092 a turn**, so a $5
trial balance is around 54,000 turns. Latency 742ms cold, then 264–287ms. The
whole encoding eval was 126 requests for $0.004.

`jev-preview` also exists, described as "should be better in most ways".
Untested here.

### One question that does not work

`all_broken` — "are all of these candidates broken?" — sits at 0.41 in every
encoding, including the runs where Jev had just chosen the good candidate with
0.86 probability. It says "these are all broken" and "this one is good" at the
same time, so it is measuring something other than what its wording asks. The
app still displays it. Do not trust it.

## What we learned about the app

### The ranker was never the bottleneck

Three listening tests, all blind, all on the phone:

| | |
| --- | --- |
| Round 1 — Jev vs local, 27 trials | local 15, Jev 11, one tie |
| Round 2 — Jev vs local, 12 trials | local 6, Jev 4, two ties |
| Round 3 — new code vs old, 8 trials | 4 — 4 |

Jev's judgment is measurably sound and its choices differ measurably from the
heuristic's, and **none of that reaches the listener**. The candidate pool is
what decides how the app sounds.

### Two complaints, translated into metrics

The most useful information in the project came in two phrases after round one:
*the answers lack resolution, and the development is dull.* No measurement had
produced anything that actionable. Both turned out to be measurable after the
fact:

- lack of resolution → the share of answers ending on a chord tone
- dull development → note-length variety within a phrase, and whether the
  phrase turns around inside itself instead of running one way

`npm run eval:session` reports both without anyone listening.

### What the reshaping moved

`shapeRhythm` takes the call's own durations, bends them a different way per
variant, and gives a third note length to any phrase left with two.
`ensureTurn` finds phrases whose highest and lowest notes are both at the ends
and pushes an interior note past them. `sequence` and `invert` keep their
contour, which is their point, but their last note is fitted to the key.

Six sessions of sixteen turns, the same seeds either side:

| | local | Jev |
| --- | --- | --- |
| Lands on a chord tone | 74% → **83%** | 77% → **92%** |
| Turns, of phrases able to | 49% → **73%** | 47% → **60%** |
| Distinct rhythms | 81% → 86% | 80% → **92%** |
| Duration variety | 57% → 62% | 53% → 58% |
| Interval variety | 67% → 73% | 66% → 71% |

Nothing moved the wrong way — and round three could not hear the difference.
Eight trials cannot resolve a change this size; that was a design error, not a
result.

## The instruments

| Command | Answers |
| --- | --- |
| `npm run smoke` | is the API reachable and answering |
| `npm run eval` | does Jev read symbolic music, and does the encoding matter |
| `npm run eval:pairs` | can it tell two plausible answers apart, one principle at a time |
| `npm run eval:session` | does a session stay interesting — `CHAIN=0/1`, `PAGE=` for an older build |
| `npm run eval:ab` | build a listening test: the same calls through two versions |
| `npm run check` | 46 unit tests and a typecheck |

`eval/page-engine.ts` loads the app's own engine out of `web/index.html` rather
than copying it, so an eval measures the code that runs.

## What did not work

Kept because the wrong turns cost more than the right ones, and they have a
shape worth recognising.

**Reading a number without checking what it measures.** `all_broken` at 0.41
was read as "the generator's candidates are weak". It was the question's
wording. One eval run settled it.

**Generalising from six trials.** Round one showed `extend` at 3–2–1, so the
ranking question was rewritten to steer towards it. Those six trials were
`extend` against the local ranker's picks; they said nothing about `extend` as
the whole diet. Round two: the rewrite was no better.

**A harness that biased what it captured.** The "monoculture" that justified two
commits was an artefact. The capture kept only trials where the two rankers
disagreed, which selects against agreement, and drove the no-repeat rule from a
stub's random sampling instead of real picks. Measured properly, the largest
share any one strategy holds is 27–36% — in every mode. There was no
monoculture, and round two's trial set inherited the bias.

**Conflating two kinds of dull.** Variety across a session is not the same as
whether one answer develops. The listening tests judged one answer at a time;
the monoculture story was about the other thing entirely.

**Optimising a proxy past its usefulness.** The turning-point metric stalled at
63%, and the remaining shortfall was `sequence` and `invert` deliberately
keeping their contour. Forcing a turn there would have broken what makes them
sequences.

**A test too small to answer its question.** Round three used eight trials to
save the listener's time, and eight trials cannot detect a difference this
size. The 4–4 means "not measured", not "no difference".

The pattern in all of them: a number was read as evidence for something it did
not measure. What broke the cycle was building the measuring instrument before
the next change, and running the previous build through the same harness with
the same seeds.

## Where it stands

The app works, privately, on loopback and as a page. Either seat can be a
person, the local heuristics, or Jev. Automatic sessions always end.

What is still open:

- **Whether a better pool would let Jev's judgment through.** Every finding
  points here. The generator offers seven templates, and a real pool holds
  constant every dimension Jev is certain about, so it arrives with nothing to
  use. A generator built by composition rather than archetype is the untested
  alternative — but that is a question about composition algorithms, not about
  Jev.
- **Whether `all_broken` can be reworded into something usable.**
- **Whether `jev-preview` scores differently.** The evals here would run against
  it unchanged.

## License

MIT. The evals are the part most worth taking — `eval/` is self-contained apart
from the client in `src/`, and the phrase sets carry their own ground truth.
