/* Synod UI — core: shared helpers, state, HUD, pipeline spine. Loaded first. */
"use strict";

const ORDER = ["empathy", "battle", "war", "probe", "risk"]; // stable colour order
const ACTIONS = ["accept", "counter_hard", "counter_soft", "hold", "probe", "concede_term", "walk"];
const TYPES = ["relationship", "soft_floor", "deceptive"];
const TYPE_SHORT = { relationship: "Relationship", soft_floor: "Soft-floor", deceptive: "Deceptive" };
const state = {
  meta: null, source: null, round: null, roundNum: 0, prevWeights: null,
  scenarioId: null, prevOffer: null, speed: 1, autoFollow: false,
  abReport: null, beliefByRound: {},
};

/* Pipeline spine: the task decomposition made visible — each node is a sub-task
   and the agent it's assigned to, lighting up as the stream reaches it. */
const STAGES = [
  { id: "inbound", label: "INBOUND", tip: "Counterparty move arrives — the only thing that crosses the information boundary" },
  { id: "belief", label: "BELIEF", tip: "Sub-task: update belief over hidden type · assigned to pure code (Bayes' rule, never an LLM)" },
  { id: "intent", label: "TRUST", tip: "Sub-task: read the counterparty's intent · assigned to the Trust lens" },
  { id: "council", label: "COUNCIL", tip: "Sub-task: score the action space under 5 criteria · assigned to five lens agents, in parallel — fixed roles, dynamic influence" },
  { id: "challenge", label: "CHALLENGE", tip: "Sub-task: stress-test the leading option · assigned dynamically — the most-diverging pair this round; defender may concede (causal, clamped)" },
  { id: "arbiter", label: "CHAIR", tip: "Sub-task: decide how much each lens counts · assigned to the neutral chair — re-decided every round from the situation, not from who argued best" },
  { id: "engine", label: "ENGINE", tip: "Sub-task: synthesize the decision · assigned to the deterministic engine (auditable argmax — no LLM)" },
  { id: "gate", label: "GATE", tip: "Sub-task: audit & gate execution · assigned to Quant (EV check) + Dotto (signed receipt)" },
  { id: "outbound", label: "OUTBOUND", tip: "The gated action is encoded and sent — the debate never crosses the boundary" },
];
const EVENT_STAGE = {
  "round-start": "inbound", belief: "belief", intent: "intent", position: "council",
  challenge: "challenge", arbiter: "arbiter", engine: "engine", gate: "gate",
  "council-move": "outbound", "your-move": "inbound",
};

const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
// Stakes are de-monetized: the engine's bargaining quantities render as abstract units
// ("stakes on the table"), not dollars — the war room/decision frame isn't a sales deal.
const money = (x) => `${Math.round(x).toLocaleString()}`;
const sci = (x) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

function typewriter(node, text, msPerChar = 14) {
  node.textContent = "";
  let i = 0;
  const tick = () => { if (i < text.length) { node.textContent += text[i++]; setTimeout(tick, msPerChar); } };
  tick();
}
const info = (tip) => `<span class="iicon" data-tip="${tip.replace(/"/g, "&quot;")}">i</span>`;
const lens = (d) => state.meta.lenses[d];
const label = (a) => state.meta.actionLabels[a];
const topAction = (scores) => ACTIONS.reduce((a, b) => (scores[b] > scores[a] ? b : a));

/* Live stakes HUD — a win-probability-style needle. Position = the real surplus on
   the table (offer − $8,000 floor) as a fraction of the best close (+$4,000 at the
   $12,000 ask). It slides each round; the probe is what sends it toward CLOSE. */
const HUD_FLOOR = 8000, HUD_BEST = 4000, HUD_CAP = 4;
const hudPos = (offer) => Math.max(0, Math.min(100, ((offer - HUD_FLOOR) / HUD_BEST) * 100));

function showHud() {
  const hud = $("#nego-hud");
  if (!hud) return;
  hud.classList.remove("hidden", "hud-locked");
  $("#hud-fill").style.width = "0%";
  $("#hud-event").textContent = "";
  $("#hud-event").className = "hud-event";
}
function hideHud() { $("#nego-hud")?.classList.add("hidden"); }

function updateHud(round, offer, signals) {
  const hud = $("#nego-hud");
  if (!hud || hud.classList.contains("hidden")) return;
  $("#hud-round").textContent = `ROUND ${round} / ${HUD_CAP}`;
  const surplus = Math.max(0, offer - HUD_FLOOR);
  const prev = state.hudSurplus ?? 0;
  $("#hud-surplus").textContent = money(surplus);
  const d = surplus - prev;
  $("#hud-delta").textContent = round > 1 && d !== 0 ? ` ${d > 0 ? "▲" : "▼"} ${money(Math.abs(d))}` : "";
  $("#hud-delta").className = `hud-delta ${d > 0 ? "up" : d < 0 ? "dn" : ""}`;
  state.hudSurplus = surplus;
  $("#hud-fill").style.width = `${hudPos(offer)}%`;
  const reveal = (signals ?? []).some((s) => s.startsWith("revealed"));
  const ev = $("#hud-event");
  if (reveal) {
    ev.textContent = "⚑ BLUFF EXPOSED — the needle swings toward CLOSE";
    ev.className = "hud-event fire";
  } else if (round > 1) {
    ev.textContent = ""; ev.className = "hud-event";
  }
}

function lockHud(t) {
  const hud = $("#nego-hud");
  if (!hud || hud.classList.contains("hidden")) return;
  hud.classList.add("hud-locked");
  const ev = $("#hud-event");
  if (t.dealSurvived) {
    $("#hud-fill").style.width = `${hudPos(HUD_FLOOR + t.surplusCaptured)}%`;
    // Their true ceiling was hidden all run — name where the close landed on the fixed scale.
    ev.textContent = `✓ CLOSED — ${money(t.surplusCaptured)} captured (their hidden ceiling capped the rest of the ${money(HUD_BEST)} ask)`;
    ev.className = "hud-event win";
  } else {
    $("#hud-fill").style.width = "0%";
    ev.textContent = "✕ WALK — 0";
    ev.className = "hud-event lose";
  }
}

/** Auto-scroll follow: the demo watches itself until the user takes the wheel. */
function follow(node) {
  if (!state.autoFollow || !node) return;
  node.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildSpine() {
  const rail = $("#pipeline-rail");
  rail.innerHTML =
    `<span class="rail-round" id="rail-round"></span>` +
    STAGES.map((s) =>
      `<span class="rail-node" data-stage="${s.id}" title="${s.tip.replace(/"/g, "&quot;")}"><i></i>${s.label}</span>`,
    ).join(`<span class="rail-edge"></span>`);
  rail.addEventListener("click", (e) => {
    const node = e.target.closest(".rail-node");
    if (!node || !state.round) return;
    const target = state.round.stageEls?.[node.dataset.stage];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function spine(stage) {
  if (!stage) return;
  const idx = STAGES.findIndex((s) => s.id === stage);
  document.querySelectorAll("#pipeline-rail .rail-node").forEach((n, i) => {
    n.classList.toggle("done", i < idx);
    n.classList.toggle("live", i === idx);
  });
}

function spineRound(n) {
  const lbl = $("#rail-round");
  if (lbl) lbl.textContent = `R${String(n).padStart(2, "0")}`;
}

function spineComplete() {
  $("#pipeline-rail").classList.add("complete"); // the current stops flowing
  document.querySelectorAll("#pipeline-rail .rail-node").forEach((n) => {
    n.classList.remove("live");
    n.classList.add("done");
  });
}

