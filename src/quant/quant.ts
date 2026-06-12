import { ACTIONS, type ActionId } from "../core/actions.js";
import { COUNTERPARTY_TYPES, type Belief, type QuantReport } from "../core/types.js";
import { payoff } from "../payoffs.js";

/**
 * The numerate validator (spec §5). It computes the pure money-EV-optimal action
 * over the current belief — ignoring every doctrine's narrative — and reports the
 * money price of the Council overriding it.
 *
 * It flags, it does not decide. "Maximize EV" is itself a doctrine; a Quant with
 * a veto becomes the silent seventh worldview that wins every deadlock — the exact
 * trap the Arbiter is built to avoid. A large Δ together with low confidence is a
 * clean, principled escalation trigger.
 */
export function quantCheck(
  belief: Belief,
  buyerOffer: number,
  recommendation: ActionId,
): QuantReport {
  const evByAction = {} as Record<ActionId, number>;
  for (const a of ACTIONS) {
    let ev = 0;
    for (const t of COUNTERPARTY_TYPES) ev += belief[t] * payoff(a, t, buyerOffer);
    evByAction[a] = ev;
  }

  const evOptimal = ACTIONS.reduce((best, a) => (evByAction[a] > evByAction[best] ? a : best));

  return {
    evOptimal,
    delta: evByAction[evOptimal] - evByAction[recommendation],
    matchesRecommendation: evOptimal === recommendation,
    evByAction,
  };
}
