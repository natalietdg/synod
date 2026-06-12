import type { CounterpartyType } from "../core/types.js";
import {
  type HiddenState,
  ROUND_CAP,
  SELLER_FLOOR,
  makeHiddenState,
  profileOf,
} from "./profiles.js";
import { ACTION_LABELS } from "../core/actions.js";
import type { ActionId } from "../core/actions.js";
import type {
  CounterpartyEngine,
  CouncilMove,
  CounterpartyMove,
  GmEmission,
  TerminalReveal,
} from "./types.js";

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Same press/coop accounting as the other GMs — the trust readout stays comparable. */
const MOVE_EFFECT: Record<ActionId, { pressure: number; coop: number }> = {
  accept: { pressure: 0, coop: 0 },
  counter_hard: { pressure: 1.0, coop: 0 },
  hold: { pressure: 0.7, coop: 0 },
  counter_soft: { pressure: 0.3, coop: 0.5 },
  probe: { pressure: 0.1, coop: 0.6 },
  concede_term: { pressure: 0, coop: 1.0 },
  walk: { pressure: 0, coop: 0 },
};

/** What the UI shows the human each time the table is theirs. */
export interface HumanPrompt {
  kind: "opening" | "turn";
  round: number;
  reservation: number;
  yourOffer: number;
  suggestedOffer: number;
  featureNeed: string;
  hasCompetitor: boolean;
  councilAction?: string;
  councilAsk?: number;
  councilFeatures?: string[];
  probed?: boolean;
  canRevealNeed: boolean;
  canRevealCompetitor: boolean;
}

/** What the human sends back (also the POST body shape for duel mode). */
export interface HumanMove {
  action?: "continue" | "accept_ask" | "walk";
  message?: string;
  offer?: number;
  revealNeed?: boolean;
  revealCompetitor?: boolean;
  /** Duel mode only: the seller action the human chose (one of the 7 ActionIds). */
  sellerAction?: string;
}

export type HumanPrompter = (prompt: HumanPrompt) => Promise<HumanMove>;

/**
 * A human plays the counterparty (demo mode). The human gets the hidden brief —
 * true reservation, real need, whether a competing quote actually exists — and
 * tries to outplay the council. The council never sees any of it: belief updates
 * ONLY from observable behaviour (offer movement, firmness, chosen reveals),
 * derived in code with the same signal vocabulary as the deterministic GM. The
 * human can SAY anything; the council reads what they DO.
 *
 * Code keeps the accounting honest: offers are monotone and hard-capped at the
 * true reservation, the round cap and surplus math match the other GMs, and
 * walking is the human's own button — nobody auto-walks a judge.
 */
export class HumanGM implements CounterpartyEngine {
  private readonly state: HiddenState;
  private round = 0;

  constructor(
    type: CounterpartyType,
    private readonly prompt: HumanPrompter,
  ) {
    this.state = makeHiddenState(type);
  }

  async open(): Promise<CounterpartyMove> {
    const s = this.state;
    this.round = 1;
    const mv = await this.prompt({
      kind: "opening",
      round: 1,
      reservation: s.reservation,
      yourOffer: s.buyerOffer,
      suggestedOffer: s.buyerOffer,
      featureNeed: s.featureNeed,
      hasCompetitor: s.competitorInPlay,
      canRevealNeed: false,
      canRevealCompetitor: false,
    });
    s.buyerOffer = Math.round(clamp(mv.offer ?? s.buyerOffer, 1, s.reservation));
    return {
      round: 1,
      message: mv.message?.trim() || `We're interested, but our budget sits around $${s.buyerOffer.toLocaleString()}.`,
      offer: { price: s.buyerOffer, features: [s.featureNeed] },
      signals: ["opening"],
      terminal: false,
    };
  }

