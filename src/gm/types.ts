import type { ActionId } from "../core/actions.js";

/**
 * Everything that crosses the information boundary (spec §2). These are the ONLY
 * shapes the Council and the Game Master exchange. Hidden state never appears here.
 */

/** What the Council sends outward each round (the GM sees only this). */
export interface CouncilMove {
  action: ActionId;
  /** The Council's outward ask: the price it stands on and any terms it offers. */
  ask: { price: number; features: string[] };
}

/** What the GM emits each round (the Council sees only this). */
export interface CounterpartyMove {
  round: number;
  message: string;
  offer: { price: number; features: string[] };
  /**
   * Visible tells the Council can read from the move — the diagnostic signal for
   * the Bayesian belief update. e.g. "small_concession", "held_firm",
   * "revealed_competitor". Never names the hidden type.
   */
  signals: string[];
  terminal: false;
}

/** The terminal reveal — emitted once, when the negotiation ends. */
export interface TerminalReveal {
  terminal: true;
  outcome: "deal" | "walk" | "round_cap";
  finalDeal: { price: number; features: string[] } | null;
  /** Headline score: money captured above the seller's floor (0 on a walk). */
  surplusCaptured: number;
  dealSurvived: boolean;
  trustFinal: number;
  /** Color/explanation only — never folded into the headline (spec §7). */
  trustNarrative: string;
  headlineScore: number;
}

export type GmEmission = CounterpartyMove | TerminalReveal;

export const isTerminal = (e: GmEmission): e is TerminalReveal => e.terminal === true;

/**
 * Anything that can sit on the counterparty side of the table. The deterministic
 * GameMaster (reproducible A/B evidence) and the QwenAdversaryGM (a live LLM
 * opponent that is NOT authored by us) both satisfy this — the Council cannot
 * tell which one it is facing, which is the point.
 */
export interface CounterpartyEngine {
  open(): Promise<CounterpartyMove>;
  step(move: CouncilMove): Promise<GmEmission>;
}
