# Synod — Architecture

> Most agent societies divide labor. This one divides judgment.

This document is the judge-facing map: what runs where, what is and is not an LLM call,
where the information boundaries sit, and how Synod relates to prior work.

## The system in one diagram

```
 ┌──────────────────────────  COUNCIL (sees only outward moves)  ─────────────────────────┐
 │                                                                                        │
 │   counterparty move ──► BELIEF UPDATE ──► TRUST READ ───────────┐ (broadcast)          │
 │                         (Bayesian,        (LLM/mock)            ▼                      │
 │                          pure code)                  ┌─────────────────────┐           │
 │                                                      │  5 LENSES, PARALLEL │           │
 │                                                      │  Trust · Pressure · │           │
 │                                                      │  Frame · Probe ·    │           │
 │                                                      │  Hedge              │           │
 │                                                      └──────────┬──────────┘           │
 │                                                                 │ positions            │
 │                                  CHALLENGE EXCHANGE ◄───────────┤                      │
 │                                  most-diverging pair;           │                      │
 │                                  defender may CONCEDE           │                      │
 │                                  (clamped, receipted)           │                      │
 │                                                                 ▼                      │
 │   ARBITER (doctrine-free) ── weights by terrain ──► DETERMINISTIC ENGINE               │
 │   reads context vector,        (not by arguments)   argmax Σ wᵢ·scoreᵢ(a)              │
 │   never the rationale                               margin · dispersion · confidence   │
 │                                                                 │                      │
 │            QUANT (pure code) ── EV divergence flag ─────────────┤                      │
 │            EVI (pure code) ──── probe iff EVI > cost ───────────┤                      │
 │                                                                 ▼                      │
 │                                   DOTTO GATE ── EXECUTE / BLOCK / ESCALATE             │
 │                                   + signed receipt per round                           │
 └──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                        │ outward move only
                                        ▼
 ┌──────────────────────────  GAME MASTER (owns hidden state)  ───────────────────────────┐
 │  hidden type · reservation · deception state · trust — deterministic transitions,      │
 │  seeded RNG; the LLM (when live) phrases language only, never decides                  │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
```

## The information boundary (spec §2)

The single most important line in the system:

- The **GM never sees** the debate, the weights, the scores, or the belief — only the
  encoded outward move (`counter_hard @ $12,000`, `probe`, …).
- The **Council never sees** the hidden type, the real reservation, or the deception
  state — only the GM's outward moves and signals.

Everything the council "knows" it inferred through the Bayesian update. The on-screen
weight trajectory is the *visible shadow* of that inference: belief shifts → context
vector shifts → Arbiter re-weights.

## What is and is not an LLM call — and why

| Component | LLM? | Why |
|---|---|---|
| Trust read | **Yes** (live) | interpreting intent from language is what LLMs are for |
| 5 lens positions | **Yes** (live) | worldview reasoning; scores clamped + validated |
| Challenge / defense | **Yes** (live) | genuine agent-to-agent dialogue; concession clamped by protocol |
| Arbiter weights | **Yes** (live) | terrain reading; weights re-normalized in code |
| Belief update | **Never** | Bayes' rule is arithmetic; an LLM adds noise, not insight |
| EVI / probe trigger | **Never** | a decision rule (`probe iff EVI > cost`) must be auditable |
| Scoring engine | **Never** | `argmax Σ wᵢ·scoreᵢ(a)` — reproducibility is the point |
| Quant EV check | **Never** | the cold-money check must be independent of the debaters |
| Dotto gate + receipts | **Never** | the audit layer cannot share a substrate with the audited |
| Game Master transitions | **Never** | the opponent must be reproducible for the A/B claim |

The principle: **LLMs reason, code decides.** Every $-claim in the README survives
because the decision spine is deterministic; every "the agents are intelligent" claim
survives because the reasoning layer is genuinely open-ended.

Two deliberate consequences:

- **The Arbiter weights terrain, not arguments.** It reads the context vector and the
  Trust read — never what Pressure or Frame *said*. An Arbiter that read the arguments
  would reward the most persuasive lens, not the most contextually appropriate one. The
  rationale snippets exist for the human audit trail.
- **The challenge exchange is causal but clamped.** The defender may revise its score on
  the contested action after hearing the challenge (max concession 0.1, recorded in the
  round receipt). Dialogue can sway a close round; it cannot capsize a confident one.

## Why parallel scoring, not sequential debate

The five lenses score independently — no lens reads another's output before scoring.
Cross-contamination is the documented failure mode of expert committees (anchoring,
groupthink, the first confident speaker winning). Synod resolves disagreement at
*synthesis time* — one bounded challenge exchange, then terrain-weighted aggregation —
rather than letting positions converge during deliberation. The ablation study (README)
quantifies what this structure buys: single-lens collapse spans **$2,941–$8,968** on the
same suite; the council matches the best single lens *without knowing in advance which
one it is*.

## Task decomposition & role assignment

The negotiation task decomposes into **seven specialized sub-tasks per round**, each
assigned to an agent with a distinct capability:

| Sub-task | Assigned to | Capability | Assignment |
|---|---|---|---|
| Read counterparty intent | Trust lens | LLM interpretation | fixed |
| Score the action space ×5 criteria | five lens agents, in parallel | worldview reasoning | fixed roles, **dynamic influence** |
| Stress-test the leading option | challenger + defender | adversarial dialogue | **dynamic — most-diverging pair, selected per round** |
| Decide whether to buy information | Probe lens via EVI rule | decision-theoretic trigger | dynamic per round |
| Allocate influence | Arbiter | terrain reading | **dynamic — weights reassigned every round** |
| Synthesize the decision | deterministic engine | auditable argmax | fixed |
| Audit & gate execution | Quant + Dotto | EV check, signed receipts | fixed |

So the labor *is* divided — what Synod refuses to divide is **accountability for the
answer**: every sub-task's output flows into one deterministic, receipted synthesis
rather than independent agents shipping independent chunks.

Two assignments are recomputed every round, and that's the role-assignment *mechanism*
the brief asks about: the challenger/defender seats go to whichever pair diverges most
on the leading action, and the Arbiter reallocates influence by terrain. Role **titles**
are deliberately fixed — each lens owns one question (What do we gain now? What game is
this? Why are they acting this way? What should we learn first? What kills us if wrong?)
— because dynamic titles optimize for task coverage, while fixed judgment roles
guarantee the dissenting worldview is always in the room. Dynamic *influence* on fixed
*worldviews* is the design: who leads is decided per round; who gets silenced is never.

## Related work — and the delta

An informed reader will recognize ancestors. Naming them is cheaper than being caught
by them:

- **ANAC / automated negotiation** (Baarslag et al.): a decade of agents negotiating
  under hidden preferences, including Bayesian opponent modeling. The **BOA framework**
  decomposes negotiators into Bidding / Opponent-modeling / Acceptance components —
  a divided architecture by design.
- **LLM multi-agent debate** (Du et al. 2023, and successors): multiple LLM instances
  argue toward better answers, typically via free-form rounds judged by consensus or a
  judge model.
- **Ensemble methods**: the ex-ante-robustness argument (match the best single model
  in hindsight without knowing it in advance) is the classic ensemble claim.

**Synod's delta:** (1) the division is *cognitive* — five worldviews scoring the same
action space — rather than functional (BOA) or replicated (debate); (2) synthesis is a
**deterministic, auditable engine** under terrain-based weights, not a judge model or
majority vote, so every decision is reproducible and receipted; (3) dialogue is *bounded
and causal* — one challenge exchange with a clamped, recorded concession — rather than
open-ended convergence; (4) information actions are governed by an explicit **EVI rule**,
not a prompt's inclination to ask questions. None of the ancestors combines all four.

