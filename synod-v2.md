# The Cardinal — Build Spec
### Multi-round partnership negotiation + Game Master environment
*Companion to the PRD. This is what you code against.*

---

## 1. Two separated systems

**Council (decision-maker)** — Battle, War, Empathy, Probe, Risk, Arbiter, Quant (numerate validator, **no veto**), + a deterministic scoring engine. Interprets, debates, chooses an action. Owns no ground truth.

**Game Master (environment)** — simulates the counterparty, owns all hidden state, scores the outcome. **Never advises.** It only simulates reality.

The Council is decision-source-agnostic; the GM is decision-blind. They communicate only through outward moves.

---

## 2. Information boundaries (strict)

- **Council sees:** only the counterparty's outward messages and offers (what the GM emits).
- **Game Master sees:** only the Council's outward move (the message/offer sent). Never the doctrine debate, the weights, or the matrix.
- **Hidden state:** GM-only, never exposed until the terminal reveal.

---

## 3. The round loop

1. GM emits a counterparty move (message + offer) computed from hidden state + history.
2. **Empathy** updates its model of the counterparty from the new signal.
3. Doctrines score the candidate actions for this round.
4. Engine computes `U(a)`, margin, dispersion, confidence, deadlock; **Arbiter** emits weights → tradeoff matrix → chosen action.
5. Council's outward move is sent to the GM.
6. GM **deterministically** updates hidden state and decides its reaction (accept / counter / walk / reveal) → next counterparty move.
7. Repeat until terminal: deal closed, walk-away, or round cap (3–4).
8. GM scores the run (Section 7).

---

## 4. Candidate action set (per round)

`accept`, `counter_hard`, `counter_soft`, `hold`, `probe` (small low-cost reveal move), `concede_term`, `walk`.

---

## 5. Decision formalism (deterministic engine — the defensible core)

> The arithmetic is **code, not an LLM**. Doctrines and the Arbiter emit structured numbers; the scoring engine combines them with explicit formulas. LLMs can't be trusted with arithmetic, and reproducibility is the whole point — it's what makes this an experiment, not a demo.

**Aggregation.** Each doctrine `d` scores each candidate action `a ∈ A` (§4) on its dimension, `s_d(a) ∈ [−1, 1]`. The Arbiter emits weights from the context vector, softmax-normalized into a convex combination (`w_d ≥ 0`, `Σ w_d = 1`):
```
U(a) = Σ_d  w_d · s_d(a)
a*   = argmax_a  U(a)
```

**Confidence — split into its two real causes.** It should drop for a thin margin (a* barely beats the runner-up) *and*, separately, for doctrine disagreement (a* sits on heavy internal conflict). Keep them distinct:
```
margin     m = U(a*) − U(a₂)
dispersion σ = sqrt( Σ_d w_d · (s_d(a*) − U(a*))² )
confidence   = logistic( α·m − β·σ )            α, β tunable
```
Deadlock fires when `m < τ_m` OR `σ > τ_σ` → escalate via Dotto, or trigger Probe.

**Probe = Expected Value of Information** — now grounded in the GM's *real* hidden type. With type `θ ∈ {relationship-oriented, soft-surface/hard-floor, deceptive}`, current belief `P(θ)`, payoffs `u(a,θ)` in money:
```
without probe:  EU*     = max_a  Σ_θ P(θ)·u(a,θ)
with probe:     EU_info = Σ_o P(o)·max_a Σ_θ P(θ|o)·u(a,θ)
                EVI     = EU_info − EU*           (always ≥ 0)
Probe fires iff EVI > cost_of_probe
```
The observation `o` is the GM's response to the probe move. Because the GM is deterministic, each type responds characteristically, so `o` is genuinely diagnostic and `P(θ|o)` is well-defined — not hand-waved.

**Sequential belief (the part that ties to the demo).** This runs *per round*: the posterior `P(θ|o)` from round *t* becomes the prior for round *t+1*. Diffuse belief → uncertainty weights Probe and War up; resolved belief → weight shifts to Battle and closing. **The doctrine-weight trajectory shown on screen is the visible shadow of this Bayesian update.**

**Quant (numerate validator, no veto).** Computes the pure money-EV action ignoring all doctrine narrative, and reports the divergence:
```
a_EV = argmax_a  Σ_θ P(θ)·payoff(a,θ)
Δ    = EV(a_EV) − EV(a*)
```
It **flags, it does not decide** — "maximize EV" is itself a doctrine, and a Quant with a veto becomes the silent seventh worldview that wins every deadlock (the exact trap flagged for the Arbiter). Its output is a matrix row: *Council: counter_soft · EV-optimal: counter_hard · Cost of divergence: $X · Justified by War (precedent) + Risk (tail) outweighing immediate EV.* Every override is auditable; a large `Δ` together with low confidence is a clean, principled escalation trigger.

