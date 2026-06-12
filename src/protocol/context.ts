import { type Belief, type ContextVector } from "../core/types.js";
import { PRICE_CEILING, ROUND_CAP, SELLER_FLOOR } from "../gm/profiles.js";
import { infoConfidence } from "../belief/update.js";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Compute the situational feature vector the Arbiter reads (spec §6) from what
 * the Council can actually see: its belief over types, the current prices, the
 * rounds remaining, and the visible tells in the last move. No hidden state.
 */
export function computeContext(
  belief: Belief,
  councilAsk: number,
  roundsLeft: number,
  signals: string[],
): ContextVector {
  const concession = signals.includes("soft_concession")
    ? 0.3
    : signals.includes("small_concession")
      ? 0.1
      : signals.includes("held_firm")
        ? -0.15
        : 0;
  const hardening = signals.includes("held_firm") ? 0.2 : 0;

  return {
    trustEst: clamp01(0.45 + 0.4 * belief.relationship - 0.35 * belief.deceptive + concession),
    infoConfidence: infoConfidence(belief),
    reversibility: clamp01(roundsLeft / ROUND_CAP),
    exposure: clamp01((councilAsk - SELLER_FLOOR) / (PRICE_CEILING - SELLER_FLOOR)),
    adversarialSignal: clamp01(belief.deceptive + hardening),
    roundsLeft,
  };
}
