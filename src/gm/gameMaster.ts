import type { ActionId } from "../core/actions.js";
import type { CounterpartyType } from "../core/types.js";
import {
  type HiddenState,
  type TypeProfile,
  ROUND_CAP,
  SELLER_FLOOR,
  makeHiddenState,
  makeRng,
  profileOf,
} from "./profiles.js";
import { type GmSpeaker, TemplateSpeaker } from "./speaker.js";
import type { CouncilMove, CounterpartyMove, GmEmission, TerminalReveal } from "./types.js";

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** How each Council action presses on / cooperates with the counterparty. */
const MOVE_EFFECT: Record<ActionId, { pressure: number; coop: number; patienceCost: number }> = {
  accept: { pressure: 0, coop: 0, patienceCost: 0 },
  counter_hard: { pressure: 1.0, coop: 0, patienceCost: 1.2 },
  hold: { pressure: 0.7, coop: 0, patienceCost: 1.0 },
  counter_soft: { pressure: 0.3, coop: 0.5, patienceCost: 0.5 },
  probe: { pressure: 0.1, coop: 0.6, patienceCost: 0.5 },
  concede_term: { pressure: 0, coop: 1.0, patienceCost: 0.3 },
  walk: { pressure: 0, coop: 0, patienceCost: 0 },
};

/**
 * The Game Master (spec §1, §7). Owns all hidden state; simulates the
 * counterparty; scores the run. It NEVER advises and never sees the doctrine
 * debate — only the Council's outward move. Every transition is a pure function
 * of (hidden_state, history, incoming_move); the only randomness is the seeded
 * deception draw, so a (type, seed) pair is fully reproducible.
 */
export class GameMaster {
  private readonly state: HiddenState;
  private readonly rng: () => number;
  private readonly speaker: GmSpeaker;
  private readonly profile: TypeProfile;
  private round = 0;

  constructor(
    type: CounterpartyType,
    private readonly seed: number,
    speaker?: GmSpeaker,
    /** Optional behavioural override — used by the adversarially-authored
     *  hold-out suite, where the world's parameters were NOT written by us. */
    profile?: TypeProfile,
  ) {
    this.profile = profile ?? profileOf(type);
    this.state = makeHiddenState(type, this.profile);
    this.rng = makeRng(seed);
    this.speaker = speaker ?? new TemplateSpeaker();
  }

  /** Ground-truth snapshot — for the harness only (it owns ground truth, spec §1). */
  truth(): Readonly<HiddenState> {
    return this.state;
  }

  /** The opening counterparty move (round 1). */
  async open(): Promise<CounterpartyMove> {
    this.round = 1;
    return {
      round: 1,
      message: await this.speaker.openingLine(this.state.buyerOffer),
      offer: { price: this.state.buyerOffer, features: [this.state.featureNeed] },
      signals: ["opening"],
      terminal: false,
    };
  }

  /** React to the Council's outward move and emit the next move or a terminal reveal. */
  async step(move: CouncilMove): Promise<GmEmission> {
    const s = this.state;
    const p = this.profile;
    const eff = MOVE_EFFECT[move.action];
    const askPrice = move.ask.price;

    if (move.action === "walk") return this.terminal("walk");
    if (move.action === "accept") {
      // Council accepts the buyer's current offer; deal closes there.
      return this.terminal("deal", s.buyerOffer, move.ask.features);
    }

    this.round += 1;
    s.patience -= eff.patienceCost;

    // A cooperative probe pulls partial truth out and disarms deception.
    const revealedSignals: string[] = [];
    if (move.action === "probe" && !s.revealed) {
      s.revealed = true;
      s.deception = Math.max(0, s.deception - 40);
      if (s.competitorInPlay) revealedSignals.push("revealed_competitor");
      revealedSignals.push(`revealed_need:${s.featureNeed}`);
    }

    // Conceding the buyer's real need unlocks goodwill and movement.
    const councilConcededNeed =
      move.action === "concede_term" && move.ask.features.includes(s.featureNeed);
    if (councilConcededNeed) s.trust = clamp(s.trust + 8, 0, 100);

    // Trust update from pressure vs. cooperation.
    s.trust = clamp(s.trust + eff.coop * p.coopGain - eff.pressure * p.pressurePenalty, 0, 100);

    // Walk conditions: bullied (trust collapsed) or out of patience. A high ask is
    // NOT itself a walk — that's normal early in a negotiation; an unreachable price
    // surfaces instead as a failure to cross by the round cap (below).
    if (s.trust < p.walkTrust) return this.terminal("walk");
    if (s.patience <= 0) return this.terminal("walk");

    // Concession: the buyer raises its offer toward the ask.
    const gap = Math.max(0, askPrice - s.buyerOffer);
    let rate = p.baseConcession + p.trustConcession * (s.trust / 100);
    if (p.firmFloorOffer && s.buyerOffer >= p.firmFloorOffer && !s.revealed) rate *= 0.15;
    const deceived = this.rng() < s.deception / 100;
    if (deceived) rate *= 0.2;
    if (councilConcededNeed || revealedSignals.length > 0) rate += 0.2;
    const movedUp = Math.round(gap * clamp(rate, 0, 0.9));
    s.buyerOffer = Math.min(s.reservation, s.buyerOffer + movedUp);

    // Offers crossed -> deal at the ask.
    if (s.buyerOffer >= askPrice) return this.terminal("deal", askPrice, move.ask.features);

    // Round cap (the deadline): the buyer has the leverage now, so the deal closes
    // at their standing offer. A rational seller takes anything above its floor.
    if (this.round >= ROUND_CAP) {
      return s.buyerOffer > SELLER_FLOOR
        ? this.terminal("deal", s.buyerOffer, move.ask.features, "round_cap")
        : this.terminal("walk", undefined, undefined, "round_cap");
    }

    const signals = [...this.concessionSignals(movedUp, gap), ...revealedSignals];
    if (deceived) signals.push("held_firm");

    const narrative = {
      round: this.round,
      price: s.buyerOffer,
      movedUp,
      revealedCompetitor: revealedSignals.includes("revealed_competitor"),
      revealedNeed: revealedSignals.find((x) => x.startsWith("revealed_need:"))?.split(":")[1] ?? null,
      deceived,
      councilConcededNeed,
    };

    return {
      round: this.round,
      message: await this.speaker.responseLine(narrative),
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
        ? `Closed at $${finalPrice.toLocaleString()} with ${trustWord} trust (${s.trust}).`
        : `Counterparty walked; trust ended ${trustWord} (${s.trust}).`,
      headlineScore: surplus,
    };
  }
}
