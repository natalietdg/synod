import { ACTIONS, type ActionId } from "../core/actions.js";
import { COUNTERPARTY_TYPES, type Belief, type CounterpartyType } from "../core/types.js";
import { payoff } from "../payoffs.js";

/**
 * Expected Value of Information for a probe (spec §5). A probe is a low-cost move
 * whose payoff is the information it buys: it elicits an observation `o` from the
 * GM, and because each type responds to a probe characteristically, `o` is
 * genuinely diagnostic and P(θ|o) is well-defined — not hand-waved.
 */

/** The distinguishable outcomes of a probe move. */
const PROBE_OUTCOMES = ["reveals_competitor", "reveals_need_only", "stays_quiet"] as const;
type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** P(o | θ, probe): how each type reacts when probed. */
const P_O_GIVEN_TYPE: Record<CounterpartyType, Record<ProbeOutcome, number>> = {
  relationship: { reveals_competitor: 0.0, reveals_need_only: 0.7, stays_quiet: 0.3 },
  soft_floor: { reveals_competitor: 0.0, reveals_need_only: 0.7, stays_quiet: 0.3 },
  deceptive: { reveals_competitor: 0.8, reveals_need_only: 0.15, stays_quiet: 0.05 },
};

/** Flat money cost of spending a round on a probe instead of committing. */
export const COST_OF_PROBE = 120;

const COMMITTING_ACTIONS: ActionId[] = ACTIONS.filter((a) => a !== "probe");

/** Best expected money payoff over committing actions under a given belief. */
function bestExpectedUtility(belief: Belief, buyerOffer: number): number {
  let best = -Infinity;
  for (const a of COMMITTING_ACTIONS) {
    let eu = 0;
    for (const t of COUNTERPARTY_TYPES) eu += belief[t] * payoff(a, t, buyerOffer);
    best = Math.max(best, eu);
  }
  return best;
}

/** Posterior belief after observing probe outcome `o`. */
function posterior(belief: Belief, o: ProbeOutcome): Belief {
  const weighted = {} as Belief;
  let sum = 0;
  for (const t of COUNTERPARTY_TYPES) {
    weighted[t] = belief[t] * P_O_GIVEN_TYPE[t][o];
    sum += weighted[t];
  }
  const out = {} as Belief;
  for (const t of COUNTERPARTY_TYPES) out[t] = sum > 0 ? weighted[t] / sum : belief[t];
  return out;
}

export interface EviResult {
  evi: number; // always >= 0
  euStar: number; // best you can do deciding now
  euInfo: number; // best you can do after probing
  worthIt: boolean;
}

/**
 * EVI = EU_info - EU*. Probe is worth firing iff EVI exceeds its cost AND there
 * is at least one more round in which to exploit what it reveals.
 */
export function expectedValueOfInformation(
  belief: Belief,
  buyerOffer: number,
  roundsLeft: number,
): EviResult {
  const euStar = bestExpectedUtility(belief, buyerOffer);

  let euInfo = 0;
  for (const o of PROBE_OUTCOMES) {
    let pO = 0;
    for (const t of COUNTERPARTY_TYPES) pO += belief[t] * P_O_GIVEN_TYPE[t][o];
    if (pO <= 0) continue;
    euInfo += pO * bestExpectedUtility(posterior(belief, o), buyerOffer);
  }

  const evi = Math.max(0, euInfo - euStar);
  const worthIt = roundsLeft > 1 && evi > COST_OF_PROBE;
  return { evi, euStar, euInfo, worthIt };
}