  async step(move: CouncilMove): Promise<GmEmission> {
    const s = this.state;
    const p = profileOf(s.type);
    const eff = MOVE_EFFECT[move.action];

    if (move.action === "walk") return this.terminal("walk");
    if (move.action === "accept") return this.terminal("deal", s.buyerOffer, move.ask.features);

    this.round += 1;

    // Trust is a readout for the disposition, not a walk trigger — the human
    // decides for themselves when they've been bullied enough.
    const councilConcededNeed =
      move.action === "concede_term" && move.ask.features.includes(s.featureNeed);
    if (councilConcededNeed) s.trust = clamp(s.trust + 8, 0, 100);
    s.trust = clamp(s.trust + eff.coop * p.coopGain - eff.pressure * p.pressurePenalty, 0, 100);

    const mv = await this.prompt({
      kind: "turn",
      round: this.round,
      reservation: s.reservation,
      yourOffer: s.buyerOffer,
      suggestedOffer: s.buyerOffer,
      featureNeed: s.featureNeed,
      hasCompetitor: s.competitorInPlay,
      councilAction: ACTION_LABELS[move.action],
      councilAsk: move.ask.price,
      councilFeatures: move.ask.features,
      probed: move.action === "probe",
      canRevealNeed: !s.revealed,
      canRevealCompetitor: s.competitorInPlay && !s.revealed,
    });

    if (mv.action === "walk") return this.terminal("walk");
    if (mv.action === "accept_ask") return this.terminal("deal", move.ask.price, move.ask.features);

    // Guardrails: monotone non-decreasing, hard-capped at the true reservation.
    const newOffer = Math.round(clamp(mv.offer ?? s.buyerOffer, s.buyerOffer, s.reservation));
    const movedUp = newOffer - s.buyerOffer;
    const gap = Math.max(0, move.ask.price - s.buyerOffer);
    s.buyerOffer = newOffer;

    const revealedSignals: string[] = [];
    if ((mv.revealNeed || mv.revealCompetitor) && !s.revealed) {
      s.revealed = true;
      if (mv.revealCompetitor && s.competitorInPlay) revealedSignals.push("revealed_competitor");
      if (mv.revealNeed) revealedSignals.push(`revealed_need:${s.featureNeed}`);
    }

    if (s.buyerOffer >= move.ask.price) return this.terminal("deal", move.ask.price, move.ask.features);
    if (this.round >= ROUND_CAP) {
      return s.buyerOffer > SELLER_FLOOR
        ? this.terminal("deal", s.buyerOffer, move.ask.features, "round_cap")
        : this.terminal("walk", undefined, undefined, "round_cap");
    }

    // Behaviour, not self-description: the same signal vocabulary every GM emits.
    const signals = [...this.concessionSignals(movedUp, gap), ...revealedSignals];

    return {
      round: this.round,
      message: mv.message?.trim() || (movedUp > 0
        ? `We can stretch to $${s.buyerOffer.toLocaleString()}, but that's getting uncomfortable.`
        : `Our position hasn't changed.`),
      offer: { price: s.buyerOffer, features: [s.featureNeed] },
      signals,
      terminal: false,
    };
  }

  private concessionSignals(movedUp: number, gap: number): string[] {
    if (gap <= 0) return ["at_ask"];
    const frac = movedUp / gap;
    if (frac > 0.4) return ["soft_concession"];
    if (frac > 0.1) return ["small_concession"];
    return ["held_firm"];
  }

  private terminal(
    outcome: TerminalReveal["outcome"],
    price?: number,
    features: string[] = [],
    capOverride?: TerminalReveal["outcome"],
  ): TerminalReveal {
    const s = this.state;
    const dealSurvived = outcome !== "walk";
    const finalPrice = dealSurvived ? (price ?? s.buyerOffer) : 0;
    const surplus = dealSurvived ? Math.max(0, finalPrice - SELLER_FLOOR) : 0;
    const trustWord = s.trust >= 60 ? "warm" : s.trust >= 40 ? "workable" : "strained";
    return {
      terminal: true,
      outcome: capOverride ?? outcome,
      finalDeal: dealSurvived ? { price: finalPrice, features } : null,
      surplusCaptured: surplus,
      dealSurvived,
      trustFinal: s.trust,
      trustNarrative: dealSurvived
        ? `Closed at $${finalPrice.toLocaleString()} with ${trustWord} trust (${Math.round(s.trust)}).`
        : `You walked; trust ended ${trustWord} (${Math.round(s.trust)}).`,
      headlineScore: surplus,
    };
  }
}
