/**
 * mcp-smoke — proves Synod's MCP server works over the REAL protocol, not just the HTTP
 * bridge the web demo shows. It spawns `src/mcp.ts` over stdio, performs the actual MCP
 * handshake (initialize → tools/list → tools/call), and prints the responses.
 *
 * Run: `npm run mcp:smoke`  (uses the deterministic mock; no Qwen needed).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp.ts"],
  env: { ...process.env, LLM_PROVIDER: "mock" },
});
const client = new Client({ name: "mcp-smoke", version: "0.1.0" }, { capabilities: {} });

await client.connect(transport); // ← the real initialize handshake over stdio
console.log("✓ connected to Synod MCP server over stdio (initialize handshake ok)\n");

const { tools } = await client.listTools();
console.log(`✓ tools/list → ${tools.length} tools:`);
for (const t of tools) console.log(`    · ${t.name}`);

console.log(`\n✓ tools/call → describe_council:`);
const res = await client.callTool({ name: "describe_council", arguments: {} });
const text = res.content?.[0]?.text ?? "(no text)";
console.log(text.split("\n").slice(0, 8).map((l) => "    " + l).join("\n") + "\n    …");

console.log(`\n✓ tools/call → list_scenarios:`);
const res2 = await client.callTool({ name: "list_scenarios", arguments: {} });
const scen = JSON.parse(res2.content?.[0]?.text ?? "[]");
for (const s of scen) console.log(`    · ${s.id} — ${s.title}`);

await client.close();
console.log("\n✓ MCP stdio integration verified end-to-end (real protocol, not the HTTP bridge).");
