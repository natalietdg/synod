import { GameMaster } from "../gm/gameMaster.js";
import { runNegotiation } from "../protocol/loop.js";
import { EVAL_SUITE } from "../suite.js";
import { COUNTERPARTY_TYPES, type CounterpartyType } from "../core/types.js";
import type { DeliberationAgents } from "../agents/index.js";

export interface CalibrationReport {
  /** confusion[trueType][predictedType] = count (predicted = argmax of terminal posterior) */
  confusion: Record<CounterpartyType, Record<CounterpartyType, number>>;
  accuracy: number;
  /** Mean probability mass the terminal posterior puts on the TRUE type. */
  meanPTrue: number;
  n: number;
  note: string;
}

/**
 * Belief calibration (the confusion matrix a skeptic asks for): run the scripted
 * suite, take the terminal posterior's argmax as the classification, score it
 * against ground truth. Published with its errors: belief accuracy in Synod is
 * INSTRUMENTAL, not terminal — the system buys exactly the distinctions that
 * change the optimal action. Soft-floor and relationship counterparties behave
 * identically until someone pushes hard enough to expose the floor, and the
 * council's cooperative play means it often never pays for that evidence — a
 * confusion that costs it almost nothing in surplus.
 */
export async function runCalibration(
  agents: DeliberationAgents,
  nSeeds = 10,
): Promise<CalibrationReport> {
  const confusion = {} as CalibrationReport["confusion"];
  for (const t of COUNTERPARTY_TYPES) {
    confusion[t] = Object.fromEntries(COUNTERPARTY_TYPES.map((u) => [u, 0])) as Record<CounterpartyType, number>;
  }
  let sumPTrue = 0;
  let correct = 0;
  let runs = 0;

  for (const entry of EVAL_SUITE) {
    for (let i = 0; i < nSeeds; i++) {
      const gm = new GameMaster(entry.type, entry.seed + i * 997);
      const res = await runNegotiation(agents, gm, entry.id, entry.type);
      const finalBelief = res.beliefTrajectory.at(-1)!.belief;
      const predicted = COUNTERPARTY_TYPES.reduce((a, b) => (finalBelief[b] > finalBelief[a] ? b : a));
      confusion[entry.type]![predicted] += 1;
      if (predicted === entry.type) correct += 1;
      sumPTrue += finalBelief[entry.type];
      runs += 1;
    }
  }

  return {
    confusion,
    accuracy: correct / runs,
    meanPTrue: sumPTrue / runs,
    n: runs,
    note:
      "Belief accuracy is instrumental, not terminal: confusions concentrate between " +
      "types whose optimal play overlaps (soft_floor ↔ relationship), because the " +
      "distinguishing evidence only exists if you pay to provoke it.",
  };
}
