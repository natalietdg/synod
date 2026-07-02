import { SELLER_FLOOR, ROUND_CAP } from "./profiles.js";
import type { CouncilMove } from "./types.js";
import type { CounterpartyEngine, CounterpartyMove, GmEmission, TerminalReveal } from "./types.js";

/**
 * ANAC-standard TIME-DEPENDENT opponents — the classic tactics from Faratin, Sierra &
 * Jennings (1998), used as the canonical baselines throughout the Automated Negotiating
 * Agents Competition (ANAC / ANL) literature:
 *
 *   offer(t) = opening + (reservation − opening) · ( k + (1−k) · t^(1/e) )
 *
 * with t = round/deadline. e < 1 is BOULWARE (concedes only near the deadline), e = 1 is
 * LINEAR, e > 1 is CONCEDER (gives ground early). These opponents were NOT authored by
 * this project — the formula and parameters are published — so they are a first
 * external-validity step: opponents from the literature, not from the same hand that
 * built the council. They are also deliberately alien to the council's belief machinery:
 * a time-based tactic has no bluff to expose and no trust to win, so probing buys nothing
 * here and cooperation isn't rewarded — the tactic concedes on the clock, full stop.
 */
export type AnacTactic = "boulware" | "linear" | "conceder";

export interface AnacProfile {
  tactic: AnacTactic;
  e: number;          // concession exponent (Faratin's β)
  k: number;          // fraction of the range conceded at t=0
  opening: number;    // buyer's opening offer
  reservation: number; // buyer's true maximum (never exceeded)
}

export const ANAC_TACTICS: AnacProfile[] = [
  { tactic: "boulware", e: 0.2, k: 0, opening: 8_600, reservation: 11_000 },
  { tactic: "linear",   e: 1.0, k: 0, opening: 8_600, reservation: 11_000 },
  { tactic: "conceder", e: 3.0, k: 0, opening: 8_600, reservation: 11_000 },
];

const LINES: Record<AnacTactic, string> = {
  boulware: "Our number moves on our schedule, not on your arguments.",
  linear: "We'll meet you a step at a time — steady as the calendar.",
  conceder: "We want this closed — meet us anywhere reasonable and it's done.",
};

export class AnacGameMaster implements CounterpartyEngine {
  private round = 0;
  private offer: number;

  constructor(private readonly p: AnacProfile, private readonly deadline = ROUND_CAP) {
    this.offer = p.opening;
  }

  /** Faratin decision function: the buyer's planned offer at round r (1-indexed). */
  private planned(r: number): number {
    const t = Math.min(1, r / this.deadline);
    const f = this.p.k + (1 - this.p.k) * Math.pow(t, 1 / this.p.e);
    return Math.round(this.p.opening + (this.p.reservation - this.p.opening) * f);
  }

  async open(): Promise<CounterpartyMove> {
    this.round = 1;
    this.offer = this.planned(1);
    return {
      round: 1,
      message: `Let's get started — I'm prepared to open at $${this.offer.toLocaleString()}. ${LINES[this.p.tactic]}`,
      offer: { price: this.offer, features: [] },
      signals: ["opening"],
      terminal: false,
    };
  }

  async step(move: CouncilMove): Promise<GmEmission> {
    if (move.action === "walk") return this.terminal(null);
    if (move.action === "accept") return this.terminal(this.offer);

    this.round += 1;
    // Classic conflict rule: PAST the deadline with no agreement, both sides get nothing.
    // The deadline-round offer itself (the tactic's full concession) is emitted and may be
    // accepted — the conflict only lands if the seller lets that final offer die too.
    if (this.round > this.deadline) return this.terminal(null);
    const prev = this.offer;
    this.offer = this.planned(this.round);

    // Classic acceptance (AC_next): accept the ask if it is no worse than what we were
    // about to offer anyway. Offers crossing closes at the ask.
    if (move.ask.price <= this.offer) return this.terminal(Math.min(move.ask.price, this.p.reservation));

    const moved = this.offer - prev;
    const signals = moved <= 60 ? ["held_firm"] : moved < 400 ? ["small_concession"] : ["soft_concession"];
    return {
      round: this.round,
      message: `$${this.offer.toLocaleString()}. ${LINES[this.p.tactic]}`,
      offer: { price: this.offer, features: [] },
      signals,
      terminal: false,
    };
  }

  private terminal(price: number | null): TerminalReveal {
    const deal = price !== null && price > SELLER_FLOOR;
    return {
      terminal: true,
      outcome: deal ? "deal" : "walk",
      finalDeal: deal ? { price: price!, features: [] } : null,
      surplusCaptured: deal ? price! - SELLER_FLOOR : 0,
      dealSurvived: deal,
      trustFinal: 50,
      trustNarrative: `time-dependent ${this.p.tactic} tactic (Faratin e=${this.p.e}) — no trust model, the clock is the strategy`,
      headlineScore: deal ? price! - SELLER_FLOOR : 0,
    };
  }
}
