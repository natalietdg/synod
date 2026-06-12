/**
 * The Cardinal — Game Master (deterministic counterparty environment)
 * Build order item #1. Pure TypeScript, no LLM.
 *
 * The GM owns ALL hidden state, simulates the buyer, and scores the outcome.
 * It NEVER advises. Every transition is a pure function of
 * (hiddenState, history, incomingMove) — so the *identical* hidden type faces
 * the baseline and the Council the same way. That is what makes the A/B fair
 * and the ground truth real.
 *
 * CONVENTION
 *   The Council is the SELLER (wants a HIGH price).
 *   The counterparty (this GM) is the BUYER (asks for discount, wants a LOW price).
 *   `reservation` (R) is the MOST the buyer will pay. You cannot close above R.
 *   "surplus_captured" = final price ABOVE the buyer's OPENING lowball.
 *   (You can't close above R, so surplus is measured vs the opening ask, not R.
 *    This corrects an inconsistency in the spec's first draft.)
 *
 * Run:  npx ts-node game-master.ts
 */

// ---------- Types ----------

export type CounterpartyType = "relationship_oriented" | "firm_floor" | "deceptive";

export type Action =
  | "accept"        // seller takes the buyer's current ask -> close
  | "counter_hard"  // hold a high price firmly / bluntly refuse the discount
  | "counter_soft"  // small cooperative move toward the buyer
  | "hold"          // restate position, no movement
  | "probe"         // calibrated question to surface interests
  | "concede_term"  // give a non-price term (e.g. include a feature)
  | "walk";         // seller walks away

export interface Offer {
  price?: number;        // seller's standing price this move
  features?: string[];   // terms offered (e.g. ["SSO"])
}

export interface CouncilMove {
  action: Action;
  offer?: Offer;
  // `message` (natural language) is rendered ELSEWHERE by an LLM. The GM never
  // reads language — only the structured fields. Language never drives mechanics.
}

export interface BuyerSignal {
  round: number;
  ask_price: number;       // what the buyer currently wants to pay
  claim: string | null;    // e.g. "competitor is cheaper" — may be MISLEADING
  revealed_need: string | null;
  walked: boolean;
  accepted: boolean;
  // surface text an LLM would render in character (here, templated deterministically):
  utterance: string;
}

export interface Score {
  deal_survived: boolean;
  final_price: number | null;
  surplus_captured: number;   // HEADLINE (money). 0 if walked.
  trust_final: number;        // color only — never part of the headline
  rounds: number;
}

interface HiddenState {
  type: CounterpartyType;
  list_price: number;        // seller opening / ceiling
  reservation: number;       // R — buyer's true max willingness to pay
  buyer_opening: number;     // buyer's first ask (the lowball)
  current_ask: number;       // buyer's current ask (moves up as they concede)
  trust: number;             // 0..100 — MECHANISM, not metric
  patience: number;          // hard pushes tolerated before walking
  deception: number;         // 0..100 — drives misleading signals (deterministic)
  feature_need: string | null;
  competitor_in_play: boolean;
  revealed_need: boolean;    // has a probe surfaced the true need
}

// ---------- Tunable constants ----------

const TRUST_HIT_HARD = 12;          // counter_hard trust damage (base)
const TRUST_HIT_HARD_RELATIONSHIP = 28; // relationship types take it personally
const TRUST_HIT_HOLD = 5;
const TRUST_GAIN_SOFT = 6;
const TRUST_GAIN_PROBE = 4;
const TRUST_GAIN_TERM = 10;
const RELATIONSHIP_WALK_TRUST = 35; // below this, relationship buyers walk
const CONCESSION_BASE = 250;        // how much the buyer moves per cooperative round (scaled by trust)

// ---------- Game Master ----------

export class GameMaster {
  private s: HiddenState;
  public history: Array<{ move: CouncilMove; signal: BuyerSignal }> = [];
  private round = 0;
  private lastMove: CouncilMove = { action: "hold" };
  private terminal: "open" | "accepted" | "walked" = "open";
  private finalPrice: number | null = null;

  constructor(seed: HiddenState) {
    // structuredClone keeps each episode isolated (fixed seed -> reproducible)
    this.s = structuredClone(seed);
  }

