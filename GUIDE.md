# Synod — a plain-language guide

*Read this first. Everything on the screen, explained without jargon.*

## The 30-second version

Synod is a committee of five AI advisors that negotiates deals. Each advisor sees the
same situation through a different worldview — one wants to win now, one protects the
relationship, one asks why the other side is acting this way, one wants to learn more
before committing, one guards against disaster. A neutral chairperson decides how much
weight each advisor gets **this round** based on the situation — not on who argued
best. Then a calculator (not an AI) adds up the weighted votes and picks the move.
Every decision is signed and filed like a court record.

Why bother? Because a single negotiator with one stance gets exploited: a bluffing
counterparty makes it push harder and lose the deal. The committee notices the bluff —
from *behavior*, not words — pays a small price to test it, and closes deals the
single agent walks away from.

## The cast

| On screen | Plain meaning |
|---|---|
| **Gain** (Battle) | "What do we win *right now*?" — the aggressive advisor |
| **Position** (War) | "What game are we really playing?" — the long-term advisor |
| **Intent** (Empathy) | "Why are they acting this way?" — reads the counterparty; its read is shared with the other four |
| **Learning** (Probe) | "What should we find out before committing?" — wants to ask questions when information is worth more than it costs |
| **Survival** (Risk) | "What kills us if we're wrong?" — guards the downside |
| **Arbiter** | The chairperson. Has no opinion of its own. Reads the *situation* (trust, uncertainty, hostility, exposure) and sets each advisor's influence. Deliberately never reads their arguments — so the most persuasive voice can't buy extra weight. |
| **Engine** | A calculator. Multiplies each advisor's scores by their weight, picks the top action. No AI here — that's why every run is reproducible. |
| **Quant** | A cold money-checker. Says what pure expected value would do. Can flag disagreement, can't veto. |
| **Gate (Dotto)** | The final safety check: EXECUTE (go), ESCALATE (needs review), BLOCK (too risky). Signs a tamper-evident receipt for every round. |
| **Counterparty / GM** | The other side of the table. Scripted simulator by default; a live AI adversary, or *you*, in the other modes. |

## The numbers

- **Belief** — the council's running guess about who it's facing: *Relationship-oriented*
  (walks if bullied), *Soft-floor* (sounds flexible, has a hard limit), or *Deceptive*
  (bluffing leverage). It updates **only on behavior** — price movements, firmness,
  reveals. Talk is free, so talk never moves it.
- **EVI** (Expected Value of Information) — in dollars: what would knowing the truth be
  worth right now? If learning is worth more than a probe costs, probing is rational.
  In offline mode this rule is hard-wired; in live mode it's advisory and the screen
  notes whenever the council overrides it.
- **Lens weights** — the Arbiter's influence allocation this round. When the belief
  shifts, the weights shift; the chart on the trajectory band shows it round by round.
- **Surplus** — profit above the seller's walk-away floor ($8,000). The headline score.
- **conf / margin / conflict** — how decisively the winning action won, and how much
  the advisors disagreed about it. The system tells you when it's unsure.
- **Trust** — how the counterparty felt about your conduct (0–100). Deals can close
  with damaged trust; the system reports it instead of hiding it.

## The moments (what to watch for)

- **Sealed briefs** — the round's sharpest disagreement: the most-opposed pair exchange
  one challenge and one defense. It's *causal*: a defender genuinely persuaded gives
  ground (shown as "concession under challenge"), which can flip a close round.
- **Beams** — when the verdict lands, each advisor's vote flows into it. Thick bright
  beam = agreed with the outcome; thin faint = dissented. The synthesis, made visible.
- **⚑ DECEPTION DISARMED** — a probe just broke the counterparty's bluff. The thesis
  in one banner.
- **Filed strips** — finished rounds collapse to one line: *THEM → READ → COUNCIL →
  SENT*. The whole case stays readable on one screen; click to reopen any round.
- **receipt ✓ signed** — every round's decision, cryptographically signed. Click it.
- **⚖ Hold the gavel** — sliders that re-weight the council and recompute the verdict
  live in your browser. Drag everything onto one advisor and you've reproduced the
  single-lens experiment from Exhibit B with your own hand.

## The evidence (Exhibits)

- **Exhibit A** — same simulated counterparty, same dice: a strong single agent vs the
  council, 10 runs per type. Headline: against the deceptive type the single agent gets
  bluffed and walks with $0 every time; the council probes and closes $3,000 every time.
- **Exhibit B (ablation)** — remove one part at a time and re-run everything. Published
  honestly, including the parts whose removal costs nothing.
- **Hold-out worlds** (README) — five new counterparties authored *adversarially by a
  different AI vendor* and frozen before testing. The single agent walks to $0 in three
  of five; the council closes all fifty runs.
- **Calibration** (README) — the confusion matrix: how often the council's final guess
  matches the truth. 10/10 on detecting deception; its errors sit between two types
  whose best response is the same anyway — it buys exactly the distinctions that change
  the move.
- **Seeds / σ / n** — every run is replayable from a seed; σ is the spread across runs;
  n is how many runs. Reproducibility is the point: run any number yourself.

## The four modes

1. **Watch Synod negotiate** — the default theater, fully reproducible.
2. **YOU play the counterparty** — you get a secret brief; try to bluff the council and
   watch the belief bar find you out.
3. **DUEL** — you negotiate first, then Synod and the baseline replay your exact game.
   Most people lose to the exhibit.
4. **Qwen adversary** — a live model plays the counterparty from a hidden brief.
   Nobody scripted its moves.
