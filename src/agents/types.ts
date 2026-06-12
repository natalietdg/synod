import type { ActionId } from "../core/actions.js";
import type {
  ArbiterVerdict,
  Belief,
  ContextVector,
  DoctrineId,
  DoctrinePosition,
  EmpathyRead,
} from "../core/types.js";
import type { CounterpartyMove } from "../gm/types.js";

/** Everything visible to the Council at the start of a round (spec §2 boundary). */
export interface RoundInput {
  round: number;
  move: CounterpartyMove; // the latest counterparty move
  history: CounterpartyMove[]; // all prior counterparty moves
  belief: Belief;
  ctx: ContextVector;
  buyerOffer: number;
  councilAsk: number;
}

/** The single-agent baseline (spec §9). "strong" is a competent ablation, not a strawman. */
export type BaselinePersona = "strong" | "naive";

export interface BaselineDecision {
  action: ActionId;
  reasoning: string;
}

/**
 * The "intelligence" the round controller needs, abstracted so the same protocol
 * runs against deterministic mock agents or live Qwen. The scoring engine, the
 * Quant, and the belief update are deliberately NOT here — they are pure code and
 * must never depend on an LLM (spec §5).
 */
export interface DeliberationAgents {
  readonly kind: "mock" | "qwen";

  /** Empathy interprets the latest move; the other doctrines condition on it. */
  empathyRead(input: RoundInput): Promise<EmpathyRead>;

  /** One doctrine's scored position on the candidate actions this round. */
  doctrinePosition(doctrine: DoctrineId, input: RoundInput, read: EmpathyRead): Promise<DoctrinePosition>;

  /** The doctrineless Arbiter: context vector -> per-doctrine weights. */
  arbiterWeights(ctx: ContextVector, read: EmpathyRead): Promise<ArbiterVerdict>;

  /** A single general-purpose negotiator, for the A/B baseline. Picks one action. */
  baselineTurn(persona: BaselinePersona, input: RoundInput): Promise<BaselineDecision>;

  /**
   * Inter-lens dialogue: challenger questions the top-voted action; defender responds.
   * `theirText` is empty for the challenger's opening, non-empty for the defender's reply.
   *
   * The dialogue is CAUSAL: the defender may return `revisedScore` — its updated score
   * on the contested action after hearing the challenge. The protocol clamps the
   * concession and applies it to the defender's position before the engine runs, so a
   * challenge that lands can flip a close round. `myScore`/`theirScore` give each side
   * its own and the opponent's current score on the contested action.
   */
  challengeResponse(
    role: "challenger" | "defender",
    myDoctrine: DoctrineId,
    theirDoctrine: DoctrineId,
    contestedAction: ActionId,
    theirText: string,
    input: RoundInput,
    stakes: { myScore: number; theirScore: number; myConfidence: number; theirConfidence: number },
  ): Promise<{ text: string; revisedScore?: number }>;
}

export type { ArbiterVerdict, ContextVector, DoctrineId };
