import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { selectAgents } from "./agents/index.js";
import { MockAgents } from "./agents/mock.js";
import { runNegotiation } from "./protocol/loop.js";
import { runBaseline } from "./harness/baseline.js";
import { runAbComparison } from "./harness/ab.js";
import { runAblation, withoutProbeLens, withSingleLens, withLensOff, runGeneralBench } from "./harness/ablation.js";
import { runReproduce } from "./reproduce.js";
import { MCP_TOOLS, invokeMcpTool } from "./mcp-catalog.js";
import { setPolicyOverride, FIXED_POLICY } from "./engine/policy.js";
import { runHoldout } from "./harness/holdout.js";
import { runCalibration } from "./harness/calibration.js";
import { GameMaster } from "./gm/gameMaster.js";
import { QwenAdversaryGM } from "./gm/qwenAdversary.js";
import { HumanGM, type HumanMove } from "./gm/humanGM.js";
import { QwenSpeaker, TemplateSpeaker } from "./gm/speaker.js";
import { OPENING_ASK, ROUND_CAP, profileOf, type TypeProfile } from "./gm/profiles.js";
import { isTerminal } from "./gm/types.js";
import { deliberateRound } from "./protocol/round.js";
import { computeContext } from "./protocol/context.js";
import { UNIFORM_PRIOR, updateBelief } from "./belief/update.js";
import type { CounterpartyMove } from "./gm/types.js";
import type { RoundInput } from "./agents/index.js";
import { QwenGovernor } from "./dotto/governor.js";
import { receiptStore } from "./dotto/store.js";
import { SUITE, EVAL_SUITE, getEntry } from "./suite.js";
import { HOLDOUT_WORLDS } from "./gm/holdout.js";
import { ANAC_TACTICS, AnacGameMaster } from "./gm/anacBaselines.js";
import { deliberateCouncil } from "./society/council.js";
import { runWargame } from "./society/wargame.js";
import { GENERALS, WAR_ACTIONS, generalForLens } from "./society/generals.js";
import { runLiveCouncil } from "./society/liveCouncil.js";
import { runWarPlan } from "./society/warplan.js";
import { QwenAgents } from "./agents/qwen.js";

// The war room's adversary openings live in society/warMoves.ts (shared with the
// debate-causality harness so every consumer faces the identical move).
import { WAR_MOVES } from "./society/warMoves.js";
const WAR_MOVE = WAR_MOVES["type-c-deceptive"]!.move;
import { LENSES, TYPE_META, DOCTRINES } from "./core/types.js";
import { ACTION_LABELS, ACTIONS, type ActionId } from "./core/actions.js";
import { encodeMove } from "./protocol/encode.js";
import type { DeliberationEvent } from "./protocol/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT ?? 4173);

/** The commit the evaluation ran on — a verifiable provenance stamp. */
const BUILD_COMMIT = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: join(__dirname, ".."), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Per-event pacing so the deliberation reads as a live negotiation in the UI. */
const EVENT_DELAY: Partial<Record<DeliberationEvent["type"], number>> = {
  "round-start": 650,
  belief: 450,
  intent: 400,
  position: 280,
  challenge: 420,
  evi: 350,
  arbiter: 450,
  engine: 400,
  quant: 350,
  gate: 350,
  "council-move": 600,
  terminal: 500,
};

const app = express();
const agents = selectAgents();

app.use(express.static(PUBLIC_DIR));
app.use(express.json());

/**
 * Human-in-the-loop plumbing: an SSE negotiation that needs the human's move
 * emits a "your-move" event carrying a session id and parks a resolver here;
 * the browser answers with POST /api/human-move, which resumes the loop.
 */
const humanWaiters = new Map<string, (mv: HumanMove) => void>();

app.post("/api/human-move", (req, res) => {
  const { sessionId, ...mv } = (req.body ?? {}) as HumanMove & { sessionId?: string };
  const waiter = humanWaiters.get(String(sessionId));
  if (!waiter) {
    res.status(404).json({ error: "no negotiation waiting on this session" });
    return;
  }
  humanWaiters.delete(String(sessionId));
  waiter(mv);
  res.json({ ok: true });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    provider: agents.kind,
    models: agents.kind === "qwen"
      ? { judgment: process.env.QWEN_MODEL ?? "qwen-max", fast: process.env.QWEN_MODEL_FAST ?? "qwen-turbo" }
      : null,
    // Provenance: who authored each side of the evaluation, frozen on which commit.
    provenance: {
      commit: BUILD_COMMIT,
      holdoutAuthor: "Claude (Anthropic) — a different model and lab than Qwen, which the system runs on",
      holdoutFrozen: "authored and committed before evaluation; see src/gm/holdout.ts",
      baseline: "strong single-agent persona — same action set, move encoding, GM, and seed as the council; only the council structure is removed",
      seeds: "fixed schedule (entry.seed + i·997), n=10 per type",
      determinism: "engine, belief update, EVI, Quant, gate are pure code — never an LLM",
    },
    // GM modes: deterministic (watch; the reproducible default), human (YOU play the
    // counterparty and try to deceive the council), duel (YOU negotiate against the
    // same GM + seed, then your result is compared to Synod's and the baseline's),
    // adversary (Qwen plays the counterparty; requires a live provider).
    gmModes: ["deterministic", "human", "duel", ...(agents.kind === "qwen" ? ["adversary", "freetext"] : [])],
    lenses: LENSES,
    actionLabels: ACTION_LABELS,
    types: TYPE_META,
    suite: SUITE.map((s) => ({ id: s.id, title: s.title, punishes: s.punishes, dropdownLabel: s.dropdownLabel, whenToUse: s.whenToUse })),
  });
});

