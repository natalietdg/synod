import { DOCTRINES, type DoctrinePosition, type Receipt } from "../core/types.js";
import { ACTIONS, type ActionId } from "../core/actions.js";
import { score, type EngineConfig, DEFAULT_CONFIG } from "../engine/scoring.js";
import { quantCheck } from "../quant/quant.js";
import { gate, type GateDecision } from "../dotto/gate.js";
import { signReceipt } from "../dotto/receipt.js";
import { receiptStore } from "../dotto/store.js";
import { expectedValueOfInformation, type EviResult } from "../belief/evi.js";
import { SELLER_FLOOR } from "../gm/profiles.js";
import type { AIGovernor } from "@natalietdg/dotto";
import type { DeliberationAgents, RoundInput } from "../agents/index.js";
import type { ArbiterVerdict, EmpathyRead, EngineResult, QuantReport } from "../core/types.js";
import type { Challenge, EventSink } from "./types.js";

export interface RoundDecision {
  read: EmpathyRead;
  positions: DoctrinePosition[];
  challenges: Challenge[];
  evi: EviResult;
  arbiter: ArbiterVerdict;
  engine: EngineResult;
  quant: QuantReport;
  gate: GateDecision;
  receipt: Receipt;
}

/** Largest concession a challenge can extract in one round, in score units.
 *  Calibrated to sway razor-thin rounds without capsizing confident ones: a
 *  dialogue is one exchange, not a re-vote. */
const MAX_CONCESSION = 0.1;

/**
 * Picks the most-diverging lens pair on the top-scoring action under uniform weights,
 * then asks each side to speak: challenger questions the action, defender responds.
 *
 * The exchange is CAUSAL (spec S5-1): the defender may concede ground on the contested
 * action after hearing the challenge. The concession is clamped and applied to the
 * defender's position IN PLACE — the engine scores the post-dialogue council, so a
 * challenge that lands can flip a close round. The original and revised scores are
 * recorded on the defense `Challenge` for the receipt trail and the UI.
 */
async function buildChallenges(
  agents: DeliberationAgents,
  positions: DoctrinePosition[],
  input: RoundInput,
): Promise<Challenge[]> {
  if (positions.length < 2) return [];

  // Top action under uniform weights = highest average score across all lenses
  const avgScore = (a: ActionId) => positions.reduce((s, p) => s + p.scores[a], 0) / positions.length;
  const topAction = ACTIONS.reduce((a, b) => avgScore(b) > avgScore(a) ? b : a);

  // Challenger = least convinced by topAction; defender = most convinced
  const sorted = [...positions].sort((a, b) => a.scores[topAction] - b.scores[topAction]);
  const challenger = sorted[0]!;
  const defender = sorted[sorted.length - 1]!;
  if (challenger.doctrine === defender.doctrine) return [];

  const challengeResult = await agents.challengeResponse(
    "challenger", challenger.doctrine, defender.doctrine, topAction, "", input,
    {
      myScore: challenger.scores[topAction], theirScore: defender.scores[topAction],
      myConfidence: challenger.confidence, theirConfidence: defender.confidence,
    },
  );
  const defenseResult = await agents.challengeResponse(
    "defender", defender.doctrine, challenger.doctrine, topAction, challengeResult.text, input,
    {
      myScore: defender.scores[topAction], theirScore: challenger.scores[topAction],
      myConfidence: defender.confidence, theirConfidence: challenger.confidence,
    },
  );

  // Apply the defender's concession, clamped so one exchange can sway but not capsize.
  const originalScore = defender.scores[topAction];
  let revisedScore: number | undefined;
  if (defenseResult.revisedScore !== undefined) {
    const concession = Math.max(
      -MAX_CONCESSION,
      Math.min(MAX_CONCESSION, defenseResult.revisedScore - originalScore),
    );
    revisedScore = Math.max(-1, Math.min(1, originalScore + concession));
    if (Math.abs(revisedScore - originalScore) > 1e-9) {
      defender.scores[topAction] = revisedScore; // the engine sees the post-dialogue score
    } else {
      revisedScore = undefined;
    }
  }

  return [
    { from: challenger.doctrine, against: defender.doctrine, text: challengeResult.text, contested: topAction },
    {
      from: defender.doctrine, against: challenger.doctrine, text: defenseResult.text,
      contested: topAction, originalScore, revisedScore,
    },
  ];
}

