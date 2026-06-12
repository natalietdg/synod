import type { ActionId } from "./core/actions.js";
import type { CounterpartyType } from "./core/types.js";
import { SELLER_FLOOR, profileOf } from "./gm/profiles.js";

/**
 * The Council's *estimate* of the money payoff `u(a, θ)` (spec §5): the surplus
 * it expects to end with if it commits to action-style `a` against a
 * counterparty of type `θ`, given the buyer's current offer.
 *
 * These are estimates, not the GM's truth (the honest GIGO caveat, spec §5).
 * The uncertainty the Council actually faces is over *which* type it's talking
 * to — so it models each archetype's reservation and reasons "if they're θ, then…".
 * That is what makes information (Probe) genuinely valuable: different types make
 * different actions optimal.
 */

/**
 * P(walk) if the Council commits to this action-style against this type. Tuned so
 * the optimal action genuinely differs by type (which is what gives information
 * value): relationship punishes hard pushes with a walk; soft_floor barely walks
 * on price (push it); deceptive walks on blind pressure (use its competitor leverage).
 */
const WALK_RISK: Record<CounterpartyType, Record<ActionId, number>> = {
  relationship: { accept: 0, counter_hard: 0.75, hold: 0.45, counter_soft: 0.05, probe: 0.02, concede_term: 0.02, walk: 1 },
  soft_floor: { accept: 0, counter_hard: 0.10, hold: 0.08, counter_soft: 0.05, probe: 0.03, concede_term: 0.05, walk: 1 },
  deceptive: { accept: 0, counter_hard: 0.50, hold: 0.40, counter_soft: 0.10, probe: 0.05, concede_term: 0.05, walk: 1 },
};

/** Fraction of the remaining headroom (toward the type's reservation) this action captures. */
function captureFraction(action: ActionId, type: CounterpartyType): number {
  switch (action) {
    case "counter_hard": return 0.75;
    case "hold": return 0.4;
    case "counter_soft": return 0.4;
    case "probe": return 0.2;
    case "concede_term": return type === "relationship" ? 0.3 : type === "soft_floor" ? 0.3 : 0.55;
    case "accept": return 0;
    case "walk": return 0;
  }
}

/** P(walk) if the Council commits to this action-style against this type. */
export const walkRisk = (action: ActionId, type: CounterpartyType): number => WALK_RISK[type][action];

/** Surplus captured IF the deal survives (ignores walk risk) — the upside of the action. */
export function capturedSurplus(action: ActionId, type: CounterpartyType, buyerOffer: number): number {
  if (action === "walk") return 0;
  const reservation = profileOf(type).reservation;
  const currentSurplus = buyerOffer - SELLER_FLOOR;
  if (action === "accept") return currentSurplus;
  const headroom = Math.max(0, reservation - SELLER_FLOOR - currentSurplus);
  return currentSurplus + captureFraction(action, type) * headroom;
}

/** Expected money payoff: keep the upside with prob (1 - walk); a walk loses the whole deal. */
export function payoff(action: ActionId, type: CounterpartyType, buyerOffer: number): number {
  if (action === "walk") return 0; // BATNA: surplus at the seller floor is zero
  return (1 - walkRisk(action, type)) * capturedSurplus(action, type, buyerOffer);
}
