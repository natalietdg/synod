import "dotenv/config";
import { QwenAdversaryGM } from "../gm/qwenAdversary.js";
import { runNegotiation } from "../protocol/loop.js";
import { runBaseline } from "./baseline.js";
import { selectAgents } from "../agents/index.js";
import { SUITE } from "../suite.js";
import { COUNTERPARTY_TYPES } from "../core/types.js";

/**
 * The 2×2 tournament — completes the evaluation square (S7-2):
 *
 *                      scripted GM            unscripted Qwen adversary
 *   strong baseline    A/B table (README)     ← THIS HARNESS
 *   Synod council      A/B table (README)     ← THIS HARNESS
 *
 * The unscripted opponent is a live model playing from a hidden brief — nobody
 * authored its moves. If the council's edge over the single agent holds here too,
 * the gain claim generalizes beyond the world we wrote. Repetitions, not seeds:
 * the adversary is stochastic by nature (temperature 0.7).
 *
 * Run: `npm run tournament [-- nReps]` (requires LLM_PROVIDER=qwen).
 */
async function main(): Promise<void> {
  const agents = selectAgents();
  if (agents.kind !== "qwen") {
    console.error("Tournament requires LLM_PROVIDER=qwen — the adversary is a live model.");
    process.exit(1);
  }
  const nReps = Number(process.argv[2] ?? 2);
  console.log(`2×2 tournament vs unscripted Qwen adversary · ${nReps} rep(s) per type\n`);

  const summary: Record<string, { surplus: number[]; deals: number }> = {
    baseline: { surplus: [], deals: 0 },
    council: { surplus: [], deals: 0 },
  };

  for (const type of COUNTERPARTY_TYPES) {
    const entry = SUITE.find((s) => s.type === type);
    for (let rep = 0; rep < nReps; rep++) {
      const b = await runBaseline(agents, new QwenAdversaryGM(type), "strong");
      summary.baseline!.surplus.push(b.surplusCaptured);
      if (b.dealSurvived) summary.baseline!.deals++;
      console.log(
        `  baseline vs ${type.padEnd(12)} rep ${rep + 1}: ` +
        `${b.dealSurvived ? "$" + b.surplusCaptured.toLocaleString() : "WALK"}`,
      );

      const c = await runNegotiation(agents, new QwenAdversaryGM(type), entry?.id ?? type, type);
      summary.council!.surplus.push(c.terminal.surplusCaptured);
      if (c.terminal.dealSurvived) summary.council!.deals++;
      console.log(
        `  council  vs ${type.padEnd(12)} rep ${rep + 1}: ` +
        `${c.terminal.dealSurvived ? "$" + c.terminal.surplusCaptured.toLocaleString() : "WALK"}`,
      );
    }
  }

  const runs = COUNTERPARTY_TYPES.length * nReps;
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  console.log(`\n=== vs unscripted Qwen adversary (${runs} runs/arm) ===`);
  console.log(`  baseline: mean surplus $${Math.round(mean(summary.baseline!.surplus)).toLocaleString()} · deals ${summary.baseline!.deals}/${runs}`);
  console.log(`  council : mean surplus $${Math.round(mean(summary.council!.surplus)).toLocaleString()} · deals ${summary.council!.deals}/${runs}`);
}

main().catch((err) => { console.error(String(err)); process.exit(1); });