/**
 * BATNA floor (deterministic). The seller's walk-away is SELLER_FLOOR; a deal only
 * helps if the counterparty can be brought above it. Project the best reachable
 * price optimistically — current offer plus the strongest concession observed so far
 * (or a generous benefit-of-the-doubt before any movement is seen), repeated over the
 * remaining rounds. If even that optimistic projection can't clear the floor, no deal
 * beats walking: return true so the engine makes `walk` the argmax.
 *
 * Uses only observed offers (legitimately visible to the council), never the hidden
 * reservation — and never fires on a viable deal, since all in-zone counterparties
 * open and stay above the floor.
 */
function batnaDominates(input: RoundInput): boolean {
  if (input.buyerOffer >= SELLER_FLOOR) return false; // already in deal-able territory
  const offers = [...input.history.map((m) => m.offer.price), input.buyerOffer];
  let bestRise = 0;
  for (let i = 1; i < offers.length; i++) bestRise = Math.max(bestRise, offers[i]! - offers[i - 1]!);
  // Before we've seen them move, grant a generous plausible concession so we don't
  // walk prematurely on a low opening offer.
  const assumedRise = offers.length < 2 ? 700 : bestRise;
  const projectedBest = input.buyerOffer + assumedRise * Math.max(0, input.ctx.roundsLeft - 1);
  return projectedBest < SELLER_FLOOR;
}

/**
 * Deadline rule (deterministic, mirror of the BATNA floor): on the FINAL round, a standing
 * offer above the seller's floor is a sure gain, and holding past it bets the whole deal
 * on the counterparty's deadline convention — kind ones close at the standing offer, the
 * classic ANAC convention burns it to nothing. Bank the sure surplus. Found by running
 * the council against literature opponents (Faratin time-dependent tactics), where the
 * original hold-to-the-cap habit walked away from live money.
 */
function deadlineAccepts(input: RoundInput): boolean {
  return input.ctx.roundsLeft <= 1 && input.buyerOffer > SELLER_FLOOR;
}

/**
 * Run one round of deliberation (spec §3 steps 2-4): doctrines score under the
 * updated belief, Battle/War challenge, the Arbiter weights the terrain, the
 * deterministic engine synthesizes, the Quant flags EV-divergence, and Dotto
 * gates the result into an outward action. Arithmetic is never an LLM (spec §5).
 */
export async function deliberateRound(
  agents: DeliberationAgents,
  input: RoundInput,
  options: { sink?: EventSink; timestamp?: string; scenarioId: string; config?: EngineConfig; governor?: AIGovernor },
): Promise<RoundDecision> {
  const emit: EventSink = options.sink ?? (() => {});
  const config = options.config ?? DEFAULT_CONFIG;

  const read = await agents.empathyRead(input);
  await emit({ type: "intent", read });

  const positions = await Promise.all(
    DOCTRINES.map((d) => agents.doctrinePosition(d, input, read)),
  );
  for (const position of positions) await emit({ type: "position", position });

  const challenges = await buildChallenges(agents, positions, input);
  for (const challenge of challenges) await emit({ type: "challenge", challenge });

  const evi = expectedValueOfInformation(input.belief, input.buyerOffer, input.ctx.roundsLeft);
  await emit({ type: "evi", evi });

  const arbiter = await agents.arbiterWeights(input.ctx, read);
  await emit({ type: "arbiter", verdict: arbiter });

  const engine = score(positions, arbiter.weights, config, { batnaWalk: batnaDominates(input), deadlineAccept: deadlineAccepts(input) });
  await emit({ type: "engine", engine });

  const quant = quantCheck(input.belief, input.buyerOffer, engine.recommendation);
  await emit({ type: "quant", quant });

  const gateDecision = await gate(engine.recommendation, input.ctx, engine, quant, options.governor);
  await emit({ type: "gate", gate: gateDecision });

  const receipt = signReceipt({
    scenarioId: options.scenarioId,
    round: input.round,
    recommendation: engine.recommendation,
    weights: arbiter.weights,
    confidence: engine.confidence,
    evDivergence: quant.delta,
    gate: gateDecision.gate,
    finalAction: gateDecision.finalAction,
    timestamp: options.timestamp ?? new Date().toISOString(),
  });
  receiptStore.add(receipt);
  await emit({ type: "receipt", receipt });

  return { read, positions, challenges, evi, arbiter, engine, quant, gate: gateDecision, receipt };
}
