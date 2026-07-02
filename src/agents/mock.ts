import { ACTION_LABELS, ACTIONS, type ActionId } from "../core/actions.js";
import {
  LENSES,
  TYPE_META,
  type ActionScores,
  type ArbiterVerdict,
  type Belief,
  type ContextVector,
  type DoctrineId,
  type DoctrinePosition,
  type EmpathyRead,
} from "../core/types.js";
import { DOCTRINES } from "../core/types.js";
import { SELLER_FLOOR } from "../gm/profiles.js";
import { COUNTERPARTY_TYPES } from "../core/types.js";
import { mostLikelyType } from "../belief/update.js";
import { COST_OF_PROBE, expectedValueOfInformation } from "../belief/evi.js";
import { capturedSurplus, payoff, walkRisk } from "../payoffs.js";
import { selectPolicy, type CouncilPolicy } from "../engine/policy.js";
import type { BaselineDecision, BaselinePersona, DeliberationAgents, RoundInput } from "./types.js";

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const unit = (x: number): number => clamp(x, -1, 1);

function scores(partial: Partial<ActionScores>): ActionScores {
  const full = {} as ActionScores;
  for (const a of ACTIONS) full[a] = partial[a] ?? 0;
  return full;
}

/** How close the buyer's offer is to the Council's ask, in [0, 1] (1 = met). */
function closeness(buyerOffer: number, councilAsk: number): number {
  const span = Math.max(1, councilAsk - SELLER_FLOOR);
  return clamp((buyerOffer - SELLER_FLOOR) / span, 0, 1);
}

/** Centre a per-action value vector and scale it into [-1, 1] for the engine. */
function normalizeToUnit(raw: Record<ActionId, number>): ActionScores {
  const vals = ACTIONS.map((a) => raw[a]);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const maxDev = Math.max(1e-6, ...vals.map((v) => Math.abs(v - mean)));
  const out = {} as ActionScores;
  for (const a of ACTIONS) out[a] = unit((raw[a] - mean) / maxDev);
  return out;
}

/**
 * The five doctrine policies. Each is a *stable lens* on the same payoff model
 * (spec §5): the worldview never changes, only the belief and prices do — which
 * is why the on-screen weight trajectory is the visible shadow of the Bayesian
 * update. Grounding the scores in the payoff/walk model (rather than hand-tuned
 * constants) is what makes the Council adapt its firmness to context.
 */