/**
 * The composer: turn the user's dials into a counterparty profile. Returns null
 * when no custom params are present (the normal preset path). Base is the soft-floor
 * profile; only the dialed fields are overridden, each clamped to a sane range.
 */
function buildCustomProfile(q: Record<string, unknown>): TypeProfile | null {
  const keys = ["reservation", "deception", "patience", "competitor"] as const;
  if (!keys.some((k) => q[k] != null)) return null;
  const base = { ...profileOf("soft_floor") };
  const num = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const reservation = num(q.reservation, 6_500, 14_000, base.reservation);
  base.reservation = reservation;
  base.deception = num(q.deception, 0, 90, base.deception);
  base.initialPatience = num(q.patience, 2, 6, base.initialPatience);
  base.competitorInPlay = q.competitor === "1" || q.competitor === "true";
  // Keep the opening offer and firm floor consistent with the chosen ceiling.
  base.openingOffer = Math.min(base.openingOffer, reservation - 500);
  if (base.firmFloorOffer) base.firmFloorOffer = Math.min(base.firmFloorOffer, reservation);
  return base;
}

/** Stream one negotiation as Server-Sent Events. */
app.get("/api/negotiate", async (req, res) => {
  const entry = getEntry(String(req.query.scenario ?? "")) ?? SUITE[0]!;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const isLive = agents.kind === "qwen";
  const speaker = isLive ? new QwenSpeaker() : new TemplateSpeaker();
  const governor = isLive ? new QwenGovernor() : undefined;
  const mode = String(req.query.gm ?? "deterministic");
  // Pacing control: 1× for the lean-back demo, 2×/4× when a judge wants to drive.
  const speed = Math.max(1, Math.min(4, Number(req.query.speed) || 1));
  // The causal lever: ?ablate=probe reruns with the EVI probe gate removed —
  // same seed, same counterparty, one mechanism missing.
  const negotiationAgents = req.query.ablate === "probe" ? withoutProbeLens(agents) : agents;

  const send = (obj: unknown): void => { res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const sessionId = randomUUID();
  const waitForHuman = (payload: object): Promise<HumanMove> =>
    new Promise((resolve) => {
      humanWaiters.set(sessionId, resolve);
      send({ type: "your-move", sessionId, ...payload });
    });
  // If the browser goes away mid-wait, unwind the parked loop as a walk.
  res.on("close", () => {
    const waiter = humanWaiters.get(sessionId);
    if (waiter) { humanWaiters.delete(sessionId); waiter({ action: "walk" }); }
  });

  try {
    if (mode === "adversary" && !isLive) {
      throw new Error("Adversary GM requires LLM_PROVIDER=qwen — the counterparty is a live model.");
    }

    if (mode === "duel") {
      // YOU are the seller against the same deterministic GM + seed; Synod and the
      // strong baseline then run the identical negotiation for the comparison.
      const gm = new GameMaster(entry.type, entry.seed, speaker);
      let councilAsk = OPENING_ASK;
      let conceded: string[] = [];
      let move = await gm.open();
      send({ type: "round-start", round: move.round, move });
      await sleep(400 / speed);
      let terminal = null;
      while (!terminal) {
        const mv = await waitForHuman({
          kind: "seller",
          round: move.round,
          roundsLeft: ROUND_CAP - move.round + 1,
          theirOffer: move.offer.price,
          yourAsk: councilAsk,
          features: move.offer.features,
        });
        const action = (ACTIONS as readonly string[]).includes(mv.sellerAction ?? "")
          ? (mv.sellerAction as ActionId)
          : "hold";
        const councilMove = encodeMove(action, councilAsk, move.offer.price, move.offer.features, conceded);
        conceded = councilMove.ask.features;
        councilAsk = councilMove.ask.price;
        send({ type: "council-move", move: councilMove });
        await sleep(300 / speed);
        const emission = await gm.step(councilMove);
        if (isTerminal(emission)) {
          terminal = emission;
          send({ type: "terminal", terminal: emission });
          break;
        }
        move = emission;
        send({ type: "round-start", round: move.round, move });
        await sleep(400 / speed);
      }
      // Same counterparty, same seed: the council and the strong baseline take your seat.
      const synod = await runNegotiation(agents, new GameMaster(entry.type, entry.seed, speaker), entry.id, entry.type);
      const baseline = await runBaseline(agents, new GameMaster(entry.type, entry.seed), "strong");
      send({ type: "duel-result", you: terminal, synod: synod.terminal, baseline });
      send({ type: "done" });
      return;
    }

    // Free-text evaluation: the user types a situation in English; the LIVE council
    // reads it and deliberates ONE round — Empathy's read, five lens scores, the
    // verdict. Reuses the proven deliberateRound path; only the move is synthesized
    // from the user's text. Live Qwen only (mock can't read prose); costs tokens.
    if (mode === "freetext") {
      if (!isLive) throw new Error("Free-text evaluation needs live Qwen (set LLM_PROVIDER=qwen).");
      const text = String(req.query.text ?? "").slice(0, 800).trim() || "(the counterparty said nothing)";
      const price = Math.max(0, Math.min(20_000, Number(req.query.offer) || 9_000));
      const move = { round: 1, message: text, offer: { price, features: [] as string[] }, signals: [] as string[], terminal: false as const };
      send({ type: "round-start", round: 1, move });
      await sleep(400 / speed);
      send({ type: "belief", before: UNIFORM_PRIOR, after: UNIFORM_PRIOR });
      const ctx = computeContext(UNIFORM_PRIOR, OPENING_ASK, ROUND_CAP, move.signals);
      const input: RoundInput = { round: 1, move, history: [], belief: UNIFORM_PRIOR, ctx, buyerOffer: price, councilAsk: OPENING_ASK };
      await deliberateRound(agents, input, {
        scenarioId: "freetext",
        governor,
        sink: async (event) => { send(event); await sleep((EVENT_DELAY[event.type] ?? 0) / speed); },
      });
      send({ type: "done" });
      return;
    }

    // Custom counterparty (the composer): override a base profile with the dials the
    // user set, then run the deterministic council on terrain nobody pre-authored.
    const customProfile = buildCustomProfile(req.query);
    const scenarioId = customProfile ? "custom" : entry.id;
    const gm =
      mode === "adversary" ? new QwenAdversaryGM(entry.type)
      : mode === "human" ? new HumanGM(entry.type, (p) => waitForHuman(p))
      : customProfile ? new GameMaster(entry.type, entry.seed, speaker, customProfile)
      : new GameMaster(entry.type, entry.seed, speaker);
    await runNegotiation(negotiationAgents, gm, scenarioId, entry.type, {
      sink: async (event) => {
        send(event);
        await sleep((EVENT_DELAY[event.type] ?? 0) / speed);
      },
      governor,
    });
  } catch (err) {
    send({ type: "error", message: String(err) });
  } finally {
    res.end();
  }
});

// A/B always runs against the deterministic mock — reproducible numbers, instant load.
// The live Qwen runs demonstrate reasoning quality; the A/B table demonstrates structural advantage.
app.get("/api/ab", async (_req, res) => {
  res.json(await runAbComparison(new MockAgents()));
});

// The canonical round behind the hero tableau. Run for real through the DETERMINISTIC
// mock engine — not a hand-written snapshot — so the votes, verdict, offers, arbiter
// reasoning, and the probe's EVI figure are all genuine engine output. Pinned to mock
// (not the active agents) on purpose: the hero card must be reproducible across refreshes
// and consistent with the A/B / ablation numbers (all mock-based), and token-free. Live
// Qwen voices are shown in the actual watch/duel runs, not this static card.
let canonicalCache: unknown = null;
app.get("/api/canonical", async (_req, res) => {
  if (canonicalCache) { res.json(canonicalCache); return; }
  const canonAgents = new MockAgents();
  const entry = getEntry("type-c-deceptive")!;
  const top = (scores: Record<string, number>): ActionId =>
    (ACTIONS as readonly ActionId[]).reduce((a, b) => (scores[b]! > scores[a]! ? b : a));
  const result = await runNegotiation(canonAgents, new GameMaster(entry.type, entry.seed), entry.id, entry.type);
  const baseline = await runBaseline(canonAgents, new GameMaster(entry.type, entry.seed), "strong");
  const r1 = result.rounds[0]!;
  const votes: Record<string, ActionId> = {};
  const voices: Record<string, string> = {};
  for (const p of r1.positions) { votes[p.doctrine] = top(p.scores); voices[p.doctrine] = p.rationale; }
  const rec = r1.engine.recommendation;
  const w = r1.arbiter.weights;
  const dissenter = Object.keys(votes)
    .filter((d) => votes[d] !== rec)
    .sort((a, b) => (w[b as keyof typeof w] ?? 0) - (w[a as keyof typeof w] ?? 0))[0];
  const ctx = r1.ctx;
  const why = dissenter
    ? `<b>${LENSES[dissenter as keyof typeof LENSES].cogFunction}</b> pushed for ${ACTION_LABELS[votes[dissenter]!]}. ` +
      `But belief is unresolved (${Math.round(ctx.infoConfidence * 100)}%) and exposure is high ` +
      `(${Math.round(ctx.exposure * 100)}%), so the Arbiter sided with <b>${ACTION_LABELS[rec]}</b>. ` +
      `The decision changed <em>because</em> they disagreed.`
    : "";
  canonicalCache = {
    message: r1.counterpartyMove.message,
    votes, voices, verdict: rec, why,
    trajectory: result.rounds.map((r) => ({ r: r.round, offer: r.counterpartyMove.offer.price })),
    synod: result.terminal.surplusCaptured,
    baseline: baseline.surplusCaptured,
    infoConfidence: ctx.infoConfidence,
    exposure: ctx.exposure,
    live: false,
  };
  res.json(canonicalCache);
});

// The war council as an agent society. The deceptive scenario = an adversary bluffing
// strength across the armistice table. We run one real round on the deterministic mock,
// then: (a) project the shared five-lens assessment through each general's temperament
// to get their individual call, and (b) war-game the table forward across who the
// adversary might really be. Pinned to mock so the room is reproducible and token-free.
let warroomCache: unknown = null;
app.get("/api/warroom", async (_req, res) => {
  if (warroomCache) { res.json(warroomCache); return; }
  const mock = new MockAgents();
  const entry = getEntry("type-c-deceptive")!;
  const result = await runNegotiation(mock, new GameMaster(entry.type, entry.seed), entry.id, entry.type);
  const r1 = result.rounds[0]!;
  const deliberation = deliberateCouncil(r1.positions, r1.engine.recommendation, r1.ctx);
  const wargame = await runWargame(mock, r1.beliefAfter, entry.seed + 1);
  const d = deliberation.dissenters[0];
  const why = d
    ? `<b>${d.name}</b> (${d.title}) would ${WAR_ACTIONS[d.action]!.toLowerCase()} — leaning ${LENSES[d.leadLens].cogFunction}. ` +
      `The chair, reading the terrain (intel ${Math.round(r1.ctx.infoConfidence * 100)}%, exposure ` +
      `${Math.round(r1.ctx.exposure * 100)}%), holds the council to <b>${WAR_ACTIONS[deliberation.council]}</b>. ` +
      `The room advises; the chair decides on the ground truth.`
    : `The room is unanimous: <b>${WAR_ACTIONS[deliberation.council]}</b>.`;
  warroomCache = {
    // The war room is a SKIN over the same negotiation engine — only the LANGUAGE layer
    // changes (spec: the renderer phrases moves; it never drives a transition). So the
    // adversary's opening speaks in armistice terms, not deal terms, and shows no price.
    // The structural move is identical to the deceptive opening: a lowball anchored on
    // bluffed strength (hidden "reserves" = hidden leverage).
    move: WAR_MOVE,
    council: deliberation.council,
    councilLabel: WAR_ACTIONS[deliberation.council],
    why,
    // The room argues: the engine's real lens-level challenge this round, attributed to
    // the generals who embody those lenses. One side may CONCEDE (causal, score-changing)
    // — agents resolving a disagreement, not just registering it.
    challenge: r1.challenges.map((c) => {
      const fromG = generalForLens(c.from);
      const againstG = generalForLens(c.against);
      return {
        role: c.originalScore !== undefined ? "defense" : "challenge",
        fromId: fromG.id, fromName: fromG.name, fromLens: LENSES[c.from].cogFunction,
        againstId: againstG.id, againstName: againstG.name, againstLens: LENSES[c.against].cogFunction,
        text: c.text,
        contested: c.contested ? WAR_ACTIONS[c.contested] : "",
        conceded: c.revisedScore !== undefined,
        originalScore: c.originalScore,
        revisedScore: c.revisedScore,
      };
    }),
    generals: deliberation.calls.map((c) => ({
      ...c,
      label: WAR_ACTIONS[c.action],
      lead: LENSES[c.leadLens].cogFunction,
      leadMath: LENSES[c.leadLens].math,
      toolUse: c.toolUse.map((t) => ({ ...t, cogFunction: LENSES[t.lens].cogFunction, math: LENSES[t.lens].math })),
    })),
    dissenters: deliberation.dissenters.map((c) => c.id),
    belief: r1.beliefAfter,
    // Structured terrain the chair reads — drives the arbitration checklist (not prose).
    terrain: {
      infoConfidence: r1.ctx.infoConfidence,
      exposure: r1.ctx.exposure,
      adversarialSignal: r1.ctx.adversarialSignal,
      eviWorthIt: r1.evi.worthIt,
    },
    wargame,
    actions: WAR_ACTIONS,
    // The shared five-lens assessment of the adversary's move — the raw scores the
    // sliders re-weight live. The client recomputes argmax U(a)=Σ w·s as the user drags,
    // so "tune the judgment" needs no round-trip.
    assessment: r1.positions.map((p) => ({
      lens: p.doctrine,
      cogFunction: LENSES[p.doctrine].cogFunction,
      math: LENSES[p.doctrine].math,
      question: LENSES[p.doctrine].question,
      scores: p.scores,
    })),
    // The chair's terrain weighting — a slider preset alongside the generals.
    chairWeights: r1.arbiter.weights,
    roster: GENERALS.map((g) => ({ id: g.id, name: g.name, title: g.title, doctrine: g.doctrine, mandate: g.mandate, lens: g.lens })),
  };
  res.json(warroomCache);
});

// The war room, LIVE — each general is an independent Qwen agent running their OWN five
// lenses on the move (5 Qwen calls, in parallel). On-demand only (a button), so the
// default war room stays deterministic/free; this proves the personas genuinely reason on
// Qwen. 503s cleanly if no key is configured. Cached after the first successful run.
// Keyed by the removal-set (e.g. "" for the full council, "probe" with Sun Tzu removed) so
// each distinct configuration is computed once and then free to replay.
const liveCouncilCache = new Map<string, unknown>();
app.get("/api/warroom-live", async (req, res) => {
  // ?off=probe,risk — remove those generals and convene the rest live (a causal switch-off).
  // ?scenario=type-b-soft-floor — face a different KIND of opponent (war-skinned move +
  // that scenario's terrain), so a judge can watch a different general become decisive.
  const off = String(req.query.off ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const exclude = DOCTRINES.filter((d) => off.includes(d)); // validate against real lens ids
  const scenarioId = WAR_MOVES[String(req.query.scenario ?? "")] ? String(req.query.scenario) : "type-c-deceptive";
  const warMove = WAR_MOVES[scenarioId]!.move;
  const cacheKey = `${scenarioId}|${[...exclude].sort().join(",")}`;
  if (liveCouncilCache.has(cacheKey)) { res.json(liveCouncilCache.get(cacheKey)); return; }
  if (!process.env.DASHSCOPE_API_KEY) {
    res.status(503).json({ error: "no-key", message: "Live Qwen not configured — set DASHSCOPE_API_KEY." });
    return;
  }
  try {
    // Terrain is a property of THIS situation, so take it from the deterministic read of
    // the matching scenario — the chair then weighs the live pooled reads by it.
    const entry = getEntry(scenarioId)!;
    const canon = await runNegotiation(new MockAgents(), new GameMaster(entry.type, entry.seed), entry.id, entry.type);
    const r1 = canon.rounds[0]!;
    const qwen = new QwenAgents();
    const live = await runLiveCouncil(qwen, warMove, { arbiterWeights: r1.arbiter.weights, ctx: r1.ctx }, exclude);
    // Once the council has decided, it accomplishes the complex task: a multi-division
    // operational order — but ONLY the convened generals contribute (a removed general is
    // absent from the plan too, not just the debate).
    const convenedLenses = live.generals.map((g) => g.leadLens);
    const plan = await runWarPlan(qwen, { directive: live.councilLabel }, warMove, convenedLenses);
    const payload = {
      ...live,
      plan,
      move: warMove,
      scenario: scenarioId,
      scenarioLabel: WAR_MOVES[scenarioId]!.label,
      actions: WAR_ACTIONS,
      // Terrain checklist + war-game come from the deterministic read of the same move,
      // so the live proceedings are internally consistent end to end.
      terrain: { infoConfidence: r1.ctx.infoConfidence, exposure: r1.ctx.exposure, adversarialSignal: r1.ctx.adversarialSignal, eviWorthIt: r1.evi.worthIt },
      wargame: await runWargame(new MockAgents(), r1.beliefAfter, entry.seed + 1),
    };
    liveCouncilCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: "qwen-failed", message: (err as Error).message });
  }
});

