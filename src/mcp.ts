import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { selectAgents } from "./agents/index.js";
import { GameMaster } from "./gm/gameMaster.js";
import { runNegotiation } from "./protocol/loop.js";
import { runAbComparison } from "./harness/ab.js";
import { runAblation } from "./harness/ablation.js";
import { receiptStore } from "./dotto/store.js";
import { SUITE, getEntry } from "./suite.js";
import { LENSES, DOCTRINES } from "./core/types.js";

/**
 * Synod as an MCP server (spec S5-4): any MCP-capable agent can convene the council
 * as a tool. The caller gets the gated decision trail and the signed receipts — the
 * same auditable record the UI renders, machine-readable.
 *
 * Run: `npm run mcp` (stdio transport). Register in an MCP client as:
 *   { "command": "npx", "args": ["tsx", "src/mcp.ts"], "cwd": "<repo>" }
 */

const server = new McpServer({ name: "synod", version: "0.1.0" });
const agents = selectAgents(); // deterministic mock by default; LLM_PROVIDER=qwen for live

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool(
  "list_scenarios",
  {
    title: "List negotiation scenarios",
    description:
      "The three hidden counterparty types Synod is evaluated against, with the " +
      "business situations each one models (vendor renewals, procurement floors, " +
      "adversarial RFPs / BATNA bluffers).",
    inputSchema: {},
  },
  async () =>
    text(
      SUITE.map((s) => ({
        id: s.id,
        title: s.title,
        punishes: s.punishes,
        whenToUse: s.whenToUse,
      })),
    ),
);

server.registerTool(
  "negotiate",
  {
    title: "Convene the council",
    description:
      "Run one full council negotiation against the chosen counterparty type. " +
      "Returns the terminal outcome plus the per-round decision trail: belief over " +
      "hidden type, lens weights, challenge exchange (with any causal concession), " +
      "engine recommendation, gate decision, and the signed receipt for every round.",
    inputSchema: {
      scenario: z
        .string()
        .describe(`Scenario id — one of: ${SUITE.map((s) => s.id).join(", ")}`),
      seed: z.number().int().optional().describe("Optional RNG seed (default: the scenario's fixed seed)"),
    },
  },
  async ({ scenario, seed }) => {
    const entry = getEntry(scenario);
    if (!entry) {
      return text({ error: `Unknown scenario "${scenario}". Use one of: ${SUITE.map((s) => s.id).join(", ")}` });
    }
    const gm = new GameMaster(entry.type, seed ?? entry.seed);
    const result = await runNegotiation(agents, gm, entry.id, entry.type);
    return text({
      scenario: entry.id,
      hiddenType: entry.type,
      outcome: {
        dealSurvived: result.terminal.dealSurvived,
        surplusCaptured: result.terminal.surplusCaptured,
        summary: result.terminal.outcome,
        trustFinal: result.terminal.trustFinal,
      },
      rounds: result.rounds.map((r) => ({
        round: r.round,
        counterparty: { offer: r.counterpartyMove.offer, signals: r.counterpartyMove.signals },
        belief: r.beliefAfter,
        challenge: r.challenges.map((c) => ({
          from: c.from,
          against: c.against,
          text: c.text,
          contested: c.contested,
          concession:
            c.revisedScore !== undefined
              ? { originalScore: c.originalScore, revisedScore: c.revisedScore }
              : undefined,
        })),
        weights: r.arbiter.weights,
        recommendation: r.engine.recommendation,
        confidence: r.engine.confidence,
        gate: r.gate.gate,
        sent: r.councilMove.action,
        receipt: r.receipt,
      })),
    });
  },
);

server.registerTool(
  "run_ab_comparison",
  {
    title: "A/B: strong single agent vs Synod",
    description:
      "Run the controlled comparison — a strong single-stance baseline vs the full " +
      "council, identical Game Master and seed schedule, N seeds per hidden type. " +
      "Returns mean ± σ surplus and deal rates. The headline: the baseline closes 0% " +
      "against the deceptive type; Synod closes 100%.",
    inputSchema: {
      nSeeds: z.number().int().min(1).max(50).optional().describe("Seeds per type (default 10)"),
    },
  },
  async ({ nSeeds }) => text(await runAbComparison(agents, { nSeeds: nSeeds ?? 10 })),
);

server.registerTool(
  "run_ablation",
  {
    title: "Ablation study",
    description:
      "Remove one architectural component at a time (causal challenge, EVI probe " +
      "trigger, terrain-weighted Arbiter, the council itself via single-lens collapse) " +
      "and re-run the suite on identical seeds. Honest nulls included.",
    inputSchema: {
      nSeeds: z.number().int().min(1).max(50).optional().describe("Seeds per type (default 10)"),
    },
  },
  async ({ nSeeds }) => text(await runAblation(agents, nSeeds ?? 10)),
);

server.registerTool(
  "get_receipts",
  {
    title: "Signed decision receipts",
    description:
      "The tamper-evident audit log: every round of every negotiation this session, " +
      "cryptographically signed — recommendation, weights, confidence, EV divergence, gate.",
    inputSchema: {},
  },
  async () => text({ receipts: receiptStore.getAll() }),
);

server.registerTool(
  "describe_council",
  {
    title: "Describe the council",
    description:
      "The five cognitive lenses (worldview, owned question, failure mode) and the " +
      "doctrine-free Arbiter — Synod's society in one card.",
    inputSchema: {},
  },
  async () =>
    text({
      thesis: "Most agent societies divide labor. This one divides judgment.",
      lenses: DOCTRINES.map((d) => ({
        id: d,
        name: LENSES[d].cogFunction,
        persona: LENSES[d].name,
        owns: LENSES[d].question,
        coreBelief: LENSES[d].coreBelief,
        failureMode: LENSES[d].failureMode,
      })),
      arbiter:
        "Doctrine-free. Reads the terrain (trust, info confidence, adversarial signal, " +
        "exposure) — never the council's arguments — and weights the lenses by what the " +
        "situation demands, not by who argued best.",
    }),
);

await server.connect(new StdioServerTransport());
