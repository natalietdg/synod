import { LENSES, DOCTRINES } from "./core/types.js";
import { SUITE, getEntry } from "./suite.js";
import { MockAgents } from "./agents/mock.js";
import { GameMaster } from "./gm/gameMaster.js";
import { runNegotiation } from "./protocol/loop.js";
import { runAbComparison } from "./harness/ab.js";
import { runAblation } from "./harness/ablation.js";

/**
 * The catalog of tools the Synod MCP server (`src/mcp.ts`, stdio transport) exposes. This
 * module is the source the WEB demo uses to *show* the MCP surface on screen — the same
 * tools any MCP host gets — and to invoke them live in the browser, so the integration is
 * demonstrable on the hosted page instead of being invisible behind stdio.
 *
 * Every `live: true` tool executes the REAL computation on request (deterministic mock
 * engine — no Qwen tokens, same numbers every time). Only `draft_operational_order` stays
 * CLI-only: it drafts the order with live Qwen calls, so it runs via `npm run mcp`.
 */
export interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  live: boolean; // invocable in-browser vs. run via `npm run mcp`
}

export const MCP_TOOLS: McpToolInfo[] = [
  { name: "describe_council", title: "Describe the council", description: "The five lenses (worldview, owned question, failure mode) and the neutral chair — Synod's society in one card.", live: true },
  { name: "list_scenarios", title: "List scenarios", description: "The hidden counterparty types Synod is evaluated against — the recurring shapes of an adversary who hides what they hold.", live: true },
  { name: "negotiate", title: "Convene the council", description: "Run a full negotiation against the deceptive counterparty; returns the outcome and the per-round decision trail (action, belief, confidence).", live: true },
  { name: "get_receipts", title: "Get the signed receipts", description: "The per-round signed receipts from a full run — the auditable record of every call the council made.", live: true },
  { name: "run_ab_comparison", title: "A/B: single agent vs the society", description: "The controlled comparison — a strong single-stance baseline vs the council, identical seeds, N per type.", live: true },
  { name: "run_ablation", title: "Ablation study", description: "Remove one component at a time and re-run on identical seeds. Honest nulls included.", live: true },
  { name: "draft_operational_order", title: "Draft the operational order", description: "Decompose the response into divisions and draft each with live Qwen — run via `npm run mcp` (spends tokens).", live: false },
];

/** Cache: the full-run tools are deterministic, so computing each once is exact. */
const cache = new Map<string, unknown>();

async function canonicalRun() {
  const key = "canonical-run";
  if (!cache.has(key)) {
    const entry = getEntry("type-c-deceptive")!;
    cache.set(key, await runNegotiation(new MockAgents(), new GameMaster(entry.type, entry.seed), entry.id, entry.type));
  }
  return cache.get(key) as Awaited<ReturnType<typeof runNegotiation>>;
}

/** Invoke a tool and return the EXACT structure an MCP host receives — the same underlying
 *  computation as the corresponding handler in src/mcp.ts. Deterministic mock engine, so
 *  the hosted invocation and the stdio invocation give identical answers. */
export async function invokeMcpTool(name: string): Promise<unknown> {
  if (name === "describe_council") {
    return {
      thesis: "Most agent societies divide labor. This one divides judgment.",
      lenses: DOCTRINES.map((d) => ({
        id: d,
        name: LENSES[d].cogFunction,
        owns: LENSES[d].question,
        coreBelief: LENSES[d].coreBelief,
        failureMode: LENSES[d].failureMode,
      })),
      chair:
        "Doctrine-free. Reads the terrain (trust, uncertainty, exposure, adversarial signal) " +
        "and weights the lenses by what the situation demands — never by who argued best.",
    };
  }
  if (name === "list_scenarios") {
    return SUITE.map((s) => ({ id: s.id, title: s.title, punishes: s.punishes, whenToUse: s.whenToUse }));
  }
  if (name === "negotiate") {
    const r = await canonicalRun();
    return {
      scenario: "type-c-deceptive",
      outcome: r.terminal.outcome,
      surplusCaptured: r.terminal.surplusCaptured,
      dealSurvived: r.terminal.dealSurvived,
      rounds: r.rounds.map((rd) => ({
        round: rd.round,
        counterpartyOffer: rd.counterpartyMove.offer.price,
        councilAction: rd.gate.finalAction,
        belief: rd.beliefAfter,
        confidence: rd.engine.confidence,
      })),
    };
  }
  if (name === "get_receipts") {
    const r = await canonicalRun();
    return { scenario: "type-c-deceptive", receipts: r.rounds.map((rd) => rd.receipt) };
  }
  if (name === "run_ab_comparison") {
    const key = "ab";
    if (!cache.has(key)) cache.set(key, await runAbComparison(new MockAgents()));
    return cache.get(key);
  }
  if (name === "run_ablation") {
    const key = "ablation";
    if (!cache.has(key)) cache.set(key, await runAblation(new MockAgents()));
    return cache.get(key);
  }
  throw new Error(`"${name}" drafts with live Qwen — exercise it via \`npm run mcp\`.`);
}
