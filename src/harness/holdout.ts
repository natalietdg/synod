import { GameMaster } from "../gm/gameMaster.js";
import { HOLDOUT_WORLDS, type HoldoutWorld } from "../gm/holdout.js";
import { runNegotiation } from "../protocol/loop.js";
import { runBaseline } from "./baseline.js";
import { withSingleLens } from "./ablation.js";
import { DOCTRINES, LENSES } from "../core/types.js";
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
  /** Optional single-lens collapse per world — the "why not just Learning?" data. */
  lenses?: Record<string, { surplusMean: number; dealRate: number }>;
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
  opts: { singleLens?: boolean } = {},
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

    // Single-lens collapse on the same seeds: which worldview would you have bet on?
    let lenses: HoldoutRow["lenses"];
    if (opts.singleLens) {
      lenses = {};
      for (const d of DOCTRINES) {
        const outcomes = [];
        for (let i = 0; i < nSeeds; i++) {
          const seed = 7919 * (w + 1) + i * 997;
          const gm = new GameMaster(world.type, seed, undefined, world.profile);
          const res = await runNegotiation(withSingleLens(agents, d), gm, world.id, world.type);
          outcomes.push({ surplusCaptured: res.terminal.surplusCaptured, dealSurvived: res.terminal.dealSurvived });
        }
        const s = toStats(outcomes);
        lenses[LENSES[d].cogFunction] = { surplusMean: s.surplusMean, dealRate: s.dealRate };
      }
    }

    rows.push({
      id: world.id,
      title: world.title,
      targets: world.targets,
      baseline: toStats(baselineOutcomes),
      council: toStats(councilOutcomes),
      ...(lenses ? { lenses } : {}),
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
