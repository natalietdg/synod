import { COUNTERPARTY_TYPES, type Belief, type CounterpartyType } from "../core/types.js";

/** The diagnostic observation categories the Council can read off a GM move. */
const CATEGORIES = [
  "soft_concession",
  "small_concession",
  "held_firm",
  "revealed_competitor",
  "revealed_need",
] as const;
type Category = (typeof CATEGORIES)[number];

/**
 * Likelihoods L[type][observation] — how characteristic each visible signal is
 * of each hidden type (spec §5: because the GM is deterministic, each type
 * responds characteristically, so the observation is genuinely diagnostic).
 */
const LIKELIHOOD: Record<CounterpartyType, Record<Category, number>> = {
  relationship: { soft_concession: 0.60, small_concession: 0.30, held_firm: 0.10, revealed_competitor: 0.05, revealed_need: 0.30 },
  soft_floor: { soft_concession: 0.35, small_concession: 0.40, held_firm: 0.45, revealed_competitor: 0.05, revealed_need: 0.40 },
  deceptive: { soft_concession: 0.10, small_concession: 0.30, held_firm: 0.60, revealed_competitor: 0.90, revealed_need: 0.60 },
};

export const UNIFORM_PRIOR: Belief = { relationship: 1 / 3, soft_floor: 1 / 3, deceptive: 1 / 3 };

/** Map a GM move's raw signals to the informative observation categories. */
export function categorize(signals: string[]): Category[] {
  const cats: Category[] = [];
  for (const s of signals) {
    if (s === "soft_concession" || s === "small_concession" || s === "held_firm") cats.push(s);
    else if (s === "revealed_competitor") cats.push("revealed_competitor");
    else if (s.startsWith("revealed_need")) cats.push("revealed_need");
    // "opening", "at_ask" carry no type information
  }
  return cats;
}

function normalize(weights: Belief): Belief {
  const sum = COUNTERPARTY_TYPES.reduce((acc, t) => acc + weights[t], 0);
  const out = {} as Belief;
  for (const t of COUNTERPARTY_TYPES) out[t] = sum > 0 ? weights[t] / sum : 1 / COUNTERPARTY_TYPES.length;
  return out;
}

/**
 * Sequential Bayesian update: posterior ∝ prior × Π likelihoods over the
 * observed categories (a naive-Bayes filter over independent tells). The
 * posterior from round t becomes the prior for round t+1.
 */
export function updateBelief(prior: Belief, signals: string[]): Belief {
  const cats = categorize(signals);
  if (cats.length === 0) return prior;
  const weighted = {} as Belief;
  for (const t of COUNTERPARTY_TYPES) {
    let lik = 1;
    for (const c of cats) lik *= LIKELIHOOD[t][c];
    weighted[t] = prior[t] * lik;
  }
  return normalize(weighted);
}

/** Shannon entropy of the belief (base = #types), in [0, 1]. */
export function entropy(b: Belief): number {
  let h = 0;
  for (const t of COUNTERPARTY_TYPES) {
    if (b[t] > 0) h -= b[t] * Math.log(b[t]);
  }
  return h / Math.log(COUNTERPARTY_TYPES.length);
}

/** How resolved the belief is: 1 - normalized entropy. Diffuse = 0, certain = 1. */
export const infoConfidence = (b: Belief): number => 1 - entropy(b);

export const mostLikelyType = (b: Belief): CounterpartyType =>
  COUNTERPARTY_TYPES.reduce((a, t) => (b[t] > b[a] ? t : a));