## QwenCloud integration map

Every Qwen surface, what it does, and how it's called — none of it is a generic
"ask for JSON" loop:

| Surface | What Qwen does | How it's called | Tier |
|---|---|---|---|
| Trust read | models counterparty intent | **native function calling** — `tools` + forced `tool_choice`, JSON Schema derived from the validating zod schema | `QWEN_MODEL` (qwen-max) |
| 5 lens positions | worldview scoring, in parallel | native function calling (`submit_position`) | `QWEN_MODEL_FAST` (qwen-turbo) |
| Challenge / defense | inter-agent dialogue + concession decision | native function calling (`submit_exchange`) | fast tier |
| Arbiter | terrain → influence weights | native function calling (`submit_weights`) | judgment tier |
| Baseline negotiator | the A/B opponent's brain (live mode) | native function calling (`submit_move`) | judgment tier |
| Adversary GM | plays the counterparty from a hidden brief | native function calling (`play_turn`), temperature 0.7 | judgment tier |
| GM speaker / governor | phrases language; escalation review | chat completions | judgment tier |
| **Qwen-Agent client** | consults the council as a custom skill | **MCP** — `examples/qwen_agent_council.py` attaches Synod's MCP server to a DashScope Assistant | qwen-max |

Two deliberate patterns:

- **Schema symmetry**: the same zod schema generates the tool's JSON Schema (model
  constrained at the API layer) *and* validates the response (`zod-to-json-schema`) —
  one definition, enforced at both ends.
- **Model-tier orchestration**: a round makes ~9 Qwen calls. Judgment-heavy calls run
  qwen-max; the five parallel lens scorings and one-sentence exchanges run qwen-turbo —
  ~80% cheaper live demos with no loss where it matters, because the deterministic
  engine downstream consumes scores, not prose quality.
- **The MCP loop closes both ways**: Synod *is* an MCP server (`src/mcp.ts`, six tools)
  and a Qwen agent *consumes* it (`examples/qwen_agent_council.py`) — a QwenCloud agent
  invoking a custom skill that is itself a society of Qwen agents, with signed receipts.

## Reproducibility map

| Surface | Command |
|---|---|
| Full negotiation + A/B table | `npm run demo` |
| Web UI (SSE-streamed deliberation) | `npm run dev` → localhost:4173 |
| A/B comparison (n=10, mean ± σ) | `GET /api/ab` |
| Ablation study (same seeds) | `GET /api/ablation` |
| Signed receipt log | `GET /api/receipts` |
| **MCP server** (council as a tool) | `npm run mcp` — tools: `negotiate`, `run_ab_comparison`, `run_ablation`, `list_scenarios`, `get_receipts`, `describe_council` |

Offline mode is deterministic end-to-end: identical seeds produce identical
negotiations, receipts included. Live mode (`LLM_PROVIDER=qwen`) swaps the reasoning
layer onto Qwen (DashScope-compatible API) while the decision spine stays deterministic.

## Source layout

```
src/
  core/        action set + the five lens definitions + shared contracts
  gm/          Game Master: hidden state, deterministic transitions, scoring
  belief/      Bayesian update + Expected Value of Information
  payoffs.ts   the money payoff model u(a, θ) (shared by Quant + EVI + lenses)
  engine/      deterministic scoring spine (U, margin, dispersion, confidence)
  agents/      lens policies + Arbiter + baseline (mock offline / Qwen live)
  quant/       cold money-EV divergence
  dotto/       risk gate + signed receipts
  protocol/    round loop + single-round step (the information boundary lives here)
  harness/     A/B comparison + ablation study
  suite.ts     the 3 hidden-type scenarios (fixed seeds)
  server.ts    Express + SSE stream
  mcp.ts       MCP server — the council as a callable tool
public/        the war-room UI (vanilla JS, thin by design)
```