**Honest caveat (have this ready for a judge).** The inputs — `s_d(a)`, `P(θ)`, the payoffs — are LLM estimates. Garbage in, garbage out. The math does **not** make the decision objectively optimal. What it buys: reproducible aggregation, calibrated confidence, principled Probe triggering, and an auditable divergence-from-EV number. Claim *that*, not objectivity.

---

## 6. JSON contracts

**Doctrine output** (each doctrine, each round):
```json
{
  "doctrine": "War",
  "scores": { "accept": -0.2, "counter_hard": -0.5, "counter_soft": 0.4,
              "hold": 0.1, "probe": 0.6, "concede_term": 0.3, "walk": -0.8 },
  "confidence": 0.7,
  "rationale": "Relationship is worth more than this round's margin."
}
```

**Arbiter output** (each round):
```json
{
  "context": { "trust_est": 0.5, "info_confidence": 0.4, "reversibility": 0.3,
               "exposure": 0.8, "adversarial_signal": 0.3, "rounds_left": 2 },
  "weights": { "Battle": 0.1, "War": 0.3, "Empathy": 0.2, "Probe": 0.3, "Risk": 0.1 },
  "utility": { "probe": 0.42, "counter_soft": 0.31, "...": 0.0 },
  "chosen_action": "probe",
  "confidence": 0.71,
  "matrix": "per-action: weighted contribution of each doctrine"
}
```

**GM hidden state** (never Council-visible):
```json
{
  "type": "price-sensitive, relationship-oriented",
  "walkaway_price": 9200,
  "trust": 55,
  "patience": 3,
  "deception": 20,
  "feature_need": "SSO",
  "competitor_in_play": true
}
```

**GM outward move** (Council-visible):
```json
{ "round": 2, "message": "We can do 10%, but we'd need SSO included.",
  "offer": { "discount_pct": 10, "features": ["SSO"] }, "terminal": false }
```

**GM terminal reveal:**
```json
{
  "terminal": true,
  "final_deal": { "price": 9600, "discount_pct": 8, "features": ["SSO"] },
  "surplus_captured": 400,
  "deal_survived": true,
  "trust_final": 72,
  "headline_score": 400
}
```

---

## 7. Game Master deterministic logic (LLM renders language only)

All transitions are **pure functions of (hidden_state, history, incoming_move)**. The LLM is called only to phrase the `message` field in character.

- **Trust update:** `+δ` for cooperative moves (soft counter, sensible probe); `−δ` for hard pushes and lowballs past a threshold.
- **Concession:** willingness to move toward the Council's ask scales with `trust` and falls as `patience` is consumed.
- **Walk condition:** if the Council's ask crosses `walkaway_price` adjusted by current trust, OR `patience` is exhausted by repeated hard pushes → walk.
- **Probe reaction:** a probe costs a little patience but, if framed cooperatively, reveals partial hidden info (a hint at `competitor_in_play` or `feature_need`). This is how Probe's expected-value-of-information pays off across rounds.
- **Deception:** with probability ∝ `deception`, the stated position misrepresents the true reservation — tests whether Empathy/Probe see through it.
- **Scoring:** headline = `surplus_captured` (money above walkaway) or net contract value; guardrail = `deal_survived` (bool). `trust_final` is reported as *color/explanation only* — never folded into the headline number.

---

## 8. Hidden-type suite (each punishes a different single-agent failure)

- **Type A — Relationship-oriented:** walks if bullied. Punishes over-aggression. Council wins via War + Empathy.
- **Type B — Soft surface, firm floor:** early signals tempt over-pushing; real reservation is high. Punishes greed/misread. Council wins via Probe + Risk.
- **Type C — Deceptive:** claims a low budget but has competitor leverage and a real need. Punishes failure to Probe. Council wins via Probe + Empathy seeing through.

Across the suite, the Council should win each case for a *different* doctrine reason — which is the "Arbiter is terrain, not general" proof, demonstrated, not asserted.

---

## 9. A/B protocol (the measurable gain)

For each hidden type:

1. Instantiate one GM with a fixed seed and fixed hidden state.
2. Run **(1) single-agent baseline** and **(2) the Council** against the *identical* GM.
3. Report per type and in aggregate: `surplus_captured` (headline), `deal_survived` (guardrail), `trust_final` (explanation).