function doctrineScores(
  doctrine: DoctrineId,
  ctx: ContextVector,
  belief: Belief,
  buyerOffer: number,
  eviValue: number,
  policy: CouncilPolicy,
): { scores: ActionScores; rationale: string; confidence: number } {
  // Per-action statistics under the current belief.
  const capture = {} as Record<ActionId, number>; // upside if the deal survives
  const walk = {} as Record<ActionId, number>; // probability of a walk
  const ev = {} as Record<ActionId, number>; // expected money payoff
  for (const a of ACTIONS) {
    let cap = 0, w = 0, e = 0;
    for (const t of COUNTERPARTY_TYPES) {
      cap += belief[t] * capturedSurplus(a, t, buyerOffer);
      w += belief[t] * walkRisk(a, t);
      e += belief[t] * payoff(a, t, buyerOffer);
    }
    capture[a] = cap; walk[a] = w; ev[a] = e;
  }
  const mlt = mostLikelyType(belief);
  const raw = {} as Record<ActionId, number>;

  switch (doctrine) {
    case "battle":
      // Win this round: immediate gain, discounted view of the future (Pressure owns γ).
      // γ=1 → pure capture-now; lower γ lets the longer-horizon payoff back in.
      for (const a of ACTIONS) raw[a] = policy.pressure.futureDiscount * capture[a] + (1 - policy.pressure.futureDiscount) * ev[a];
      return { scores: normalizeToUnit(raw), rationale: "There's ground to take right now — press for it. Hesitation leaves it on the table.", confidence: 0.6 };

    case "war":
      // Win the relationship: protect against the walk, accept modest capture.
      for (const a of ACTIONS) raw[a] = 0.3 * capture[a] - 900 * walk[a];
      return { scores: normalizeToUnit(raw), rationale: "Don't torch the deal for one round's margin — hold the position, play the long game.", confidence: 0.55 };

    case "risk": {
      // Hedge's algorithm: score = λ·worst_case + (1−λ)·expected_value (Hedge owns λ).
      // Worst case is the walk-dominated downside; expected value is the belief-weighted
      // payoff. Higher λ = more worst-case averse → pushes harder off irreversible commits.
      const lambda = policy.hedge.lambda;
      const evMax = Math.max(...ACTIONS.map((a) => ev[a])) || 1;
      for (const a of ACTIONS) {
        const worstCase = -1200 * walk[a];
        const expected = ev[a] / Math.max(1, Math.abs(evMax)) * 1200 - 1200; // scaled into the worst-case range
        raw[a] = lambda * worstCase + (1 - lambda) * expected;
      }
      raw.accept -= (300 + 600 * lambda) * ctx.exposure; // committing under exposure scales with aversion
      raw.walk -= 400 * lambda; // walking is irreversible too
      return { scores: normalizeToUnit(raw), rationale: "If we're wrong here it's irreversible — keep the deal alive and our options open.", confidence: 0.5 + 0.3 * ctx.infoConfidence };
    }

    case "empathy":
      // Model the counterparty: favour what is actually best for the believed type.
      for (const a of ACTIONS) raw[a] = payoff(a, mlt, buyerOffer);
      return { scores: normalizeToUnit(raw), rationale: `I read them as ${mlt.replace("_", " ")} — play what actually fits that, not what flatters us.`, confidence: 0.5 + 0.4 * ctx.infoConfidence };

    case "probe": {
      // Probe's score IS the decision rule "probe iff EVI > cost" (spec §5): a
      // decisive switch, not a gentle nudge, so the information actually gets bought
      // when it is worth more than the probe's price (and there's a round to use it).
      // Probe's rule: probe iff EVI clears Probe's own threshold (Probe owns it). The
      // threshold adapts to the situation; lower = more willing to spend a move to learn.
      const worth = eviValue > policy.probe.eviThreshold && ctx.roundsLeft > 1;
      for (const a of ACTIONS) raw[a] = ev[a];
      raw.probe = worth ? Math.max(...ACTIONS.map((a) => ev[a])) + 1e6 : Math.min(...ACTIONS.map((a) => ev[a])) - 1e6;
      return {
        scores: normalizeToUnit(raw),
        rationale: worth
          ? `We're deciding blind — information is worth ~${Math.round(eviValue)}, more than the probe costs. Buy it before we commit.`
          : `Information's only worth ~${Math.round(eviValue)} here — not worth spending a probe.`,
        confidence: 0.5 + 0.4 * ctx.infoConfidence,
      };
    }
  }
}

function softmax(logits: Record<DoctrineId, number>): Record<DoctrineId, number> {
  const max = Math.max(...DOCTRINES.map((d) => logits[d]));
  const exps = {} as Record<DoctrineId, number>;
  let sum = 0;
  for (const d of DOCTRINES) { exps[d] = Math.exp(logits[d] - max); sum += exps[d]; }
  const w = {} as Record<DoctrineId, number>;
  for (const d of DOCTRINES) w[d] = exps[d] / sum;
  return w;
}

export class MockAgents implements DeliberationAgents {
  readonly kind = "mock" as const;

  async empathyRead(input: RoundInput): Promise<EmpathyRead> {
    const { signals } = input.move;
    const flags: string[] = [];
    if (signals.includes("held_firm")) flags.push("claims position is firm");
    if (signals.includes("revealed_competitor")) flags.push("competitor leverage disclosed");
    if (signals.some((s) => s.startsWith("revealed_need"))) flags.push("real need surfaced");
    if (signals.includes("soft_concession")) flags.push("moving cooperatively");
    const likely = mostLikelyType(input.belief);
    return {
      summary:
        `Latest move: "${input.move.message}" — reads as ${TYPE_META[likely].name.toLowerCase()} ` +
        `(${Math.round(input.belief[likely] * 100)}% belief).`,
      flags,
      readTrust: input.ctx.trustEst,
      likelyType: likely,
    };
  }

  async doctrinePosition(
    doctrine: DoctrineId,
    input: RoundInput,
    _read: EmpathyRead,
  ): Promise<DoctrinePosition> {
    const eviValue =
      doctrine === "probe"
        ? expectedValueOfInformation(input.belief, input.buyerOffer, input.ctx.roundsLeft).evi
        : 0;
    const { scores: s, rationale, confidence } = doctrineScores(
      doctrine,
      input.ctx,
      input.belief,
      input.buyerOffer,
      eviValue,
      selectPolicy(input.ctx),
    );
    const top = ACTIONS.reduce((a, b) => (s[b] > s[a] ? b : a));
    const meta = LENSES[doctrine];
    return {
      doctrine,
      scores: s,
      confidence,
      rationale,
      reasoning:
        `${meta.name} ("${meta.coreBelief}") favours "${top}". Read: trust ${pct(input.ctx.trustEst)}, ` +
        `belief-resolution ${pct(input.ctx.infoConfidence)}, adversarial ${pct(input.ctx.adversarialSignal)}, ` +
        `exposure ${pct(input.ctx.exposure)}, ${input.ctx.roundsLeft} round(s) left.`,
    };
  }