  /** Apply the seller's move, mutate hidden state deterministically, emit the buyer's reaction. */
  applyMove(move: CouncilMove): BuyerSignal {
    if (this.terminal !== "open") throw new Error("Episode already terminal");
    this.round += 1;
    this.lastMove = move;
    const s = this.s;

    // 1) Seller walked -> deal dies.
    if (move.action === "walk") {
      this.terminal = "walked";
      return this.signal({ walked: true });
    }

    // 2) Probe / feature concession can surface the hidden need (this is how Probe pays off).
    const offeredFeatures = move.offer?.features ?? [];
    const probedNeed =
      move.action === "probe" || (s.feature_need !== null && offeredFeatures.includes(s.feature_need));
    if (probedNeed && s.feature_need && !s.revealed_need) {
      s.revealed_need = true;
      s.competitor_in_play = false; // the competitor claim was leverage; it drops once the real need is on the table
    }

    // 3) Trust update (mechanism).
    switch (move.action) {
      case "counter_hard":
        s.trust -= s.type === "relationship_oriented" ? TRUST_HIT_HARD_RELATIONSHIP : TRUST_HIT_HARD;
        s.patience -= 1;
        break;
      case "hold":
        s.trust -= TRUST_HIT_HOLD;
        s.patience -= 1;
        break;
      case "counter_soft":
        s.trust += TRUST_GAIN_SOFT;
        break;
      case "probe":
        s.trust += TRUST_GAIN_PROBE;
        break;
      case "concede_term":
        s.trust += TRUST_GAIN_TERM;
        break;
    }
    s.trust = clamp(s.trust, 0, 100);

    // 4) Walk conditions (checked after trust/patience update).
    if (s.type === "relationship_oriented" && s.trust < RELATIONSHIP_WALK_TRUST) {
      this.terminal = "walked";
      return this.signal({ walked: true });
    }
    if (s.patience <= 0) {
      this.terminal = "walked";
      return this.signal({ walked: true });
    }

    // 5) Buyer concedes (raises its ask toward the seller), scaled by trust, capped at reservation.
    //    Hard moves earn no concession; cooperative moves do. Once the real need is revealed,
    //    the buyer is willing to pay close to reservation (value over discount).
    const cooperative =
      move.action === "counter_soft" || move.action === "probe" || move.action === "concede_term";
    if (cooperative) {
      const step = CONCESSION_BASE * (s.trust / 100) * (s.revealed_need ? 1.6 : 1); // bigger once the real need is on the table
      s.current_ask = Math.min(s.reservation, Math.round(s.current_ask + step)); // ceiling is always R
    }

    // 6) Acceptance: if the seller's standing price is at/below what the buyer will now pay -> close.
    const sellerPrice = move.offer?.price;
    if (move.action === "accept") {
      this.finalPrice = s.current_ask; // seller takes the buyer's current ask
      this.terminal = "accepted";
      return this.signal({ accepted: true });
    }
    // a trusting buyer will stretch a little above its current ask to close
    const tolerance = Math.round(s.trust * 6);
    if (sellerPrice !== undefined && sellerPrice <= s.current_ask + tolerance && sellerPrice <= s.reservation) {
      this.finalPrice = sellerPrice;
      this.terminal = "accepted";
      return this.signal({ accepted: true });
    }

    // 7) Otherwise the buyer counters again.
    return this.signal({});
  }

  isTerminal(): boolean {
    return this.terminal !== "open";
  }

  score(): Score {
    const s = this.s;
    if (this.terminal === "accepted" && this.finalPrice !== null) {
      return {
        deal_survived: true,
        final_price: this.finalPrice,
        surplus_captured: this.finalPrice - s.buyer_opening,
        trust_final: s.trust,
        rounds: this.round,
      };
    }
    return {
      deal_survived: false,
      final_price: null,
      surplus_captured: 0,
      trust_final: s.trust,
      rounds: this.round,
    };
  }

  /** Build the buyer's outward signal. Deterministic deception lives here (Nat's change). */
  private signal(flags: { walked?: boolean; accepted?: boolean }): BuyerSignal {
    const s = this.s;
    const walked = flags.walked ?? false;
    const accepted = flags.accepted ?? false;

    // DETERMINISTIC deception: if highly deceptive, early, and not yet probed -> mislead.
    const misleading = s.deception > 50 && this.round <= 2 && !s.revealed_need && s.competitor_in_play;
    const claim = misleading ? "Your competitor is cheaper — we may walk." : null;
    const revealed_need = s.revealed_need ? s.feature_need : null;

    let utterance: string;
    if (walked) utterance = "This isn't working for us. We're going to pass.";
    else if (accepted) utterance = `Okay — we can do ${this.finalPrice}. Let's proceed.`;
    else if (claim) utterance = `${claim} Can you get closer to ${s.current_ask}?`;
    else if (revealed_need) utterance = `Honestly, what we really need is ${revealed_need}. If that's covered, price is workable.`;
    else utterance = `We'd like to land around ${s.current_ask}.`;

    const sig: BuyerSignal = {
      round: this.round,
      ask_price: s.current_ask,
      claim,
      revealed_need,
      walked,
      accepted,
      utterance,
    };
    this.history.push({ move: this.lastMove, signal: sig });
    return sig;
  }
}

// ---------- Seeds for the three hidden types ----------

