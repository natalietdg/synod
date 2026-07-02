import type { ContextVector } from "../core/types.js";

/**
 * ADAPTIVE POLICY SELECTION — the reasoning layer configures the deterministic engine
 * instead of replacing it.
 *
 * Each LENS owns its own algorithm and the small policy that tunes it. The engine owns
 * these interfaces; the reasoning layer (the situation, or live, the generals' arguments)
 * may only FILL them with values inside a bounded space — it can't invent parameters or
 * edit the algorithms. The engine then validates, clamps, applies, and logs the values
 * before scoring. So:
 *
 *   General (a worldview) → argues → Lens policy (bounded slot) → Engine validates → rescore
 *
 * That is constrained adaptive optimization, not self-modification — which is why the
 * determinism guarantee (`npm run reproduce`) survives: same situation → same policy →
 * same numbers.
 */

/** Hedge's algorithm blends average and worst case: score = λ·worst_case + (1−λ)·expected.
 *  λ owned by Hedge: 1.0 = full minimax on the downside; lower lets the average back in. */
export interface HedgePolicy { lambda: number }
/** Probe's rule is "probe iff EVI > eviThreshold." The threshold is Probe's; lower = more
 *  willing to spend a move to investigate. */
export interface ProbePolicy { eviThreshold: number }
/** Pressure's utility is immediate_gain + γ·future_gain... here γ is the discount it applies
 *  to the future: 1.0 = pure capture-now (myopic), lower = weighs consequences more. */
export interface PressurePolicy { futureDiscount: number }

export interface CouncilPolicy {
  hedge: HedgePolicy;
  probe: ProbePolicy;
  pressure: PressurePolicy;
}

/** The bounded, validated policy space the engine owns. Every proposed value is clamped
 *  into these ranges; nothing outside is reachable. */
export const POLICY_BOUNDS = {
  hedge: { lambda: [0.5, 1.0] },
  probe: { eviThreshold: [70, 520] },
  pressure: { futureDiscount: [0.5, 1.0] },
} as const;

const clampTo = ([lo, hi]: readonly [number, number], x: number): number => Math.max(lo, Math.min(hi, x));

/** A/B harness hook: force a FIXED policy (the same one every situation) so we can measure
 *  what the *adaptive* selection actually buys vs. a static clamp. null = adaptive (normal). */
let fixedOverride: CouncilPolicy | null = null;
export function setPolicyOverride(p: CouncilPolicy | null): void { fixedOverride = p; }
/** The fixed baseline policy: mid-range, situation-blind. */
export const FIXED_POLICY: CouncilPolicy = { hedge: { lambda: 0.75 }, probe: { eviThreshold: 295 }, pressure: { futureDiscount: 0.75 } };

/**
 * Propose a policy from the situation — deterministic, so it replays identically. Each lens's
 * parameter is a transparent function of the situation features the chair already reads. (In
 * live mode the generals' arguments nudge these proposals; the bounds and clamping are the
 * same either way.) The result is always clamped into POLICY_BOUNDS.
 */
export function selectPolicy(ctx: ContextVector): CouncilPolicy {
  if (fixedOverride) return fixedOverride; // A/B: situation-blind fixed clamp
  const irreversibility = 1 - ctx.reversibility;
  const unsure = 1 - ctx.infoConfidence;
  const timeToUse = ctx.roundsLeft > 1 ? 1 : 0; // info is only worth buying if a round remains to use it

  return {
    // Hedge leans harder on the worst case as stakes rise and recovery room shrinks.
    hedge: { lambda: clampTo(POLICY_BOUNDS.hedge.lambda, 0.7 + 0.45 * ctx.exposure - 0.2 * ctx.reversibility + 0.15 * irreversibility) },
    // Probe tolerates a higher investigation cost (lower threshold) when we're unsure and
    // have a round to use what we'd learn; it grows reluctant when time is short.
    probe: { eviThreshold: clampTo(POLICY_BOUNDS.probe.eviThreshold, 480 - 360 * unsure * timeToUse - 120 * ctx.adversarialSignal) },
    // Pressure grows myopic as rounds run out — less future left to protect.
    pressure: { futureDiscount: clampTo(POLICY_BOUNDS.pressure.futureDiscount, 0.6 + 0.1 * (4 - ctx.roundsLeft)) },
  };
}

/** The audit record: situation in, policy out, proof every value stayed in bounds. Logged
 *  per round so a judge can replay the run and confirm the adaptation was real and bounded. */
export interface PolicyAudit {
  situation: { stakes: number; uncertainty: number; reversibility: number; adversarial: number; roundsLeft: number };
  policy: CouncilPolicy;
  bounds: typeof POLICY_BOUNDS;
  withinBounds: boolean;
}

const inB = ([lo, hi]: readonly [number, number], x: number) => x >= lo - 1e-9 && x <= hi + 1e-9;

export function auditPolicy(ctx: ContextVector, policy: CouncilPolicy): PolicyAudit {
  return {
    situation: {
      stakes: ctx.exposure,
      uncertainty: 1 - ctx.infoConfidence,
      reversibility: ctx.reversibility,
      adversarial: ctx.adversarialSignal,
      roundsLeft: ctx.roundsLeft,
    },
    policy,
    bounds: POLICY_BOUNDS,
    withinBounds:
      inB(POLICY_BOUNDS.hedge.lambda, policy.hedge.lambda) &&
      inB(POLICY_BOUNDS.probe.eviThreshold, policy.probe.eviThreshold) &&
      inB(POLICY_BOUNDS.pressure.futureDiscount, policy.pressure.futureDiscount),
  };
}
