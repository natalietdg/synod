import type { ActionId } from "./actions.js";

/**
 * The five lenses. They are NOT doctrines ("always do X") — they are *cognitive
 * archetypes*: each holds a worldview and owns a question the others tend to
 * ignore. The `math` field is one operationalization of that worldview (what the
 * mock computes); the live Qwen agent gets the whole cluster as its character.
 * The five are the set that naturally *disagrees* in a negotiation.
 */
export const DOCTRINES = ["empathy", "battle", "war", "probe", "risk"] as const;
export type DoctrineId = (typeof DOCTRINES)[number];

export interface LensMeta {
  name: string;
  /** The cognitive function this lens represents (Gain / Position / Intent / Learning / Survival). */
  cogFunction: string;
  /** The dimension of the estimate sheet this lens owns. Each agent scores the same action set
   *  through this dimension — the conflict is real because the dimensions genuinely disagree. */
  dimension: string;
  coreBelief: string;
  /** The fundamental question this lens owns. */
  question: string;
  thinkingStyle: string;
  failureMode: string;
  /** The precise operationalization (how the engine scores this lens). */
  math: string;
  keywords: string[];
}

export const LENSES: Record<DoctrineId, LensMeta> = {
  battle: {
    name: "Battle",
    cogFunction: "Gain",
    dimension: "immediate value",
    coreBelief: "Action beats hesitation.",
    question: "What move creates the most advantage right now?",
    thinkingStyle: "Opportunistic, decisive, momentum-sensitive.",
    failureMode: "Short-termism; burns relationships for a quick win.",
    math: "immediate utility — myopic captured surplus",
    keywords: ["momentum", "leverage", "capture", "initiative", "pressure", "closing"],
  },
  war: {
    name: "War",
    cogFunction: "Position",
    dimension: "campaign value",
    coreBelief: "Position matters more than today's result.",
    question: "What game are we really playing?",
    thinkingStyle: "Strategic, long-horizon, patient.",
    failureMode: "Paralysis; too patient; misses real openings.",
    math: "long-horizon utility — surplus weighted against walk risk",
    keywords: ["position", "precedent", "trust", "optionality", "trajectory", "campaign"],
  },
  empathy: {
    name: "Empathy",
    cogFunction: "Intent",
    dimension: "intent posterior",
    coreBelief: "Behavior only makes sense once incentives are understood.",
    question: "Why are they acting this way?",
    thinkingStyle: "Theory of mind; counterparty modeling; incentive analysis.",
    failureMode: "Over-analysis; too much benefit of the doubt; manipulable.",
    math: "best response to the Bayesian belief over their hidden type",
    keywords: ["intent", "motivation", "needs", "pressure", "signal", "incentives"],
  },
  probe: {
    name: "EVI",
    cogFunction: "Learning",
    dimension: "information gain",
    coreBelief: "Information is usually worth more than conviction.",
    question: "What small action would teach us the most?",
    thinkingStyle: "Experimental, hypothesis-driven, exploratory.",
    failureMode: "Endless experimentation; never commits; analysis loops.",
    math: "value of information — probe iff EVI > cost",
    keywords: ["experiment", "test", "evidence", "hypothesis", "discovery", "information"],
  },
  risk: {
    name: "Risk",
    cogFunction: "Survival",
    dimension: "downside exposure",
    coreBelief: "Survival is a prerequisite for victory.",
    question: "What happens if we're wrong?",
    thinkingStyle: "Defensive, scenario-based, catastrophe-aware.",
    failureMode: "Excessive caution; misses upside; fear-driven.",
    math: "minimax — downside / walk exposure",
    keywords: ["exposure", "downside", "fragility", "worst-case", "survival", "resilience"],
  },
};

/**
 * The hidden counterparty types the GM can instantiate (spec §8). The Council
 * never sees the true type; it maintains a belief distribution over these and
 * updates it each round.
 */
