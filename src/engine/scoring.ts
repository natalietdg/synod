import { ACTIONS, type ActionId } from "../core/actions.js";
import {
  DOCTRINES,
  type DoctrineId,
  type DoctrinePosition,
  type EngineResult,
  type MatrixRow,
} from "../core/types.js";

/**
 * Tunable constants for the confidence and deadlock logic (PRD §4.2).
 *
 * - `alpha` scales how much a clear margin raises confidence.
 * - `beta`  scales how much internal disagreement lowers it.
 * - `marginDeadlock`     : below this gap, a* barely beat the runner-up -> coin flip.
 * - `dispersionDeadlock` : above this spread, a* sits on heavy disagreement.
 */
export interface EngineConfig {
  alpha: number;
  beta: number;
  marginDeadlock: number;
  dispersionDeadlock: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  alpha: 6,
  beta: 4,
  marginDeadlock: 0.08,
  dispersionDeadlock: 0.45,
};

const logistic = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * The deterministic spine. Given the doctrines' scores and the Arbiter's
 * weights, blend them into a tradeoff matrix, pick a recommendation, and
 * report a calibrated confidence plus a deadlock signal.
 *
 * This function is intentionally free of any LLM call or randomness: the same
 * inputs always produce the same matrix. That reproducibility is the claim we
 * make to judges (PRD §4.5) — not that the result is "objectively optimal".
 */
export function score(
  positions: DoctrinePosition[],
  weights: Record<DoctrineId, number>,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineResult {
  const byDoctrine = new Map(positions.map((p) => [p.doctrine, p]));

  // Build one matrix row per candidate action: U(a) = sum_d w_d * s_d(a).
  const matrix: MatrixRow[] = ACTIONS.map((action) => {
    const perDoctrine = {} as Record<DoctrineId, number>;
    let utility = 0;
    for (const d of DOCTRINES) {
      const s = byDoctrine.get(d)?.scores[action] ?? 0;
      perDoctrine[d] = s;
      utility += weights[d] * s;
    }
    return { action, utility, perDoctrine };
  });

  const ranked = [...matrix].sort((a, b) => b.utility - a.utility);
  const best = ranked[0]!;
  const second = ranked[1]!;

  const margin = best.utility - second.utility;

  // Dispersion: weighted spread of the doctrines' views on the *winning* action.
  // High dispersion means the winner sits on heavy internal conflict.
  let variance = 0;
  for (const d of DOCTRINES) {
    const deviation = best.perDoctrine[d] - best.utility;
    variance += weights[d] * deviation * deviation;
  }
  const dispersion = Math.sqrt(variance);

  const confidence = logistic(config.alpha * margin - config.beta * dispersion);

  // Two independent deadlock causes, kept separate (PRD §4.2).
  let deadlockReason: EngineResult["deadlockReason"] = null;
  if (margin < config.marginDeadlock) deadlockReason = "thin-margin";
  else if (dispersion > config.dispersionDeadlock) deadlockReason = "high-dispersion";

  return {
    matrix,
    recommendation: best.action as ActionId,
    runnerUp: second.action as ActionId,
    margin,
    dispersion,
    confidence,
    deadlock: deadlockReason !== null,
    deadlockReason,
  };
}
