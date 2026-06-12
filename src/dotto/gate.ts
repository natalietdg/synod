import { diff, runGovernance, allowLowRisk, escalateHighRisk } from "@natalietdg/dotto";
import type { AIGovernor, PolicyRule } from "@natalietdg/dotto";
import type { ActionId } from "../core/actions.js";
import type { ContextVector, EngineResult, Gate, QuantReport } from "../core/types.js";

export interface GateDecision {
  gate: Gate;
  /** What is actually sent to the GM. A blocked commit falls back to a safe hold. */
  finalAction: ActionId;
  reason: string;
}

type GateRecord = Record<string, unknown>;

const COMMITTING = new Set<ActionId>(["accept", "walk"]);
const isCommitting = (a: ActionId): boolean => COMMITTING.has(a);

/** Block irreversible commits when the engine signals low confidence or deadlock. */
function blockIrreversibleUnderUncertainty(minConfidence: number): PolicyRule<GateRecord> {
  return {
    name: "block-irreversible-low-confidence",
    evaluate(d) {
      const { recommendation, confidence, deadlock } = d.after as {
        recommendation: string;
        confidence: number;
        deadlock: boolean;
      };
      if (isCommitting(recommendation as ActionId) && (confidence < minConfidence || deadlock)) {
        return "block";
      }
      return null;
    },
  };
}

/** Escalate when the Quant's EV-divergence is large on a committing action. */
function escalateLargeEvDivergence(threshold: number): PolicyRule<GateRecord> {
  return {
    name: "escalate-large-ev-divergence",
    evaluate(d) {
      const { recommendation, evDivergence } = d.after as {
        recommendation: string;
        evDivergence: number;
      };
      if (isCommitting(recommendation as ActionId) && Math.abs(evDivergence) > threshold) {
        return "escalate";
      }
      return null;
    },
  };
}

/** Escalate when exposure is high and the engine is insufficiently confident. */
function escalateHighExposureUnknown(expThreshold: number, confThreshold: number): PolicyRule<GateRecord> {
  return {
    name: "escalate-high-exposure",
    evaluate(d) {
      const { recommendation, exposure, confidence } = d.after as {
        recommendation: string;
        exposure: number;
        confidence: number;
      };
      if (isCommitting(recommendation as ActionId) && exposure >= expThreshold && confidence < confThreshold) {
        return "escalate";
      }
      return null;
    },
  };
}

// Catch-all: anything that cleared all deterministic + AI checks is authorized.
const allowAllClear: PolicyRule<GateRecord> = {
  name: "allow-all-clear",
  evaluate: () => "allow",
};

/**
 * Gate the round's chosen action (PRD §3.4).
 *
 * Implements "risk classifier (Qwen + rules) → gate" per spec:
 * - Deterministic rules run first (confidence, EV-divergence, exposure).
 * - Optional AI governor (Qwen) then assesses broader execution risk.
 * - Catch-all allows anything that cleared all checks.
 *
 * Reversible moves (counter, probe, hold, concede) always execute — they are not
 * commits and can be revisited. Irreversible commits (accept/walk) obey the full
 * rule chain. Pass governor=undefined for mock/A-B runs (rules-only mode).
 */
export async function gate(
  recommendation: ActionId,
  ctx: ContextVector,
  engine: EngineResult,
  quant: QuantReport,
  governor?: AIGovernor,
): Promise<GateDecision> {
  const record: GateRecord = {
    recommendation,
    confidence: engine.confidence,
    deadlock: engine.deadlock ?? false,
    evDivergence: quant.delta,
    exposure: ctx.exposure,
    trustEst: ctx.trustEst,
  };

  const result = await runGovernance({
    diff: diff(null, record),
    context: { roundsLeft: ctx.roundsLeft },
    ai: governor,
    rules: [
      blockIrreversibleUnderUncertainty(0.5),
      escalateLargeEvDivergence(250),
      escalateHighExposureUnknown(0.7, 0.7),
      escalateHighRisk<GateRecord>(),
      allowLowRisk<GateRecord>(),
      allowAllClear,
    ],
  });

  const { decision, reasons } = result.governance;
  const aiNote = result.aiInterpretation
    ? ` AI (${result.aiInterpretation.risk} risk): ${result.aiInterpretation.recommendation}`
    : "";

  // Reversible actions always execute — no commit, no hold needed.
  if (!isCommitting(recommendation)) {
    return { gate: "execute", finalAction: recommendation, reason: `Reversible; executed.${aiNote}` };
  }

  if (decision === "allow") {
    return { gate: "execute", finalAction: recommendation, reason: `Authorized.${aiNote}` };
  }

  const gateStatus: Gate =
    recommendation === "walk" ? "escalate" : decision === "escalate" ? "escalate" : "block";

  return {
    gate: gateStatus,
    finalAction: "hold",
    reason: reasons.length > 0 ? `${reasons.join("; ")}.${aiNote}` : `Held for sign-off.${aiNote}`,
  };
}
