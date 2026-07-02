import { GameMaster } from "../gm/gameMaster.js";
import type { TerminalReveal } from "../gm/types.js";
import type { DeliberationAgents } from "../agents/index.js";
import { runNegotiation } from "../protocol/loop.js";
import { EVAL_SUITE, type SuiteEntry } from "../suite.js";
import { runBaseline } from "./baseline.js";

export interface TypeStats {
  surplusMean: number;
  surplusStd: number;
  dealRate: number;
  n: number;
}

export interface AbRow {
  id: string;
  typeName: string;
  punishes: string;
  baseline: TypeStats;
  council: TypeStats;
}

export interface AbReport {
  rows: AbRow[];
  totals: {
    baselineSurplusMean: number;
    councilSurplusMean: number;
    baselineDealRate: number;
    councilDealRate: number;
    n: number;
  };
}

const outcomeOf = (t: TerminalReveal) => ({
  surplusCaptured: t.surplusCaptured,
  dealSurvived: t.dealSurvived,
});

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function toStats(outcomes: { surplusCaptured: number; dealSurvived: boolean }[]): TypeStats {
  const surpluses = outcomes.map((o) => o.surplusCaptured);
  return {
    surplusMean: surpluses.reduce((s, v) => s + v, 0) / surpluses.length,
    surplusStd: stdDev(surpluses),
    dealRate: outcomes.filter((o) => o.dealSurvived).length / outcomes.length,
    n: outcomes.length,
  };
}

/**
 * Run (A) a single-agent baseline and (B) the Council across N seeds per hidden type.
 * Reports mean ± std of surplus captured and deal rate — a more honest headline than
 * a single cherry-picked seed.
 *
 * Optional `baselineAgents` (S2-5): supply a second DeliberationAgents whose
 * `baselineTurn` is used as A — enables Qwen-vs-Qwen comparison that isolates
 * structure from LLM quality.
 */
export async function runAbComparison(
  agents: DeliberationAgents,
  options: {
    suite?: SuiteEntry[];
    nSeeds?: number;
    baselineAgents?: DeliberationAgents;
  } = {},
): Promise<AbReport> {
  const suite = options.suite ?? EVAL_SUITE;
  const nSeeds = options.nSeeds ?? 10;
  const baseAgents = options.baselineAgents ?? agents;
  const rows: AbRow[] = [];

  for (const entry of suite) {
    const baselineOutcomes: { surplusCaptured: number; dealSurvived: boolean }[] = [];
    const councilOutcomes: { surplusCaptured: number; dealSurvived: boolean }[] = [];

    for (let i = 0; i < nSeeds; i++) {
      // Prime stride so seeds don't cluster — each (type, i) pair is unique
      const seed = entry.seed + i * 997;

      const baselineGm = new GameMaster(entry.type, seed);
      baselineOutcomes.push(outcomeOf(await runBaseline(baseAgents, baselineGm, "strong")));

      const councilGm = new GameMaster(entry.type, seed);
      const result = await runNegotiation(agents, councilGm, entry.id, entry.type);
      councilOutcomes.push(outcomeOf(result.terminal));
    }

    rows.push({
      id: entry.id,
      typeName: entry.title,
      punishes: entry.punishes,
      baseline: toStats(baselineOutcomes),
      council: toStats(councilOutcomes),
    });
  }

  const totalN = rows.reduce((s, r) => s + r.council.n, 0);
  return {
    rows,
    totals: {
      baselineSurplusMean: rows.reduce((s, r) => s + r.baseline.surplusMean, 0),
      councilSurplusMean: rows.reduce((s, r) => s + r.council.surplusMean, 0),
      baselineDealRate: rows.reduce((s, r) => s + r.baseline.dealRate, 0) / rows.length,
      councilDealRate: rows.reduce((s, r) => s + r.council.dealRate, 0) / rows.length,
      n: totalN,
    },
  };
}
