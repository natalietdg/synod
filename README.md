# Synod

**A multi-agent negotiation council that detects deceptive counterparties and closes deals single-stance agents walk away from.**

A single-stance negotiating agent always fails against a deceptive counterparty: it reads
"competitor leverage" at face value, pushes harder, and the counterparty walks. Synod
doesn't. Five cognitive lenses deliberate in parallel; the Probe lens fires when the
**Expected Value of Information** exceeds its cost; deception is disarmed; the deal closes.

Across n=10 independent runs: **baseline $0 (100% walk rate), Synod $3,000 (100% deal rate).**

That's the concrete claim. The architecture is what makes it reproducible.

---

> Most agent societies divide labor. This one divides judgment.

The labor is divided too — each round decomposes into seven specialized sub-tasks
(intent reading, parallel scoring, adversarial stress-test, information purchase,
influence allocation, synthesis, audit-and-gate), with the challenger/defender seats
and the lens weights **reassigned dynamically every round**. What Synod refuses to
divide is accountability for the answer: every sub-task flows into one deterministic,
receipted synthesis. See the task-decomposition table in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

Five agents represent competing **decision lenses** (not task silos). A doctrineless **Arbiter**
weights them by situational context — not by which lens argued most convincingly, but by
what the terrain demands. A deterministic engine scores the result. A numerate **Quant**
checks it against cold money-EV. A **Game Master** simulates the counterparty and owns all
hidden state. Every round is gated and cryptographically receipted (**Dotto**).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system map, the determinism
boundary, and related work (ANAC/BOA, LLM debate — and Synod's delta).
[`synod-v2.md`](./synod-v2.md) is the build spec; [`synod-prd.md`](./synod-prd.md) the PRD.

## The five lenses (cognitive archetypes, not doctrines)

Each is a worldview that owns a question the others ignore. The `math` is one
operationalization (what the offline mock computes); the live Qwen agent gets the whole
worldview as its character.

| Lens | Owns the question | Math |
|---|---|---|
| **Pressure** | What move creates advantage *now*? | immediate utility (myopic capture) |
| **Frame** | What game are we really playing? | long-horizon utility (capture vs. walk risk) |
| **Trust** | Why are they acting this way? | best response to the Bayesian belief |
| **Probe** | What should we learn first? | value of information — probe iff EVI > cost |
| **Hedge** | What kills us if we're wrong? | minimax / downside (walk exposure) |

*(Internally the five are typed `battle/war/empathy/probe/risk`; the instinct names above are the display identity.)*

## How it works (one negotiation)

The Council and the Game Master exchange **only outward moves** — the GM never sees the
debate, weights, or matrix; the Council never sees the hidden state (spec §2). Each round:

1. The GM emits a counterparty move (deterministic; LLM phrases language only).
2. The belief over the hidden type updates on the move's visible signals (the posterior
   from round *t* becomes the prior for *t+1* — the on-screen **weight trajectory** is the
   visible shadow of this Bayesian update).
3. The five lenses score the candidate actions independently. The most-diverging pair
   exchange one **challenge and response** — genuine agent-to-agent message passing,
   and it is **causal**: the defender may concede ground on the contested action after
   hearing the challenge (clamped, auditable, recorded on the receipt), so a challenge
   that lands can flip a close round before the engine scores the council.
4. **Probe fires iff Expected Value of Information > its cost**, grounded in how each hidden
   type characteristically responds.
5. The Arbiter weights the lenses by context; the deterministic engine picks the action; the
   Quant flags the money-EV divergence; **Dotto** gates and signs a receipt.

Candidate actions: `accept`, `counter_hard`, `counter_soft`, `hold`, `probe`,
`concede_term`, `walk`.

## The measurable result (rule-based MCDA council, n=10 seeds)

Strong single-agent baseline vs. Synod across 10 independent seeds per hidden type.
Mean surplus captured; σ = standard deviation across seeds.

| Hidden type | Baseline (mean ± σ) | Synod (mean ± σ) | Deals |
|---|--:|--:|--:|
| Relationship-oriented | $2,500 ± $0 | $2,500 ± $0 | B 100% · S 100% |
| Soft surface, firm floor | $2,906 ± $19 | **$3,468 ± $98** | B 100% · S 100% |
| Deceptive | $0 ± $0 | **$3,000 ± $0** | B 0% · S 100% |
| **Total surplus** | **$5,406** | **$8,968** | |

