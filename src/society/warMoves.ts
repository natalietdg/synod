/** The war room's adversary openings — one war-skinned move per counterparty type, shared
 *  by the server (mock + live rooms) and the debate-causality harness so every consumer
 *  faces the identical move. */
export const WAR_MOVES: Record<string, { move: string; label: string }> = {
  "type-c-deceptive": {
    label: "A bluffed threat",
    move:
      "We hold the eastern bank — and there are reserves we haven't shown you. " +
      "Pull your line back to the river, or the ceasefire ends Thursday.",
  },
  "type-b-soft-floor": {
    label: "A firm red line",
    move:
      "We can talk about everything else, but the river crossing stays ours — that is not " +
      "posturing, it is the one line our command will not move. Bring us terms that respect it.",
  },
  "type-a-relationship": {
    label: "An ally worth keeping",
    move:
      "We both know this ceasefire is worth more than any single position. We're prepared to " +
      "give ground on the checkpoints — but if you humiliate us at the table, our coalition walks.",
  },
};
