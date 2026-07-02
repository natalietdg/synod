import { type DoctrineId } from "../core/types.js";

/**
 * The war council as an agent society that DIVIDES JUDGMENT INTO ITS FACULTIES. Each
 * general OWNS exactly one lens — one criterion of judgment — and is the only agent who
 * speaks for it: Patton owns Pressure (what wins now), Sun Tzu owns Probe (what to learn),
 * Kutuzov owns Hedge (what if we're wrong), Eisenhower owns Trust (read their intent),
 * Zhukov owns Frame (the long game). A neutral chair integrates the five faculties by
 * terrain. This divides JUDGMENT (the criteria), not LABOR (the tasks) — and it gives each
 * agent a genuinely distinct capability: remove Sun Tzu and the council loses recon.
 *
 * The figures are an all-time council, not a historical meeting. Each ownership is grounded
 * in the general's DOCUMENTED reputation (Sun Tzu → reconnaissance, Patton → assault) — it
 * is reputational shorthand, not a claim about anything they said. Their lines come from the
 * real engine reasoning in character, never fabricated quotes.
 */
export interface General {
  id: string;
  name: string;
  /** Their seat / mandate in the room. */
  title: string;
  /** One-line doctrine — the worldview their lens encodes. */
  doctrine: string;
  /** Delegated authority: the scope this seat is trusted to decide within. */
  mandate: string;
  /** The ONE lens (judgment faculty) this general owns and speaks for — their distinct
   *  capability. Each lens is owned by exactly one general (a bijection). */
  lens: DoctrineId;
}

// Lens ids, for reference while reading the lens ownership below:
//   battle = Pressure   war = Frame   empathy = Trust   probe = Probe   risk = Hedge
export const GENERALS: General[] = [
  {
    id: "patton",
    name: "Patton",
    title: "Field commander",
    doctrine: "Press the advantage now — momentum is everything, hesitation is defeat.",
    mandate: "May press for maximal terms; may not break off the talks without the chair.",
    lens: "battle",
  },
  {
    id: "zhukov",
    name: "Zhukov",
    title: "Mass & decisive force",
    doctrine: "Concentrate force and accept the near-term cost for an irreversible result.",
    mandate: "May commit to decisive terms, trading present exposure for a settled outcome.",
    lens: "war",
  },
  {
    id: "eisenhower",
    name: "Eisenhower",
    title: "Supreme allied chair",
    doctrine: "The peace has to hold — don't humiliate them into the next war.",
    mandate: "Holds coalition cohesion; weighs the durability of any settlement above the margin.",
    lens: "empathy",
  },
  {
    id: "sun-tzu",
    name: "Sun Tzu",
    title: "Intelligence & deception",
    doctrine: "Know the enemy — test the claim before you yield to it.",
    mandate: "Owns reconnaissance; may demand verification before any concession is made.",
    lens: "probe",
  },
  {
    id: "kutuzov",
    name: "Kutuzov",
    title: "Patient attritionist",
    doctrine: "Never gamble the army on one round — trade space, preserve the force.",
    mandate: "Guards the force; may trade ground but never the army's survival.",
    lens: "risk",
  },
];

export const getGeneral = (id: string): General | undefined => GENERALS.find((g) => g.id === id);

/** The general who OWNS a lens — its sole voice in the room (Pressure → Patton, Probe →
 *  Sun Tzu, Hedge → Kutuzov, Trust → Eisenhower, Frame → Zhukov). One owner per lens. */
export const generalForLens = (lens: DoctrineId): General =>
  GENERALS.find((g) => g.lens === lens) ?? GENERALS[0]!;

/**
 * War-room skin for the action set. Same closed action set the engine scores —
 * only the framing changes, so the deterministic spine is untouched.
 */
export const WAR_ACTIONS: Record<string, string> = {
  accept: "Sign on their terms",
  counter_hard: "Press — demand more",
  counter_soft: "Soften the demand",
  hold: "Hold the line",
  probe: "Demand verification — call the bluff",
  concede_term: "Trade a non-territorial term",
  walk: "Break off — resume hostilities",
};
