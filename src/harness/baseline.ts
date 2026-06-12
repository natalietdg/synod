import { UNIFORM_PRIOR } from "../belief/update.js";
import { OPENING_ASK, ROUND_CAP } from "../gm/profiles.js";
import { isTerminal, type CounterpartyEngine, type CounterpartyMove, type TerminalReveal } from "../gm/types.js";
import type { BaselinePersona, DeliberationAgents, RoundInput } from "../agents/index.js";
import { computeContext } from "../protocol/context.js";
import { encodeMove } from "../protocol/encode.js";

/**
 * Run a single-agent baseline against the GM (spec §9). Same model, same action
 * set, same deterministic GM + seed, same move encoding as the Council — the ONLY
 * removed variable is the doctrine/Arbiter structure and the type belief. If the
 * Council beats this, the gain is attributable to the structure.
 */
export async function runBaseline(
  agents: DeliberationAgents,
  gm: CounterpartyEngine,
  persona: BaselinePersona,
): Promise<TerminalReveal> {
  let councilAsk = OPENING_ASK;
  let conceded: string[] = [];
  const priorMoves: CounterpartyMove[] = [];

  let move = await gm.open();
  for (let guard = 0; guard < 12; guard++) {
    const roundsLeft = ROUND_CAP - move.round + 1;
    // The single agent holds no belief; pass a diffuse prior so the context is well-formed.
    const ctx = computeContext(UNIFORM_PRIOR, councilAsk, roundsLeft, move.signals);
    const input: RoundInput = {
      round: move.round,
      move,
      history: [...priorMoves],
      belief: UNIFORM_PRIOR,
      ctx,
      buyerOffer: move.offer.price,
      councilAsk,
    };

    const decision = await agents.baselineTurn(persona, input);
    const councilMove = encodeMove(decision.action, councilAsk, move.offer.price, move.offer.features, conceded);
    conceded = councilMove.ask.features;
    councilAsk = councilMove.ask.price;

    priorMoves.push(move);
    const emission = await gm.step(councilMove);
    if (isTerminal(emission)) return emission;
    move = emission;
  }
  // Safety: should never reach here (the GM forces a terminal at the round cap).
  return (await gm.step({ action: "accept", ask: { price: move.offer.price, features: conceded } })) as TerminalReveal;
}
