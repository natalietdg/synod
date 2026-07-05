import { readFileSync, writeFileSync } from "node:fs";
import { MockAgents } from "../agents/mock.js";
import { deliberateRound } from "../protocol/round.js";
import { computeContext } from "../protocol/context.js";
import { UNIFORM_PRIOR, updateBelief } from "../belief/update.js";
import { encodeMove } from "../protocol/encode.js";
import { OPENING_ASK } from "../gm/profiles.js";
import type { CounterpartyMove } from "../gm/types.js";

/**
 * THE REAL-TRANSCRIPT RUNG — Synod read against 4,277 REAL human-human negotiations
 * (CraigslistBargain; He et al. 2018 — MTurk workers bargaining over real Craigslist
 * listings, with private targets and recorded outcomes).
 *
 * What this honestly can and cannot claim. A replay cannot claim "Synod would have won
 * more" — changing one move changes the whole trajectory. What it CAN measure, with the
 * humans' own outcomes as ground truth, is AGREEMENT ANALYSIS: in every dialogue where a
 * real seller accepted a buyer's offer, replay the buyer's offers through Synod's engine
 * and ask whether Synod would also have accepted, or dissented (hold out / check first).
 * Then compare the prices the humans actually got in the two groups. If sellers who
 * accepted AGAINST Synod's dissent got systematically worse prices, Synod's dissent flags
 * real fleecings — measured on real humans, not on our worlds.
 *
 * Price mapping (disclosed, fixed): each buyer offer p on a listing L maps linearly into
 * Synod's native band — 0.5·L → $8,000 (the walk-away floor), L → $12,000 (the full ask),
 * clamped to [6500, 13000]. The comparison between groups is invariant to this choice of
 * anchor; only absolute accept rates move with it.
 *
 * Run: npx tsx src/harness/transcripts.ts   (deterministic mock engine — no tokens)
 * Writes public/transcripts.json.
 */

interface Dialogue {
  category: string;
  listing: number;
  buyerTarget: number;
  sellerTarget: number;
  buyerOffers: number[];
  outcome: "deal" | "nodeal";
  dealPrice: number | null;
  finalActor: "seller-accept" | "buyer-accept" | "none";
}

const BAND_LO = 8_000, BAND_SPAN = 4_000;
const mapPrice = (p: number, listing: number): number => {
  const frac = p / listing; // 0.5 → floor, 1.0 → full ask
  const n = BAND_LO + BAND_SPAN * ((frac - 0.5) / 0.5);
  return Math.round(Math.max(6_500, Math.min(13_000, n)));
};

/** Replay a buyer's offer sequence through the canonical loop; return the final action. */
async function synodFinalAction(offers: number[], listing: number): Promise<string> {
  const agents = new MockAgents();
  const mapped = offers.map((p) => mapPrice(p, listing));
  const deadline = Math.max(2, mapped.length);
  let belief = UNIFORM_PRIOR;
  let councilAsk = OPENING_ASK;
  const priorMoves: CounterpartyMove[] = [];
  let action = "hold";
  for (let i = 0; i < mapped.length; i++) {
    const delta = i === 0 ? 0 : mapped[i]! - mapped[i - 1]!;
    const signals = i === 0 ? ["opening"] : delta <= 60 ? ["held_firm"] : delta < 400 ? ["small_concession"] : ["soft_concession"];
    const move: CounterpartyMove = { round: i + 1, message: "", offer: { price: mapped[i]!, features: [] }, signals, terminal: false };
    belief = updateBelief(belief, signals);
    const roundsLeft = Math.max(1, deadline - i);
    const ctx = computeContext(belief, councilAsk, roundsLeft, signals);
    const input = { round: i + 1, move, history: [...priorMoves], belief, ctx, buyerOffer: mapped[i]!, councilAsk };
    const decision = await deliberateRound(agents, input, { scenarioId: "craigslist-replay" });
    action = decision.gate.finalAction;
    const councilMove = encodeMove(decision.gate.finalAction, councilAsk, mapped[i]!, [], []);
    councilAsk = councilMove.ask.price;
    priorMoves.push(move);
  }
  return action;
}

async function main() {
  const data = JSON.parse(readFileSync("data/craigslist-slim.json", "utf8"));
  const dialogues: Dialogue[] = data.dialogues;
  const sellerAccepts = dialogues.filter((d) => d.finalActor === "seller-accept" && d.dealPrice);

  const agree: number[] = [];   // deal price as % of listing, where Synod would also accept
  const dissent: number[] = []; // …where Synod would have held out / checked first
  const dissentActions: Record<string, number> = {};

  let done = 0;
  for (const d of sellerAccepts) {
    const action = await synodFinalAction(d.buyerOffers, d.listing);
    const pct = (d.dealPrice! / d.listing) * 100;
    if (action === "accept") agree.push(pct);
    else { dissent.push(pct); dissentActions[action] = (dissentActions[action] ?? 0) + 1; }
    done += 1;
    if (done % 500 === 0) console.log(`…${done}/${sellerAccepts.length}`);
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const out = {
    source: data.source,
    note: data.note,
    method:
      "Agreement analysis on every dialogue where a REAL seller accepted a buyer's offer: replay the buyer's " +
      "offers through Synod's deterministic engine and split the humans' outcomes by whether Synod would also " +
      "have said yes. No counterfactual claims — the humans' own prices are the only outcomes used.",
    mapping: "buyer offer p on listing L → 8000 + 4000·((p/L − 0.5)/0.5), clamped [6500, 13000]",
    dialoguesTotal: dialogues.length,
    sellerAcceptCases: sellerAccepts.length,
    agree: { n: agree.length, meanPctOfListing: +mean(agree).toFixed(1) },
    dissent: { n: dissent.length, meanPctOfListing: +mean(dissent).toFixed(1), actions: dissentActions },
    deltaPoints: +(mean(agree) - mean(dissent)).toFixed(1),
  };
  writeFileSync("public/transcripts.json", JSON.stringify(out, null, 2));
  console.log(`\nseller-accept cases: ${sellerAccepts.length} of ${dialogues.length} real dialogues`);
  console.log(`Synod AGREES  (would also accept): n=${out.agree.n} · humans got ${out.agree.meanPctOfListing}% of listing`);
  console.log(`Synod DISSENTS (would hold/check): n=${out.dissent.n} · humans got ${out.dissent.meanPctOfListing}% of listing`);
  console.log(`delta: ${out.deltaPoints} points of listing price · dissent actions: ${JSON.stringify(dissentActions)}`);
  console.log("✓ wrote public/transcripts.json");
}

main();
