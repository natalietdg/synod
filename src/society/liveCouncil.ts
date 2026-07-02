import { ACTIONS, ACTION_LABELS, type ActionId } from "../core/actions.js";
import { DOCTRINES, LENSES, type DoctrineId, type DoctrinePosition, type ArbiterVerdict, type ContextVector } from "../core/types.js";
import { score } from "../engine/scoring.js";
import { GENERALS, WAR_ACTIONS, type General } from "./generals.js";
import type { QwenAgents } from "../agents/qwen.js";

/**
 * The war room, LIVE — a genuine multi-round deliberation among five Qwen agents. Each
 * general is an independent agent: round 1 they read the move through their own five
 * lenses (weighted by their temperament) and call an action. Then they DELIBERATE — every
 * round, every general sees the whole room and argues in character, and may CHANGE their
 * call if a colleague genuinely moved them. The room keeps going until it converges (or
 * stops moving), capped by the Arbiter reading the terrain. The chair then decides by
 * terrain. We record each general's progression, the whole room's split per round, and
 * which lens is leading each general — so you can watch the room, and the lenses, move.
 */
const wAction = (a: ActionId) => WAR_ACTIONS[a] ?? ACTION_LABELS[a];

export interface DelibTurn {
  id: string; name: string;
  call: ActionId; label: string;
  leadLens: DoctrineId; lead: string;
  line: string;
  changedFrom?: ActionId;     // set when this general moved this round
  lensMovedFrom?: DoctrineId;  // set when the lens leading them changed
}
export interface DelibRound {
  round: number;
  kind: "positions" | "deliberation";
  turns: DelibTurn[];
  split: Array<{ action: ActionId; label: string; count: number }>;
  lensTally: Array<{ lens: DoctrineId; cog: string; count: number }>;
}
export interface LiveProceedings {
  generals: Array<{ id: string; name: string; title: string; action: ActionId; label: string; lead: string; leadLens: DoctrineId; voice: string; agreesWithCouncil: boolean }>;
  council: ActionId; councilLabel: string;
  /** Generals the chair did NOT convene for this situation (adaptive participation). */
  benched: Array<{ id: string; name: string; lens: DoctrineId; lensName: string; why: string }>;
  convenedNote: string;
  dissenters: string[];
  deliberation: {
    cap: number; rounds: DelibRound[]; stopReason: "consensus" | "stable" | "cap";
    changedCall: boolean; round1Call: ActionId; round1Label: string; finalLabel: string;
  };
  why: string;
  live: true;
}

