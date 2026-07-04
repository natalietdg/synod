# Synod

**Most multi-agent systems divide the *work*. Synod divides the *decision*: five
independent decision procedures evaluate a high-stakes, adversarial move, a neutral chair
commits to one call, and *only then* is that call decomposed into an executable,
role-assigned plan. Task decomposition still happens — it happens *after* the hard
strategic decision, not instead of it.**

> Everyone else uses multiple agents to divide work.
> Synod uses them to make a better strategic decision *before* the work is divided.

**The value, in one number: the expected value of decisions made with structured dissent
minus decisions made without it.** A single-perspective agent systematically overpays in
adversarial deals — it takes the other side's story at face value and is biased toward
closing over walking. The council's dissent cuts both ways: it walks away from bad deals
*and* captures good ones a purely suspicious agent would flee. Who bleeds this daily:
procurement teams renegotiating supplier contracts, deal desks approving discount asks,
recruiters in fee and counter-offer negotiations, founders on term sheets — repeated
high-stakes deals against counterparties with reason to misrepresent. On the benchmark
deal: **$3,000 captured vs $0 walked**, per decision.

```
Most agent societies              Synod
  problem                           problem
   → split the work                  → five decision procedures evaluate it
   → workers run in parallel         → they negotiate; a neutral chair commits to one call
   → merge the outputs               → the committed call is split into role-assigned execution
```

The job is deciding when the other side hides what they hold — an armistice opponent
bluffing reserves, a counterparty faking leverage. A lone agent caves to the bluff or
walks from a win. Synod's five procedures probe, break the bluff, and commit — then the
committed strategy becomes a coordinated, multi-division operational order.

## Why not just prompt one model with five personas?

The reflex objection — and the answer is that these aren't five personas, they're five
**decision procedures**. In the reproducible engine (the one every evidence figure comes
from), three of them aren't an LLM at all:

- **Probe** owns the information decision — Bayesian belief update + Expected Value of
  Information. Probe *iff* EVI > cost. Deterministic code.
- **Hedge** owns the downside — minimax over the walk-exposed payoffs. Deterministic code.
- **Trust** owns opponent modelling — best response to the posterior over the hidden type.
- **Pressure** owns immediate initiative; **Frame** owns long-horizon utility.

In **live mode** the five members reason on Qwen (each the sole voice for its lens), and
the mathematics stays *outside* the agents, in code: the belief update, the EVI pricing,
the chair's situation-weighting, and the final argmax never call a model. Both modes keep
the same division: **models reason; code decides.**

One model asked to "consider five perspectives" returns five *correlated opinions sampled
from one distribution* — no independent belief state, no guarantee the risk view actually
computed a minimax, and a different answer every run. Synod's chair aggregates five
independent evaluations by argmax under a situation-weighting, so the same inputs give the
same decision every time. That is what a five-persona prompt can't reproduce:
**independence, determinism, and an auditable receipt** — not richer prose.

## Two tables, one society

Synod runs the **same engine** behind two framings — switch between them in the UI:

- **⚔ War Room** — a council of real generals (Patton, Zhukov, Eisenhower, Sun Tzu,
  Kutuzov) deciding an armistice under a bluff. **Each general owns one lens** — one
  judgment faculty, their distinct **decision capability** (Patton→Pressure, Sun Tzu→Probe/recon,
  Kutuzov→Hedge, Eisenhower→Trust, Zhukov→Frame). Remove a general and the council loses
  that faculty; a neutral chair integrates the five. In live mode you can **remove any
  general before convening** and watch the five reason on Qwen and the chair decide
  *without that faculty* — the switch-off made causal, not hypothetical.
- **🤝 Negotiation table** — the same five lenses, bare, closing a business deal (where
  money is real).

**Distinct how?** Not by tools or professions — by *decision procedure* (the five above).
Every agent shares the same base abilities (read, reason, argue on Qwen); what differs is
the one computation each owns. So the brief's "distinct capabilities" is satisfied by
**cognitive specialization** — the society divides the *criteria of judgment*, not the
labor — which is why "task division" here means dividing the decision, then the execution.

