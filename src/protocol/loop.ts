import { type Belief } from "../core/types.js";
import { UNIFORM_PRIOR, updateBelief } from "../belief/update.js";
import { OPENING_ASK, ROUND_CAP } from "../gm/profiles.js";
import { isTerminal, type CounterpartyEngine, type CounterpartyMove, type TerminalReveal } from "../gm/types.js";
import type { AIGovernor } from "@natalietdg/dotto";
import type { DeliberationAgents, RoundInput } from "../agents/index.js";
import { computeContext } from "./context.js";
import { deliberateRound } from "./round.js";
import { encodeMove } from "./encode.js";
import type { EventSink, NegotiationResult, RoundResult } from "./types.js";

/**
 * Run one full negotiation (spec §3 round loop). Strict information boundary:
 * the agents only ever see `CounterpartyMove`s; the GM only ever sees the encoded
 * `CouncilMove`. The doctrine debate, weights, and matrix never cross to the GM.
 *
 * Each round: the GM emits a move, the belief updates on its signals (the prior
 * for round t+1 is the posterior from round t), the Council deliberates, its
 * gated action is encoded and sent, and the GM reacts — until a terminal reveal.
 */
export async function runNegotiation(
  agents: DeliberationAgents,
  gm: CounterpartyEngine,
  scenarioId: string,
  trueType: string,
  options: { sink?: EventSink; timestamp?: string; governor?: AIGovernor } = {},
): Promise<NegotiationResult> {
  const emit: EventSink = options.sink ?? (() => {});

  let belief: Belief = UNIFORM_PRIOR;
  let councilAsk = OPENING_ASK;
  let conceded: string[] = [];
  const priorMoves: CounterpartyMove[] = [];
  const rounds: RoundResult[] = [];
  const weightTrajectory: NegotiationResult["weightTrajectory"] = [];
  const beliefTrajectory: NegotiationResult["beliefTrajectory"] = [];

  let move = await gm.open();
  await emit({ type: "round-start", round: move.round, move });
  let terminal: TerminalReveal | null = null;

  while (!terminal) {
    // Step 2: Empathy updates the model from the new signal (the Bayesian update).
    const beliefBefore = belief;
    belief = updateBelief(belief, move.signals);
    await emit({ type: "belief", before: beliefBefore, after: belief });
    beliefTrajectory.push({ round: move.round, belief });

    const roundsLeft = ROUND_CAP - move.round + 1;
    const ctx = computeContext(belief, councilAsk, roundsLeft, move.signals);
    const input: RoundInput = {
      round: move.round,
      move,
      history: [...priorMoves],
      belief,
      ctx,
      buyerOffer: move.offer.price,
      councilAsk,
    };

    const decision = await deliberateRound(agents, input, {
      sink: options.sink,
      timestamp: options.timestamp,
      scenarioId,
      governor: options.governor,
    });
    weightTrajectory.push({ round: move.round, weights: decision.arbiter.weights });

    // Encode the gated action into the outward move and send it to the GM.
    const councilMove = encodeMove(
      decision.gate.finalAction,
      councilAsk,
      move.offer.price,
      move.offer.features,
      conceded,
    );
    conceded = councilMove.ask.features;
    councilAsk = councilMove.ask.price;
    await emit({ type: "council-move", move: councilMove });

    rounds.push({
      round: move.round,
      counterpartyMove: move,
      beliefBefore,
      beliefAfter: belief,
      ctx,
      ...decision,
      councilMove,
    });

    priorMoves.push(move);
    const emission = await gm.step(councilMove);
    if (isTerminal(emission)) {
      terminal = emission;
      await emit({ type: "terminal", terminal });
      break;
    }
    move = emission;
    await emit({ type: "round-start", round: move.round, move });
  }

  const result: NegotiationResult = {
    scenarioId,
    trueType,
    rounds,
    terminal,
    weightTrajectory,
    beliefTrajectory,
  };
  await emit({ type: "done", result });
  return result;
}