export const COUNTERPARTY_TYPES = ["relationship", "soft_floor", "deceptive"] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

export const TYPE_META: Record<CounterpartyType, { name: string; tell: string }> = {
  relationship: { name: "Relationship-oriented", tell: "cooperative; walks if bullied" },
  soft_floor: { name: "Soft surface, firm floor", tell: "looks soft early, real reservation high" },
  deceptive: { name: "Deceptive", tell: "claims low budget, hides competitor leverage + real need" },
};

/** Council's belief over the hidden types. Sums to 1. */
export type Belief = Record<CounterpartyType, number>;

/**
 * The situational features the Arbiter reads to decide which doctrines have the
 * advantage this round (spec §6). The Arbiter holds no doctrine of its own.
 * All fields normalized to [0, 1] except `roundsLeft`.
 */
export interface ContextVector {
  /** Council's trust estimate of the counterparty. */
  trustEst: number;
  /** How resolved the belief is: 1 - normalized entropy over the types. */
  infoConfidence: number;
  /** Remaining optionality: roundsLeft / maxRounds. */
  reversibility: number;
  /** Normalized stakes (contract value vs. ceiling). */
  exposure: number;
  /** Signal that we are being worked: P(deceptive) blended with observed hardening. */
  adversarialSignal: number;
  /** Whole rounds remaining before the cap. */
  roundsLeft: number;
}

/** A doctrine's score for each candidate action, in [-1, 1]. */
export type ActionScores = Record<ActionId, number>;

/** One doctrine's position in a round (spec §6 doctrine output). */
export interface DoctrinePosition {
  doctrine: DoctrineId;
  scores: ActionScores;
  /** The doctrine's own confidence in its read, in [0, 1]. */
  confidence: number;
  rationale: string;
  reasoning: string;
}

/**
 * Empathy's interpretation of the latest counterparty move (spec §3, §5). It
 * posts a shared read the other doctrines condition on; the numeric belief
 * update itself is deterministic (belief/update.ts), not an LLM guess.
 */
export interface EmpathyRead {
  summary: string;
  flags: string[];
  /** Empathy's read of counterparty trust, in [0, 1]. */
  readTrust: number;
  likelyType: CounterpartyType;
}

/** The doctrineless Arbiter's output: per-doctrine weights from the context. */
export interface ArbiterVerdict {
  context: ContextVector;
  weights: Record<DoctrineId, number>;
  rationale: string;
}

/** One row of the tradeoff matrix: how each doctrine scored one action. */
export interface MatrixRow {
  action: ActionId;
  utility: number; // U(a) = sum_d w_d * s_d(a)
  perDoctrine: Record<DoctrineId, number>;
}

/** Output of the deterministic scoring engine (spec §5). Pure arithmetic. */
export interface EngineResult {
  matrix: MatrixRow[];
  recommendation: ActionId; // a*
  runnerUp: ActionId; // a_2
  margin: number; // U(a*) - U(a_2)
  dispersion: number; // weighted spread of doctrine views on a*
  confidence: number; // logistic(alpha*margin - beta*dispersion)
  deadlock: boolean;
  deadlockReason: "thin-margin" | "high-dispersion" | null;
}

/** The Quant flags money-EV divergence; it has no veto (spec §5). */
export interface QuantReport {
  evOptimal: ActionId; // a_EV
  delta: number; // EV(a_EV) - EV(a*), the money price of honoring doctrine over math
  matchesRecommendation: boolean;
  evByAction: Record<ActionId, number>;
}

/** Dotto's gate decision for the chosen action. */
export type Gate = "execute" | "block" | "escalate";

/** Immutable, signed record of one round's decision (PRD §3.4 / spec §5). */
export interface Receipt {
  scenarioId: string;
  round: number;
  recommendation: ActionId;
  weights: Record<DoctrineId, number>;
  confidence: number;
  evDivergence: number;
  gate: Gate;
  finalAction: ActionId;
  timestamp: string;
  signature: string;
}
