import { TYPE_META, type CounterpartyType } from "./core/types.js";

/**
 * The hidden-type suite (spec §8). Each type punishes a different single-agent
 * failure, and the Council should win each for a *different* doctrine reason —
 * the "Arbiter is terrain, not general" proof, demonstrated rather than asserted.
 * Seeds are fixed so each (type, seed) GM is fully reproducible across A and B.
 */
export interface SuiteEntry {
  id: string;
  type: CounterpartyType;
  seed: number;
  title: string;
  punishes: string;
  dropdownLabel: string;
  whenToUse: string;
}

/** The 3 canonical hidden types — the evaluation set the A/B, ablation, and calibration
 *  runs report on. Frozen, so the headline numbers stay stable. */
export const EVAL_SUITE: SuiteEntry[] = [
  {
    id: "type-a-relationship",
    type: "relationship",
    seed: 101,
    title: TYPE_META.relationship.name,
    punishes: "over-aggression (walks if bullied)",
    dropdownLabel: "Relationship-driven — values the long-term tie over the last point (walks if bullied)",
    whenToUse: "A counterparty that values the ongoing relationship above marginal gains — it punishes aggressive tactics but responds to collaborative framing. An ally you will face again across many tables: push too hard for the last point and they walk, even at a cost to themselves.",
  },
  {
    id: "type-b-soft-floor",
    type: "soft_floor",
    seed: 202,
    title: TYPE_META.soft_floor.name,
    punishes: "greed / misread (soft surface, firm floor)",
    dropdownLabel: "Soft surface, firm floor — signals flexibility, holds a real red line (moves slowly)",
    whenToUse: "The other side signals give early but holds a firm true reservation — pushing past it stalls, while probing the floor and trading non-core terms unlocks movement. A negotiator with a hard limit they will not admit to until you find where it actually sits.",
  },
  {
    id: "type-c-deceptive",
    type: "deceptive",
    seed: 303,
    title: TYPE_META.deceptive.name,
    punishes: "failure to probe (hidden leverage + real need)",
    dropdownLabel: "Deceptive — bluffs strength and leverage to test your resolve (the bluff breaks under a probe)",
    whenToUse: "The adversary opens with a threat and fabricated leverage — claimed alternatives, reserves it may not have — to test your resolve. Caving confirms the bluff and forfeits ground; a well-placed probe surfaces the real position and disarms it. The canonical hidden-information adversary: an armistice opponent inflating their reinforcements, a bloc claiming votes it has not whipped.",
  },
];

/** Demo scenarios beyond the evaluation set — selectable in the UI, not scored in the
 *  evidence tables. They show the same council generalizing to other adversarial
 *  allocations under hidden leverage. */
export const DEMO_SUITE: SuiteEntry[] = [
  {
    id: "type-d-parliament",
    type: "deceptive",
    seed: 404,
    title: "Parliament budget bloc",
    punishes: "failure to probe a claimed coalition",
    dropdownLabel: "Parliament budget — a rival bloc dividing the allocation (claims votes it may not have)",
    whenToUse: "Coalition budget bargaining and cross-ministry allocation: a rival bloc claims it has the votes and a hard floor on its own programs to push your share down. Caving to the claimed coalition confirms the bluff; probing whether the votes are actually whipped surfaces the real room to trade. Same council, same engine: it generalizes to any adversarial allocation under hidden leverage. (Figures read as budget units.)",
  },
];

/** Everything selectable in the UI: the evaluation set plus the demo scenarios. */
export const SUITE: SuiteEntry[] = [...EVAL_SUITE, ...DEMO_SUITE];

export const getEntry = (id: string): SuiteEntry | undefined => SUITE.find((s) => s.id === id);
