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
import { runAblation, withoutProbeLens } from "./harness/ablation.js";
import { runHoldout } from "./harness/holdout.js";
import { runCalibration } from "./harness/calibration.js";
import { GameMaster } from "./gm/gameMaster.js";
import { QwenAdversaryGM } from "./gm/qwenAdversary.js";
import { HumanGM, type HumanMove } from "./gm/humanGM.js";
import { QwenSpeaker, TemplateSpeaker } from "./gm/speaker.js";
import { OPENING_ASK, ROUND_CAP, profileOf, type TypeProfile } from "./gm/profiles.js";
import { isTerminal } from "./gm/types.js";
import { QwenGovernor } from "./dotto/governor.js";
import { receiptStore } from "./dotto/store.js";
import { SUITE, getEntry } from "./suite.js";
import { LENSES, TYPE_META } from "./core/types.js";
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
      holdoutAuthor: "Claude (Anthropic) — a different vendor than the system under test",
      holdoutFrozen: "authored and committed before evaluation; see src/gm/holdout.ts",
      baseline: "strong single-agent persona — same action set, move encoding, GM, and seed as the council; only the council structure is removed",
      seeds: "fixed schedule (entry.seed + i·997), n=10 per type",
      determinism: "engine, belief update, EVI, Quant, gate are pure code — never an LLM",
    },
    // GM modes: deterministic (watch; the reproducible default), human (YOU play the
    // counterparty and try to deceive the council), duel (YOU negotiate against the
    // same GM + seed, then your result is compared to Synod's and the baseline's),
    // adversary (Qwen plays the counterparty; requires a live provider).
    gmModes: ["deterministic", "human", "duel", ...(agents.kind === "qwen" ? ["adversary"] : [])],
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
  const reservation = num(q.reservation, 7_500, 14_000, base.reservation);
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

// Ablation study: remove one architectural component at a time, same seeds (S5-2).
app.get("/api/ablation", async (_req, res) => {
  res.json(await runAblation(new MockAgents()));
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