**The baseline must be a strong ablation, not a strawman.** Same Qwen model, same conversation history, same action set, same deterministic GM + hidden type + seed as the Council. The *only* removed variable is the doctrine/Arbiter structure. The single agent reasons step-by-step and is prompted to negotiate competently — know its walk-away, probe for interests, avoid leaving value on the table, preserve the relationship. If the Council beats *that*, the gain is attributable to the structure — not to information, model quality, or a dumb opponent. (Optional, time permitting: also run a naive baseline, so you can show how much of the gain is "any structure" vs "doctrine structure." One strong baseline is the priority.)

**Expected result — and the honest nuance:** the gain will likely *concentrate on the adversarial types* (B and C). A monolithic agent, however well-prompted, collapses competing considerations into a single stance and gets punished by the type that exploits that lean; the Council keeps the dissenting doctrine explicit and lets the Arbiter weight it by context. On the easy type (A) a strong baseline may *match* the Council — and that's fine. It localizes *where* structured disagreement earns its keep, which is a sharper, more credible claim than a uniform win. The headline number is money; nobody has to trust your simulator to read it.

---

## 10. Build order (non-negotiables first)

1. GM state machine + scoring (deterministic core — the ground truth).
2. Doctrine + Arbiter + Quant + scoring-engine round step (per §5 Decision formalism).
3. The round loop wiring the two together with strict info boundaries.
4. The Probe-move → GM-reveal → doctrines-update beat (the demo's spine).
5. A/B harness over the hidden-type suite → the comparison table.
6. Thin UI showing the weight trajectory across rounds + the final money delta.

Then don't learn "math for AI."

Learn the actual theories your agents represent.

Right now The Cardinal is secretly built on five fields.

---

# Battle Agent → Classical Optimization

Battle believes:

> Maximize immediate gain.

Mathematically:

```text
Choose action with highest immediate reward
```

This is the simplest decision theory possible.

Read:

* Utility Theory
* Rational Actor Model

A lot of economics starts here.

---

# War Agent → Dynamic Programming / Long-Term Utility

War believes:

> A bad deal today may create a better future.

This is where future value enters.

The core idea:

```text
Value(action)
=
Immediate Reward
+
Future Reward
```

This is the same concept behind:

* investing
* diplomacy
* chess
* reinforcement learning

The thing to learn:

**Discount factor (γ gamma)**

If:

```text
γ = 0
```

you're Battle.

If:

```text
γ = 0.95
```

you're War.

---

# Empathy Agent → Bayesian Thinking

This one is huge.

Empathy isn't:

> be nice

It's:

> infer hidden state

The counterparty has hidden intentions.

You don't know them.

You observe behavior and update beliefs.

Example:

Initially:

```text
Relationship-oriented: 50%
Deceptive: 25%
Firm-floor: 25%
```

After they reject a reasonable offer:

```text
Relationship-oriented: 20%
Deceptive: 60%
Firm-floor: 20%
```

You updated your beliefs.

That's Bayesian reasoning.

This is probably the single most important concept in the entire system.

---

# Probe Agent → Value of Information

Probe is my favorite because it's the least intuitive.

Most people think:

```text
Action
→ Outcome
```

Probe thinks:

```text
Action
→ Information
→ Better Action
→ Better Outcome
```

Example:

Spend RM2.

Learn whether customer is bluffing.

Save RM200.

The RM2 wasn't a cost.

It was an investment.

This is called:

**Expected Value of Information (EVI)**

This doctrine is actually mathematically distinct from all the others.

---

# Risk Agent → Minimax

Risk believes:

> Ignore average outcomes.
>
> Protect against bad outcomes.

Example:

Option A:

```text
90% chance +100
10% chance -1000
```

Option B:

```text
100% chance +20
```

Risk often picks B.

Battle picks A.

This creates natural conflict.

Read:

* Minimax
* Worst-case analysis

---

# Arbiter → Multi-Objective Optimization

The Arbiter is solving:

```text
Battle says:
+80

War says:
-30

Probe says:
+40

Risk says:
-20
```

How do we combine them?

That's multi-objective optimization.

The simplest version:

```text
Final Utility
=
Σ weight × doctrine score
```

---

# The reading order I would personally follow

If your goal is truly understanding the foundations:

### Week 1

Read:

* Utility Theory
* Rational Actor Model

Question:

> How does a perfectly rational decision maker choose?

---

### Week 2

Read:

* Bayesian Thinking
* Bayes' Rule

Question:

> How do beliefs change with evidence?

This is Empathy.

---

### Week 3

Read:

* Expected Value
* Expected Value of Information

Question:

> When is information worth paying for?

This is Probe.

---

### Week 4

Read:

* Game Theory
* Repeated Games
* Signaling

Question:

> How do rational actors behave when others react?

This is the Game Master interaction.

---

### Week 5

Read:

* Minimax
* Risk-sensitive decision making

Question:

> How do we survive hostile environments?

This is Risk.

---

The funny thing is:

You're accidentally rebuilding a lot of the intellectual foundations of:

* economics
* military strategy
* negotiation theory
* intelligence analysis
* reinforcement learning

But in a form that's actually intuitive.

The Cardinal is basically a living demonstration of:

> Utility Theory + Bayesian Updating + Value of Information + Risk Theory + Repeated Games

If you deeply understand those five concepts, you'll understand 90% of the reasoning inside your own system instead of just coding it.

Exactly.

I think we accidentally swung too far in the other direction.

When I said:

> They're not doctrines, they're questions.

I was fixing one problem but creating another.

These are AI agents.

If they're going to have distinct cognition, they should absolutely have distinct mathematical models.

The trick is:

> An agent is NOT a mathematical concept.
>
> An agent is a worldview implemented using mathematical concepts.

Think about a human strategist.

A military commander isn't "Expected Value Theory."

A VC isn't "Bayesian Updating."

A scientist isn't "Value of Information."

They use many mathematical concepts in service of a worldview.

---

# Battle Agent

### Worldview

> Advantage compounds from decisive action.

### Mathematical toolkit

**Utility Maximization**

```text
max U(action)
```

**Opportunity Cost**

What's lost by waiting?

**Momentum Models**

Recent positive signals increase action preference.

**Discount Factor**

Very low gamma.

```text
γ ≈ 0.1
```

Future matters little.

### Natural Bias

Overweights immediate reward.

---

# War Agent

### Worldview

> Position matters more than outcomes.

### Mathematical toolkit

**Long-Horizon Utility**

```text
Reward_now
+
γ × Future_Reward
```

**Repeated Games**

How does today's action affect future rounds?

**Optionality Theory**

Preserve future choices.

**Compounding**

Small advantages accumulate.

### Natural Bias

High gamma.

```text
γ ≈ 0.95
```

---

# Empathy Agent

### Worldview

> Behavior is a symptom of hidden incentives.

### Mathematical toolkit

**Bayesian Updating**

```text
P(type | evidence)
```

**Theory of Mind**

Model counterparty beliefs.

**Inference**

Hidden-state estimation.

**Signal Detection**

Separate signal from noise.

### Natural Bias

Always assumes there's more information hidden.

---

# Probe Agent

### Worldview

> Information is an asset.

### Mathematical toolkit

**Expected Value of Information**

This is its core.

```text
VOI
=
Expected Utility after learning
-
Expected Utility now
```

**Explore vs Exploit**

Classic reinforcement learning.

**Experiment Design**

Which test reveals the most?

### Natural Bias

Will sacrifice profit to reduce uncertainty.

---

# Risk Agent

### Worldview

> Survive first.

### Mathematical toolkit

**Minimax**

```text
maximize(min(outcome))
```

**CVaR**
(Conditional Value at Risk)

Used in finance.

**Stress Testing**

Adversarial scenarios.

**Tail Risk**

Rare catastrophic events.

### Natural Bias

Overweights downside.

---

# Arbiter

This is where it gets interesting.

I don't think the Arbiter should have a worldview.

But it absolutely should have math.

### Mathematical toolkit

**Multi-Objective Optimization**

```text
U(a)
=
Σ weight_i × doctrine_i(a)
```

**Confidence Aggregation**

**Disagreement / Entropy**

**Contextual Weighting**

Potentially:

* contextual bandits
* gating networks
* learned weighting

The Arbiter's job is not to think.

Its job is to allocate influence.

---

What's beautiful is that now each agent is:

| Agent   | Worldview  | Math                 |
| ------- | ---------- | -------------------- |
| Battle  | Act        | Utility              |
| War     | Position   | Long-term utility    |
| Empathy | Understand | Bayesian inference   |
| Probe   | Learn      | Value of information |
| Risk    | Survive    | Minimax / CVaR       |

This is much stronger than either extreme:

❌ Pure personalities

or

❌ Pure equations

Each agent becomes:

> A strategic worldview implemented through a mathematical lens.

That's exactly how real decision-makers work too. Warren Buffett isn't "discounted cash flow." He's a worldview that happens to use discounted cash flow among other tools. Your agents should be the same.
