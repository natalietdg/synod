/**
 * mcp-agent-demo — a REAL agent consuming Synod as a tool, end to end.
 *
 * A Qwen agent (a deal-desk assistant, NOT part of Synod) is given a live decision and a
 * toolbox that happens to include Synod's MCP tools. Nothing tells it what to conclude:
 * it chooses to consult the council, receives the real deliberation output over the real
 * MCP stdio protocol, and makes its call citing what the council found.
 *
 * This is the "any AI can call Synod as a tool" claim demonstrated, not asserted:
 *   Qwen agent ──tool_call──▶ MCP client ──stdio──▶ Synod MCP server ──▶ the council runs
 *
 * Run: `node scripts/mcp-agent-demo.mjs`  (needs DASHSCOPE_API_KEY for the OUTER agent;
 * Synod itself runs on the deterministic mock so the council's output is reproducible).
 * Writes the full transcript to public/mcp-agent-transcript.json for the site to show.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.DASHSCOPE_API_KEY) {
  console.error("DASHSCOPE_API_KEY not set — the outer agent is a real Qwen call.");
  process.exit(1);
}

// ── 1. Connect to Synod's MCP server over the real stdio protocol ──────────────
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp.ts"],
  env: { ...process.env, LLM_PROVIDER: "mock" }, // the council stays deterministic/reproducible
});
const mcp = new Client({ name: "deal-desk-agent", version: "0.1.0" }, { capabilities: {} });
await mcp.connect(transport);
const { tools } = await mcp.listTools();
console.log(`✓ MCP: connected to Synod, ${tools.length} tools available\n`);

// ── 2. Expose the MCP tools to a real Qwen agent as OpenAI-style tools ─────────
const qwen = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
});
const model = process.env.QWEN_MODEL_FAST ?? "qwen-turbo";
const toolDefs = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

const SITUATION =
  "You are the deal-desk assistant on a $12,000 contract renewal. The counterparty's latest " +
  "message: \"We have a competing quote in hand at far better terms — match a steep discount " +
  "by Friday or we sign with them.\" You cannot verify the competing quote. Decide what the " +
  "desk should do: match the discount, hold, or test the claim first. You have tools; use " +
  "whatever helps. When you have decided, state DECISION: <one line> and the reason.";

const messages = [
  { role: "system", content: "You are a careful deal-desk assistant. Prefer evidence over instinct; use available tools when a decision hinges on something you cannot verify yourself." },
  { role: "user", content: SITUATION },
];
const transcript = [{ role: "user", content: SITUATION }];

// ── 3. The agentic loop: the agent may call Synod; we forward over MCP ─────────
let toolCallsMade = 0;
for (let turn = 0; turn < 6; turn++) {
  const resp = await qwen.chat.completions.create({ model, messages, tools: toolDefs });
  const msg = resp.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    transcript.push({ role: "agent", content: msg.content ?? "" });
    console.log("AGENT:", msg.content, "\n");
    break;
  }
  for (const call of msg.tool_calls) {
    toolCallsMade += 1;
    const args = JSON.parse(call.function.arguments || "{}");
    console.log(`AGENT → tools/call ${call.function.name}(${JSON.stringify(args)})`);
    transcript.push({ role: "agent-tool-call", tool: call.function.name, args });
    const result = await mcp.callTool({ name: call.function.name, arguments: args });
    const text = result.content?.[0]?.text ?? "(no text)";
    console.log(`SYNOD ← ${text.length} chars of council output\n`);
    transcript.push({ role: "synod-mcp-result", tool: call.function.name, text: text.slice(0, 4000) });
    messages.push({ role: "tool", tool_call_id: call.id, content: text.slice(0, 12000) });
  }
}
await mcp.close();

// ── 4. Record the run so the site can show a REAL transcript, labeled as such ──
const out = {
  recorded: new Date().toISOString(),
  outerAgent: `qwen (${model}) — an independent deal-desk assistant, not part of Synod`,
  innerCouncil: "Synod MCP server over stdio, deterministic mock engine (reproducible)",
  mcpToolCallsMade: toolCallsMade,
  transcript,
};
writeFileSync("public/mcp-agent-transcript.json", JSON.stringify(out, null, 2));
console.log(`✓ transcript written to public/mcp-agent-transcript.json (${toolCallsMade} MCP tool call${toolCallsMade === 1 ? "" : "s"} made by the agent)`);
