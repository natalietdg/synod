import OpenAI from "openai";
import { z } from "zod";
import { openingMessage, phraseMove, type MoveNarrative } from "./language.js";

export interface GmSpeaker {
  openingLine(price: number): Promise<string>;
  responseLine(narrative: MoveNarrative): Promise<string>;
}

/** Deterministic template speaker — fully reproducible, used in A/B and mock runs. */
export class TemplateSpeaker implements GmSpeaker {
  async openingLine(price: number): Promise<string> {
    return openingMessage(price);
  }
  async responseLine(n: MoveNarrative): Promise<string> {
    return phraseMove(n);
  }
}

const msgSchema = z.object({ message: z.string() });

/**
 * Qwen-backed speaker for live negotiations.
 * Only has access to visible move facts — not the hidden counterparty type.
 * Falls back to the template on any API error.
 */
export class QwenSpeaker implements GmSpeaker {
  private readonly fallback = new TemplateSpeaker();
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

  async openingLine(price: number): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a B2B procurement buyer opening a software contract negotiation. " +
              "Generate ONE short, natural sentence (under 25 words) as your opening line to the seller. " +
              "Sound human — direct, businesslike, slightly guarded. Return JSON: {message: string}.",
          },
          {
            role: "user",
            content: `You're opening with an offer of $${price.toLocaleString()}. Start the negotiation.`,
          },
        ],
      });
      const raw = res.choices[0]?.message.content ?? "{}";
      return msgSchema.parse(JSON.parse(raw)).message;
    } catch {
      return this.fallback.openingLine(price);
    }
  }

  async responseLine(n: MoveNarrative): Promise<string> {
    try {
      const facts: string[] = [
        `Round ${n.round}. Your current offer: $${n.price.toLocaleString()}.`,
        n.movedUp > 250
          ? `You moved up $${n.movedUp.toLocaleString()} this round.`
          : n.movedUp > 0
            ? `You nudged your offer up $${n.movedUp} — a small move.`
            : `You held firm. No price movement.`,
      ];
      if (n.councilConcededNeed) facts.push("The seller just gave you the feature you needed.");
      if (n.revealedNeed) facts.push(`You've disclosed that ${n.revealedNeed} is non-negotiable for you.`);
      if (n.revealedCompetitor) facts.push("You've mentioned you have another vendor in the conversation.");
      if (n.deceived) facts.push("You're not being fully transparent about your budget situation.");

      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a B2B procurement buyer in an ongoing software contract negotiation. " +
              "Given the facts of this round, generate ONE short natural sentence (under 25 words) to say to the seller. " +
              "Vary your tone — sometimes direct, sometimes pressed, sometimes collegial. No jargon. " +
              "Return JSON: {message: string}.",
          },
          { role: "user", content: facts.join(" ") },
        ],
      });
      const raw = res.choices[0]?.message.content ?? "{}";
      return msgSchema.parse(JSON.parse(raw)).message;
    } catch {
      return this.fallback.responseLine(n);
    }
  }
}
