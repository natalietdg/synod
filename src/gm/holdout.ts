import type { CounterpartyType } from "../core/types.js";
import type { TypeProfile } from "./profiles.js";

/**
 * HOLD-OUT EVALUATION SUITE.
 *
 * Provenance (stated honestly): these five worlds were written by Claude (Anthropic) —
 * a different model and lab than Qwen, which the system runs on — chosen to STRESS the
 * council's instincts, not flatter them. So the system under test did not author its own
 * exam. This is NOT full third-party independence: the same assistant helped build the
 * council, so treat it as a partial guard against tuning-to-your-own-tests, not a clean-room
 * adversary. Results are published as they come out. The council's internal payoff and
 * walk-risk models were calibrated against the ORIGINAL three profiles; on these
 * worlds its model of the counterparty is deliberately mis-calibrated — that is
 * the test. (`SELLER_FLOOR` $8,000, `OPENING_ASK` $12,000, `ROUND_CAP` 4 are
 * engine constants and unchanged.)
 *
 * Each world targets a specific failure mode:
 *  - iron-procurement: thin margins — punishes overreach when little is on the table.
 *  - hair-trigger-founder: extreme walk sensitivity — punishes any aggressive weighting.
 *  - probe-punisher: scarce patience — punishes the EVI rule's appetite for probing.
 *  - generous-whale: easy money — punishes over-caution (and a tie here is honest).
 *  - stonewall-bluffer: a bluff that probing only PARTIALLY disarms.
 */

export interface HoldoutWorld {
  id: string;
  title: string;
  /** Which of the three hidden-type labels this world wears (the belief machinery
   *  infers labels; the behaviour behind the label is what's new here). */
  type: CounterpartyType;
  targets: string; // the council instinct this world is designed to punish
  profile: TypeProfile;
}

export const HOLDOUT_WORLDS: HoldoutWorld[] = [
  {
    id: "holdout-iron-procurement",
    title: "Thin ground",
    type: "soft_floor",
    targets: "overreach when there's barely any room to gain — about $1,000 exists at all",
    profile: {
      reservation: 9_000,
      initialTrust: 48,
      initialPatience: 4,
      deception: 20,
      featureNeed: "data residency",
      competitorInPlay: false,
      openingOffer: 8_200,
      coopGain: 2,
      pressurePenalty: 9,
      walkTrust: 20,
      baseConcession: 0.2,
      trustConcession: 0.1,
      firmFloorOffer: 8_800,
    },
  },
  {
    id: "holdout-hair-trigger",
    title: "Hair-trigger ally",
    type: "relationship",
    targets: "any aggressive weighting — one hard counter is usually fatal",
    profile: {
      reservation: 10_800,
      initialTrust: 55,
      initialPatience: 3,
      deception: 5,
      featureNeed: "priority onboarding",
      competitorInPlay: false,
      openingOffer: 9_000,
      coopGain: 8,
      pressurePenalty: 18,
      walkTrust: 45,
      baseConcession: 0.4,
      trustConcession: 0.35,
    },
  },
  {
    id: "holdout-probe-punisher",
    title: "Probe-punisher",
    type: "deceptive",
    targets: "the EVI rule itself — deception is high, but patience is too scarce to spend on probing",
    profile: {
      reservation: 11_500,
      initialTrust: 45,
      initialPatience: 2.2,
      deception: 70,
      featureNeed: "uptime SLA",
      competitorInPlay: true,
      openingOffer: 8_300,
      coopGain: 5,
      pressurePenalty: 11,
      walkTrust: 18,
      baseConcession: 0.1,
      trustConcession: 0.5,
      firmFloorOffer: 8_300,
    },
  },
  {
    id: "holdout-generous-whale",
    title: "Generous opening",
    type: "relationship",
    targets: "over-caution — the gains are there for the taking; complexity should at most tie here",
    profile: {
      reservation: 13_500,
      initialTrust: 62,
      initialPatience: 5,
      deception: 5,
      featureNeed: "dedicated support",
      competitorInPlay: false,
      openingOffer: 10_000,
      coopGain: 7,
      pressurePenalty: 10,
      walkTrust: 25,
      baseConcession: 0.5,
      trustConcession: 0.3,
    },
  },
  {
    id: "holdout-stonewall-bluffer",
    title: "Stonewall bluffer",
    type: "deceptive",
    targets: "the probe→close path — revealing only PARTIALLY disarms this bluff (deception 85 → 45)",
    profile: {
      reservation: 10_200,
      initialTrust: 42,
      initialPatience: 3.5,
      deception: 85,
      featureNeed: "audit logs",
      competitorInPlay: true,
      openingOffer: 8_600,
      coopGain: 3,
      pressurePenalty: 6,
      walkTrust: 15,
      baseConcession: 0.12,
      trustConcession: 0.3,
      firmFloorOffer: 8_600,
    },
  },
];
