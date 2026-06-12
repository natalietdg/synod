/**
 * The Cardinal — Doctrines as worldviews implemented through a mathematical lens.
 * Build order item #2 (the scoring core). Pure deterministic transforms.
 *
 * PRINCIPLE: the math is only real if it's in CODE, not the prompt. So ONE LLM
 * estimation step fills a shared "estimate sheet" of raw quantities per action;
 * each doctrine is a DETERMINISTIC transform over that sheet. The worldview lives
 * in WHICH numbers a doctrine weights and HOW it transforms them — not a personality.
 *
 * Run:  node --experimental-strip-types doctrines.ts
 */

type Action = "counter_hard" | "counter_soft" | "probe";
type CType = "relationship" | "firm_floor" | "deceptive";

// The ONLY non-deterministic step: the LLM estimates these raw quantities per action.
interface ActionEstimate {
  immediate: number;   // surplus impact THIS round
  future: number;      // positional value: relationship / precedent / optionality
  worst_case: number;  // payoff if it goes badly (they walk / it backfires)
  info_gain: number;   // 0..1 — how much this action reveals about hidden type
}
type EstimateSheet = Record<Action, ActionEstimate>;

// ---- doctrine transforms: each is a worldview as one line of math ----
const doctrine = {
  // Battle — advantage compounds from decisive action. Utility, very low gamma.
  battle: (e: EstimateSheet) => map(e, a => a.immediate + 0.1 * a.future),
  // War — position matters more than outcomes. Same utility, high gamma.
  war: (e: EstimateSheet) => map(e, a => a.immediate + 0.95 * a.future),
  // Risk — survive first. Minimax: judge an action by its worst case.
  risk: (e: EstimateSheet) => map(e, a => a.worst_case),
  // Probe — information is an asset. VOI ~ info_gain scaled by remaining uncertainty.
  probe: (e: EstimateSheet, uncertainty: number) => map(e, a => a.info_gain * uncertainty * 1000),
};

// Empathy — behavior is a symptom of hidden incentives. Bayesian update -> posterior.
// (Empathy's output is the posterior; it FEEDS the others rather than scoring actions.)
function empathyPosterior(prior: Record<CType, number>, likelihood: Record<CType, number>) {
  const post = {} as Record<CType, number>;
  let z = 0;
  for (const t of Object.keys(prior) as CType[]) { post[t] = prior[t] * likelihood[t]; z += post[t]; }
  for (const t of Object.keys(post) as CType[]) post[t] /= z;
  return post;
}
const entropy = (p: Record<CType, number>) =>
  -Object.values(p).reduce((s, x) => s + (x > 0 ? x * Math.log2(x) : 0), 0);

// Arbiter — no worldview, only math. Allocates influence: multi-objective aggregation + confidence.
function arbiter(scores: Record<string, Record<Action, number>>, weights: Record<string, number>) {
  const actions = Object.keys(scores.battle) as Action[];
  const norm: Record<string, Record<Action, number>> = {};
  for (const d of Object.keys(scores)) norm[d] = normalize(scores[d]); // fair weighting
  const U = {} as Record<Action, number>;
  for (const a of actions) U[a] = Object.keys(weights).reduce((s, d) => s + weights[d] * norm[d][a], 0);
  const ranked = [...actions].sort((x, y) => U[y] - U[x]);
  const aStar = ranked[0];
  const margin = U[aStar] - U[ranked[1]];
  const dispersion = Math.sqrt(
    Object.keys(weights).reduce((s, d) => s + weights[d] * (norm[d][aStar] - U[aStar]) ** 2, 0)
  );
  const confidence = 1 / (1 + Math.exp(-(6 * margin - 3 * dispersion))); // logistic(α·margin − β·dispersion)
  return { U, aStar, margin, dispersion, confidence };
}

// ----------------- demo: one situation, five lenses -----------------

// The LLM estimated this sheet once (hardcoded here for the demo):
const sheet: EstimateSheet = {
  counter_hard: { immediate: 400, future: -300, worst_case: -500, info_gain: 0.1 },
  counter_soft: { immediate: 50,  future: 250,  worst_case: 20,   info_gain: 0.2 },
  probe:        { immediate: -50, future: 100,  worst_case: -80,  info_gain: 0.7 },
};

// Empathy reads the evidence ("claims a cheaper competitor + demands a big discount") -> posterior
const posterior = empathyPosterior(
  { relationship: 1 / 3, firm_floor: 1 / 3, deceptive: 1 / 3 },
  { relationship: 0.2, firm_floor: 0.3, deceptive: 0.9 } // deception signature
);
const uncertainty = entropy(posterior) / Math.log2(3); // 0..1

const scores = {
  battle: doctrine.battle(sheet),
  war: doctrine.war(sheet),
  risk: doctrine.risk(sheet),
  probe: doctrine.probe(sheet, uncertainty),
};

console.log("Same estimate sheet. Five worldviews, five mathematical lenses:\n");
for (const [name, s] of [["Battle", scores.battle], ["War", scores.war], ["Risk", scores.risk], ["Probe", scores.probe]] as [string, Record<Action, number>][]) {
  const r = (Object.entries(s) as [Action, number][]).sort((a, b) => b[1] - a[1]);
  console.log(`  ${pad(name, 7)} ${r.map(([a, v]) => `${pad(a, 13)}${v.toFixed(0).padStart(5)}`).join("   ")}   -> ${r[0][0]}`);
}
console.log(`\n  Empathy posterior: ${(Object.entries(posterior) as [CType, number][]).map(([t, p]) => `${t} ${(p * 100).toFixed(0)}%`).join("   ")}   (uncertainty ${(uncertainty * 100).toFixed(0)}%)`);

// Arbiter weights for THIS context (early round, high uncertainty, high exposure):
const w = { battle: 0.1, war: 0.25, probe: 0.4, risk: 0.25 }; // empathy feeds the posterior, so it isn't an action-scorer here
const out = arbiter(scores, w);
console.log(`\n  Arbiter  weights B:${w.battle} W:${w.war} P:${w.probe} R:${w.risk}`);
console.log(`           choice: ${out.aStar}   confidence: ${(out.confidence * 100).toFixed(0)}%   (margin ${out.margin.toFixed(2)}, dispersion ${out.dispersion.toFixed(2)})`);
console.log(`\n  Battle wanted counter_hard. War wanted counter_soft. Same numbers, opposite calls — purely from γ.`);
console.log(`  Thin margin + high dispersion => low confidence => the system probes instead of committing. That's the deadlock rule firing.`);

// ---- helpers ----
function map(e: EstimateSheet, f: (a: ActionEstimate) => number): Record<Action, number> {
  const o = {} as Record<Action, number>;
  for (const k of Object.keys(e) as Action[]) o[k] = f(e[k]);
  return o;
}
function normalize(s: Record<Action, number>): Record<Action, number> {
  const v = Object.values(s); const lo = Math.min(...v), hi = Math.max(...v);
  const o = {} as Record<Action, number>;
  for (const k of Object.keys(s) as Action[]) o[k] = hi === lo ? 0.5 : (s[k] - lo) / (hi - lo);
  return o;
}
function pad(s: string, n: number) { return (s + " ".repeat(n)).slice(0, n); }
