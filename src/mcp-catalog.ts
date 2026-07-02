import { LENSES, DOCTRINES } from "./core/types.js";
import { SUITE } from "./suite.js";

/**
 * The catalog of tools the Synod MCP server (`src/mcp.ts`, stdio transport) exposes. This
 * module is the source the WEB demo uses to *show* the MCP surface on screen — the same
 * tools any MCP host gets — and to invoke the data-only ones live, so the integration is
 * demonstrable in a browser instead of being invisible behind stdio.
 *
 * `live: true` tools are pure data (instant, no Qwen) and are invoked here; the rest run a
 * full negotiation / ablation / live-Qwen order and are exercised via `npm run mcp`.
 */
export interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  live: boolean; // invocable in-browser (data-only) vs. run via `npm run mcp`
}

export const MCP_TOOLS: McpToolInfo[] = [
  { name: "describe_council", title: "Describe the council", description: "The five lenses (worldview, owned question, failure mode) and the neutral chair — Synod's society in one card.", live: true },
  { name: "list_scenarios", title: "List scenarios", description: "The hidden counterparty types Synod is evaluated against — the recurring shapes of an adversary who hides what they hold.", live: true },
  { name: "negotiate", title: "Convene the council", description: "Run a full negotiation against a chosen counterparty type; returns the per-round decision trail (belief, weights, gate) and a signed receipt per round.", live: false },
  { name: "run_ab_comparison", title: "A/B: single agent vs the society", description: "The controlled comparison — a strong single-stance baseline vs the council, identical seeds, N per type.", live: false },
  { name: "run_ablation", title: "Ablation study", description: "Remove one component at a time and re-run on identical seeds. Honest nulls included.", live: false },
  { name: "draft_operational_order", title: "Draft the operational order", description: "Decompose the response into divisions, assign each to the general by capability, and draft each — a live multi-step Qwen skill.", live: false },
];

/** Invoke a data-only tool and return the EXACT structure an MCP host receives. Mirrors the
 *  corresponding handler in src/mcp.ts (same source data). Throws for tools that need a full
 *  run (use `npm run mcp`). */
export function invokeMcpTool(name: string): unknown {
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
  throw new Error(`"${name}" runs a full negotiation/order — exercise it via \`npm run mcp\`.`);
}
