import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ACTION_LABELS, ACTIONS, type ActionId } from "../core/actions.js";
import {
  COUNTERPARTY_TYPES,
  LENSES,
  type ActionScores,
  type ArbiterVerdict,
  type ContextVector,
  type DoctrineId,
  type DoctrinePosition,
  type EmpathyRead,
} from "../core/types.js";
import { DOCTRINES } from "../core/types.js";
import type { BaselineDecision, BaselinePersona, DeliberationAgents, RoundInput } from "./types.js";

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

const actionScoreSchema = z.object(
  Object.fromEntries(ACTIONS.map((a) => [a, z.number()])) as Record<ActionId, z.ZodNumber>,
);
const positionSchema = z.object({
  scores: actionScoreSchema,
  confidence: z.number(),
  rationale: z.string(),
  reasoning: z.string(),
});
const readSchema = z.object({
  summary: z.string(),
  flags: z.array(z.string()),
  readTrust: z.number(),
  likelyType: z.enum(COUNTERPARTY_TYPES),
});
const weightsSchema = z.object({
  weights: z.object(
    Object.fromEntries(DOCTRINES.map((d) => [d, z.number()])) as Record<DoctrineId, z.ZodNumber>,
  ),
  rationale: z.string(),
});
const baselineSchema = z.object({ action: z.enum(ACTIONS), reasoning: z.string() });
const challengeSchema = z.object({ text: z.string(), revisedScore: z.number().optional() });

const visible = (input: RoundInput) =>
  JSON.stringify({
    round: input.round,
    counterpartyOffer: input.move.offer,
    counterpartyMessage: input.move.message,
    signals: input.move.signals,
    yourCurrentAsk: input.councilAsk,
    belief: input.belief,
    context: input.ctx,
  });

/**
 * Live Qwen implementation. One stable system prompt per doctrine.
 *
 * Platform usage is deliberate, not generic (S7):
 * - **Native function calling**: every structured output goes through DashScope's
 *   `tools` + forced `tool_choice` path with a JSON Schema derived from the same zod
 *   schema that validates the result — the model is constrained at the API layer,
 *   not asked nicely for JSON.
 * - **Model-tier orchestration**: judgment-heavy calls (Empathy read, Arbiter,
 *   baseline) run on QWEN_MODEL (default qwen-max); the five parallel lens scorings
 *   and one-sentence challenge exchanges run on QWEN_MODEL_FAST (default qwen-turbo).
 *   A full round makes ~9 calls — tiering cuts live-demo cost ~80% with no loss
 *   where it matters, and the deterministic engine downstream is indifferent to
 *   phrasing quality.
 */
export class QwenAgents implements DeliberationAgents {
  readonly kind = "qwen" as const;
  private readonly client: OpenAI;
  private readonly model: string; // judgment tier
  private readonly modelFast: string; // volume tier (5 parallel lenses, challenges)

  constructor() {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("LLM_PROVIDER=qwen but DASHSCOPE_API_KEY is not set.");
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    this.model = process.env.QWEN_MODEL ?? "qwen-max";
    this.modelFast = process.env.QWEN_MODEL_FAST ?? "qwen-turbo";
  }

