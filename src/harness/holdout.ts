import { GameMaster } from "../gm/gameMaster.js";
import { HOLDOUT_WORLDS, type HoldoutWorld } from "../gm/holdout.js";
import { runNegotiation } from "../protocol/loop.js";
import { runBaseline } from "./baseline.js";
import type { DeliberationAgents } from "../agents/index.js";

export interface HoldoutStats {
  surplusMean: number;
  dealRate: number;
  walkRate: number;
  n: number;
}

export interface HoldoutRow {
  id: string;
  title: string;
  targets: string;
  baseline: HoldoutStats;
  council: HoldoutStats;
}

export interface HoldoutReport {
  rows: HoldoutRow[];
  totals: { baselineSurplusMean: number; councilSurplusMean: number };
  provenance: string;
}

const toStats = (outcomes: { surplusCaptured: number; dealSurvived: boolean }[]): HoldoutStats => ({
  surplusMean: outcomes.reduce((s, o) => s + o.surplusCaptured, 0) / outcomes.length,
  dealRate: outcomes.filter((o) => o.dealSurvived).length / outcomes.length,
  walkRate: outcomes.filter((o) => !o.dealSurvived).length / outcomes.length,
  n: outcomes.length,
});

/**
 * Run the adversarially-authored hold-out suite (see src/gm/holdout.ts for
 * provenance). Same protocol as the A/B harness: identical GM + seed per arm,
 * n seeds per world, results published as they come out — including losses.
 */
export async function runHoldout(
  agents: DeliberationAgents,
  nSeeds = 10,
): Promise<HoldoutReport> {
  const rows: HoldoutRow[] = [];

  for (const [w, world] of HOLDOUT_WORLDS.entries()) {
    const baselineOutcomes = [];
    const councilOutcomes = [];
    for (let i = 0; i < nSeeds; i++) {
      const seed = 7919 * (w + 1) + i * 997; // fixed schedule, disjoint from the main suite
      const bGm = new GameMaster(world.type, seed, undefined, world.profile);
      const b = await runBaseline(agents, bGm, "strong");
      baselineOutcomes.push({ surplusCaptured: b.surplusCaptured, dealSurvived: b.dealSurvived });

      const cGm = new GameMaster(world.type, seed, undefined, world.profile);
      const c = await runNegotiation(agents, cGm, world.id, world.type);
      councilOutcomes.push({
        surplusCaptured: c.terminal.surplusCaptured,
        dealSurvived: c.terminal.dealSurvived,
      });
    }
    rows.push({
      id: world.id,
      title: world.title,
      targets: world.targets,
      baseline: toStats(baselineOutcomes),
      council: toStats(councilOutcomes),
    });
  }

  return {
    rows,
    totals: {
      baselineSurplusMean: rows.reduce((s, r) => s + r.baseline.surplusMean, 0),
      councilSurplusMean: rows.reduce((s, r) => s + r.council.surplusMean, 0),
    },
    provenance:
      "Worlds authored adversarially by Claude (Anthropic), frozen before evaluation; " +
      "the council's payoff model was calibrated on the ORIGINAL profiles only. " +
      "Results published as measured.",
  };
}
