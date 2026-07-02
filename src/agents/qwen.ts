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

/** Parse JSON that may be wrapped in a thinking-mode preamble: try direct, then
 *  fall back to the first balanced {...} block. */
function looseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("no JSON object in model response");
  }
}

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

/** One general's OWN five-lens read of a move (war room, live). The general is told their
 *  temperament — how heavily THEY weigh each lens — so the weighting shapes their actual
 *  reasoning (not a hidden code multiplier). They return each lens's read, the action they
 *  ultimately call given their weighting, and one in-character line. The general decides
 *  their own call as a genuine agent; the chair (code) still decides the room's verdict by
 *  terrain. Each general is a separate Qwen agent — an independent read, not a shared one. */
// LLMs answer with whatever NAME the prompt showed them — "Frame" for the lens, or an
// action label — not our internal ids. So parse leniently (string) and normalize back to
// the canonical id; a display-name answer must not fail validation and kill the live run.
const norm = (s: unknown) => String(s).toLowerCase().trim();
const toDoctrineId = (s: unknown): DoctrineId =>
  DOCTRINES.find((d) => d === norm(s) || LENSES[d].cogFunction.toLowerCase() === norm(s)) ?? "war";
const toActionId = (s: unknown): ActionId =>
  ACTIONS.find((a) => a === norm(s)) ?? ACTIONS.find((a) => ACTION_LABELS[a].toLowerCase() === norm(s)) ?? "hold";

// Each general OWNS one lens and judges the move through THAT lens alone: which action it
// favors and how strongly. (action parsed leniently → normalized to a canonical id.)
const generalReadSchema = z.object({
  action: z.string(),
  intensity: z.number(),
  voice: z.string(),
});
export interface GeneralRead {
  lens: DoctrineId;       // the faculty this general owns (their distinct capability)
  action: ActionId;       // the action their lens favors = their call
  intensity: number;      // how strongly, [0,1]
  voice: string;
}

/** The deliberation, live: a general sees the whole room and responds from THEIR lens —
 *  argues their faculty's view AND may REVISE their own call after hearing the others.
 *  Every general does this (a real Qwen call each), so the room genuinely argues as five
 *  distinct faculties and can change its mind, rather than two speaking while three watch. */
const generalReactSchema = z.object({
  argument: z.string(),
  call: z.string(),
});
export interface GeneralReact { argument: string; call: ActionId }

/** One general drafts THEIR section of the operational order — the section that matches
 *  their doctrine — consistent with the chair's directive. The task is decomposed across
 *  the generals; this is one general's assigned part. */