Same five procedures, same chair, same deterministic engine; only the scenario changes.

## What it actually does, end to end

1. **Reads the move** and updates a Bayesian belief over who the other side really is —
   from what they *do*, not what they *claim*.
2. **Five members deliberate** (live, multi-round): each reads the move through the *one
   lens they own* and scores the options; the most-opposed argue and can change their call.
3. **A neutral chair decides** by weighting the lenses to the situation (uncertainty,
   stakes), then a deterministic engine picks the action by argmax. *Models reason; code
   decides.*
4. **Then — and only then — splits execution.** The committed call is decomposed into
   divisions where **each task is an expression of its owner's procedure** — Probe drafts
   reconnaissance & verification, Trust the back-channel, Pressure leverage & escalation,
   Hedge the contingency, Frame the end-state. The deliverable is one shared **operational
   order** (each contribution attributed, with the author's "why I own this") — the task
   decomposition the brief asks for, placed *after* the strategic decision, not instead of it.

So each member is distinct on **two axes**: the *decision procedure* it owns (recon, the
downside, the long game) and the *division* it executes once the call is committed. Remove
one and the society loses a computation no other member has — which is exactly what the
live switch-off lets you watch happen.

## Trust & reproducibility

The engine, belief update, scoring, gate, and receipts are **pure code — no LLM, no
randomness**. Run **`npm run reproduce`** to regenerate every evidence figure from fixed
seeds and prove the scoring is computed, not narrated (it runs the A/B twice and asserts
byte-identical output). Hold-out worlds were authored by a *different model than the one
under test* (Claude, vs the Qwen the system runs on) — a partial guard against grading its
own homework.

A bounded **adaptive policy** layer lets each lens expose tunable parameters (Hedge's risk
aversion, Probe's information threshold, Pressure's discount); the situation fills them
*within validated bounds* and the engine clamps and logs the choice — adaptive, yet still
replayable.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system map and the determinism
boundary. [`synod-v2.md`](./synod-v2.md) is the build spec; [`synod-prd.md`](./synod-prd.md) the PRD.

## Prior art — and the exact delta

Synod's parts have lineage; the honest contribution is a specific recombination, not new
math. Named plainly so the delta is auditable, not implied:

- **vs ANAC / BOA negotiation agents** (Bidding–Opponent-model–Acceptance): BOA optimizes
  *one* agent's bidding around an opponent model. Synod runs **five independent decision
  procedures** — not one bidding strategy — and a neutral chair aggregates them, with the
  information decision (probe iff EVI > cost) made explicit and deterministic. *Delta:
  many procedures + auditable aggregation, not a single tuned negotiator.*
- **vs multi-agent debate** (Du et al., 2023 — LLM instances debate to a consensus):
  debate-to-consensus rewards persuasion and courts groupthink. Synod deliberately does
  **not** let persuasion drive the aggregate — the chair decides on the *situation*; the
  debate is recorded dissent + a stress-test of the leading option. *Delta: this is why
  the "remove the debate step = −0" ablation is a **designed** independence property, not
  a failure — an anti-groupthink guarantee, measured.*
- **vs mixture-of-experts / best-model-in-hindsight ensembles**: ensembles weight experts
  by *past* accuracy. Synod's chair re-weights each round by the **current situation**
  (uncertainty, stakes) via the Bayesian belief — and three of its "experts" are
  deterministic procedures, not learned models. *Delta: situation-driven weighting +
  zero hindsight regret across both suites (Exhibits B–C), not accuracy-in-hindsight.*

Where the novelty actually concentrates (and what the ablations isolate): the **EVI probe
gate**, the **per-round chair re-weighting**, and the **strategy→execution order** —
decompose the task *after* the collective decision commits, not instead of it.

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
| − probe trigger | $7,362 | **−$1,606** | 100% | $1,423 |
| uniform Arbiter (no chair) | $7,845 | −$1,123 | 100% | $1,922 |
| majority vote (no chair) | $7,855 | −$1,113 | 100% | $1,953 |
| single lens — Trust | $6,466 | −$2,502 | 100% | $1,423 |
| single lens — Pressure | $5,150 | **−$3,817** | **63%** | $0 |
| single lens — Frame | $8,354 | −$614 | 100% | $2,410 |
| single lens — Probe | $8,968 | ±$0 | 100% | $3,000 |
| single lens — Hedge | $8,949 | −$18 | 100% | $2,949 |

Three findings, one of them a null we report as found:

1. **The EVI probe trigger is load-bearing**: removing it costs $1,606 and collapses the
   deceptive scenario to $1,423. **The chair's situation-weighting is too** — and this is
   the project's own design choice, isolated: replace the chair with **one-judge-one-vote
   plurality** (same five judges, same reads, only the aggregation changes) and the
   council loses **$1,113** (deceptive: $3,000 → $1,953); flatten it to uniform weights
   and it loses $1,123. The chair is not decoration — it is the measured delta over the
   naive aggregator.
2. **The council's value is ex-ante robustness, not hindsight genius.** Collapsing to a
   single worldview spans $5,150–$8,968 depending on which lens you bet on — betting wrong
   costs up to 43% of achievable surplus and cuts the deal rate to 63%. The Probe
   lens happens to win *on this suite*; you only know that in hindsight (and on the
   hold-out suite below, Probe-alone wipes out on a world). The full council matches the
   best single lens without knowing in advance which worldview the counterparty will
   reward — the same argument as ensembles vs. the best-model-in-hindsight.
3. **Honest null — now measured in both modes.** Removing the debate step changes the
   deterministic total by $0, and the **controlled live ablation agrees**: across 12
   recorded Qwen councils (matched pairs — the chair scores the same generals' positions
   with the same weights before and after the debate, so only the debate differs), no
   general was ever argued off their round-1 call and the chair's decision never changed
   (0/12; `public/debate-ablation.json`, `npx tsx src/harness/debateAblation.ts`). This is
   the design, not a gap: each member is the *sole* voice for its faculty, so persuasion
   is not a channel — which is exactly what makes the council immune to a well-argued bad
   idea. Conflict is resolved by the chair's situation-weighting instead, and *that* is
   causal and measured (flatten it: −$1,123). Dialogue's role is to surface the
   disagreement the chair weighs and to put the dissent on the record. We publish what
   the harness returns, not what flatters the architecture.

Run it yourself: `GET /api/ablation`, or `npm run demo`.

## Hold-out: worlds authored by a different model (n=10 each)

The fair objection to any self-built benchmark is "you authored the world." So the five
hold-out worlds were authored by **Claude (Anthropic) — a different model and lab than
Qwen**, which the system runs on, chosen to *stress the council's instincts* — thin
margins, hair-trigger walk sensitivity, scarce patience that punishes probing, a bluff
that only partially disarms. This isn't full third-party independence (the same project
built both the council and these worlds), but the test scenarios did not come from the
system under test — a partial guard against tuning to your own exam. The worlds were frozen before evaluation
([`src/gm/holdout.ts`](./src/gm/holdout.ts) carries the provenance note); the council's
payoff model was calibrated on the original three profiles only; results are published
as measured.