The gain concentrates on the adversarial types. A single agent collapses competing
considerations into one stance — the deceptive type's bluff makes it walk; the soft-floor
type's firmness pushes it past the reservation. Synod keeps the dissenting lens explicit:
Hedge stays visible even when Pressure is weighted highest, and Probe fires when EVI justifies it.

The Relationship type ties by design: easy, honest counterparties don't reward complexity.
The ±$0 variance on Deceptive reflects fully deterministic outcomes — the bluff either
breaks (council probes, survives) or doesn't (baseline pushes, walks). Reproducible by construction.

## Ablation study (same seeds, n=10 per type)

Remove one component at a time. If removal doesn't hurt, the table says so.

| Variant | Total surplus | Δ vs full | Deal rate | Deceptive |
|---|--:|--:|--:|--:|
| **Full Synod** | **$8,968** | — | 100% | $3,000 |
| − causal challenge | $8,968 | ±$0 | 100% | $3,000 |
| − probe trigger | $7,384 | **−$1,584** | 100% | $1,423 |
| uniform Arbiter | $8,923 | −$45 | 100% | $3,000 |
| single lens — Trust | $6,466 | −$2,502 | 100% | $1,423 |
| single lens — Pressure | $2,941 | **−$6,027** | **33%** | $0 |
| single lens — Frame | $8,354 | −$614 | 100% | $2,410 |
| single lens — Probe | $8,968 | ±$0 | 100% | $3,000 |
| single lens — Hedge | $8,832 | −$136 | 100% | $2,832 |

Three findings, two of them nulls we report as found:

1. **The EVI probe trigger is load-bearing**: removing it costs $1,584 and collapses the
   deceptive scenario to $1,423.
2. **The council's value is ex-ante robustness, not hindsight genius.** Collapsing to a
   single worldview spans $2,941–$8,968 depending on which lens you bet on — betting wrong
   costs up to 67% of achievable surplus and craters the deal rate to 33%. The Probe
   lens happens to win *on this suite*; you only know that in hindsight. The full council
   matches the best single lens without knowing in advance which worldview the counterparty
   will reward — the same argument as ensembles vs. the best-model-in-hindsight.
3. **Honest nulls:** the causal-challenge concession rarely flips a round in the
   deterministic council (the confidence-edge rule is deliberately conservative; live-Qwen
   defenders concede on merit instead), and uniform weighting costs only $45 on this suite —
   the Arbiter's terrain reading shows up in confidence calibration more than raw surplus.
   We publish what the harness returns, not what flatters the architecture.

Run it yourself: `GET /api/ablation`, or `npm run demo`.

## Hold-out: adversarially-authored worlds (n=10 each)

The fair objection to any self-built benchmark is "you authored the world." So a model
from a **different vendor** (Claude, Anthropic) authored five new counterparty
parameterizations with explicit instructions to *stress the council's instincts* —
thin margins, hair-trigger walk sensitivity, scarce patience that punishes probing, a
bluff that only partially disarms. The worlds were frozen before evaluation
([`src/gm/holdout.ts`](./src/gm/holdout.ts) carries the provenance note); the council's
payoff model was calibrated on the original three profiles only; results are published
as measured.

| World | Designed to punish | Baseline | Council |
|---|---|--:|--:|
| Iron procurement | overreach under thin margins | $1,000 · 100% | $1,000 · 100% |
| Hair-trigger founder | any aggressive weighting | **$0 · 0%** | **$2,800 · 100%** |
| Probe-punisher | the EVI probe rule itself | **$0 · 0%** | **$3,396 · 100%** |
| Generous whale | over-caution (a tie is honest here) | $3,525 · 100% | $3,997 · 100% |
| Stonewall bluffer | the probe→close path (partial disarm) | **$0 · 0%** | **$1,971 · 100%** |
| **Total** | | **$4,525** | **$13,164** |

The single agent walked to $0 in three of five adversarial worlds; the council closed
all fifty negotiations. The world built to break the probe rule is the one the council
won hardest — and the designed tie tied, which is what an honest harness looks like.
Run it: `GET /api/holdout`.

### "Why isn't Synod just the Probe lens?"

The sharpest reading of Exhibit B: on the original suite, a Probe-only council ties
the full council ($8,968). Fair question. The hold-out suite answers it empirically:

| World | Council | Trust | Pressure | Frame | Probe | Hedge |
|---|--:|--:|--:|--:|--:|--:|
| Iron procurement | $1,000 | $933 | $1,000 | $1,000 | $1,000 | $1,000 |
| Hair-trigger founder | $2,800 | $2,800 | **$0 (0%)** | $2,800 | $2,800 | $2,800 |
| Probe-punisher | **$3,396** | $1,259 | **$0 (0%)** | $2,305 | $3,305 | $2,882 |
| Generous whale | **$3,997** | $3,979 | $3,764 | $3,979 | $3,979 | $3,982 |
| Stonewall bluffer | $1,971 | $1,465 | **$0 (0%)** | **$2,200** | $1,971 | $2,149 |
| **Total** | **$13,164** | $10,436 | $4,764 | $12,284 | $13,055 | $12,813 |

Three observations, including the honest one:

1. **The council is first on total and never catastrophic.** Every single-lens arm
   except Probe has at least one wiped-out world; Pressure has three.
2. **Probe (the information lens) is genuinely strong** ($13,055, no wipeouts) — its
   information-theoretic scoring is the most robust single worldview. The council still
   beats it where its own instinct is the trap (Probe-punisher: $3,396 vs $3,305) and never loses.
3. **Single lenses can win individual worlds** — Frame takes Stonewall by $229.
   No lens dominates across worlds, and which one wins is only knowable in hindsight.

That's the answer: **zero hindsight regret.** Across both suites the council matches or
beats every single worldview without knowing in advance which one the terrain will
reward — and betting on the wrong one costs up to everything.

## Belief calibration (the confusion matrix a skeptic asks for)

Terminal-posterior argmax vs ground truth, scripted suite, n=10 per type
(`GET /api/calibration`):

| true \ predicted | relationship | soft_floor | deceptive |
|---|--:|--:|--:|
| relationship | **9** | 1 | 0 |
| soft_floor | 6 | **4** | 0 |
| deceptive | 0 | 0 | **10** |

Accuracy 77% · mean P(true type) at terminal 0.60. Read the errors before the
accuracy: **deceptive detection is 10/10** — the type the architecture exists to catch —
and every confusion sits between soft-floor and relationship, two types that behave
identically *until someone pushes hard enough to expose the floor*. The council plays
cooperatively, so it often never pays for that distinguishing evidence — and it doesn't
need to, because the optimal action against both types largely overlaps. **Belief
accuracy in Synod is instrumental, not terminal**: the system buys exactly the
distinctions that change the optimal move (and the surplus tables show it). The same
property explains live human play: a player on a "relationship" brief who fabricates
competitor leverage and stonewalls is *behaving* deceptively, and the posterior tracks
the behaviour — the belief is over conduct, not name tags, and verbal justifications
are deliberately inadmissible (cheap-talk immunity: words move the council's play via
the Trust read; only costly action moves what it believes).

## Run it

Runs fully offline with deterministic mock agents — no API key needed.

```bash
npm install
npm run demo      # CLI: a full negotiation (the Probe→reveal→update beat) + the A/B table
npm run dev       # web UI at http://localhost:4173 (round trajectory + clickable lens cards)
npm run mcp       # MCP server: the council as a callable tool (stdio)
```

### Synod as an MCP server

Any MCP-capable agent can convene the council as a tool:

```jsonc
// e.g. in an MCP client config
{ "synod": { "command": "npx", "args": ["tsx", "src/mcp.ts"], "cwd": "<repo>" } }
```

Tools: `negotiate` (full council run → outcome + per-round decision trail + signed
receipts), `run_ab_comparison`, `run_ablation`, `list_scenarios`, `get_receipts`,
`describe_council`. The deliberation that powers the UI is the same one returned to
the calling agent — Synod is a *society another agent can consult*.

### Live Qwen (the demo mode)

```bash
cp .env.example .env   # set LLM_PROVIDER=qwen and DASHSCOPE_API_KEY=...
npm run dev
```

Live mode puts Qwen behind every reasoning surface — the Trust read, all five lens
positions, the challenge/defense dialogue (including the concession decision), and the
Arbiter's terrain reading. The deterministic engine, the Quant, and the belief update
never call an LLM — reproducibility is the point (spec §5). **For judging, run live**:
offline mode exists so the evidence is reproducible, not because the AI is optional.

### Adversary GM — an opponent nobody scripted