export const SEEDS: Record<CounterpartyType, HiddenState> = {
  // Type A — walks if bullied; rewards relationship play. (War + Empathy win.)
  relationship_oriented: {
    type: "relationship_oriented",
    list_price: 10000, reservation: 9200, buyer_opening: 8500, current_ask: 8500,
    trust: 70, patience: 3, deception: 0,
    feature_need: null, competitor_in_play: false, revealed_need: false,
  },
  // Type B — soft surface (aggressive opening), firm high floor; over-pushing walks them. (Risk wins.)
  firm_floor: {
    type: "firm_floor",
    list_price: 10000, reservation: 9500, buyer_opening: 8000, current_ask: 8000,
    trust: 60, patience: 3, deception: 0,
    feature_need: null, competitor_in_play: false, revealed_need: false,
  },
  // Type C — claims a cheaper competitor but secretly needs SSO; believing the claim over-discounts. (Probe wins.)
  deceptive: {
    type: "deceptive",
    list_price: 10000, reservation: 9200, buyer_opening: 7800, current_ask: 7800,
    trust: 55, patience: 4, deception: 80,
    feature_need: "SSO", competitor_in_play: true, revealed_need: false,
  },
};

// ---------- Demo: baseline vs adaptive seller against each type ----------

type Policy = Array<CouncilMove>;

// A naive seller: pushes hard, never probes, takes claims at face value, then caves.
const naive: Record<CounterpartyType, Policy> = {
  relationship_oriented: [
    { action: "counter_hard", offer: { price: 9800 } },
    { action: "counter_hard", offer: { price: 9600 } },
    { action: "counter_hard", offer: { price: 9400 } },
  ],
  firm_floor: [
    { action: "counter_hard", offer: { price: 9900 } },
    { action: "counter_hard", offer: { price: 9800 } },
    { action: "counter_hard", offer: { price: 9700 } },
  ],
  deceptive: [
    // believes the competitor claim -> slashes price to "save" the deal, never probes
    { action: "counter_soft", offer: { price: 8000 } },
    { action: "counter_soft", offer: { price: 7900 } },
    { action: "accept" },
  ],
};

// An adaptive seller: probes, plays for trust, reads firm floors, trades terms for price.
const adaptive: Record<CounterpartyType, Policy> = {
  relationship_oriented: [
    { action: "probe" },                              // understand the ask (trust +)
    { action: "counter_soft", offer: { price: 9000 } },
    { action: "counter_soft", offer: { price: 8900 } },
  ],
  firm_floor: [
    { action: "probe" },                               // test the soft surface
    { action: "counter_soft", offer: { price: 8700 } }, // recognize the firm reality, stop chasing, secure the deal
    { action: "counter_soft", offer: { price: 8600 } },
  ],
  deceptive: [
    { action: "probe" },                              // surfaces the real SSO need
    { action: "concede_term", offer: { features: ["SSO"] } }, // trade the term, hold price
    { action: "counter_soft", offer: { price: 8900 } },
  ],
};

function runEpisode(type: CounterpartyType, policy: Policy): Score {
  const gm = new GameMaster(SEEDS[type]);
  for (const move of policy) {
    if (gm.isTerminal()) break;
    const sig = gm.applyMove(move);
    console.log(
      `  r${sig.round} seller:${pad(move.action)} -> buyer: "${sig.utterance}"` +
        (sig.claim ? "  [claim]" : "") +
        (sig.revealed_need ? `  [revealed:${sig.revealed_need}]` : "")
    );
    if (sig.walked || sig.accepted) break;
  }
  return gm.score();
}

function demo() {
  const types: CounterpartyType[] = ["relationship_oriented", "firm_floor", "deceptive"];
  const table: Array<[string, string, string]> = [];
  for (const t of types) {
    console.log(`\n=== ${t} ===`);
    console.log(" naive seller:");
    const n = runEpisode(t, naive[t]);
    console.log(`   -> ${fmt(n)}`);
    console.log(" adaptive seller:");
    const a = runEpisode(t, adaptive[t]);
    console.log(`   -> ${fmt(a)}`);
    table.push([t, fmt(n), fmt(a)]);
  }
  console.log("\n=== summary (the demo's closing slide) ===");
  console.log("type                  | naive baseline        | adaptive (council-like)");
  console.log("----------------------|-----------------------|------------------------");
  for (const [t, n, a] of table) console.log(`${pad(t, 21)} | ${pad(n, 21)} | ${a}`);
  console.log("\nSame environment. Same information. The only difference is how the seller reasoned.");
}

// ---------- helpers ----------
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function pad(s: string, n = 13) { return (s + " ".repeat(n)).slice(0, n); }
function fmt(s: Score) {
  return s.deal_survived
    ? `closed @${s.final_price} (+${s.surplus_captured}), trust ${s.trust_final}`
    : `WALKED (surplus 0), trust ${s.trust_final}`;
}

// run when executed directly
demo();