// Fit explorer (negotiation table): each single-lens framing against each counterparty
// PERSONALITY. Shows which framing fits which situation — and which backfires — from real
// runs. The point the council makes interactive: no single framing wins everywhere.
let fitCache: unknown = null;
app.get("/api/fit", async (_req, res) => {
  if (fitCache) { res.json(fitCache); return; }
  const mock = new MockAgents();
  const N = 6;
  const run = async (agents: typeof mock, type: (typeof EVAL_SUITE)[number]["type"], seed: number) => {
    let surplus = 0, deals = 0;
    for (let i = 0; i < N; i++) {
      const r = await runNegotiation(agents, new GameMaster(type, seed + i * 131), `fit-${type}`, type);
      surplus += r.terminal.surplusCaptured;
      if (r.terminal.dealSurvived) deals += 1;
    }
    return { surplus: surplus / N, dealRate: deals / N };
  };
  const matrix = [];
  for (const entry of EVAL_SUITE) {
    const cells = [];
    for (const lens of DOCTRINES) {
      const r = await run(withSingleLens(mock, lens) as typeof mock, entry.type, entry.seed);
      cells.push({ lens, cog: LENSES[lens].cogFunction, ...r });
    }
    const council = await run(mock, entry.type, entry.seed);
    // Best fit = highest surplus among framings that actually close; backfire = walks (or worst).
    const closing = cells.filter((c) => c.dealRate > 0.5);
    const best = (closing.length ? closing : cells).reduce((a, b) => (b.surplus > a.surplus ? b : a));
    const worst = cells.reduce((a, b) => (b.surplus < a.surplus ? b : a));
    matrix.push({
      type: entry.type,
      name: TYPE_META[entry.type].name,
      tell: TYPE_META[entry.type].tell,
      council,
      cells,
      bestLens: best.lens,
      worstLens: worst.lens,
    });
  }
  fitCache = { matrix, lenses: DOCTRINES.map((d) => ({ id: d, cog: LENSES[d].cogFunction })) };
  res.json(fitCache);
});

