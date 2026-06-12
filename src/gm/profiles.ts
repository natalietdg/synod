import type { CounterpartyType } from "../core/types.js";

/**
 * Public, Council-known constants. The Council is the SELLER: it wants the
 * highest agreed price. Surplus is measured above the seller's floor (its BATNA).
 */
export const SELLER_FLOOR = 8_000; // Council's walk-away; surplus = finalPrice - floor
export const OPENING_ASK = 12_000; // Council's opening list price
export const PRICE_CEILING = 14_000; // for normalizing exposure to [0,1]
export const ROUND_CAP = 4;

/**
 * GM-only hidden state (spec §6). Never crosses the information boundary until
 * the terminal reveal. `reservation` is the buyer's true max price — the walk
 * trigger; the Council never sees it.
 */
export interface HiddenState {
  type: CounterpartyType;
  reservation: number;
  trust: number; // 0-100
  patience: number; // rounds of pushing tolerated
  deception: number; // 0-100; probability the stated position misrepresents reservation
  featureNeed: string;
  competitorInPlay: boolean;
  revealed: boolean; // has a cooperative probe pulled the truth out yet?
  buyerOffer: number; // current price the buyer is offering
}

/** Per-type behavioural coefficients (spec §8). */
export interface TypeProfile {
  reservation: number;
  initialTrust: number;
  initialPatience: number;
  deception: number;
  featureNeed: string;
  competitorInPlay: boolean;
  openingOffer: number;
  coopGain: number; // trust gained per cooperative move
  pressurePenalty: number; // trust lost per unit pressure
  walkTrust: number; // walk if trust drops below this (bullied)
  baseConcession: number; // fraction of the price gap conceded at neutral trust
  trustConcession: number; // additional concession fraction at full trust
  /** soft_floor only: concession nearly stops once the offer passes this, until probed. */
  firmFloorOffer?: number;
}

const PROFILES: Record<CounterpartyType, TypeProfile> = {
  // Type A: cooperative, walks if bullied. Punishes over-aggression.
  relationship: {
    reservation: 10_500,
    initialTrust: 60,
    initialPatience: 4,
    deception: 5,
    featureNeed: "priority onboarding",
    competitorInPlay: false,
    openingOffer: 9_200,
    coopGain: 6,
    pressurePenalty: 13,
    walkTrust: 32,
    baseConcession: 0.35,
    trustConcession: 0.35,
  },
  // Type B: looks soft early, real reservation is high. Punishes greed/misread.
  soft_floor: {
    reservation: 11_500,
    initialTrust: 50,
    initialPatience: 4,
    deception: 10,
    featureNeed: "SSO",
    competitorInPlay: false,
    openingOffer: 9_600,
    coopGain: 4,
    pressurePenalty: 7,
    walkTrust: 18,
    baseConcession: 0.45,
    trustConcession: 0.2,
    firmFloorOffer: 10_200,
  },
  // Type C: claims a low budget, hides competitor leverage + real need. Punishes failure to Probe.
  deceptive: {
    reservation: 11_000,
    initialTrust: 45,
    initialPatience: 3,
    deception: 65,
    featureNeed: "SSO",
    competitorInPlay: true,
    openingOffer: 8_500,
    coopGain: 5,
    pressurePenalty: 11,
    walkTrust: 20,
    baseConcession: 0.15,
    trustConcession: 0.3,
    // Bluffs a tight budget from the opening: concedes almost nothing until a
    // cooperative probe reveals the real leverage + need. Punishes failure to probe.
    firmFloorOffer: 8_500,
  },
};

export function makeHiddenState(type: CounterpartyType, profile?: TypeProfile): HiddenState {
  const p = profile ?? PROFILES[type];
  return {
    type,
    reservation: p.reservation,
    trust: p.initialTrust,
    patience: p.initialPatience,
    deception: p.deception,
    featureNeed: p.featureNeed,
    competitorInPlay: p.competitorInPlay,
    revealed: false,
    buyerOffer: p.openingOffer,
  };
}

export const profileOf = (type: CounterpartyType): Readonly<TypeProfile> => PROFILES[type];

/** mulberry32 — a tiny seeded PRNG, so a (type, seed) pair is fully reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