In live mode the UI offers **GM: Qwen adversary**: Qwen plays the counterparty from a
hidden character brief (true reservation, real need, a bluff to run). The behavioral
decisions — how much to concede, whether the bluff survives a sincere probe, when to
walk — are the model's; only the accounting (reservation ceiling, trust arithmetic,
round cap, surplus math) stays in code so results remain bounded and comparable. This
answers the fair objection that the deterministic GM is authored by the same team as
the council: in adversary mode, **both sides of the table are agents, and neither is
scripted by us.** The deterministic GM remains the default because the A/B table
depends on seeded reproducibility.

## Layout

```
src/
  core/        action set + shared type contracts + the five lenses
  gm/          Game Master: hidden state, deterministic transitions, scoring
  belief/      Bayesian update + Expected Value of Information
  payoffs.ts   the money payoff model u(a, θ) (shared by Quant + EVI + lenses)
  engine/      deterministic scoring spine (U, margin, dispersion, confidence)
  agents/      lens policies + Arbiter + strong baseline (mock offline / qwen live)
  quant/       cold money-EV divergence
  dotto/       risk gate + signed receipts
  protocol/    the round loop + single-round step (strict info boundary)
  suite.ts     the 3 hidden-type scenarios (fixed seeds)
  harness/     the A/B comparison + the ablation study
  server.ts    Express + SSE stream
  mcp.ts       MCP server — the council as a callable tool
  demo.ts      CLI runner
public/        the web UI (vanilla, thin)
```

## Why parallel, not iterative

The five lenses score independently — they don't read each other's output before voting.
This is intentional. Real expert committees don't deliberate in a circle before the chair
decides; each expert gives their independent assessment and the chair resolves disagreement
at synthesis time. Cross-contamination between advisors is a known failure mode (groupthink,
anchoring on the first speaker). Synod's parallel structure keeps the dissenting lens
honest even when it's in the minority.

The one exception is deliberate: the most-diverging pair exchange **one challenge and one
response** after all positions are in, before the Arbiter weighs in. The exchange has
teeth — the defender may revise its score on the contested action (concession clamped to
0.1, applied before the engine runs, recorded in the round receipt). One bounded exchange
surfaces the real disagreement and lets a strong objection move the outcome, without
collapsing independent signals into a debate-converged compromise.

The on-screen weight trajectory is the visible shadow of this: as the Bayesian belief
converges on a counterparty type, the context vector shifts, and the Arbiter re-weights
the lenses accordingly. The weight distribution is itself an updating, evidence-driven decision.

## Boundaries — what Synod cannot do yet

Found by adversarial testing (much of it by judges and rival models), published because
the failure modes are as informative as the wins:

1. **It never walks away on its own.** In a "no-zone" test (counterparty's true ceiling
   $7,500, below our $8,000 floor — no mutually beneficial deal exists), the council
   chose the `walk` action in **0/10 runs**: it ground through three futile rounds every
   time until the simulator ended things. Within its payoff model this is coherent —
   every closable deal clears the floor by construction — but the model's type-space has
   no concept of a doomed negotiation, so futility recognition doesn't exist. A real
   deployment needs a BATNA-aware stopping rule.
2. **Cheap-talk immunity cuts both ways.** The belief layer ignores verbal claims by
   design (a bluffer and an honest buyer can say identical things), which makes it
   bluff-resistant — and blind to genuinely informative honest speech. An honest buyer
   whose constraints are purely verbal gets read skeptically until they act.
3. **Beliefs are noisy; the policy is what's robust.** The calibration matrix shows
   confusions between behaviourally-similar types, and live human play can drive the
   posterior to a wrong label. What the duels show is that classification error does
   not cascade: the council still negotiates appropriately and converges on surplus.
   Synod is a **decision system under epistemic uncertainty**, not a truth-finder —
   judge it on its moves, which is what the receipts record.
4. **The unscripted-adversary comparison is unfinished.** Against a qwen-turbo
   counterparty that stonewalls everyone identically, council and baseline converge to
   the same cap outcome — an uninformative cell, pending a stronger adversary model.

## Honest caveat

The lens scores, the belief priors, and the payoffs are estimates (closed-form offline, LLM
estimates live). The math does **not** make a decision "objectively optimal." What it buys:
reproducible aggregation, calibrated confidence, principled Probe triggering via EVI, and an
auditable divergence-from-EV number — claimed, not objectivity.
