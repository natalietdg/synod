import "dotenv/config";
import { writeFileSync } from "node:fs";
import { GameMaster } from "../gm/gameMaster.js";
import { runNegotiation } from "../protocol/loop.js";
import { getEntry } from "../suite.js";
import { MockAgents } from "../agents/mock.js";
import { QwenAgents } from "../agents/qwen.js";
import { runLiveCouncil } from "../society/liveCouncil.js";
import { WAR_MOVES } from "../society/warMoves.js";

/**
 * DEBATE-CAUSALITY ABLATION (live) — the controlled version of "is the dialogue causal?"
 *
 * Every live council contains its own matched pair: the chair scores the SAME generals'
 * positions twice with the SAME terrain weights — once on their round-1 reads (before any
 * argument) and once on their final calls (after the deliberation). Nothing else differs,
 * so any difference between the two chair calls is attributable to the debate alone.
 *
 * This harness runs N live councils per scenario and reports, as measured rates:
 *   - how often the debate moved at least one general off their round-1 call, and
 *   - how often those movements changed the CHAIR's final call (round-1 chair call vs
 *     final chair call — the outcome-level causal effect the track brief asks about).
 *
 * Published as counted, favorable or not: in the deterministic engine the same ablation is
 * −0 BY DESIGN (persuasion cannot override the computation); this measures the live
 * counterpart where generals genuinely reason and may genuinely be talked round.
 *
 * Run: npx tsx src/harness/debateAblation.ts [trialsPerScenario]
 * Cost: live Qwen — ~(5 reads + rounds×5 reactions) per trial.
 * Writes public/debate-ablation.json for the site to render.
 */

interface Trial {
  scenario: string;
  round1Call: string;
  finalCall: string;
  chairFlipped: boolean;
  generalsMoved: number; // generals whose final call differs from their round-1 call
  generalsTotal: number;
  deliberationRounds: number;
  stopReason: string;
}

async function terrainFor(scenarioId: string) {
  const entry = getEntry(scenarioId)!;
  const canon = await runNegotiation(new MockAgents(), new GameMaster(entry.type, entry.seed), entry.id, entry.type);
  const r1 = canon.rounds[0]!;
  return { arbiterWeights: r1.arbiter.weights, ctx: r1.ctx };
}

async function runTrial(scenarioId: string): Promise<Trial> {
  const terrain = await terrainFor(scenarioId);
  const live = await runLiveCouncil(new QwenAgents(), WAR_MOVES[scenarioId]!.move, terrain);
  const first = live.deliberation.rounds[0]!;
  const last = live.deliberation.rounds[live.deliberation.rounds.length - 1]!;
  const byId = new Map(first.turns.map((t) => [t.id, t.call]));
  const generalsMoved = last.turns.filter((t) => byId.get(t.id) !== t.call).length;
  return {
    scenario: scenarioId,
    round1Call: live.deliberation.round1Label,
    finalCall: live.deliberation.finalLabel,
    chairFlipped: live.deliberation.changedCall,
    generalsMoved,
    generalsTotal: last.turns.length,
    deliberationRounds: live.deliberation.rounds.length,
    stopReason: live.deliberation.stopReason,
  };
}

async function main() {
  const N = Number(process.argv[2]) || 4;
  const scenarios = Object.keys(WAR_MOVES);
  const trials: Trial[] = [];
  for (const sc of scenarios) {
    for (let i = 0; i < N; i++) {
      const t = await runTrial(sc);
      trials.push(t);
      console.log(
        `${sc.padEnd(22)} trial ${i + 1}/${N} · generals moved ${t.generalsMoved}/${t.generalsTotal}` +
        ` · chair: ${t.round1Call} → ${t.finalCall}${t.chairFlipped ? "  ◀ FLIPPED BY THE DEBATE" : ""}` +
        ` (${t.deliberationRounds} rounds, ${t.stopReason})`,
      );
    }
  }

  const flips = trials.filter((t) => t.chairFlipped).length;
  const anyMoved = trials.filter((t) => t.generalsMoved > 0).length;
  const out = {
    recorded: new Date().toISOString(),
    method:
      "Matched-pair within each live council: the chair scores the same generals' positions with the same " +
      "terrain weights before the debate (round-1 reads) and after it (final calls). Only the deliberation " +
      "differs, so any change in the chair's call is attributable to the debate.",
    models: { judgment: process.env.QWEN_MODEL ?? "qwen-max", fast: process.env.QWEN_MODEL_FAST ?? "qwen-turbo" },
    trialsPerScenario: N,
    trials,
    summary: {
      trials: trials.length,
      generalsMovedInAtLeastOneRound: anyMoved,
      generalsMovedRate: +(anyMoved / trials.length).toFixed(2),
      meanGeneralsMovedPerTrial: +(trials.reduce((s, t) => s + t.generalsMoved, 0) / trials.length).toFixed(2),
      chairFlips: flips,
      chairFlipRate: +(flips / trials.length).toFixed(2),
    },
  };
  writeFileSync("public/debate-ablation.json", JSON.stringify(out, null, 2));
  console.log(
    `\nSUMMARY  trials=${trials.length}  debate moved ≥1 general in ${anyMoved}/${trials.length}` +
    `  chair flipped in ${flips}/${trials.length} (${Math.round((flips / trials.length) * 100)}%)`,
  );
  console.log("✓ wrote public/debate-ablation.json");
}

main();
