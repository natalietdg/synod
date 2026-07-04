import { GameMaster } from "../gm/gameMaster.js";
import { ACTIONS } from "../core/actions.js";
import { runNegotiation } from "../protocol/loop.js";
import { EVAL_SUITE } from "../suite.js";
import { DOCTRINES, LENSES, type DoctrineId } from "../core/types.js";
import type { ArbiterVerdict, ContextVector, EmpathyRead } from "../core/types.js";
import type { DeliberationAgents } from "../agents/index.js";
import { GENERALS } from "../society/generals.js";

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

/** Switch off ONE general: zero their owned lens's weight (and renormalize), so that
 *  faculty has no say in the decision — the rest of the council decides without it. Used by
 *  the interactive "switch off a general" artifact: pick any general, watch the effect. */
export const withLensOff = (base: DeliberationAgents, off: DoctrineId): DeliberationAgents =>
  wrap(base, {
    arbiterWeights: async (ctx: ContextVector, read: EmpathyRead): Promise<ArbiterVerdict> => {
      const v = await base.arbiterWeights(ctx, read);
      const w = { ...v.weights, [off]: 0 };
      const sum = DOCTRINES.reduce((s, d) => s + w[d], 0) || 1;
      for (const d of DOCTRINES) w[d] = w[d] / sum;
      return { ...v, weights: w, rationale: `Switched off: ${LENSES[off].cogFunction}.` };
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

/** MAJORITY VOTE — the naive aggregator the chair replaces. Each judge casts one vote for
 *  its single favourite action (scores collapse to one-hot), all votes count equally, and
 *  plurality wins. Same five judges, same reads — only the aggregation differs. This
 *  isolates the project's OWN design choice: does the situation-weighted chair beat plain
 *  voting by the same council? */
const withMajorityVote = (base: DeliberationAgents): DeliberationAgents =>
  wrap(base, {
    doctrinePosition: async (...args: Parameters<DeliberationAgents["doctrinePosition"]>) => {
      const p = await base.doctrinePosition(...args);
      const top = ACTIONS.reduce((a, b) => (p.scores[b] > p.scores[a] ? b : a));
      const scores = {} as typeof p.scores;
      for (const a of ACTIONS) scores[a] = a === top ? 1 : 0;
      return { ...p, scores };
    },
    arbiterWeights: async (ctx: ContextVector, _read: EmpathyRead): Promise<ArbiterVerdict> => {
      const weights = {} as Record<DoctrineId, number>;
      for (const d of DOCTRINES) weights[d] = 1 / DOCTRINES.length;
      return { context: ctx, weights, rationale: "Ablation: one judge, one vote — plurality wins, no chair." };
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

  for (const entry of EVAL_SUITE) {
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
    dealRate: dealRateSum / EVAL_SUITE.length,
    deceptiveSurplusMean,
    n: nSeeds,
  };
}

export async function runAblation(
  agents: DeliberationAgents,
  nSeeds = 10,
): Promise<AblationReport> {
  const rows: AblationRow[] = [];

  rows.push(await runVariant(agents, "Full council (everything on)", "all components active", nSeeds));
  rows.push(await runVariant(
    withoutCausalChallenge(agents),
    "without the debate step",
    "the generals still argue, but no one ever concedes",
    nSeeds,
  ));
  rows.push(await runVariant(
    withoutProbeLens(agents),
    "without the probe check",
    "the council can never choose to check a claim first",
    nSeeds,
  ));
  rows.push(await runVariant(
    withUniformArbiter(agents),
    "no chair (equal weights)",
    "every lens counts the same, no matter the situation",
    nSeeds,
  ));
  rows.push(await runVariant(
    withMajorityVote(agents),
    "majority vote (no chair)",
    "one judge one vote, plurality wins — the naive aggregator the chair replaces",
    nSeeds,
  ));

  // Single-lens councils: collapse to each worldview in turn. The spread between the
  // best and worst single lens is the cost of having to pick a worldview in advance —
  // the council's job is to match the best one ex ante, without knowing which it is.
  for (const d of DOCTRINES) {
    rows.push(await runVariant(
      withSingleLens(agents, d),
      `only the ${LENSES[d].cogFunction} lens`,
      `all weight on the ${LENSES[d].name} lens`,
      nSeeds,
    ));
  }

  return { rows, nSeeds };
}

/**
 * The society vs any single general (item 11 for the war room): does the adaptive chair
 * beat each general deciding alone? Each general OWNS one lens, so "only <general>" is that
 * lens deciding alone (single-lens collapse). Run the full society and every single-general
 * council over the same seeds — at the level the demo shows: generals, each their faculty.
 */
export async function runGeneralBench(
  agents: DeliberationAgents,
  nSeeds = 10,
): Promise<AblationReport> {
  const rows: AblationRow[] = [];
  rows.push(await runVariant(agents, "Full society (chair adapts)", "the chair weights the lenses to the situation each round", nSeeds));
  for (const g of GENERALS) {
    rows.push(await runVariant(
      withSingleLens(agents, g.lens),
      `only ${g.name}`,
      `${g.name} deciding alone — their ${LENSES[g.lens].cogFunction} lens only`,
      nSeeds,
    ));
  }
  return { rows, nSeeds };
}
