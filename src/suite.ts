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

export const SUITE: SuiteEntry[] = [
  {
    id: "type-a-relationship",
    type: "relationship",
    seed: 101,
    title: TYPE_META.relationship.name,
    punishes: "over-aggression (walks if bullied)",
    dropdownLabel: "Relationship-oriented — vendor renewal, partner upsell (walks if bullied)",
    whenToUse: "Enterprise account renewal, preferred supplier negotiation, existing partner upsell. The counterparty values the relationship above marginal price gains — punishes aggressive tactics but responds to collaborative framing. In M&A: a founder-led acquisition target where cultural continuity matters more than the last dollar — push hard and they walk to a lower bid.",
  },
  {
    id: "type-b-soft-floor",
    type: "soft_floor",
    seed: 202,
    title: TYPE_META.soft_floor.name,
    punishes: "greed / misread (soft surface, firm floor)",
    dropdownLabel: "Soft surface, firm floor — procurement buyer, budget-constrained (moves slowly, holds floor)",
    whenToUse: "Procurement-led deals, budget-cycle negotiations, vendor shortlist decisions. The buyer signals flexibility early but holds a firm real reservation — pushing past it stalls; probing the floor and trading terms unlocks movement. In M&A: a sell-side with a firm minimum valuation but real flexibility on structure — finding the earnout floor and offering the right mix of cash vs. equity is what closes it.",
  },
  {
    id: "type-c-deceptive",
    type: "deceptive",
    seed: 303,
    title: TYPE_META.deceptive.name,
    punishes: "failure to probe (hidden leverage + real need)",
    dropdownLabel: "Deceptive — adversarial RFP, BATNA bluffer (fakes constraints, tests your resolve)",
    whenToUse: "Adversarial RFPs, competitive bids, buyers who open with a BATNA threat. The counterparty fabricates constraints and competitor leverage to test resolve — caving confirms the bluff; probing surfaces the real need and disarms it. In M&A: a seller claiming multiple competing bids and a lower EBITDA floor than reality — probing the alternative timeline disarms the bluff and surfaces the real exit motivation.",
  },
];

export const getEntry = (id: string): SuiteEntry | undefined => SUITE.find((s) => s.id === id);
