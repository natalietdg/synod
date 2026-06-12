/**
 * Phrases a counterparty move in character (spec §7: the LLM renders language
 * only). Kept deterministic and templated here so runs are fully reproducible;
 * a live LLM could substitute richer phrasing without touching any transition.
 *
 * Crucially, the wording never names the hidden type — it only expresses the
 * outward facts the Council is already allowed to see.
 */
export interface MoveNarrative {
  round: number;
  price: number;
  movedUp: number; // how much the offer rose this round
  revealedCompetitor: boolean;
  revealedNeed: string | null;
  deceived: boolean;
  councilConcededNeed: boolean;
}

export function phraseMove(n: MoveNarrative): string {
  const parts: string[] = [];

  if (n.councilConcededNeed) parts.push("Appreciate you including that — it helps.");

  if (n.revealedNeed) {
    parts.push(`Honestly, ${n.revealedNeed} is the part we actually can't do without.`);
  }
  if (n.revealedCompetitor) {
    parts.push("And I'll be straight with you, we do have another vendor in the conversation.");
  }

  if (n.deceived) {
    parts.push("Budget's genuinely tight on our side this quarter.");
  }

  if (n.movedUp > 250) parts.push(`We can come up to $${n.price.toLocaleString()}.`);
  else if (n.movedUp > 0) parts.push(`I can nudge us to $${n.price.toLocaleString()}, but that's a stretch.`);
  else parts.push(`We're still at $${n.price.toLocaleString()} — that's where we are.`);

  return parts.join(" ");
}

export function openingMessage(price: number): string {
  return `Thanks for the proposal. Where we're landing is about $${price.toLocaleString()} — can we make that work?`;
}
