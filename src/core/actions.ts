/**
 * The candidate actions the Council scores each round of a negotiation (spec §4).
 *
 * Closed set, so the deterministic engine can blend every doctrine's scores into
 * one comparable matrix. `probe` is the rare one: a small, low-cost reveal move
 * whose value is the information it buys, not its immediate payoff (spec §5 EVI).
 */
export const ACTIONS = [
  "accept",
  "counter_hard",
  "counter_soft",
  "hold",
  "probe",
  "concede_term",
  "walk",
] as const;

export type ActionId = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<ActionId, string> = {
  accept: "Accept",
  counter_hard: "Counter (hard)",
  counter_soft: "Counter (soft) · price",
  hold: "Hold position",
  probe: "Probe",
  concede_term: "Concede term · non-price",
  walk: "Walk away",
};
