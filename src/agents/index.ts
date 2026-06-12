import type { DeliberationAgents } from "./types.js";
import { MockAgents } from "./mock.js";
import { QwenAgents } from "./qwen.js";

/**
 * Select the agent implementation from the environment. Defaults to the
 * deterministic mock so the whole system runs offline with no API key.
 * Set LLM_PROVIDER=qwen (and DASHSCOPE_API_KEY) to go live.
 */
export function selectAgents(): DeliberationAgents {
  const provider = (process.env.LLM_PROVIDER ?? "mock").toLowerCase();
  return provider === "qwen" ? new QwenAgents() : new MockAgents();
}

export type { DeliberationAgents, RoundInput, BaselinePersona } from "./types.js";
