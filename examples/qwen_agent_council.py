"""
A Qwen agent that consults the Synod council as a tool — the MCP loop, closed
from the Qwen side.

Synod exposes itself as an MCP server (`npm run mcp`): negotiate, run_ab_comparison,
run_ablation, list_scenarios, get_receipts, describe_council. This script builds a
Qwen-Agent assistant (DashScope) with that MCP server attached, then asks it a
business question. The Qwen agent decides to convene the council, runs a full
negotiation through the MCP tool, and answers with the council's verdict and the
signed receipts.

Setup (judging day):
    pip install "qwen-agent[mcp]"
    export DASHSCOPE_API_KEY=...        # same key as the Synod council
    python examples/qwen_agent_council.py

What a judge sees: a QwenCloud agent calling a custom MCP skill, which is itself
a society of Qwen agents — agents consulting an agent society, with receipts.
"""

import os

from qwen_agent.agents import Assistant

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

llm_cfg = {
    "model": os.environ.get("QWEN_MODEL", "qwen-max"),
    "model_server": "dashscope",
    "api_key": os.environ["DASHSCOPE_API_KEY"],
}

# Synod's MCP server, attached as a custom skill (stdio transport).
tools = [{
    "mcpServers": {
        "synod": {
            "command": "npx",
            "args": ["tsx", "src/mcp.ts"],
            "cwd": REPO_ROOT,
        },
    },
}]

assistant = Assistant(
    llm=llm_cfg,
    function_list=tools,
    system_message=(
        "You are a deal-desk analyst. When asked whether to pursue a negotiation, "
        "consult the Synod council via its tools: list the scenarios, run the one "
        "that matches, and report the council's verdict — the outcome, the decisive "
        "rounds (especially any probe that disarmed deception), and cite the signed "
        "receipt ids. Do not improvise a negotiation strategy yourself; the council "
        "is the negotiator, you are the analyst."
    ),
)

QUESTION = (
    "A buyer on an adversarial RFP claims a tight budget and competing quotes. "
    "Should we pursue the deal, and on what posture? Consult the council."
)

if __name__ == "__main__":
    messages = [{"role": "user", "content": QUESTION}]
    for chunk in assistant.run(messages=messages):
        pass  # stream to completion; chunk holds the running response
    for msg in chunk:
        if msg.get("role") == "assistant" and msg.get("content"):
            print(msg["content"])