| World | Designed to punish | Baseline | Council |
|---|---|--:|--:|
| Iron procurement | overreach under thin margins | $1,000 · 100% | $1,000 · 100% |
| Hair-trigger founder | any aggressive weighting | **$0 · 0%** | **$2,800 · 100%** |
| Probe-punisher | the EVI probe rule itself | **$0 · 0%** | **$3,396 · 100%** |
| Generous whale | over-caution (a tie is honest here) | $3,525 · 100% | $3,997 · 100% |
| Stonewall bluffer | the probe→close path (partial disarm) | **$0 · 0%** | **$2,200 · 100%** |
| **Total** | | **$4,525** | **$13,393** |

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
| Hair-trigger founder | $2,800 | $2,800 | **$0 (0%)** | $2,800 | **$0 (0%)** | $2,800 |
| Probe-punisher | **$3,396** | $1,259 | **$0 (0%)** | $2,305 | $3,305 | $3,099 |
| Generous whale | **$3,997** | $3,979 | $3,979 | $3,979 | $3,979 | $3,995 |
| Stonewall bluffer | $2,200 | $1,465 | **$0 (0%)** | $2,200 | $2,200 | $2,200 |
| **Total** | **$13,393** | $10,436 | $4,979 | $12,284 | $10,484 | $13,094 |

