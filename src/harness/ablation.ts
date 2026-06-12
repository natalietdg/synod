import { GameMaster } from "../gm/gameMaster.js";
import { runNegotiation } from "../protocol/loop.js";
import { SUITE } from "../suite.js";
import { DOCTRINES, LENSES, type DoctrineId } from "../core/types.js";
import type { ArbiterVerdict, ContextVector, EmpathyRead } from "../core/types.js";
import type { DeliberationAgents } from "../agents/index.js";

/**
 * Ablation study (spec S5-2): remove one architectural component at a time and
 * re-run the full suite on the SAME seeds. If a component's removal doesn't hurt,
 * the table says so — the point is to prove (or disprove) that each part of the
 * council earns its complexity, not to flatter the architecture.
 */

export interface AblationRow {
  variant: string;
  description: string;
  totalSurplusMean: number; // sum of per-type mean surplus
  dealRate: number; // average deal rate across types
  deceptiveSurplusMean: number; // the proof-of-concept type, broken out
  n: number; // seeds per type
}

export interface AblationReport {
  rows: AblationRow[];
  nSeeds: number;
}

/** Proxy an agents object, overriding selected methods. Everything else passes through. */
function wrap(base: DeliberationAgents, overrides: Partial<DeliberationAgents>): DeliberationAgents {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in overrides) return (overrides as Record<PropertyKey, unknown>)[prop];
      return Reflect.get(target, prop, receiver);
    },
  }) as DeliberationAgents;
}

/** − causal challenge: the exchange still happens, but the defender never concedes. */
const withoutCausalChallenge = (base: DeliberationAgents): DeliberationAgents =>
  wrap(base, {
    challengeResponse: async (...args: Parameters<DeliberationAgents["challengeResponse"]>) => {
      const result = await base.challengeResponse(...args);
      return { text: result.text }; // strip the revision — dialogue becomes decorative
    },
  });

/** − probe lens: the lens still scores, but its EVI trigger is removed (never recommends probing).
 *  Exported: the UI's "rerun without the probe gate" button uses this — the causal
 *  lever a judge can flip themselves, same seed, same counterparty. */
export const withoutProbeLens = (base: DeliberationAgents): DeliberationAgents =>
  wrap(base, {
    doctrinePosition: async (...args: Parameters<DeliberationAgents["doctrinePosition"]>) => {
      const position = await base.doctrinePosition(...args);
      if (position.doctrine === "probe") position.scores.probe = -1;
      return position;
    },
  });

/** Uniform Arbiter: terrain-weighting replaced by 1/5 each — the council without a chair. */
const withUniformArbiter = (base: DeliberationAgents): DeliberationAgents =>
  wrap(base, {
    arbiterWeights: async (ctx: ContextVector, _read: EmpathyRead): Promise<ArbiterVerdict> => {
      const weights = {} as Record<DoctrineId, number>;
      for (const d of DOCTRINES) weights[d] = 1 / DOCTRINES.length;
      return { context: ctx, weights, rationale: "Ablation: uniform weights (no terrain reading)." };
    },
  });

/** Single lens: all weight on one doctrine — the council collapsed to one worldview.
 *  Exported: the hold-out harness uses it to answer "why not just Learning?" on
 *  worlds the council was never tuned on. */
export const withSingleLens = (base: DeliberationAgents, lens: DoctrineId): DeliberationAgents =>
  wrap(base, {
    arbiterWeights: async (ctx: ContextVector, _read: EmpathyRead): Promise<ArbiterVerdict> => {
      const weights = {} as Record<DoctrineId, number>;
      for (const d of DOCTRINES) weights[d] = d === lens ? 1 : 0;
      return { context: ctx, weights, rationale: `Ablation: ${LENSES[lens].name} lens only.` };
    },
  });

async function runVariant(
  agents: DeliberationAgents,
  variant: string,
  description: string,
  nSeeds: number,
): Promise<AblationRow> {
  let totalSurplusMean = 0;
  let dealRateSum = 0;
  let deceptiveSurplusMean = 0;

  for (const entry of SUITE) {
    let surplusSum = 0;
    let deals = 0;
    for (let i = 0; i < nSeeds; i++) {
      const seed = entry.seed + i * 997; // identical seed schedule to the A/B harness
      const gm = new GameMaster(entry.type, seed);
      const result = await runNegotiation(agents, gm, entry.id, entry.type);
      surplusSum += result.terminal.surplusCaptured;
      if (result.terminal.dealSurvived) deals += 1;
    }
    const mean = surplusSum / nSeeds;
    totalSurplusMean += mean;
    dealRateSum += deals / nSeeds;
    if (entry.type === "deceptive") deceptiveSurplusMean = mean;
  }

  return {
    variant,
    description,
    totalSurplusMean,
    dealRate: dealRateSum / SUITE.length,
    deceptiveSurplusMean,
    n: nSeeds,
  };
}

export async function runAblation(
  agents: DeliberationAgents,
  nSeeds = 10,
): Promise<AblationReport> {
  const rows: AblationRow[] = [];

  rows.push(await runVariant(agents, "Full Synod", "all components active", nSeeds));
  rows.push(await runVariant(
    withoutCausalChallenge(agents),
    "− causal challenge",
    "exchange happens but the defender never concedes",
    nSeeds,
  ));
  rows.push(await runVariant(
    withoutProbeLens(agents),
    "− probe trigger",
    "Learning lens never recommends probing (EVI rule removed)",
    nSeeds,
  ));
  rows.push(await runVariant(
    withUniformArbiter(agents),
    "uniform Arbiter",
    "terrain weighting replaced by 1/5 each",
    nSeeds,
  ));

  // Single-lens councils: collapse to each worldview in turn. The spread between the
  // best and worst single lens is the cost of having to pick a worldview in advance —
  // the council's job is to match the best one ex ante, without knowing which it is.
  for (const d of DOCTRINES) {
    rows.push(await runVariant(
      withSingleLens(agents, d),
      `single lens — ${LENSES[d].cogFunction}`,
      `all weight on the ${LENSES[d].name} lens`,
      nSeeds,
    ));
  }

  return { rows, nSeeds };
}
