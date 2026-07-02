import { DOCTRINES, type ContextVector, type DoctrineId, type DoctrinePosition } from "../core/types.js";
import { ACTIONS, type ActionId } from "../core/actions.js";
import { GENERALS, type General } from "./generals.js";

/** Each general OWNS one lens; this is how strongly that lens favors the chosen action.
 *  (Kept as a list for the UI breakdown, but only the owned lens carries any weight.) */
export interface ToolUse {
  lens: DoctrineId;
  /** 1 for the general's owned lens, 0 otherwise — they speak for one faculty only. */
  weight: number;
  /** The owned lens's score on the chosen action this round. */
  contribution: number;
}

/** One general's call on the adversary's move — their temperament applied to the
 *  shared five-lens assessment. */
export interface GeneralCall {
  id: string;
  name: string;
  title: string;
  doctrine: string;
  mandate: string;
  /** What this general's temperament recommends. */
  action: ActionId;
  /** Engine confidence in that call under this general's weighting. */
  confidence: number;
  /** The lens doing the most work in their call (weight_d · score_d on the chosen action). */
  leadLens: DoctrineId;
  /** Every lens ranked by how much it drives this call — which tools they're using, most-first. */
  toolUse: ToolUse[];
  /** Whether their own call matches the council's decision. */
  agreesWithCouncil: boolean;
}

export interface CouncilDeliberation {
  /** The institution's decision — the chair's terrain weighting, not a vote. */
  council: ActionId;
  calls: GeneralCall[];
  /** Generals whose own call differs from the council's — the room's live disagreement. */
  dissenters: GeneralCall[];
}

/** The owned lens's pull, shown as a one-entry breakdown (the general speaks for one
 *  faculty). The owned lens carries weight 1; the rest are listed at 0 for the UI. */
function toolUse(general: General, positions: DoctrinePosition[], action: ActionId): ToolUse[] {
  const byDoctrine = new Map(positions.map((p) => [p.doctrine, p]));
  return DOCTRINES
    .map((d) => ({
      lens: d,
      weight: d === general.lens ? 1 : 0,
      contribution: d === general.lens ? (byDoctrine.get(d)?.scores[action] ?? 0) : 0,
    }))
    .sort((a, b) => b.weight - a.weight || b.contribution - a.contribution);
}

/**
 * The society step (mock). Each general OWNS one lens and is the council's only voice for
 * it; their call is the action that lens favors. The council's decision is the chair's
 * *terrain* weighting (the Arbiter), not a headcount. The gap between a general's call and
 * the council's is the delegation tension made visible: the room advises, the chair decides.
 */
export function deliberateCouncil(
  positions: DoctrinePosition[],
  councilAction: ActionId,
  _ctx: ContextVector,
): CouncilDeliberation {
  const byDoctrine = new Map(positions.map((p) => [p.doctrine, p]));
  const calls: GeneralCall[] = GENERALS.map((general) => {
    const lensPos = byDoctrine.get(general.lens);
    // This general's call = the action their owned lens favors most.
    const action = ACTIONS.reduce((a, b) => ((lensPos?.scores[b] ?? -Infinity) > (lensPos?.scores[a] ?? -Infinity) ? b : a));
    return {
      id: general.id,
      name: general.name,
      title: general.title,
      doctrine: general.doctrine,
      mandate: general.mandate,
      action,
      confidence: lensPos?.confidence ?? 0.5,
      leadLens: general.lens,
      toolUse: toolUse(general, positions, action),
      agreesWithCouncil: action === councilAction,
    };
  });

  return {
    council: councilAction,
    calls,
    dissenters: calls.filter((c) => !c.agreesWithCouncil),
  };
}
