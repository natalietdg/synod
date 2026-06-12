import type { ActionId } from "../core/actions.js";
import type { CouncilMove } from "../gm/types.js";

/**
 * Translate a chosen action into the outward move the GM sees (spec §2: the GM
 * sees only the message/offer, never the reasoning). Used identically by the
 * Council and the single-agent baseline, so the A/B is fair — the only removed
 * variable is the doctrine/Arbiter structure, not the move encoding.
 *
 * `accept` agrees to the buyer's current offer; price actions move the ask by a
 * fixed fraction of the gap; `concede_term` grants the buyer's requested terms
 * without moving on price.
 */
export function encodeMove(
  action: ActionId,
  currentAsk: number,
  buyerOffer: number,
  requestedFeatures: string[],
  alreadyConceded: string[],
): CouncilMove {
  const gap = Math.max(0, currentAsk - buyerOffer);
  const features = [...alreadyConceded];

  let askPrice = currentAsk;
  switch (action) {
    case "accept": askPrice = buyerOffer; break;
    case "counter_hard": askPrice = currentAsk - Math.round(gap * 0.05); break;
    case "counter_soft": askPrice = currentAsk - Math.round(gap * 0.35); break;
    case "hold": askPrice = currentAsk; break;
    case "probe": askPrice = currentAsk; break;
    case "concede_term":
      for (const f of requestedFeatures) if (!features.includes(f)) features.push(f);
      break;
    case "walk": askPrice = currentAsk; break;
  }

  return { action, ask: { price: askPrice, features } };
}
