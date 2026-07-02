import { GameMaster } from "../gm/gameMaster.js";
import { runNegotiation } from "../protocol/loop.js";
import { COUNTERPARTY_TYPES, type Belief, type CounterpartyType } from "../core/types.js";
import type { DeliberationAgents } from "../agents/index.js";

/** Outcome distribution if the adversary turns out to be this type. */
export interface OutcomeStat {
  type: CounterpartyType;
  /** The council's current P(this is who they are). */
  belief: number;
  /** P(armistice holds | type). */
  armisticeRate: number;
  /** Mean terms captured | type (engine surplus units). */
  expectedTerms: number;
  /** P(talks collapse → war resumes | type). */
  warRate: number;
  n: number;
}

export interface Wargame {
  perType: OutcomeStat[];
  /** Belief-weighted headline: the range of futures the room is actually choosing among. */
  blended: { armisticeRate: number; expectedTerms: number; warRate: number };
  nSeeds: number;
}

/**
 * War-game the table. The council does not know who sits across from it — it holds a
 * belief over the adversary's hidden type. So roll the negotiation forward many times
 * under EACH possible type, then weight by belief. The output is the decision a war
 * room actually wants: not "what will happen" but "here is the distribution of futures,
 * and here is how it splits depending on who they really are."
 *
 * Deterministic (mock agents + fixed seed schedule) so the forecast is reproducible —
 * a war-game you can replay, not a one-off roll.
 */
export async function runWargame(
  agents: DeliberationAgents,
  belief: Belief,
  baseSeed: number,
  nSeeds = 8,
): Promise<Wargame> {
  const perType: OutcomeStat[] = [];

  for (const type of COUNTERPARTY_TYPES) {
    let deals = 0;
    let terms = 0;
    for (let i = 0; i < nSeeds; i++) {
      const gm = new GameMaster(type, baseSeed + i * 131);
      const result = await runNegotiation(agents, gm, `wargame-${type}`, type);
      if (result.terminal.dealSurvived) deals += 1;
      terms += result.terminal.surplusCaptured;
    }
    perType.push({
      type,
      belief: belief[type],
      armisticeRate: deals / nSeeds,
      expectedTerms: terms / nSeeds,
      warRate: 1 - deals / nSeeds,
      n: nSeeds,
    });
  }

  const blend = (pick: (o: OutcomeStat) => number) =>
    perType.reduce((s, o) => s + o.belief * pick(o), 0);

  return {
    perType,
    blended: {
      armisticeRate: blend((o) => o.armisticeRate),
      expectedTerms: blend((o) => o.expectedTerms),
      warRate: blend((o) => o.warRate),
    },
    nSeeds,
  };
}