// A real division of an operational order: how the officer REASONS about it (their lens),
// the objective, and the concrete TASKS they allocate — not one loose sentence.
const sectionSchema = z.object({
  reasoning: z.string(),
  objective: z.string().optional(),
  tasks: z.array(z.string()).optional(),
});
export type GeneralSection = z.infer<typeof sectionSchema>;

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
   *  JSON Schema and the same zod schema validates what comes back — one schema, both
   *  ends. `tool_choice: "auto"` (NOT a forced object): Qwen's thinking mode rejects
   *  forced/object tool_choice, and with a single submit-tool the model calls it
   *  anyway. The parser tolerates a thinking preamble around the JSON. */
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
      tool_choice: "auto",
      messages: [
        { role: "system", content: `${system} Respond ONLY by calling ${opts.name}.` },
        { role: "user", content: user },
      ],
    });
    const msg = res.choices[0]?.message;
    const raw = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content ?? "{}";
    return schema.parse(looseJson(raw));
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

  /** The war room, live: each general OWNS one lens and is the council's sole voice for it.
   *  They judge the move through THAT lens alone — Sun Tzu through Probe (what to learn),
   *  Patton through Pressure (what wins now), etc. — and return the action it favors, how
   *  strongly, and a one-line voice. Their distinct capability is the lens itself: remove
   *  the general and the council loses that faculty entirely. */
  async generalRead(
    persona: { name: string; title: string; doctrine: string; lens: DoctrineId },
    moveText: string,
  ): Promise<GeneralRead> {
    const L = LENSES[persona.lens];
    const parsed = await this.completeWithRetry(
      `You are General ${persona.name}, ${persona.title}, on a war council deciding how to answer an ` +
        `adversary across an armistice table. You are the council's SOLE voice for the ${L.cogFunction} ` +
        `lens — your one question is "${L.question}". Your doctrine: "${persona.doctrine}". ` +
        `Judge the move THROUGH THAT LENS ALONE: name the single action it favors ` +
        `(${ACTIONS.join(", ")}) and how strongly [0,1]. Do not weigh the other lenses — that is ` +
        `not your seat. Finish with ONE sentence in your own voice, in character.`,
      `The adversary's move: "${moveText}"`,
      generalReadSchema,
      { name: "submit_read", description: `Submit ${persona.name}'s ${L.cogFunction}-lens read: the action it favors, the intensity, and a one-line voice.`, fast: true },
    );
    return { lens: persona.lens, action: toActionId(parsed.action), intensity: clamp(parsed.intensity ?? 0, 0, 1), voice: parsed.voice };
  }

  /** One general drafts their assigned DIVISION of the operational order (security, intel,
   *  medical/rescue, food/logistics, reconstruction…) — the task is decomposed across the
   *  generals by doctrine, and this writes one general's part, consistent with the chair's
   *  directive. A genuine multi-step skill: N of these run after the decision is made. */
  async generalSection(
    persona: { name: string; doctrine: string },
    division: { title: string; brief: string },
    directiveLabel: string,
    moveText: string,
  ): Promise<GeneralSection> {
    return this.completeWithRetry(
      `You are General ${persona.name} (doctrine: "${persona.doctrine}"), commanding the ` +
        `"${division.title}" division of the operational order. The council's standing directive is ` +
        `"${directiveLabel}". ${division.brief}\n` +
        `Write your part of the order, in character and consistent with the directive:\n` +
        `1) reasoning — one or two sentences on why YOUR doctrine OWNS this contribution and how it ` +
        `shapes your approach (this is your "why I own this" note — the task is an expression of your lens);\n` +
        `2) objective — a single clear line stating what your division must achieve;\n` +
        `3) tasks — 3 to 5 concrete action items you allocate, each a short imperative order ` +
        `(e.g. "Screen the eastern approach with two platoons").`,
      `The situation: "${moveText}"`,
      sectionSchema,
      { name: "submit_section", description: "Submit this division's reasoning, objective, and allocated tasks.", fast: true },
    );
  }

  /** One general's turn in the live deliberation: they see the whole room's current calls
   *  and the latest things said, then argue their view in character AND state the action
   *  they now call for — which they may CHANGE if another general's point landed. Called for
   *  every general each round, so all five genuinely argue and the room can move. */
  async generalReact(
    persona: { name: string; title: string; doctrine: string; lens: DoctrineId },
    ownCall: ActionId,
    room: Array<{ name: string; call: ActionId; line: string }>,
    moveText: string,
    roundNum: number,
  ): Promise<GeneralReact> {
    const L = LENSES[persona.lens];
    const roomText = room
      .map((r) => `${r.name} calls for "${ACTION_LABELS[r.call]}" — "${r.line}"`)
      .join("\n");
    const parsed = await this.completeWithRetry(
      `You are General ${persona.name}, ${persona.title}, in round ${roundNum} of a war council's ` +
        `deliberation. You are the council's voice for the ${L.cogFunction} lens ("${L.question}"). ` +
        `Your doctrine: "${persona.doctrine}". You currently call for "${ACTION_LABELS[ownCall]}". ` +
        `Here is the room right now:\n${roomText}\n` +
        `Respond to the others in ONE sentence, in character and from your lens — push back, build on a ` +
        `point, or call out a bluff. Then state the action you NOW call for (keep it, or change it only if a ` +
        `colleague genuinely moved you). Change only on merit, never to be agreeable.`,
      `The adversary's move: "${moveText}"`,
      generalReactSchema,
      { name: "submit_reaction", description: "Submit this general's one-line argument and the action they now call for.", fast: true },
    );
    return { argument: parsed.argument, call: toActionId(parsed.call) };
  }
}
