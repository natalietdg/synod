import "dotenv/config";
import { selectAgents } from "./agents/index.js";
import { ACTION_LABELS } from "./core/actions.js";
import { COUNTERPARTY_TYPES, DOCTRINES, LENSES, TYPE_META, type Belief } from "./core/types.js";
import { GameMaster } from "./gm/gameMaster.js";
import { runNegotiation } from "./protocol/loop.js";
import { runAbComparison } from "./harness/ab.js";
import { runAblation } from "./harness/ablation.js";
import { SUITE, getEntry } from "./suite.js";
import { verifyReceipt } from "./dotto/receipt.js";

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const money = (x: number): string => `$${x.toLocaleString()}`;

function rule(t: string): void {
  console.log(`\n\x1b[1m${"─".repeat(3)} ${t} ${"─".repeat(Math.max(0, 62 - t.length))}\x1b[0m`);
}
function beliefBar(b: Belief): string {
  return COUNTERPARTY_TYPES.map((t) => `${TYPE_META[t].name.split(" ")[0]} ${pct(b[t])}`).join("  ·  ");
}

async function main(): Promise<void> {
  const agents = selectAgents();
  console.log(`\n\x1b[1mSYNOD\x1b[0m — negotiation deliberation  (agents: ${agents.kind})`);

  // Headline run: the deceptive type (the Probe→reveal→belief-shift beat).
  const entry = getEntry("type-c-deceptive")!;
  console.log(`\nHidden type (GM-only ground truth): \x1b[1m${entry.title}\x1b[0m — ${entry.punishes}`);
  const gm = new GameMaster(entry.type, entry.seed);
  const result = await runNegotiation(agents, gm, entry.id, entry.type);

  for (const r of result.rounds) {
    rule(`ROUND ${r.round}`);
    console.log(`  counterparty: "${r.counterpartyMove.message}"`);
    console.log(`  offer ${money(r.counterpartyMove.offer.price)}   signals: ${r.counterpartyMove.signals.join(", ")}`);
    console.log(`  belief: ${beliefBar(r.beliefBefore)}  →  ${beliefBar(r.beliefAfter)}`);
    console.log(`  EVI: ${money(Math.round(r.evi.evi))} ${r.evi.worthIt ? "> cost → probe pays" : "≤ cost"}`);
    const weights = [...DOCTRINES].sort((a, b) => r.arbiter.weights[b] - r.arbiter.weights[a]);
    console.log(`  weights: ${weights.map((d) => `${LENSES[d].name} ${pct(r.arbiter.weights[d])}`).join("  ")}`);
    const rec = r.engine.recommendation;
    console.log(
      `  → \x1b[1m${ACTION_LABELS[rec]}\x1b[0m (conf ${pct(r.engine.confidence)}${r.engine.deadlock ? `, ⚠ ${r.engine.deadlockReason}` : ""})  ` +
        `Quant: EV-opt ${ACTION_LABELS[r.quant.evOptimal]}, Δ ${money(Math.round(r.quant.delta))}`,
    );
    console.log(`  Dotto: ${r.gate.gate.toUpperCase()} → sends \x1b[1m${ACTION_LABELS[r.councilMove.action]}\x1b[0m @ ${money(r.councilMove.ask.price)}  (receipt ✓ ${verifyReceipt(r.receipt)})`);
  }

  rule("TERMINAL REVEAL (GM)");
  const t = result.terminal;
  console.log(`  outcome: ${t.outcome}   ${t.trustNarrative}`);
  console.log(`  \x1b[1mheadline surplus captured: ${money(t.headlineScore)}\x1b[0m   deal survived: ${t.dealSurvived}`);

  rule("WEIGHT TRAJECTORY (the visible shadow of the Bayesian update)");
  for (const w of result.weightTrajectory) {
    const top2 = [...DOCTRINES].sort((a, b) => w.weights[b] - w.weights[a]).slice(0, 2);
    console.log(`  round ${w.round}: ${top2.map((d) => `${LENSES[d].name} ${pct(w.weights[d])}`).join(", ")}`);
  }

  // A/B over the full suite.
  rule("A/B COMPARISON — strong single agent vs Synod (identical GM per type)");
  const report = await runAbComparison(agents);
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (s: string, n: number) => s.padStart(n);
  console.log("  " + pad("hidden type", 26) + num("baseline", 12) + num("Synod", 12) + "   guardrail");
  for (const row of report.rows) {
    const b = row.baseline;
    const c = row.council;
    const guard = `deals B:${Math.round(b.dealRate * 100)}% S:${Math.round(c.dealRate * 100)}%`;
    console.log(
      "  " + pad(row.typeName, 26) + num(money(b.surplusMean), 12) + num(money(c.surplusMean), 12) + `   ${guard}`,
    );
  }
  console.log(
    "  " + pad("TOTAL surplus", 26) + num(money(report.totals.baselineSurplusMean), 12) + num(money(report.totals.councilSurplusMean), 12),
  );
  console.log(
    `\n  \x1b[2mGain concentrates on the adversarial types (B, C): a monolithic agent collapses\n` +
      `  competing considerations into one stance and gets punished; the Council keeps the\n` +
      `  dissenting doctrine explicit and lets the Arbiter weight it by context.\x1b[0m\n`,
  );

  // Ablation: remove one component at a time, same seeds. Nulls are reported as found.
  rule("ABLATION — remove one component at a time (same seeds)");
  const ablation = await runAblation(agents);
  const full = ablation.rows[0]!;
  console.log("  " + pad("variant", 30) + num("surplus", 10) + num("Δ vs full", 12) + num("deals", 8) + num("deceptive", 12));
  for (const row of ablation.rows) {
    // Delta of the rounded figures, so the column agrees with the table's own arithmetic.
    const delta = Math.round(row.totalSurplusMean) - Math.round(full.totalSurplusMean);
    const deltaStr = row === full ? "—" : delta === 0 ? "±$0" : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}`;
    console.log(
      "  " + pad(row.variant, 30) +
        num(money(Math.round(row.totalSurplusMean)), 10) +
        num(deltaStr, 12) +
        num(pct(row.dealRate), 8) +
        num(money(Math.round(row.deceptiveSurplusMean)), 12),
    );
  }
  console.log(
    `\n  \x1b[2mIf removing a component doesn't hurt, the table says so — single-lens spread\n` +
      `  shows the cost of betting on one worldview ex ante; the council matches the\n` +
      `  best lens without knowing in advance which one the counterparty rewards.\x1b[0m\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