  /** Structured call via native function calling: the zod schema becomes the tool's
   *  JSON Schema, `tool_choice` forces the call, and the same zod schema validates
   *  what comes back. One schema, enforced at both ends. */
  private async complete<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    opts: { name: string; description: string; fast?: boolean } = { name: "submit", description: "Submit the structured result." },
  ): Promise<T> {
    const res = await this.client.chat.completions.create({
      model: opts.fast ? this.modelFast : this.model,
      temperature: 0.2,
      tools: [{
        type: "function",
        function: {
          name: opts.name,
          description: opts.description,
          parameters: zodToJsonSchema(schema) as Record<string, unknown>,
        },
      }],
      tool_choice: { type: "function", function: { name: opts.name } },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const msg = res.choices[0]?.message;
    const args = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content ?? "{}";
    return schema.parse(JSON.parse(args));
  }

  /** One retry on transient failure (malformed tool call, parse error, blip) —
   *  a single bad completion must not kill a judged round. Quota/auth errors
   *  (4xx) rethrow immediately: retrying those only burns time. */
  private async completeWithRetry<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    opts?: { name: string; description: string; fast?: boolean },
  ): Promise<T> {
    try {
      return await this.complete(system, user, schema, opts);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) throw err;
      return this.complete(system, user, schema, opts);
    }
  }

  async empathyRead(input: RoundInput): Promise<EmpathyRead> {
    const parsed = await this.completeWithRetry(
      "You are Empathy in a negotiation council. Model the counterparty's true intent from their " +
        `outward move. The hidden type is one of ${COUNTERPARTY_TYPES.join(", ")}.`,
      visible(input),
      readSchema,
      { name: "submit_intent_read", description: "Submit the intent read that all five lenses will condition on." },
    );
    return { ...parsed, readTrust: clamp(parsed.readTrust, 0, 1) };
  }

  async doctrinePosition(doctrine: DoctrineId, input: RoundInput, read: EmpathyRead): Promise<DoctrinePosition> {
    const m = LENSES[doctrine];
    const parsed = await this.completeWithRetry(
      `You are the ${m.name} lens on a negotiation council — a cognitive archetype, not a rule. ` +
        `Core belief: "${m.coreBelief}" The question you own: "${m.question}" ` +
        `Thinking style: ${m.thinkingStyle} Your blind spot to resist: ${m.failureMode} ` +
        `Reason as this whole worldview (keywords: ${m.keywords.join(", ")}), not one formula. ` +
        `Score each action in [-1,1]: ${ACTIONS.join(", ")}. ` +
        `Your rationale must be ONE sentence arguing FROM your core belief in your own voice — ` +
        `do NOT summarize the counterparty's message or restate the situation; the other four ` +
        `lenses see the same facts, so only your worldview's verdict on them is worth saying.`,
      `${visible(input)} Empathy's read: ${JSON.stringify(read)}.`,
      positionSchema,
      // Volume tier: five of these run in parallel every round.
      { name: "submit_position", description: "Submit this lens's scored position on the action set.", fast: true },
    );
    const s = {} as ActionScores;
    for (const a of ACTIONS) s[a] = clamp(parsed.scores[a], -1, 1);
    return { doctrine, scores: s, confidence: clamp(parsed.confidence, 0, 1), rationale: parsed.rationale, reasoning: parsed.reasoning };
  }

  async arbiterWeights(ctx: ContextVector, read: EmpathyRead): Promise<ArbiterVerdict> {
    const parsed = await this.completeWithRetry(
      "You are the Arbiter. You hold NO doctrine of your own. Read the context and decide which " +
        `doctrines have the advantage. Weights are over: ${DOCTRINES.join(", ")}.`,
      `Context: ${JSON.stringify(ctx)}. Empathy's read: ${JSON.stringify(read)}.`,
      weightsSchema,
      { name: "submit_weights", description: "Submit the per-doctrine influence weights for this round." },
    );
    const nonNeg = {} as Record<DoctrineId, number>;
    let sum = 0;
    for (const d of DOCTRINES) { nonNeg[d] = Math.max(0, parsed.weights[d]); sum += nonNeg[d]; }
    const weights = {} as Record<DoctrineId, number>;
    for (const d of DOCTRINES) weights[d] = sum > 0 ? nonNeg[d] / sum : 1 / DOCTRINES.length;
    return { context: ctx, weights, rationale: parsed.rationale };
  }

  async baselineTurn(persona: BaselinePersona, input: RoundInput): Promise<BaselineDecision> {
    const stance =
      persona === "strong"
        ? "You are a single, skilled B2B negotiator (the seller). Know your walk-away, probe for the " +
          "buyer's real interests, don't leave value on the table, and preserve the relationship."
        : "You are a single negotiator who wants to close quickly and avoid losing the deal.";
    return this.completeWithRetry(
      `${stance} Choose exactly ONE action: ${ACTIONS.join(", ")}.`,
      visible(input),
      baselineSchema,
      { name: "submit_move", description: "Submit the single negotiator's chosen action." },
    );
  }

  async challengeResponse(
    role: "challenger" | "defender",
    myDoctrine: DoctrineId,
    theirDoctrine: DoctrineId,
    contestedAction: ActionId,
    theirText: string,
    input: RoundInput,
    stakes: { myScore: number; theirScore: number; myConfidence: number; theirConfidence: number },
  ): Promise<{ text: string; revisedScore?: number }> {
    const m = LENSES[myDoctrine];
    const them = LENSES[theirDoctrine];
    const actionLabel = ACTION_LABELS[contestedAction];
    const system =
      role === "challenger"
        ? `You are the ${m.name} lens on a negotiation council (${m.cogFunction}, core belief: "${m.coreBelief}"). ` +
          `You DISAGREE with ${them.name}'s preference for "${actionLabel}" right now ` +
          `(your score on it: ${stakes.myScore.toFixed(2)}; theirs: ${stakes.theirScore.toFixed(2)}). ` +
          `In exactly one direct sentence, challenge why that action is wrong from your worldview.`
        : `You are the ${m.name} lens on a negotiation council (${m.cogFunction}, core belief: "${m.coreBelief}"). ` +
          `${them.name} challenged your preference for "${actionLabel}": "${theirText}" ` +
          `Your current score on it is ${stakes.myScore.toFixed(2)}; theirs is ${stakes.theirScore.toFixed(2)}. ` +
          `In exactly one direct sentence, defend your position from your worldview. ` +
          `This exchange is CAUSAL: if — and only if — the challenge genuinely lands, also return revisedScore ` +
          `(your updated score on "${actionLabel}", in [-1,1]). Holding firm is legitimate; concede on merit, not politeness.`;
    const parsed = await this.completeWithRetry(system, visible(input), challengeSchema,
      { name: "submit_exchange", description: "Submit the one-sentence challenge or defense (defenders may concede via revisedScore).", fast: true });
    return role === "defender" && parsed.revisedScore !== undefined
      ? { text: parsed.text, revisedScore: clamp(parsed.revisedScore, -1, 1) }
      : { text: parsed.text };
  }
}