export interface Terrain {
  arbiterWeights: ArbiterVerdict["weights"];
  ctx: ContextVector;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The Arbiter caps how long the room may deliberate, read from the terrain: the more
 *  unresolved the situation (low info, high exposure), the more rounds it grants — bounded.
 *  This is the "limit set by the arbiter" — deterministic, from the same terrain the chair
 *  weighs. (min 2, max 5 deliberation rounds.) */
export function deliberationCap(ctx: ContextVector): number {
  const unresolved = (1 - ctx.infoConfidence) * 0.6 + ctx.exposure * 0.4; // [0,1]
  return Math.max(2, Math.min(5, 2 + Math.round(unresolved * 3)));
}

/**
 * ADAPTIVE PARTICIPATION — the chair convenes only the specialists THIS situation calls
 * for, so the society isn't always the same five-person committee. A lens is convened when
 * the chair's terrain weighting makes it matter (≥ half the weight of the most-relevant
 * lens); the rest sit the call out. The count varies with the situation — a calm, certain
 * call convenes few; an uncertain, high-stakes one convenes all five — which is what makes
 * it feel like a live society, not a fixed panel. (Always at least the two most-relevant.)
 */
export function selectConvened(weights: ArbiterVerdict["weights"]): DoctrineId[] {
  const max = Math.max(...DOCTRINES.map((d) => weights[d]));
  const threshold = max * 0.5;
  let convened = DOCTRINES.filter((d) => weights[d] >= threshold);
  if (convened.length < 2) {
    convened = [...DOCTRINES].sort((a, b) => weights[b] - weights[a]).slice(0, 2);
  }
  return convened;
}

const splitOf = (turns: DelibTurn[]) => {
  const counts = {} as Record<ActionId, number>;
  for (const t of turns) counts[t.call] = (counts[t.call] ?? 0) + 1;
  return (Object.keys(counts) as ActionId[])
    .sort((a, b) => counts[b] - counts[a])
    .map((action) => ({ action, label: wAction(action), count: counts[action] }));
};
const lensTallyOf = (turns: DelibTurn[]) => {
  const counts = {} as Record<DoctrineId, number>;
  for (const t of turns) counts[t.leadLens] = (counts[t.leadLens] ?? 0) + 1;
  return DOCTRINES.filter((d) => counts[d]).sort((a, b) => counts[b] - counts[a])
    .map((lens) => ({ lens, cog: LENSES[lens].cogFunction, count: counts[lens] }));
};

/** Each general OWNS one lens, so the assessment is built directly: lens d's position is
 *  the read of the general who owns d (no averaging — one voice per faculty). The favored
 *  action carries that lens's intensity; the chair then weights the five by terrain. */
function positionsFromReads(reads: Array<{ g: General; read: { action: ActionId; intensity: number } }>): DoctrinePosition[] {
  const byLens = new Map<DoctrineId, { action: ActionId; intensity: number }>();
  for (const r of reads) byLens.set(r.g.lens, r.read);
  return DOCTRINES.map((d) => {
    const r = byLens.get(d);
    const scores = {} as Record<ActionId, number>;
    for (const a of ACTIONS) scores[a] = 0;
    if (r && ACTIONS.includes(r.action)) scores[r.action] = clamp01(r.intensity);
    return { doctrine: d, scores, confidence: r ? clamp01(r.intensity) : 0, rationale: `Live ${LENSES[d].cogFunction} read${r ? "" : " (faculty absent)"}.`, reasoning: "" };
  });
}

export async function runLiveCouncil(qwen: QwenAgents, moveText: string, terrain: Terrain, exclude: DoctrineId[] = []): Promise<LiveProceedings> {
  // REMOVING A GENERAL: zero that lens's weight (renormalized over the rest) so the chair
  // decides WITHOUT that faculty — the removal is causal, not cosmetic, and it's the same
  // terrain the chair otherwise weighs. Removed generals never read, never deliberate.
  const excluded = new Set(exclude);
  const weights = { ...terrain.arbiterWeights };
  for (const d of excluded) weights[d] = 0;
  const tot = DOCTRINES.reduce((s, d) => s + weights[d], 0) || 1;
  for (const d of DOCTRINES) weights[d] = weights[d] / tot;
  // The war room runs ONE situation, so an auto "adaptive" bench would drop the same two
  // lenses every time — which reads as a fixed panel, not a live one. So here the ONLY
  // benching is an explicit removal: convene everyone the user didn't remove. (The
  // "different situation calls a different set" claim is shown honestly by the switch-off
  // matrix across counterparty types, not by pretending one fixed situation varies.)
  const convenedLenses = new Set(DOCTRINES.filter((d) => !excluded.has(d)));
  const convenedGenerals = GENERALS.filter((g) => convenedLenses.has(g.lens));
  const benched = GENERALS.filter((g) => excluded.has(g.lens)).map((g) => ({
    id: g.id, name: g.name, lens: g.lens, lensName: LENSES[g.lens].cogFunction,
    why: "you removed this general",
  }));

  // Round 1 — POSITIONS: each CONVENED general reads the move through their owned lens.
  const reads = await Promise.all(
    convenedGenerals.map(async (g) => {
      const read = await qwen.generalRead({ name: g.name, title: g.title, doctrine: g.doctrine, lens: g.lens }, moveText);
      return { g, read: { action: read.action, intensity: read.intensity }, call: read.action, leadLens: g.lens, line: read.voice };
    }),
  );
  // Mutable current state per general; we snapshot it into rounds as the room moves.
  const state = reads.map((r) => ({ g: r.g, call: r.call, leadLens: r.leadLens, line: r.line }));
  const snapshot = (kind: DelibRound["kind"], round: number, prev?: typeof state): DelibRound => {
    const turns: DelibTurn[] = state.map((s, i) => ({
      id: s.g.id, name: s.g.name, call: s.call, label: wAction(s.call),
      leadLens: s.leadLens, lead: LENSES[s.leadLens].cogFunction, line: s.line,
      changedFrom: prev && prev[i]!.call !== s.call ? prev[i]!.call : undefined,
      lensMovedFrom: prev && prev[i]!.leadLens !== s.leadLens ? prev[i]!.leadLens : undefined,
    }));
    return { round, kind, turns, split: splitOf(turns), lensTally: lensTallyOf(turns) };
  };

  const rounds: DelibRound[] = [snapshot("positions", 1)];

  // DELIBERATION — every general argues each round and may move; until convergence or cap.
  const cap = deliberationCap(terrain.ctx);
  let stopReason: LiveProceedings["deliberation"]["stopReason"] = "cap";
  for (let r = 2; r <= cap; r++) {
    const prev = state.map((s) => ({ ...s }));
    const room = state.map((s) => ({ name: s.g.name, call: s.call, line: s.line }));
    const reactions = await Promise.all(
      state.map((s) => qwen.generalReact(
        { name: s.g.name, title: s.g.title, doctrine: s.g.doctrine, lens: s.g.lens },
        s.call, room, moveText, r,
      )),
    );
    // Each general owns a fixed lens, so only their CALL can move across rounds, never their lens.
    reactions.forEach((re, i) => { state[i]!.call = re.call; state[i]!.line = re.argument; });
    rounds.push(snapshot("deliberation", r, prev));

    // The room is still moving if any general changed their call (their lens is fixed).
    const moved = state.some((s, i) => s.call !== prev[i]!.call);
    const consensus = new Set(state.map((s) => s.call)).size === 1;
    if (consensus) { stopReason = "consensus"; break; }
    if (!moved) { stopReason = "stable"; break; } // a round where nothing moved → settled
  }

  // The chair decides by TERRAIN over the five owned-lens reads AS THEY STAND AFTER THE
  // DEBATE — each general's FINAL call (carrying their round-1 conviction). So the
  // deliberation is load-bearing: a general changed by a colleague shifts their lens's vote,
  // which can change the chair's decision. (Principled weighting, not a headcount.)
  // We score the round-1 reads TOO, purely to record whether the debate actually changed the
  // call — proof the dialogue is causal, not decoration (or an honest null if it didn't).
  const engineR1 = score(positionsFromReads(reads.map((r) => ({ g: r.g, read: r.read }))), weights);
  const finalReads = state.map((s, i) => ({ g: s.g, read: { action: s.call, intensity: reads[i]!.read.intensity } }));
  const engine = score(positionsFromReads(finalReads), weights);
  const council = engine.recommendation;
  const debateChangedCall = engineR1.recommendation !== council;

  const generals = state.map((s) => ({
    id: s.g.id, name: s.g.name, title: s.g.title,
    action: s.call, label: wAction(s.call),
    lead: LENSES[s.leadLens].cogFunction, leadLens: s.leadLens, voice: s.line,
    agreesWithCouncil: s.call === council,
  }));
  const dissenters = generals.filter((x) => !x.agreesWithCouncil);

  const finalSplit = rounds[rounds.length - 1]!.split;
  const roomLeaning = finalSplit[0];
  const why = roomLeaning && roomLeaning.action !== council
    ? `After ${rounds.length} rounds the room leaned <b>${roomLeaning.label}</b> (${roomLeaning.count}/5), ` +
      `but the chair, weighing the terrain (intel ${Math.round(terrain.ctx.infoConfidence * 100)}%, exposure ` +
      `${Math.round(terrain.ctx.exposure * 100)}%), holds to <b>${wAction(council)}</b>. The room argues; the chair decides on the terrain.`
    : `The room deliberated to <b>${wAction(council)}</b>, and the terrain agrees.`;

  return {
    generals, council, councilLabel: wAction(council),
    benched,
    convenedNote: excluded.size
      ? `You removed ${GENERALS.filter((g) => excluded.has(g.lens)).map((g) => g.name).join(" and ")}. The council decided this call — and wrote the plan — without that faculty.`
      : `All five generals convened. Remove one above to watch the council decide without that faculty.`,
    dissenters: dissenters.map((x) => x.id),
    deliberation: {
      cap, rounds, stopReason,
      // Did the debate move the chair's call vs. round-1 positions? Causality, recorded.
      changedCall: debateChangedCall,
      round1Call: engineR1.recommendation, round1Label: wAction(engineR1.recommendation),
      finalLabel: wAction(council),
    },
    why, live: true,
  };
}