// Ablation study: remove one architectural component at a time, same seeds (S5-2).
app.get("/api/ablation", async (_req, res) => {
  res.json(await runAblation(new MockAgents()));
});

// Exhibit D: the society (adaptive chair) vs each single general deciding alone.
let generalBenchCache: unknown = null;
app.get("/api/general-bench", async (_req, res) => {
  if (!generalBenchCache) generalBenchCache = await runGeneralBench(new MockAgents());
  res.json(generalBenchCache);
});

// MCP surface, made visible: Synod runs as an MCP server over stdio (`npm run mcp`); these
// endpoints expose its tool catalog and invoke the data-only tools live, so the integration
// is demonstrable in a browser (the exact response an MCP host receives), not just asserted.
app.get("/api/mcp/catalog", (_req, res) => {
  res.json({ server: "synod (MCP, stdio) · npm run mcp", tools: MCP_TOOLS });
});
// GET and POST both work (a curious judge will try either). Every live tool executes the
// real computation on request — deterministic mock engine, so hosted and stdio agree.
const mcpInvoke = async (req: express.Request, res: express.Response) => {
  const tool = String(req.query.tool ?? req.body?.tool ?? req.body?.params?.name ?? "describe_council");
  try {
    res.json({
      request: { jsonrpc: "2.0", method: "tools/call", params: { name: tool, arguments: {} } },
      response: { content: [{ type: "text", text: JSON.stringify(await invokeMcpTool(tool), null, 2) }] },
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
};
app.get("/api/mcp/invoke", mcpInvoke);
app.post("/api/mcp/invoke", mcpInvoke);

// The recon capability, proven by lens-ablation: remove the Probe lens from the council's
// repertoire and it can no longer buy information — belief stalls instead of resolving, and
// the outcome halves. Returns the belief trace + actions + outcome, with and without the
// lens, on the deceptive scenario. Deterministic; cached.
let capabilityCache: unknown = null;
app.get("/api/capability", async (_req, res) => {
  if (capabilityCache) { res.json(capabilityCache); return; }
  const entry = getEntry("type-c-deceptive")!;
  const trace = async (agents: import("./agents/index.js").DeliberationAgents) => {
    const r = await runNegotiation(agents, new GameMaster(entry.type, entry.seed), entry.id, entry.type);
    return {
      belief: r.beliefTrajectory.map((b, i) => ({ round: i + 1, deceptive: b.belief.deceptive })),
      probed: r.rounds.some((x) => x.councilMove.action === "probe"),
      peak: Math.max(...r.beliefTrajectory.map((b) => b.belief.deceptive)),
      surplus: r.terminal.surplusCaptured,
      settled: r.terminal.dealSurvived,
    };
  };
  const full = await trace(new MockAgents());
  // Switch off each general (zero their lens) and re-run the same deceptive seed.
  const generals = [];
  for (const g of GENERALS) {
    const off = await trace(withLensOff(new MockAgents(), g.lens));
    generals.push({ id: g.id, name: g.name, lens: g.lens, lensName: LENSES[g.lens].cogFunction, off, delta: off.surplus - full.surplus });
  }
  capabilityCache = { full, generals };
  res.json(capabilityCache);
});

// Multi-scenario switch-off: removing each general across ALL THREE counterparty types,
// to show no general is globally inert — different faculties carry different worlds. Fixes
// the "4/5 do nothing" read of the deceptive-only view.
let switchMatrixCache: unknown = null;
app.get("/api/switch-matrix", async (_req, res) => {
  if (switchMatrixCache) { res.json(switchMatrixCache); return; }
  // The three calibration opponents + the five Claude-authored hold-out worlds: eight
  // opponents total, so "which general is decisive" is tested beyond the tuned suite.
  const surplus = async (
    agents: import("./agents/index.js").DeliberationAgents,
    type: ConstructorParameters<typeof GameMaster>[0],
    seed: number, id: string, profile?: ConstructorParameters<typeof GameMaster>[3],
  ) => (await runNegotiation(agents, new GameMaster(type, seed, undefined, profile), id, type)).terminal.surplusCaptured;
  const rows = [];
  const suite = ["type-a-relationship", "type-b-soft-floor", "type-c-deceptive"].map((id) => getEntry(id)!);
  for (const e of suite) {
    const fullS = await surplus(new MockAgents(), e.type, e.seed, e.id);
    const offs: Record<string, number> = {};
    for (const g of GENERALS) offs[g.id] = (await surplus(withLensOff(new MockAgents(), g.lens), e.type, e.seed, e.id)) - fullS;
    rows.push({ scenario: e.title, type: e.type, holdout: false, full: fullS, offs });
  }
  for (const w of HOLDOUT_WORLDS) {
    const fullS = await surplus(new MockAgents(), w.type, 7001, w.id, w.profile);
    const offs: Record<string, number> = {};
    for (const g of GENERALS) offs[g.id] = (await surplus(withLensOff(new MockAgents(), g.lens), w.type, 7001, w.id, w.profile)) - fullS;
    rows.push({ scenario: w.title, type: w.type, holdout: true, full: fullS, offs });
  }
  switchMatrixCache = { generals: GENERALS.map((g) => ({ id: g.id, name: g.name, lens: g.lens, lensName: LENSES[g.lens].cogFunction })), rows };
  res.json(switchMatrixCache);
});

// NegMAS bridge (external-validity rung 2): lets Synod sit inside a real NegMAS
// SAOMechanism against actual negotiation-literature agents. STATELESS by replay: each
// call re-runs the canonical loop (belief → lenses → chair → gate → ask evolution) over
// the full offer history — deterministic mock, so the replay is always self-consistent.
// POST { offers: number[], deadline?: number } → { action, ask, belief }.
app.post("/api/bridge/decide", async (req, res) => {
  const offers = (Array.isArray(req.body?.offers) ? req.body.offers : [])
    .map((x: unknown) => Number(x)).filter((x: number) => Number.isFinite(x));
  const deadline = Math.max(2, Math.min(12, Number(req.body?.deadline) || ROUND_CAP));
  if (!offers.length) { res.status(400).json({ error: "offers[] required" }); return; }
  try {
    const agents = new MockAgents();
    let belief = UNIFORM_PRIOR;
    let councilAsk = OPENING_ASK;
    const priorMoves: CounterpartyMove[] = [];
    let decision: Awaited<ReturnType<typeof deliberateRound>> | null = null;
    for (let i = 0; i < offers.length; i++) {
      // Signals derived from observable movement only — same thresholds the GM emits.
      const delta = i === 0 ? 0 : offers[i]! - offers[i - 1]!;
      const signals = i === 0 ? ["opening"] : delta <= 60 ? ["held_firm"] : delta < 400 ? ["small_concession"] : ["soft_concession"];
      const move: CounterpartyMove = { round: i + 1, message: "", offer: { price: offers[i]!, features: [] }, signals, terminal: false };
      belief = updateBelief(belief, signals);
      const roundsLeft = Math.max(1, deadline - i);
      const ctx = computeContext(belief, councilAsk, roundsLeft, signals);
      const input = { round: i + 1, move, history: [...priorMoves], belief, ctx, buyerOffer: offers[i]!, councilAsk };
      decision = await deliberateRound(agents, input, { scenarioId: "negmas-bridge" });
      const councilMove = encodeMove(decision.gate.finalAction, councilAsk, offers[i]!, [], []);
      councilAsk = councilMove.ask.price;
      priorMoves.push(move);
    }
    // The council's reasoning, in plain words — composed from the REAL decision state
    // (belief, engine flags, chosen action), never free-written. This is what the
    // recorded ANAC sessions show as "why Synod did that".
    const d = decision!;
    const TYPE_PLAIN: Record<string, string> = {
      relationship: "they mostly want to keep the relationship",
      soft_floor: "they have a real limit they won't cross",
      deceptive: "they're likely bluffing",
    };
    const likely = (Object.entries(belief) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0]!;
    const read = `${TYPE_PLAIN[likely[0]] ?? likely[0]} (${Math.round(likely[1] * 100)}% sure)`;
    const action = d.gate.finalAction;
    const why = d.engine.deadlineAccept
      ? `last chance to say yes — their offer beats walking away with nothing, so take the sure win instead of betting it on their patience`
      : d.engine.batnaWalk
        ? `even the best price they could believably reach is worse than walking away — stop wasting rounds`
        : action === "accept"
          ? `their offer is already better than anything more pushing would win — the council reads ${read} and takes it`
          : action === "probe"
            ? `the council isn't sure who it's facing (${read}) — asking a question is worth more than committing blind`
            : action === "counter_soft"
              ? `they're moving, so meet them a step — the council reads ${read} and keeps the deal alive`
              : action === "concede_term"
                ? `give a little on a side term — not the price — to get them moving; the council reads ${read}`
                : `the council reads ${read} — hold the number and let them come to us`;
    res.json({ action, ask: councilAsk, belief, why, read });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Exhibit F: opponents from the LITERATURE — the ANAC-standard time-dependent tactics
// (Faratin et al. 1998; the canonical ANAC/ANL baselines). Not authored by this project:
// a first external-validity step beyond self- and Claude-authored worlds.
let anacCache: unknown = null;
app.get("/api/anac-bench", async (_req, res) => {
  if (anacCache) { res.json(anacCache); return; }
  const rows = [];
  for (const p of ANAC_TACTICS) {
    const solo = await runBaseline(new MockAgents(), new AnacGameMaster(p), "strong");
    const council = await runNegotiation(new MockAgents(), new AnacGameMaster(p), `anac-${p.tactic}`, "soft_floor");
    rows.push({
      tactic: p.tactic, e: p.e,
      solo: { surplus: solo.surplusCaptured, deal: solo.dealSurvived },
      council: { surplus: council.terminal.surplusCaptured, deal: council.terminal.dealSurvived },
    });
  }
  anacCache = { rows, note: "Faratin et al. (1998) time-dependent tactics — the standard ANAC baselines; deterministic, no seeds needed." };
  res.json(anacCache);
});

// Exhibit E: the adaptive policy layer vs a fixed clamp — the measured algorithmic delta.
let adaptiveCache: unknown = null;
app.get("/api/adaptive-bench", async (_req, res) => {
  if (adaptiveCache) { res.json(adaptiveCache); return; }
  setPolicyOverride(null);
  const adaptive = (await runAbComparison(new MockAgents(), { nSeeds: 10 })).totals.councilSurplusMean;
  setPolicyOverride(FIXED_POLICY);
  const fixed = (await runAbComparison(new MockAgents(), { nSeeds: 10 })).totals.councilSurplusMean;
  setPolicyOverride(null);
  adaptiveCache = { adaptive, fixed, delta: adaptive - fixed };
  res.json(adaptiveCache);
});

// The EXACT `npm run reproduce` output, served verbatim so the page can show the real
// terminal result (provenance + exhibits + the byte-identical determinism proof) — not a
// description of it. Cached; deterministic, so it's the same every load.
let reproduceCache: { output: string; ok: boolean } | null = null;
app.get("/api/reproduce", async (req, res) => {
  // ?fresh=1 re-runs the check live (the "Re-run" button), so a judge can trigger the
  // verification from the browser; otherwise serve the cached run for instant page load.
  if (req.query.fresh || !reproduceCache) {
    const { text, ok } = await runReproduce();
    reproduceCache = { output: text, ok };
  }
  res.json(reproduceCache);
});

// Hold-out suite: adversarially-authored worlds the council was never tuned on (S7-1).
// ?lenses=1 adds the single-lens collapse per world — the "why not just Learning?" data.
app.get("/api/holdout", async (req, res) => {
  res.json(await runHoldout(new MockAgents(), 10, { singleLens: req.query.lenses === "1" }));
});

// Belief calibration: terminal-posterior confusion matrix vs ground truth (S7-3).
app.get("/api/calibration", async (_req, res) => {
  res.json(await runCalibration(new MockAgents()));
});

// Signed receipt audit log — every round of every negotiation, tamper-evident.
app.get("/api/receipts", (_req, res) => {
  res.json({ receipts: receiptStore.getAll() });
});

app.listen(PORT, () => {
  console.log(`\nSynod running on http://localhost:${PORT}  (agents: ${agents.kind})\n`);
});
