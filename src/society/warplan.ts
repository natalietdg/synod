import { type DoctrineId, LENSES } from "../core/types.js";
import { GENERALS, type General } from "./generals.js";
import type { QwenAgents } from "../agents/qwen.js";

/**
 * The operational order — the complex task the society accomplishes AFTER it decides.
 *
 * The decision ("hold the line", "press", "probe") is one action; executing it is a
 * multi-division plan. This skill DECOMPOSES that plan into divisions and ASSIGNS each to
 * the general whose doctrine fits — security to the presser, intelligence to the prober,
 * food & logistics to the attritionist, medical & rescue to the coalition-builder,
 * reconstruction to the strategist. Each general drafts their division (a Qwen call), all
 * consistent with the chair's directive; the result is a single signed order.
 *
 * This is the Track-3 loop made literal: task division → role assignment → (the prior
 * deliberation resolved the conflict) → a complex deliverable. And it's a genuine
 * multi-step Qwen skill (N section calls), not one prompt.
 */
export interface Division {
  lens: DoctrineId;
  title: string;
  brief: string;
}

/** The task is an EXPRESSION OF THE CAPABILITY: each division is the natural next-action of
 *  the lens that owns it — Probe→reconnaissance, Trust→relationship, Pressure→leverage,
 *  Hedge→contingency, Frame→end-state. Not arbitrary departments; the same faculty that
 *  argued the decision is now responsible for executing its part of it. */
export const DIVISIONS: Division[] = [
  { lens: "probe", title: "Reconnaissance & verification", brief: "Own the information the decision hinges on: what must be verified, and the scouting that confirms or breaks the adversary's claim." },
  { lens: "empathy", title: "Back-channel & relationship", brief: "Own the relationship: read what the other side actually needs and keep a credible path to settlement open." },
  { lens: "battle", title: "Leverage & escalation", brief: "Own the initiative: the leverage and escalation options that hold or improve our position." },
  { lens: "risk", title: "Contingency & defensive posture", brief: "Own the downside: the fallback and defensive posture if the read turns out to be wrong." },
  { lens: "war", title: "End-state & political position", brief: "Own the long game: the durable settlement and political position this move must set up." },
];

export interface PlanSection {
  lens: DoctrineId;
  cog: string;
  title: string;
  brief: string;
  general: string;
  why: string;            // why the chair assigned this officer to this division
  reasoning: string;      // how this officer's lens reads the division (the judgment)
  objective: string;      // the division's objective, one line
  tasks: string[];        // the concrete tasks the officer allocates (the breakdown)
  ok: boolean; // false if this division's draft failed (graceful degradation)
}

export interface WarPlan {
  directive: string;      // the chair's standing call, which every division serves
  assignedBy: "chair" | "fallback"; // who decomposed + assigned (agent vs deterministic)
  sections: PlanSection[];
  authored: number;       // how many divisions drafted successfully
}

/**
 * Run the order. Each division is drafted in parallel by its assigned general. A failed
 * division degrades gracefully to a placeholder rather than sinking the whole order — the
 * order is still issued with the divisions that succeeded.
 */
interface Assignment { title: string; brief: string; lens: DoctrineId; general: General; why: string }

/** The capability→task coupling is FIXED, by design: each division goes to the general who
 *  OWNS its lens (a clean bijection). "Probe always owns reconnaissance" — the task is an
 *  expression of the lens, not a runtime reshuffle, so the general who argued the decision
 *  is the one responsible for executing its part. The dynamic part is which generals get
 *  convened (adaptive participation) and what each one drafts for THIS situation, live. */
function fixedAssignment(onlyLenses?: DoctrineId[]): Assignment[] {
  const allow = onlyLenses ? new Set(onlyLenses) : null;
  return DIVISIONS.filter((d) => !allow || allow.has(d.lens)).map((d) => {
    const general = GENERALS.find((g) => g.lens === d.lens) ?? GENERALS[0]!;
    return { title: d.title, brief: d.brief, lens: d.lens, general, why: `${general.name} owns the ${LENSES[d.lens].cogFunction} lens.` };
  });
}

export async function runWarPlan(
  qwen: QwenAgents,
  decision: { directive: string },
  moveText: string,
  onlyLenses?: DoctrineId[], // only these lenses contribute — removed/benched generals are absent
): Promise<WarPlan> {
  const finalAssignments = fixedAssignment(onlyLenses);

  const sections = await Promise.all(
    finalAssignments.map(async (a): Promise<PlanSection> => {
      const base = { lens: a.lens, cog: LENSES[a.lens].cogFunction, title: a.title, brief: a.brief, general: a.general.name, why: a.why };
      try {
        const out = await qwen.generalSection(
          { name: a.general.name, doctrine: a.general.doctrine },
          { title: a.title, brief: a.brief },
          decision.directive,
          moveText,
        );
        // Keep only non-empty tasks; the order shows a real breakdown, not blanks.
        const tasks = (out.tasks ?? []).map((t) => t.trim()).filter(Boolean);
        return { ...base, reasoning: out.reasoning, objective: out.objective ?? "", tasks, ok: true };
      } catch {
        return { ...base, reasoning: "(division could not file orders this cycle)", objective: "", tasks: [], ok: false };
      }
    }),
  );
  return { directive: decision.directive, assignedBy: "chair", sections, authored: sections.filter((s) => s.ok).length };
}