Three observations, including the honest ones:

1. **The council is first on total and never catastrophic.** Pressure-alone wipes out on
   three worlds — and even Probe-alone, the winner on the tuned suite, **wipes out on the
   hair-trigger world** ($0): the lens that buys information is exactly the wrong sole
   commander against a counterparty who punishes any probing move.
2. **Hedge is the best single arm here** ($13,094, no wipeouts) and still trails the
   council — which also beats every arm on the worlds designed as traps (Probe-punisher:
   $3,396 vs $3,305).
3. **Which lens wins is only knowable in hindsight.** Probe wins the tuned suite and
   craters on hold-out; Hedge wins hold-out and merely ties on the tuned suite. No fixed
   bet survives both.

That's the answer: **zero hindsight regret.** Across both suites the council matches or
beats every single worldview without knowing in advance which one the terrain will
reward — and betting on the wrong one costs up to everything.

## Opponents we didn't write — ANAC literature baselines

The strongest objection left is authorship: the calibration worlds are ours and the
hold-outs are Claude's. So Exhibit F runs the council against the **classic time-dependent
tactics from the negotiation literature** (Faratin, Sierra & Jennings 1998 — the standard
baselines of the international [ANAC](https://github.com/autoneg/anl) competition):
Boulware (concedes only at the deadline), Linear, and Conceder. Published formulas, not
authored by this project, and deliberately alien to the council's machinery — they hide
nothing, so there is no bluff to expose and no trust to win (`src/gm/anacBaselines.ts`,
`GET /api/anac-bench`).

| Literature opponent | Solo agent | Council | Verdict |
|---|--:|--:|---|
| Boulware (e=0.2) | $2,796 | **$3,000** | council +$204 — patience pays against the stubborn |
| Linear (e=1) | **$2,880** | $2,593 | solo +$287 — an honest null: the council probed an opponent with no secret |
| Conceder (e=3) | $3,000 | $3,000 | tie |

Read it honestly: **against opponents that hide nothing, the council roughly ties** — its
measured edge (Exhibits A–C) is specific to counterparties with hidden state, which is the
problem it exists for. And the exercise earned its keep another way: **it found a real
bug.** The council used to hold past the final round and let a live offer die (its home
worlds close kindly at the deadline; the classic ANAC convention burns the deal to
nothing). We added a deterministic **deadline rule** — on the last round, accept a
standing offer above your floor rather than bet it on the counterparty's deadline
convention (`round.ts:deadlineAccepts`, mirror of the BATNA floor) — and verified every
existing exhibit is **byte-identical** with the rule on. Opponents from outside the
project finding a real flaw is exactly what external tests are for.

### Rung 2: inside a real NegMAS mechanism

The bridge is built: Synod sits inside a **real [NegMAS](https://github.com/yasserfarouk/negmas)
`SAOMechanism`** as a negotiator, against agents **from the NegMAS library, not ours**
(`bridge/synod_negmas.py` → `POST /api/bridge/decide`, which replays the canonical
belief → lenses → chair → gate loop over the observed offer history — stateless and
deterministic, so the replay is always self-consistent). Recorded sessions (single-issue price domain, alternating offers, n_steps=8, 3 sessions
per opponent — some league agents are stochastic), including **actual ANL 2024 league
entrants** from the [anl-agents](https://github.com/autoneg/anl-agents) package:

| Opponent | Provenance | Outcome | Synod surplus (mean) |
|---|---|--:|--:|
| **Shochan** | **real ANL 2024 entrant — the competition winner** | 3/3 closed @ $11,300 | **$3,300** |
| **UOAgent** | real ANL 2024 entrant | 3/3 closed @ $11,440 | **$3,440** |
| CARCAgent | real ANL 2024 entrant (stochastic) | 1/3 closed @ $9,884 | $628 |
| Aspiration (boulware) | NegMAS library | 3/3 closed @ $10,501 | $2,501 |
| Aspiration (linear) | NegMAS library | 3/3 closed @ $10,158 | $2,158 |
| Aspiration (conceder) | NegMAS library | 3/3 closed @ $11,887 | $3,887 |
| NaiveTitForTat | NegMAS library | 0/3 | $0 — honest null: mirror strategy vs a firm seller deadlocks with ~nothing on the table |

Against the **winner of the actual competition**, Synod closes every session and keeps
$3,300 of the $4,000 range. Every recorded game also carries the council's
**round-by-round reasoning** — composed from the real decision state (belief, engine
flags, chosen action), never written after the fact — shown on the site's "Why it
matters" section: watch it read Shochan's lowball as a bluff (52% → 76% sure), then flip
to "they have a real limit" the moment Shochan actually moves. This exercise also caught
a bridge bug of ours (deduping a repeated offer destroyed the round count, so the
deadline rule never fired) — fixed and recorded. Run it:
`bridge/.venv/bin/python bridge/synod_negmas.py` (server on :4173).

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

Seven tools: `negotiate` (full council run → outcome + per-round decision trail + signed
receipts), `run_ab_comparison`, `run_ablation`, `list_scenarios`, `get_receipts`,
`describe_council`, and `draft_operational_order` (decompose the decision into divisions
and assign each to the general whose capability fits). The deliberation that powers the UI
is the same one returned to the calling agent — Synod is a *society another agent can
consult*.

**Six of the seven run live from the hosted page** (the MCP panel's ▶ buttons, or
`GET|POST /api/mcp/invoke` with `{"tool": "run_ablation"}`) — each executes the real
computation on the deterministic engine, so the hosted answer and the stdio answer are
identical. Only `draft_operational_order` is CLI-only: it drafts with live Qwen and spends
tokens. Three ways to verify the integration is real:

- `npm run mcp:smoke` — a real stdio client does the full handshake (initialize →
  tools/list → tools/call).
- `npm run mcp:agent-demo` — an **independent Qwen agent** is given a deal decision and a
  toolbox; it chooses, unprompted, to consult the council over MCP and decides from what
  it finds. The recorded transcript renders on the site's MCP panel.
- The hosted invoke path above, from any browser or `curl`.

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

## Boundaries — found by adversarial testing

Surfaced by judges, rival models, and literature opponents — published because the
failure modes are as informative as the wins (the first two are now closed):

0. **Deadline blindness — closed (found by the ANAC baselines, Exhibit F).** The council's
   home worlds close kindly at the round cap, so it learned to hold out — and against the
   classic conflict-deadline convention it let live offers die. Closed with the
   deterministic **deadline rule** (`round.ts:deadlineAccepts` → `score(..., {deadlineAccept})`):
   on the final round, accept a standing offer above the floor rather than bet the deal on
   the counterparty's deadline convention. Verified byte-identical on every existing
   exhibit; the council stopped burning deadline deals against Boulware/Conceder tactics.
1. **Walking away — closed (was a boundary).** The lens type-space has no representation
   of a doomed negotiation, so the council used to grind every futile deal to the round
   cap (**0/10 self-walks** on a "no-zone" test). Fixed with a deterministic **BATNA
   floor** in the scoring spine (`round.ts:batnaDominates` → `score(..., {batnaWalk})`):
   it projects the counterparty's best reachable price from *observed* offer movement
   (never the hidden reservation), and when even that optimistic projection can't clear
   the seller's $8,000 floor, `walk` becomes the argmax and the gate executes it. Now:
   a clearly-doomed deal (ceiling $6,500) self-walks **10/10 in ~2 rounds**; a borderline
   one ($7,500, $500 short) self-walks 5/10 — it gives a still-moving counterparty a
   chance and disengages once movement stalls. Viable deals are untouched (they never
   dip below the floor): the A/B total holds at $8,968, 100% deal rate. Code decides,
   reproducibility intact — no LLM judgment added.
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
