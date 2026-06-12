import OpenAI from "openai";
import { z } from "zod";
import type { AIGovernor, AIGovernorInput, AIInterpretation } from "@natalietdg/dotto";

const schema = z.object({
  intent: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  tradeoffs: z.array(z.string()),
  recommendation: z.string(),
});

/**
 * Qwen-backed AIGovernor for the Dotto layer (PRD §3.4 "Qwen + rules").
 * Interprets the gate context and returns a risk assessment + recommendation.
 * Only instantiated when DASHSCOPE_API_KEY is set (live Qwen runs).
 */
export class QwenGovernor implements AIGovernor {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set.");
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    this.model = process.env.QWEN_MODEL ?? "qwen-max";
  }

  async interpret(input: AIGovernorInput): Promise<AIInterpretation> {
    const ctx = input.diff.after as Record<string, unknown>;
    const recommendation = ctx.recommendation as string;
    const confidence = ctx.confidence as number;
    const deadlock = ctx.deadlock as boolean;
    const evDivergence = ctx.evDivergence as number;
    const exposure = ctx.exposure as number;

    const userPrompt =
      `Proposed action: ${recommendation}. ` +
      `Engine confidence: ${(confidence * 100).toFixed(0)}%. ` +
      `Deadlock: ${deadlock}. ` +
      `EV-divergence from cold math: $${Math.abs(evDivergence).toFixed(0)} ` +
      `(council ${evDivergence >= 0 ? "above" : "below"} pure EV). ` +
      `Exposure: ${(exposure * 100).toFixed(0)}%.`;

    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a governance risk assessor for an AI negotiation council. " +
            "Given the proposed action and decision context, assess execution risk. " +
            "HIGH: irreversible action (accept/walk) with low confidence, deadlock, or large EV-divergence. " +
            "MEDIUM: commit under moderate uncertainty. " +
            "LOW: reversible action, or commit with high confidence and small EV-divergence. " +
            "Return JSON: {intent: string, risk: 'low'|'medium'|'high', tradeoffs: string[], recommendation: string}.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = res.choices[0]?.message.content ?? "{}";
    return { ...schema.parse(JSON.parse(raw)), raw };
  }
}