  async arbiterWeights(ctx: ContextVector, _read: EmpathyRead): Promise<ArbiterVerdict> {
    const { infoConfidence: info, adversarialSignal: adv, exposure: exp, trustEst: trust, reversibility: rev } = ctx;
    const logits: Record<DoctrineId, number> = {
      empathy: 0.5 + 0.8 * (1 - info) + 0.4 * (1 - adv),
      battle: 0.6 + 1.0 * trust * (1 - adv),
      war: 0.5 + 0.9 * adv + 0.6 * (1 - trust),
      probe: 0.3 + 1.6 * (1 - info),
      risk: 0.5 + 1.2 * exp + 1.0 * adv + 0.4 * (1 - rev),
    };
    const weights = softmax(logits);
    const leaders = [...DOCTRINES].sort((a, b) => weights[b] - weights[a]).slice(0, 2);
    return {
      context: ctx,
      weights,
      rationale:
        `Terrain: belief-resolution ${pct(info)}, adversarial ${pct(adv)}, exposure ${pct(exp)} ` +
        `-> advantage to ${leaders.map((d) => LENSES[d].name).join(" + ")}.`,
    };
  }

  async baselineTurn(persona: BaselinePersona, input: RoundInput): Promise<BaselineDecision> {
    const { buyerOffer, councilAsk, ctx, history, move } = input;
    const prevOffer = history.at(-1)?.offer.price ?? buyerOffer;
    const rose = move.offer.price - prevOffer;
    const near = closeness(buyerOffer, councilAsk);

    if (persona === "naive") {
      if (buyerOffer > SELLER_FLOOR && (near > 0.6 || ctx.roundsLeft <= 2)) {
        return { action: "accept", reasoning: "Good enough and I'd rather lock it in than risk the deal." };
      }
      return { action: "counter_soft", reasoning: "Nudge them up a little, then take what I can get." };
    }

    // "strong": a competent negotiator with no doctrine/Arbiter structure or type belief.
    if (buyerOffer >= councilAsk * 0.97) {
      return { action: "accept", reasoning: "Their offer essentially meets my ask — close it." };
    }
    if (ctx.roundsLeft <= 1) {
      return buyerOffer > SELLER_FLOOR
        ? { action: "accept", reasoning: "Last round; the offer clears my floor, so I take it." }
        : { action: "counter_soft", reasoning: "Last round; make one more move toward a deal." };
    }
    if (rose > 250) {
      return { action: "counter_soft", reasoning: "They're moving — keep the momentum and meet partway." };
    }
    return { action: "counter_hard", reasoning: "They've stalled; hold firm and push for more." };
  }

  async challengeResponse(
    role: "challenger" | "defender",
    myDoctrine: DoctrineId,
    _theirDoctrine: DoctrineId,
    contestedAction: ActionId,
    _theirText: string,
    _input: RoundInput,
    stakes: { myScore: number; theirScore: number; myConfidence: number; theirConfidence: number },
  ): Promise<{ text: string; revisedScore?: number }> {
    const m = LENSES[myDoctrine];
    const actionLabel = ACTION_LABELS[contestedAction];
    if (role === "challenger") {
      return { text: `"${actionLabel}" favours the wrong horizon right now — ${m.coreBelief.toLowerCase()}.` };
    }
    // Causal concession rule (deterministic, auditable): the defender concedes only
    // when the challenger holds an epistemic edge — concession is proportional to the
    // challenger's confidence ADVANTAGE over the defender, scaled by the score gap.
    // A confident dissent against a hesitant defender moves the council; a dissent
    // from equal or lower confidence is absorbed. The protocol clamps the concession.
    const gap = stakes.theirScore - stakes.myScore;
    const edge = Math.max(0, stakes.theirConfidence - stakes.myConfidence);
    const concession = gap * edge;
    const revisedScore = stakes.myScore + concession;
    if (Math.abs(concession) < 0.01) {
      return { text: `The situation is exactly why "${actionLabel}" is correct — ${m.coreBelief.toLowerCase()}.` };
    }
    return {
      text: `The situation still favours "${actionLabel}" — ${m.coreBelief.toLowerCase()} — though the objection has weight.`,
      revisedScore,
    };
  }
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
