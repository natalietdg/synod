import type {
  ArbiterVerdict,
  Belief,
  ContextVector,
  DoctrineId,
  DoctrinePosition,
  EmpathyRead,
  EngineResult,
  QuantReport,
  Receipt,
} from "../core/types.js";
import type { CouncilMove, CounterpartyMove, TerminalReveal } from "../gm/types.js";
import type { GateDecision } from "../dotto/gate.js";
import type { EviResult } from "../belief/evi.js";
import type { ActionId } from "../core/actions.js";

/** One side of the most-diverging-pair challenge exchange. */
export interface Challenge {
  from: DoctrineId;
  against: DoctrineId;
  text: string;
  /** The action under dispute (set on both sides of the exchange). */
  contested?: ActionId;
  /** Defender only: score on the contested action before/after hearing the challenge.
   *  When they differ, the dialogue had causal force — the engine sees the revised score. */
  originalScore?: number;
  revisedScore?: number;
}

/** The full record of one round of deliberation. */
export interface RoundResult {
  round: number;
  counterpartyMove: CounterpartyMove;
  beliefBefore: Belief; // prior carried in from last round
  beliefAfter: Belief; // posterior after updating on this move's signals
  ctx: ContextVector;
  read: EmpathyRead;
  positions: DoctrinePosition[];
  challenges: Challenge[];
  evi: EviResult;
  arbiter: ArbiterVerdict;
  engine: EngineResult;
  quant: QuantReport;
  gate: GateDecision;
  councilMove: CouncilMove;
  receipt: Receipt;
}

/** The full record of one negotiation. */
export interface NegotiationResult {
  scenarioId: string;
  trueType: string; // ground truth, attached by the harness for scoring/display
  rounds: RoundResult[];
  terminal: TerminalReveal;
  /** Per-round doctrine weights — the visible shadow of the Bayesian update. */
  weightTrajectory: { round: number; weights: Record<DoctrineId, number> }[];
  /** Per-round belief over the hidden types. */
  beliefTrajectory: { round: number; belief: Belief }[];
}

/** Streaming events for the web UI, in order. */
export type DeliberationEvent =
  | { type: "round-start"; round: number; move: CounterpartyMove }
  | { type: "belief"; before: Belief; after: Belief }
  | { type: "intent"; read: EmpathyRead }
  | { type: "position"; position: DoctrinePosition }
  | { type: "challenge"; challenge: Challenge }
  | { type: "evi"; evi: EviResult }
  | { type: "arbiter"; verdict: ArbiterVerdict }
  | { type: "engine"; engine: EngineResult }
  | { type: "quant"; quant: QuantReport }
  | { type: "gate"; gate: GateDecision }
  | { type: "council-move"; move: CouncilMove }
  | { type: "receipt"; receipt: Receipt }
  | { type: "terminal"; terminal: TerminalReveal }
  | { type: "done"; result: NegotiationResult };

export type EventSink = (event: DeliberationEvent) => void | Promise<void>;
