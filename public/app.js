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
  { id: "intent", label: "INTENT", tip: "Sub-task: read counterparty intent · assigned to the Intent lens" },
  { id: "council", label: "COUNCIL", tip: "Sub-task: score the action space under 5 criteria · assigned to five lens agents, in parallel — fixed roles, dynamic influence" },
  { id: "challenge", label: "CHALLENGE", tip: "Sub-task: stress-test the leading option · assigned dynamically — the most-diverging pair this round; defender may concede (causal, clamped)" },
  { id: "arbiter", label: "ARBITER", tip: "Sub-task: allocate influence · assigned to the doctrine-free Arbiter — weights reassigned every round from terrain, not arguments" },
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
const money = (x) => `$${Math.round(x).toLocaleString()}`;
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

async function init() {
  state.meta = await (await fetch("/api/meta")).json();
  $("#provider-badge").textContent =
    state.meta.provider === "qwen"
      ? "COUNCIL LIVE ON QWEN"
      : "OFFLINE MODE · DETERMINISTIC & REPRODUCIBLE";
  // Mode select: watch the council, deceive it yourself, or duel it on the same seed
  const GM_LABELS = {
    deterministic: "Watch Synod negotiate",
    human: "YOU play the counterparty — deceive the council",
    duel: "DUEL — you negotiate, then Synod takes your seat",
    adversary: "Qwen adversary — unscripted opponent",
  };
  const gmSel = el("select");
  gmSel.id = "gm-select";
  for (const m of state.meta.gmModes ?? ["deterministic"]) {
    const o = el("option"); o.value = m; o.textContent = GM_LABELS[m] ?? m; gmSel.appendChild(o);
  }
  $("#scenario-select").insertAdjacentElement("afterend", gmSel);
  const sel = $("#scenario-select");
  for (const s of state.meta.suite) {
    const o = el("option");
    o.value = s.id;
    // Long labels truncate in the select — the operation brief carries the detail.
    o.textContent = s.dropdownLabel.replace(/\s*\(.*\)$/, "");
    sel.appendChild(o);
  }
  sel.addEventListener("change", updateScenarioCard);
  updateScenarioCard();
  $("#legend").innerHTML = ORDER.map((d) => `<span><i class="seg-${d}"></i>${lens(d).cogFunction} <span style="color:var(--muted);font-size:0.65rem">${lens(d).name}</span></span>`).join("");
  $("#run-btn").addEventListener("click", run);
  $("#speed-btn").addEventListener("click", () => {
    state.speed = state.speed >= 4 ? 1 : state.speed * 2;
    $("#speed-btn").textContent = `${state.speed}×`;
  });
  $("#guide-btn").addEventListener("click", startTour);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") endTour(); });
  buildSpine();
  // The user taking the wheel pauses auto-follow until the next run.
  for (const evt of ["wheel", "touchstart"]) {
    window.addEventListener(evt, () => { state.autoFollow = false; }, { passive: true });
  }
  loadAb();
  loadAblation();
}

function updateScenarioCard() {
  const id = $("#scenario-select").value;
  const s = state.meta.suite.find((x) => x.id === id);
  if (!s) return;
  $("#scenario-card").innerHTML =
    `<div class="sc-when"><span class="sc-lbl">Operation brief — when to use</span>${s.whenToUse}</div>`;
}

function reset() {
  $("#rounds").innerHTML = "";
  $("#weight-trajectory").innerHTML = "";
  $("#belief-trajectory").innerHTML = "";
  $("#terminal-panel").classList.add("hidden");
  // The brief stays visible during the run — compacted to one line, not removed.
  $("#scenario-card").classList.add("compact");
  state.round = null; state.roundNum = 0; state.prevWeights = null;
  state.prevOffer = null; state.beliefByRound = {};
}

function run() {
  if (state.source) state.source.close();
  reset();
  $("#run-btn").disabled = true;
  const id = $("#scenario-select").value;
  state.scenarioId = id;
  const gmMode = $("#gm-select")?.value ?? "deterministic";
  state.mode = gmMode;
  $("#truth-hint").textContent =
    gmMode === "human" ? "you ARE the counterparty — make the council guess wrong"
    : gmMode === "duel" ? "same counterparty, same seed — beat the council if you can"
    : "type hidden until final round";
  // The masthead has been read; give the proceedings the screen.
  document.body.classList.add("running");
  // The spine tracks council deliberation — in duel mode YOU are the council.
  $("#pipeline-rail").classList.toggle("hidden", gmMode === "duel");
  $("#pipeline-rail").classList.remove("complete");
  state.autoFollow = true;
  // The causal lever: a rerun with the EVI probe gate removed — same seed, same world.
  const ablated = state.ablateNext === true;
  state.ablateNext = false;
  state.ablatedRun = ablated;
  if (ablated) {
    $("#rounds").appendChild(el("div", "ablate-banner",
      `⊘ PROBE GATE REMOVED — same seed, same counterparty, one mechanism missing`));
  }
  const src = new EventSource(
    `/api/negotiate?scenario=${encodeURIComponent(id)}&gm=${encodeURIComponent(gmMode)}` +
      `&speed=${state.speed}${ablated ? "&ablate=probe" : ""}`,
  );
  state.source = src;
  src.onmessage = (e) => handle(JSON.parse(e.data));
  src.onerror = () => finish();
}

function finish() {
  if (state.source) state.source.close();
  clearBetweenRounds();
  if (state.round && state.round.thinking) {
    state.round.thinking.remove();
    state.round.thinking = null;
  }
  $("#run-btn").disabled = false;
  $("#scenario-card").classList.remove("compact");
  spineComplete();
  loadAb();
}

function handle(ev) {
  spine(EVENT_STAGE[ev.type]);
  switch (ev.type) {
    case "round-start": return startRound(ev);
    case "belief": return renderBelief(ev.before, ev.after);
    case "intent": return renderIntent(ev.read);
    case "position": return renderLens(ev.position);
    case "challenge": return renderChallenge(ev.challenge);
    case "evi": return renderEvi(ev.evi);
    case "arbiter": return renderArbiter(ev.verdict);
    case "engine": return renderEngine(ev.engine);
    case "quant": return renderQuant(ev.quant);
    case "gate": return renderGate(ev.gate);
    case "council-move": return renderCouncilMove(ev.move);
    case "receipt": return renderReceipt(ev.receipt);
    case "terminal": return renderTerminal(ev.terminal);
    case "your-move": return renderYourMove(ev);
    case "duel-result": return renderDuelResult(ev);
    case "error": return renderStreamError(ev.message);
    case "done": return finish();
  }
}

/** POST the human's move back to the parked negotiation loop. */
async function sendHumanMove(sessionId, body, dock) {
  dock.classList.add("hd-sent");
  dock.querySelectorAll("button, input, textarea").forEach((n) => { n.disabled = true; });
  await fetch("/api/human-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...body }),
  });
  dock.remove();
}

function renderYourMove(ev) {
  clearBetweenRounds();
  const dock = el("div", "human-dock");
  if (ev.probed) dock.classList.add("probed");

  if (ev.kind === "seller") {
    // DUEL: you are the seller — pick one of the council's seven actions.
    dock.innerHTML =
      `<div class="hd-head"><span class="hd-title">⇡ YOUR MOVE — you are the seller</span>` +
      `<span class="hint">their offer ${money(ev.theirOffer)} · your ask ${money(ev.yourAsk)} · ${ev.roundsLeft} round${ev.roundsLeft !== 1 ? "s" : ""} left</span></div>` +
      `<div class="hd-chips">` +
      ACTIONS.map((a) => `<button class="hd-chip" data-a="${a}">${label(a)}</button>`).join("") +
      `</div>`;
    dock.querySelectorAll(".hd-chip").forEach((btn) =>
      btn.addEventListener("click", () => sendHumanMove(ev.sessionId, { sellerAction: btn.dataset.a }, dock)),
    );
  } else {
    // You are the counterparty: say anything — the council reads behaviour.
    const opening = ev.kind === "opening";
    const briefBits = [
      `your true ceiling <b>${money(ev.reservation)}</b>`,
      ev.hasCompetitor ? `competing quote: <b>real</b>` : `competing quote: <b>none — bluff at will</b>`,
      `your asks visibly include <b>${ev.featureNeed}</b> — how much it matters is yours to reveal`,
    ];
    dock.innerHTML =
      `<div class="hd-head"><span class="hd-title">⇣ THE TABLE IS YOURS — you are the counterparty</span></div>` +
      `<div class="hd-brief">SECRET BRIEF · ${briefBits.join(" · ")} · the council sees none of this</div>` +
      (ev.probed
        ? `<div class="hd-probe">⚑ SYNOD IS PROBING YOU — it wants to know what's really driving your number. Hold the bluff, or come clean?</div>`
        : "") +
      (ev.councilAction && !opening
        ? `<div class="hd-ctx hint">Synod played <b>${ev.councilAction}</b>, standing at ${money(ev.councilAsk)}${ev.councilFeatures?.length ? ` · offering: ${ev.councilFeatures.join(", ")}` : ""}</div>`
        : "") +
      `<textarea class="hd-msg" rows="2" placeholder="${opening ? "open however you like — bluff, charm, stonewall…" : "say anything — the council reads what you DO, not what you say"}"></textarea>` +
      `<div class="hd-row">` +
        `<label class="hd-lbl">your offer</label>` +
        `<input class="hd-offer" type="number" step="100" min="${opening ? 1 : ev.yourOffer}" max="${ev.reservation}" value="${ev.suggestedOffer}" />` +
        (ev.canRevealNeed ? `<label class="hd-check"><input type="checkbox" class="hd-need" /> reveal your real need</label>` : "") +
        (ev.canRevealCompetitor ? `<label class="hd-check"><input type="checkbox" class="hd-comp" /> disclose the competing quote</label>` : "") +
      `</div>` +
      `<div class="hd-actions">` +
        `<button class="hd-send">Send response</button>` +
        (!opening ? `<button class="hd-accept ghost-btn">Accept their ask${ev.councilAsk ? ` (${money(ev.councilAsk)})` : ""}</button>` : "") +
        (!opening ? `<button class="hd-walk ghost-btn">Walk away</button>` : "") +
      `</div>`;

    const payload = () => ({
      action: "continue",
      message: dock.querySelector(".hd-msg").value,
      offer: Number(dock.querySelector(".hd-offer").value),
      revealNeed: dock.querySelector(".hd-need")?.checked ?? false,
      revealCompetitor: dock.querySelector(".hd-comp")?.checked ?? false,
    });
    dock.querySelector(".hd-send").addEventListener("click", () => sendHumanMove(ev.sessionId, payload(), dock));
    dock.querySelector(".hd-accept")?.addEventListener("click", () => sendHumanMove(ev.sessionId, { action: "accept_ask" }, dock));
    dock.querySelector(".hd-walk")?.addEventListener("click", () => sendHumanMove(ev.sessionId, { action: "walk" }, dock));
  }

  $("#rounds").appendChild(dock);
  state.autoFollow = true; // the dock demands the wheel back
  follow(dock);
}

/** DUEL verdict: you, the council, and the baseline on the identical negotiation. */
function renderDuelResult(ev) {
  const cols = [
    { who: "YOU", t: ev.you },
    { who: "SYNOD", t: ev.synod },
    { who: "BASELINE", t: ev.baseline },
  ];
  const best = Math.max(...cols.map((c) => c.t.surplusCaptured));
  const youWon = ev.you.surplusCaptured >= ev.synod.surplusCaptured;
  const line = youWon
    ? `you matched or beat the council — ${money(ev.you.surplusCaptured)} vs ${money(ev.synod.surplusCaptured)}. Respect.`
    : `the council out-negotiated you by <b>${money(ev.synod.surplusCaptured - ev.you.surplusCaptured)}</b> on the identical counterparty and seed.`;
  const band = el("div", "disposition duel-band");
  band.innerHTML =
    `<div class="disp-stamp">DUEL VERDICT</div>` +
    `<div class="duel-cols">` +
    cols.map((c) =>
      `<div class="duel-col ${c.t.surplusCaptured === best ? "duel-best" : ""}">` +
        `<span class="dc-who">${c.who}</span>` +
        `<span class="dc-val ${c.t.dealSurvived ? "" : "walk"}">${c.t.dealSurvived ? money(c.t.surplusCaptured) : "WALK"}</span>` +
        `<span class="dc-sub">${c.t.dealSurvived ? "deal closed" : "no deal · $0"}</span>` +
      `</div>`,
    ).join("") +
    `</div>` +
    `<div class="disp-cf">${line} <span class="hint">same GM · same seed · surplus above the $8,000 floor</span></div>`;
  $("#rounds").appendChild(band);
  follow(band);
}

/**
 * File a completed round: collapse it to a one-line story strip —
 * THEM → READ → COUNCIL → SENT — the four beats of a round, in one glance.
 * Click reopens the full record. The live round keeps the full theater.
 */
function fileRound(r) {
  if (!r || r.filed || !r.card) return;
  r.filed = true;

  const tally = (() => {
    const counts = {};
    for (const p of Object.values(r.positions)) {
      const fav = topAction(p.scores);
      counts[fav] = (counts[fav] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return "";
    const [act, n] = sorted[0];
    return `${n}–${ORDER.length - n} ${label(act)}`;
  })();

  const b = r.beliefData;
  const sig = r.signal ? r.signal.replace(/:.*$/, "").replace(/_/g, " ") : "";
  const segs = [
    `<span class="rs-seg"><i>them</i>${money(r.offerPrice)}${sig ? ` · ${sig}` : ""}</span>`,
  ];
  if (b) segs.push(`<span class="rs-seg"><i>read</i><span class="bseg-${b.dominant}-txt">${TYPE_SHORT[b.dominant]} ${Math.round(b.after[b.dominant] * 100)}%</span></span>`);
  if (tally) segs.push(`<span class="rs-seg"><i>council</i>${tally}</span>`);
  if (r.sentMove) segs.push(`<span class="rs-seg rs-sent"><i>sent</i>${label(r.sentMove.action)} @ ${money(r.sentMove.ask.price)}</span>`);

  const strip = el("div", "round-strip",
    (r.disarmed ? `<span class="rs-flag" title="deception disarmed this round">⚑</span>` : "") +
    segs.join(`<span class="rs-arr">→</span>`) +
    `<span class="rs-caret">▸</span>`);
  const head = r.card.querySelector(".round-head");
  head.insertAdjacentElement("afterend", strip);
  strip.addEventListener("click", () => r.card.classList.toggle("filed"));
  r.card.classList.add("filed");
}

function startRound(ev) {
  clearBetweenRounds();
  fileRound(state.round); // the previous round goes into the record
  state.roundNum = ev.round;
  spineRound(ev.round);
  const card = el("div", "round");
  const ts = new Date().toLocaleTimeString("en-GB");
  card.appendChild(el("div", "round-head",
    `<span class="rh-no">ROUND ${String(ev.round).padStart(2, "0")}</span>` +
    `<span class="rh-rule"></span>` +
    `<span class="rh-time">session convened ${ts}</span>`));

  // The climax: a probe broke the act. This is the thesis — give it the stamp.
  const reveals = ev.move.signals.filter((s) => s === "revealed_competitor" || s.startsWith("revealed_need:"));
  if (reveals.length) {
    const parts = [];
    if (reveals.includes("revealed_competitor")) parts.push("the competitor leverage was a bluff");
    const need = reveals.find((s) => s.startsWith("revealed_need:"));
    if (need) parts.push(`real need surfaced: ${need.split(":")[1]}`);
    card.appendChild(el("div", "disarm-banner",
      `<span class="db-stamp">⚑ DECEPTION DISARMED</span><span class="db-text">${parts.join(" · ")}` +
      ` — <b>a single-stance agent never asks; it walks with $0</b></span>`));
    // A split-second gold wash over the whole room — the case just turned.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const flash = el("div", "flash-overlay");
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 650);
    }
  }

  // Offer delta: movement is the story in a negotiation.
  const price = ev.move.offer.price;
  const delta = state.prevOffer != null ? price - state.prevOffer : null;
  state.prevOffer = price;
  const deltaHtml = delta
    ? ` <span class="offer-delta ${delta > 0 ? "up" : "dn"}">${delta > 0 ? "↑" : "↓"} ${money(Math.abs(delta))}</span>`
    : "";

  const cp = el("div", "cp-move");
  const msgEl = el("div", "cp-msg");
  cp.innerHTML =
    `<div class="cp-meta"><span class="who">⇣ inbound · counterparty</span>` +
    `<span class="offer">${money(price)}${deltaHtml}</span></div>`;
  cp.appendChild(msgEl);
  cp.insertAdjacentHTML("beforeend", `<div class="sig">${ev.move.signals.map((s) => `<span class="tagx">${s}</span>`).join("")}</div>`);
  typewriter(msgEl, ev.move.message);
  card.appendChild(cp);
  const lenses = el("div", "lenses");
  // Thinking indicator: visible until the first lens card arrives (no council in duel mode)
  let thinking = null;
  if (state.mode !== "duel") {
    thinking = el("div", "thinking");
    thinking.innerHTML = `<span></span><span></span><span></span>`;
    lenses.appendChild(thinking);
  }
  card.appendChild(lenses);
  $("#rounds").appendChild(card);
  // positions: raw per-doctrine data; stageEls: spine click-to-scroll targets;
  // offerPrice/signal/disarmed/sentMove feed the story strip when the round files.
  state.round = {
    card, lenses, lensEls: {}, positions: {}, decision: null, thinking,
    stageEls: { inbound: cp, council: lenses },
    num: ev.round, offerPrice: price, disarmed: reveals.length > 0,
    signal: ev.move.signals.find((s) => s !== "opening") ?? null,
  };
  follow(card);
}

/** Remove the between-rounds waiting indicator if one exists. */
function clearBetweenRounds() {
  const existing = document.getElementById("between-rounds");
  if (existing) existing.remove();
}

function renderBelief(before, after) {
  if (!state.round) return;
  // The belief bar renders inside the Empathy card (one concept, one card) —
  // here we just record the update and feed the trajectory.
  const dominant = TYPES.reduce((a, b) => after[b] > after[a] ? b : a);
  const isFirstRound = Object.values(before).every(v => Math.abs(v - 1 / 3) < 0.02);
  const delta = after[dominant] - before[dominant];
  state.round.beliefData = { before, after, dominant, delta, isFirstRound };
  state.beliefByRound[state.roundNum] = {
    dominant, pct: after[dominant], prevPct: before[dominant],
  };
  addTrajRow("#belief-trajectory", state.roundNum, TYPES.map((t) => ({ cls: `bseg-${t}`, w: after[t] })), TYPE_SHORT[dominant]);
  state.round.lastBelief = after;
}

function renderIntent(read) {
  if (!state.round) return;
  const typeLabel = TYPE_SHORT[read.likelyType] ?? read.likelyType;
  const flags = read.flags.map((f) => `<span class="tagx">${f}</span>`).join("");

  // Belief bar, folded in from the preceding belief event
  let beliefHtml = "";
  const b = state.round.beliefData;
  if (b) {
    let deltaBadge = "";
    if (!b.isFirstRound && Math.abs(b.delta) > 0.04) {
      const sign = b.delta > 0 ? "+" : "";
      deltaBadge = `<span class="belief-delta ${b.delta > 0 ? "up" : "dn"}">${sign}${Math.round(b.delta * 100)}%</span>`;
    }
    const barInner = TYPES.map((t) =>
      `<span class="bseg-${t}" style="width:${b.after[t] * 100}%"></span>`,
    ).join("");
    beliefHtml =
      `<div class="belief-row">` +
        `<span class="belief-lbl">belief</span>` +
        `<span class="bbar">${barInner}</span>` +
        `<span class="belief-dom bseg-${b.dominant}-txt">${TYPE_SHORT[b.dominant]} ${Math.round(b.after[b.dominant] * 100)}%</span>` +
        deltaBadge +
      `</div>`;
  }

  const card = el("div", "empathy-broadcast");
  card.innerHTML =
    `<div class="eb-header">` +
      `<span class="eb-label">Intent reads</span>` +
      `<span class="eb-type">${typeLabel}</span>` +
      `<span class="eb-trust hint">${pct(read.readTrust)} confidence</span>` +
      `<span class="eb-arrow hint">→ shapes all 5 positions below</span>` +
    `</div>` +
    beliefHtml +
    `<div class="eb-summary">${read.summary}</div>` +
    (flags ? `<div class="eb-flags">${flags}</div>` : "");
  state.round.card.insertBefore(card, state.round.lenses);
  state.round.stageEls.belief = card;
  state.round.stageEls.intent = card;
}

function renderLens(p) {
  if (!state.round) return;
  const m = lens(p.doctrine);
  const favAction = topAction(p.scores);

  // Remove thinking indicator on first lens
  if (state.round.thinking) {
    state.round.thinking.remove();
    state.round.thinking = null;
  }
  // Store for vote-split and post-engine agree/dissent marking
  state.round.positions[p.doctrine] = p;

  // Collapsed = one scannable line. The worldview lives in the expansion.
  const node = el("div", "lens");
  node.dataset.d = p.doctrine;
  node.dataset.vote = favAction;
  node.style.setProperty("--lens-delay", `${ORDER.indexOf(p.doctrine) * 60}ms`);
  node.innerHTML = `
    <div class="lens-head">
      <span class="lens-name">${m.cogFunction}</span>
      <span class="lens-persona">${m.name}</span>
      <span class="lens-fav">${label(favAction)}</span>
      <span class="caret">▸</span>
    </div>
    <div class="lens-body">
      <div class="lens-q-full">${m.question} <span class="lens-dim">· ${m.dimension}</span></div>
      <div class="lens-meta"><b>${m.coreBelief}</b><br/>${m.thinkingStyle} <span class="hint">· math: ${m.math} · watch: ${m.failureMode}</span></div>
      <div class="lens-rationale">${p.rationale}</div>
      <div class="scores"></div>
    </div>`;
  const scores = node.querySelector(".scores");
  scores.appendChild(el("div", "score-scale", `<span></span><span class="scale-track"><span>−1</span><span>0</span><span>+1</span></span><span></span>`));
  for (const a of ACTIONS) scores.appendChild(scoreRow(label(a), p.scores[a]));
  node.addEventListener("click", () => node.classList.toggle("open"));
  state.round.lenses.appendChild(node);
  state.round.lensEls[p.doctrine] = node;

  // Once all 5 lenses have arrived, render the vote split summary
  if (Object.keys(state.round.positions).length === ORDER.length) {
    renderVoteSplit();
  }
}

/** Tallies each lens's top-voted action and renders a "3 favour X · 2 favour Y" line. */
function renderVoteSplit() {
  const voteCounts = {};
  for (const p of Object.values(state.round.positions)) {
    const fav = topAction(p.scores);
    voteCounts[fav] = (voteCounts[fav] || 0) + 1;
  }
  const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
  const isUnanimous = sorted.length === 1;

  const splitEl = el("div", "vote-split");
  state.round.splitEl = splitEl;

  const voteTip = "Lenses score independently — cross-contamination is a known failure mode in expert committees. The Arbiter resolves disagreement at synthesis time, not during scoring.";
  if (isUnanimous) {
    splitEl.innerHTML =
      `<span class="split-lbl">VOTE${info(voteTip)}</span> ` +
      `<span class="split-unanimous">unanimous — all five favour ${label(sorted[0][0])}</span>`;
  } else {
    const parts = sorted
      .map(([action, count]) => `<b>${count}</b>&thinsp;${label(action)}`)
      .join(` <span class="split-dot">·</span> `);
    splitEl.innerHTML = `<span class="split-lbl">VOTE${info(voteTip)}</span> ${parts}`;
  }

  // Insert directly after the lenses container
  state.round.lenses.insertAdjacentElement("afterend", splitEl);
}

function scoreRow(name, v) {
  const row = el("div", "score-row");
  row.appendChild(el("span", null, name));
  const track = el("div", "score-track"); track.appendChild(el("span", "mid"));
  const f = el("span", v >= 0 ? "fill pos" : "fill neg"); f.style.width = `${Math.abs(v) * 50}%`;
  track.appendChild(f); row.appendChild(track);
  row.appendChild(el("span", null, sci(v)));
  return row;
}

function ensureDecision() {
  if (state.round.decision) return state.round.decision;
  const d = el("div", "decision");
  state.round.card.appendChild(d);
  state.round.decision = d;
  return d;
}

const LENS_COLORS = { empathy: "var(--empathy)", battle: "var(--battle)", war: "var(--war)", probe: "var(--probe)", risk: "var(--risk)" };

function renderChallenge(c) {
  if (!state.round) return;
  if (!state.round.pendingChallenge) {
    state.round.pendingChallenge = c;
    return;
  }
  const first = state.round.pendingChallenge;
  state.round.pendingChallenge = null;

  const challengerM = lens(first.from);
  const defenderM = lens(first.against);
  const defenderPos = state.round.positions[first.against];
  const contestedAction = defenderPos ? label(topAction(defenderPos.scores)) : "";

  const makeBrief = (doctrine, m, speechText, stanceLabel, stanceText, revisionHtml) => {
    const brief = el("div", "cr-brief");
    brief.innerHTML =
      `<div class="cr-brief-inner">` +
        `<div class="cr-brief-label" style="color:${LENS_COLORS[doctrine]}">${m.cogFunction}</div>` +
        `<div class="cr-speech">${speechText}</div>` +
        (stanceText ? `<div class="cr-stance"><span class="cr-stance-lbl">${stanceLabel}</span> ${stanceText}</div>` : ``) +
      (revisionHtml ?? ``) +
      `</div>`;
    return brief;
  };

  // Causal concession: the defense event carries original → revised score on the
  // contested action. Update our stored position so the verdict math matches the
  // post-dialogue council the engine actually scored.
  let revisionHtml = null;
  if (c.revisedScore !== undefined && c.contested) {
    const defStored = state.round.positions[c.from];
    if (defStored) defStored.scores[c.contested] = c.revisedScore;
    revisionHtml =
      `<div class="cr-revision">concession under challenge · ` +
      `${c.originalScore.toFixed(2)} → <b>${c.revisedScore.toFixed(2)}</b> on ${label(c.contested)}</div>`;
  }

  const leftBrief  = makeBrief(first.from, challengerM, first.text, "contests", contestedAction, null);
  const rightBrief = makeBrief(c.from, defenderM, c.text, "defends", contestedAction, revisionHtml);

  const briefs = el("div", "cr-briefs");
  briefs.appendChild(leftBrief);
  briefs.appendChild(rightBrief);

  const verdictEl = el("div", "cr-verdict");
  verdictEl.textContent = "—";

  const record = el("div", "challenge-record");
  record.appendChild(briefs);
  record.appendChild(verdictEl);

  const anchor = state.round.splitEl ?? state.round.lenses;
  anchor.insertAdjacentElement("afterend", record);

  // Sequential brief opening: left opens first, pause, right opens
  setTimeout(() => leftBrief.classList.add("open"), 120);
  setTimeout(() => rightBrief.classList.add("open"), 720);

  state.round.challengesEl = record;
  state.round.verdictEl = verdictEl;
  state.round.challengerDoctrine = first.from;
  state.round.challengeDefenderDoctrine = first.against;
  state.round.stageEls.challenge = record;
  follow(record);
}

function renderEvi(evi) {
  const d = ensureDecision();
  state.round.eviWorthIt = evi.worthIt;
  state.round.eviValue = evi.evi;
  const tip = "Expected Value of Information: the deterministic referee's estimate of what learning the counterparty type is worth before committing. In offline mode this gates the Learning lens directly; in live mode the LLM lenses weigh it as worldviews — the engine records any divergence below.";
  d.appendChild(el("div", "row", `Probe EVI${info(tip)}: ${money(evi.evi)} ${evi.worthIt ? "<b>&gt; cost → information pays</b>" : "≤ cost (advisory)"}`));
}

function renderArbiter(v) {
  const tipText = ORDER.map((d) => `${lens(d).cogFunction}: ${pct(v.weights[d])}`).join(" · ");

  // Weight-shift badge: largest gainer vs prior round (shows Bayesian update driving Arbiter)
  let shiftLabel = null;
  if (state.prevWeights) {
    let topGainer = null, topDelta = 0;
    for (const d of ORDER) {
      const delta = v.weights[d] - (state.prevWeights[d] ?? 0);
      if (delta > topDelta) { topDelta = delta; topGainer = d; }
    }
    if (topGainer && topDelta > 0.12) shiftLabel = `${lens(topGainer).cogFunction} ↑${Math.round(topDelta * 100)}pp`;
  }
  state.prevWeights = { ...v.weights };
  // For the cross-chart hover: belief shift ⟶ weight shift, per round
  if (state.beliefByRound[state.roundNum]) state.beliefByRound[state.roundNum].shift = shiftLabel;

  addTrajRow("#weight-trajectory", state.roundNum, ORDER.map((d) => ({ cls: `seg-${d}`, w: v.weights[d] })), shiftLabel, tipText);
  const ctx = v.context;
  const d = ensureDecision();
  const topLens = ORDER.reduce((a, b) => v.weights[b] > v.weights[a] ? b : a);
  const arbTip = "The Arbiter reads terrain, not the council's arguments. It sees the context vector and Empathy's read — not what Battle or War said. An Arbiter that read the rationale snippets would reward the most persuasive lens, not the most contextually appropriate one. The rationale snippets are for you, not for the machine.";

  const TERRAIN_FACTORS = [
    { key: "trustEst",          name: "trust",        tip: "↑ activates Battle; ↓ activates War" },
    { key: "infoConfidence",    name: "info conf",    tip: "↓ unresolved belief activates Probe + Empathy" },
    { key: "adversarialSignal", name: "adversarial",  tip: "↑ activates Risk + War; ↓ activates Battle" },
    { key: "exposure",          name: "exposure",     tip: "↑ activates Risk" },
  ];

  const factorRows = TERRAIN_FACTORS.map((f) =>
    `<div class="arb-factor">` +
      `<span class="arb-flabel" title="${f.tip}">${f.name}</span>` +
      `<div class="arb-bar"><div class="arb-fill" style="width:${Math.round(ctx[f.key] * 100)}%"></div></div>` +
      `<span class="arb-fval">${pct(ctx[f.key])}</span>` +
    `</div>`
  ).join("");

  let narrative = v.rationale;
  if (state.round && state.round.lastBelief) {
    const dominant = TYPES.reduce((a, b) => state.round.lastBelief[b] > state.round.lastBelief[a] ? b : a);
    narrative =
      `<span class="bseg-${dominant}-txt">${TYPE_SHORT[dominant]}</span> ${pct(state.round.lastBelief[dominant])} ` +
      `→ <span style="color:var(--${topLens})">${lens(topLens).cogFunction}</span> leads · ${v.rationale}`;
  }

  const arbSection = el("div", "arbiter-section");
  arbSection.innerHTML =
    `<div class="arb-header">` +
      `<span class="arb-badge">ARBITER${info(arbTip)}</span>` +
      `<span class="arb-rounds hint">${ctx.roundsLeft} round${ctx.roundsLeft !== 1 ? "s" : ""} left</span>` +
    `</div>` +
    `<div class="arb-terrain">${factorRows}</div>` +
    `<div class="arb-narrative">${narrative}</div>`;
  d.appendChild(arbSection);
  state.round.weights = { ...v.weights };
  state.round.stageEls.arbiter = arbSection;
}

function renderEngine(engine) {
  const d = ensureDecision();

  // Color-code each lens: green border if it voted for the recommendation, muted if it dissented
  if (state.round && state.round.positions) {
    for (const [doctrine, p] of Object.entries(state.round.positions)) {
      const lensEl = state.round.lensEls[doctrine];
      if (!lensEl) continue;
      lensEl.classList.add(topAction(p.scores) === engine.recommendation ? "lens-agree" : "lens-dissent");
    }
  }

  // Resolve the challenge record verdict now that the recommendation is known
  if (state.round && state.round.verdictEl) {
    const defPos = state.round.positions[state.round.challengeDefenderDoctrine];
    const chalPos = state.round.positions[state.round.challengerDoctrine];
    const defTop = defPos ? topAction(defPos.scores) : null;
    const chalTop = chalPos ? topAction(chalPos.scores) : null;
    const chalM = state.round.challengerDoctrine ? lens(state.round.challengerDoctrine) : null;
    const defM = state.round.challengeDefenderDoctrine ? lens(state.round.challengeDefenderDoctrine) : null;
    const chalName = (chalM?.cogFunction ?? "GAIN").toUpperCase();
    const defName = (defM?.cogFunction ?? "POSITION").toUpperCase();
    let verdictText, verdictCls;
    if (engine.recommendation === defTop) {
      verdictText = `CHALLENGE ABSORBED · ${defName} HOLDS`;
      verdictCls = "verdict-holds";
    } else if (engine.recommendation === chalTop) {
      verdictText = `${chalName} CARRIES · ${defName} CONCEDES`;
      verdictCls = "verdict-carries";
    } else {
      verdictText = `COUNCIL DECIDES · ${label(engine.recommendation).toUpperCase()}`;
      verdictCls = "verdict-other";
    }
    state.round.verdictEl.innerHTML = `<span class="${verdictCls}">${verdictText}</span>`;
    state.round.verdictEl.classList.add("resolved");
  }

  const dlTip = engine.deadlockReason === "thin-margin"
    ? "The winning action barely beat the runner-up — a close call, not a confident one. The system knows it is uncertain."
    : "The doctrines sharply disagree on the winning action — the recommendation sits on unresolved internal conflict.";
  const dl = engine.deadlock ? ` <span class="hint">⚠ ${engine.deadlockReason}${info(dlTip)}</span>` : "";
  const confTip = "Confidence drops for two reasons: thin margin (the winner barely beat the runner-up) or high dispersion (the doctrines sharply disagree on the winning action). Both are tracked separately.";

  // Dispersion gauge: how much doctrines disagreed on the winning action
  const dispNorm = Math.min(engine.dispersion / 1.5, 1); // rough ceiling at 1.5
  const dispLabel = engine.dispersion < 0.3 ? "low conflict" : engine.dispersion < 0.7 ? "contested" : "high conflict";
  const dispTip = "Weighted spread of doctrine scores on the winning action. Low = the council pulled in the same direction. High = the Arbiter weights broke genuine disagreement — the recommendation is correct but not obvious.";
  const dispBar =
    `<div class="dispersion-row">` +
    `<span class="ctx-lbl">conflict${info(dispTip)}</span>` +
    `<div class="dispersion-track"><div class="dispersion-fill" style="width:${Math.round(dispNorm * 100)}%"></div></div>` +
    `<span class="hint">${dispLabel} (${engine.dispersion.toFixed(2)})</span>` +
    `</div>`;

  const head = el("div");
  head.innerHTML =
    `<div class="rec-line"><span class="rec-lbl">COUNCIL RECOMMENDS</span> ` +
    `<span class="rec">${label(engine.recommendation)}</span> ` +
    `<span class="hint">conf ${pct(engine.confidence)}${info(confTip)}, margin ${engine.margin.toFixed(2)}</span>${dl}</div>` +
    dispBar;
  d.insertBefore(head, d.firstChild);
  state.round.stageEls.engine = d;
  state.round.stageEls.gate = d;

  // Show the minority: auto-open the strongest dissenting lens, once, so the
  // judge sees what disagreement looks like without having to hunt for it.
  const dissenter = state.round.lensEls[state.round.challengerDoctrine];
  if (dissenter && dissenter.classList.contains("lens-dissent") &&
      !Object.values(state.round.lensEls).some((n) => n.classList.contains("open"))) {
    dissenter.classList.add("open");
  }

  // The council may overrule the EVI referee (or ignore a green light) — that is
  // legitimate worldview-vs-arithmetic disagreement, but it must be NAMED on screen
  // or it reads as a bug.
  if (engine.recommendation === "probe" && state.round.eviWorthIt === false) {
    const tip = "The deterministic EVI referee priced the information below the probe's cost, but the weighted lens worldviews favoured probing anyway — e.g. Survival buying certainty, or Intent needing the read. The engine executes the council and records the divergence, exactly as it does when the Quant disagrees.";
    d.appendChild(el("div", "row", `⚖ council overrode the EVI referee${info(tip)}: lenses bought information the arithmetic priced at ${money(state.round.eviValue ?? 0)} — divergence on record`));
  } else if (engine.recommendation !== "probe" && state.round.eviWorthIt === true) {
    const tip = "The EVI referee priced information above the probe's cost, but the weighted council preferred another action. Recorded as divergence — the referee advises, the council decides.";
    d.appendChild(el("div", "row", `⚖ council declined the EVI referee's green light${info(tip)} — divergence on record`));
  }

  state.round.engineResult = engine;
  follow(d);
  // The synthesis, made visible: each lens's vote flows into the verdict.
  requestAnimationFrame(() => drawConvergence(engine));
}

/**
 * Convergence beams: when the engine rules, draw a beam from every lens's vote
 * chip into the recommendation — agreeing lenses bright and thick, dissenters
 * thin and faint. Two seconds of the architecture explaining itself, then gone.
 */
function drawConvergence(engine) {
  const r = state.round;
  if (!r || !r.decision || !r.card) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const NS = "http://www.w3.org/2000/svg";
  const cardRect = r.card.getBoundingClientRect();
  const targetEl = r.decision.querySelector(".rec") ?? r.decision;
  const t = targetEl.getBoundingClientRect();
  const tx = t.left + t.width / 2 - cardRect.left;
  const ty = t.top - cardRect.top + 2;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "converge");
  svg.setAttribute("width", String(r.card.clientWidth));
  svg.setAttribute("height", String(r.card.clientHeight));

  // Circuit-bus layout: each lens emits a short horizontal tick to a shared
  // vertical rail at the right edge; the rail flows down and turns into the
  // verdict. Orthogonal and schematic — no spaghetti.
  const busX = r.card.clientWidth - 14;
  let i = 0;
  let topY = Infinity;
  for (const dctr of ORDER) {
    const lensEl = r.lensEls[dctr];
    const pos = r.positions[dctr];
    if (!lensEl || !pos) continue;
    const chip = lensEl.querySelector(".lens-fav") ?? lensEl;
    const c = chip.getBoundingClientRect();
    const sx = c.right - cardRect.left + 4;
    const sy = c.top + c.height / 2 - cardRect.top;
    topY = Math.min(topY, sy);
    const tick = document.createElementNS(NS, "path");
    tick.setAttribute("d", `M ${sx} ${sy} L ${busX} ${sy}`);
    tick.setAttribute("pathLength", "1");
    tick.setAttribute("class", "beam");
    const agree = topAction(pos.scores) === engine.recommendation;
    tick.style.stroke = LENS_COLORS[dctr];
    tick.style.strokeWidth = agree ? "2.5" : "1";
    tick.style.opacity = agree ? "0.9" : "0.35";
    tick.style.animationDelay = `${i * 70}ms`;
    svg.appendChild(tick);
    i++;
  }
  if (i > 0 && Number.isFinite(topY)) {
    const bus = document.createElementNS(NS, "path");
    bus.setAttribute("d", `M ${busX} ${topY} L ${busX} ${ty} L ${tx} ${ty}`);
    bus.setAttribute("pathLength", "1");
    bus.setAttribute("class", "beam beam-bus");
    bus.style.animationDelay = `${i * 70 + 120}ms`;
    svg.appendChild(bus);
  }
  r.card.appendChild(svg);
  setTimeout(() => svg.classList.add("fade"), 1700);
  setTimeout(() => svg.remove(), 2500);
}

/**
 * Hold the gavel: the engine is deterministic and the scores are client-side, so
 * the user can re-weight the council and watch the recommendation respond live.
 * This is the ablation study made tactile — drag everything onto one lens and
 * you've reproduced the single-lens collapse from Exhibit B with your own hand.
 */
function renderGavel(engine) {
  if (!state.round || !state.round.weights) return;
  const positions = state.round.positions;
  if (Object.keys(positions).length !== ORDER.length) return;

  const details = el("details", "gavel");
  const startWeights = state.round.weights;
  details.innerHTML =
    `<summary><span class="gavel-mark">⚖</span> Hold the gavel <span class="hint">re-weight the council — the deterministic engine answers live</span></summary>`;
  const body = el("div", "gavel-body");

  const sliders = {};
  for (const dctr of ORDER) {
    const row = el("div", "gavel-row");
    const val = Math.round(startWeights[dctr] * 100);
    row.innerHTML =
      `<span class="gavel-lens" style="color:${LENS_COLORS[dctr]}">${lens(dctr).cogFunction}</span>` +
      `<input type="range" min="0" max="100" value="${val}" data-d="${dctr}" />` +
      `<span class="gavel-val">${val}%</span>`;
    sliders[dctr] = row.querySelector("input");
    body.appendChild(row);
  }
  const verdict = el("div", "gavel-verdict");
  body.appendChild(verdict);
  details.appendChild(body);

  const recompute = () => {
    const raw = {};
    let sum = 0;
    for (const dctr of ORDER) { raw[dctr] = Number(sliders[dctr].value); sum += raw[dctr]; }
    for (const dctr of ORDER) {
      const w = sum > 0 ? raw[dctr] / sum : 1 / ORDER.length;
      sliders[dctr].closest(".gavel-row").querySelector(".gavel-val").textContent = `${Math.round(w * 100)}%`;
      raw[dctr] = w;
    }
    const score = (a) => ORDER.reduce((s, dctr) => s + raw[dctr] * positions[dctr].scores[a], 0);
    const yours = ACTIONS.reduce((a, b) => (score(b) > score(a) ? b : a));
    const same = yours === engine.recommendation;
    verdict.innerHTML = same
      ? `your council sends <b class="gv-same">${label(yours)}</b> — same as the Arbiter's weighting`
      : `your council sends <b class="gv-diff">${label(yours)}</b> · the Arbiter's sent <b>${label(engine.recommendation)}</b>`;
    verdict.classList.toggle("diverged", !same);
  };
  for (const dctr of ORDER) sliders[dctr].addEventListener("input", recompute);
  recompute();

  state.round.decision.appendChild(details);
}

function renderQuant(q) {
  const d = ensureDecision();
  const verb = q.matchesRecommendation ? "matches the math" : "override priced in";
  const tip = "Pure money-EV check. Δ is the dollar cost of the doctrine-driven choice vs. cold expected value. The Quant flags but has no veto — maximise EV is itself a doctrine, and a Quant with a veto would silently win every deadlock.";
  d.appendChild(el("div", "row", `Quant${info(tip)}: EV-optimal ${label(q.evOptimal)}, Δ ${money(q.delta)} <span class="hint">(${verb})</span>`));
}

function renderGate(g) {
  const d = ensureDecision();
  const tip = "Rules-based execution gate. Checks confidence and exposure before committing any action. EXECUTE: auto-approved. BLOCK: too risky or irreversible. ESCALATE: low confidence or large EV-divergence. Every decision is cryptographically signed.";
  d.appendChild(el("div", "row", `Execution gate${info(tip)}: <span class="pill ${g.gate}">${g.gate.toUpperCase()}</span> ${g.reason}`));
  if (state.round?.engineResult) renderGavel(state.round.engineResult);
}

/** Signed receipt chip — the auditability claim, made visible per round. */
function renderReceipt(receipt) {
  if (!state.round || !state.round.decision) return;
  const chip = el("div", "receipt-chip");
  const sig = String(receipt.signature ?? "").slice(0, 16);
  chip.innerHTML = `<span class="rc-tick">✓</span> receipt signed <span class="rc-sig">${sig}…</span>`;
  const pre = el("pre", "receipt-json hidden");
  pre.textContent = JSON.stringify(receipt, null, 2);
  chip.addEventListener("click", () => pre.classList.toggle("hidden"));
  state.round.decision.appendChild(chip);
  state.round.decision.appendChild(pre);
}

function renderCouncilMove(move) {
  if (!state.round) return;
  const feats = move.ask.features.length ? ` · terms: ${move.ask.features.join(", ")}` : "";
  const who = state.mode === "duel" ? "YOU send" : "Synod sends";
  const node = el("div", "council-move", `<span class="lbl">⇡ outbound · ${who}</span> <b>${label(move.action)}</b> @ ${money(move.ask.price)}${feats}`);
  state.round.card.appendChild(node);
  state.round.sentMove = move;
  state.round.stageEls.outbound = node;
  follow(node);
  // Between-rounds indicator: shows until the next round-start fires
  const waiting = el("div", "between-rounds");
  waiting.id = "between-rounds";
  waiting.innerHTML = `<span></span><span></span><span></span>`;
  $("#rounds").appendChild(waiting);
}

function renderStreamError(message) {
  clearBetweenRounds();
  const errEl = el("div", "stream-error");
  errEl.innerHTML = `<b>Error</b> — ${message || "connection lost"}`;
  if (state.round && state.round.card) {
    state.round.card.appendChild(errEl);
  } else {
    $("#rounds").appendChild(errEl);
  }
}

function renderTerminal(t) {
  const panel = $("#terminal-panel");
  panel.classList.remove("hidden");
  const trustColor = t.trustFinal >= 60 ? "var(--good)" : t.trustFinal >= 40 ? "var(--accent)" : "var(--bad)";
  const trustWord = t.trustFinal >= 60 ? "warm" : t.trustFinal >= 40 ? "workable" : "strained";
  const trustTip = "Trust (0–100) tracks how the counterparty perceived the Council's conduct. Warm (≥60): cooperative play paid off. Workable (40–59): deal closed but relationship taxed. Strained (<40): pressure degraded the relationship even if the deal survived.";
  const stamp = t.dealSurvived
    ? `<div class="case-stamp closed">Case closed</div>`
    : `<div class="case-stamp walked">No deal</div>`;
  const big = t.dealSurvived
    ? `<div class="big">${money(t.surplusCaptured)}</div><div class="sub">surplus captured · ${t.outcome}</div>`
    : `<div class="big walk">WALK</div><div class="sub">no deal · counterparty walked</div>`;
  const trustRow = `<div class="trust-row"><span class="trust-score" style="color:${trustColor}">${Math.round(t.trustFinal)}</span><span class="trust-label">${trustWord} trust${info(trustTip)}</span></div>`;
  $("#terminal-body").innerHTML = `${stamp}${big}${trustRow}`;

  // The ending ends the proceeding: a full-width disposition band in the record
  // itself, with the counterfactual — what the single agent did on this same type.
  const ab = state.abReport?.rows.find((r) => r.id === state.scenarioId);
  const cf = ab
    ? `<div class="disp-cf">the single-agent baseline on this counterparty: ` +
      `<b>${money(ab.baseline.surplusMean)}</b> mean · <b>${pctFmt(ab.baseline.dealRate)}</b> deals (n=${ab.baseline.n}) — ` +
      `<a href="#exhibit-a">Exhibit A</a></div>`
    : "";
  fileRound(state.round); // the final round joins the record; the band is the ending
  // Declassification: the hidden type comes out from under the redaction bar.
  // In human mode there is no ground truth about the player — only the brief they
  // were handed and the behaviour the council actually read. The type system is
  // behavioural, not a name tag: a "relationship" player who fabricates leverage
  // and stonewalls IS behaving deceptively, and the read should say so.
  const entry = state.meta.suite.find((s) => s.id === state.scenarioId);
  let declass = "";
  if (entry && state.mode === "human") {
    const lb = state.round?.lastBelief;
    const dom = lb ? TYPES.reduce((a, b) => (lb[b] > lb[a] ? b : a)) : null;
    const read = dom
      ? ` — the council read your <b>behaviour</b> as <span class="bseg-${dom}-txt">${TYPE_SHORT[dom]} ${Math.round(lb[dom] * 100)}%</span>`
      : "";
    declass =
      `<div class="declass"><span class="dcl-lbl">BRIEF DECLASSIFIED</span> you played the ` +
      `<span class="redacted"><i>${entry.title}</i></span> brief${read}</div>`;
  } else if (entry) {
    declass =
      `<div class="declass"><span class="dcl-lbl">DOSSIER DECLASSIFIED</span> counterparty was ` +
      `<span class="redacted"><i>${entry.title}</i></span></div>`;
  }

  const band = el("div", `disposition ${t.dealSurvived ? "disp-deal" : "disp-walk"}`);
  band.innerHTML =
    `<div class="disp-stamp">${t.dealSurvived ? "CASE CLOSED" : "NO DEAL"}</div>` +
    `<div class="disp-main">` +
      `<span class="disp-big">${t.dealSurvived ? money(t.surplusCaptured) : "WALK"}</span>` +
      `<span class="disp-sub">${t.dealSurvived ? `surplus captured · ${t.outcome}` : "counterparty walked"} · trust ${Math.round(t.trustFinal)} (${trustWord})</span>` +
    `</div>` + declass + cf;

  // The lever a judge can flip: rerun this exact negotiation without the probe gate.
  if (state.mode === "deterministic" && !state.ablatedRun) {
    const btn = el("button", "ablate-btn", "⊘ rerun without the probe gate — same seed");
    btn.addEventListener("click", () => {
      state.gateBaseline = { surplus: t.surplusCaptured, deal: t.dealSurvived };
      state.ablateNext = true;
      run();
    });
    band.appendChild(btn);
  } else if (state.ablatedRun && state.gateBaseline) {
    band.insertAdjacentHTML("beforeend",
      `<div class="disp-cf">probe gate removed this run · with the gate (the run before): ` +
      `<b>${state.gateBaseline.deal ? money(state.gateBaseline.surplus) : "WALK"}</b> — the mechanism is the difference</div>`);
  }

  $("#rounds").appendChild(band);
  follow(band);
}

function addTrajRow(sel, round, segs, dominantLabel, stackTooltip) {
  const row = el("div", "traj-row");
  row.dataset.round = round;
  row.appendChild(el("span", null, `r${round}`));
  const stack = el("div", "stack");
  if (stackTooltip) stack.title = stackTooltip;
  for (const s of segs) { const seg = el("span", s.cls); seg.style.width = `${s.w * 100}%`; stack.appendChild(seg); }
  row.appendChild(stack);
  if (dominantLabel) row.appendChild(el("span", "traj-dom", dominantLabel));

  // Cross-chart hover: same round lights up in both charts, with the causal line
  // belief shift ⟶ weight shift spelled out underneath.
  row.addEventListener("mouseenter", () => {
    document.querySelectorAll(`.traj-row[data-round="${round}"]`).forEach((r) => r.classList.add("traj-hot"));
    const b = state.beliefByRound[round];
    const note = $("#traj-link") ?? (() => {
      const n = el("div", "traj-link-note");
      n.id = "traj-link";
      $("#weight-trajectory").insertAdjacentElement("afterend", n);
      return n;
    })();
    if (b) {
      note.innerHTML =
        `r${round}: P(<span class="bseg-${b.dominant}-txt">${TYPE_SHORT[b.dominant]}</span>) ` +
        `${Math.round(b.prevPct * 100)}% → ${Math.round(b.pct * 100)}%` +
        (b.shift ? ` <span class="arrow">⟶</span> ${b.shift}` : ` <span class="arrow">⟶</span> weights steady`);
      note.classList.add("visible");
    }
  });
  row.addEventListener("mouseleave", () => {
    document.querySelectorAll(".traj-hot").forEach((r) => r.classList.remove("traj-hot"));
    $("#traj-link")?.classList.remove("visible");
  });
  $(sel).appendChild(row);
}

const pctFmt = (r) => `${Math.round(r * 100)}%`;
const meanStd = (s) => `${money(s.surplusMean)} <span class="hint">±${money(s.surplusStd)}</span>`;

async function loadAblation() {
  const table = $("#ablation-table");
  if (!table) return;
  const report = await (await fetch("/api/ablation")).json();
  const full = report.rows[0];
  let head = `<tr><th>variant</th><th>what's removed</th><th>total surplus</th><th>Δ vs full</th><th>deal rate</th><th>deceptive</th></tr>`;
  let body = "";
  for (const r of report.rows) {
    const delta = r.totalSurplusMean - full.totalSurplusMean;
    const deltaTxt = r === full ? "—" : delta === 0 ? "±$0" : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}`;
    const deltaCls = delta < -100 ? "lose" : "";
    const isFull = r === full;
    // The headline causal result: removing the probe trigger is the single largest
    // component effect — the mechanism a judge can point at.
    const isCausal = r.variant.includes("probe");
    body += `<tr${isFull ? ` style="font-weight:600"` : ""}${isCausal ? ` class="row-causal"` : ""}>
      <td>${isCausal ? `<span class="causal-chip">PRIMARY CAUSAL RESULT</span> ` : ""}${r.variant}</td>
      <td style="text-align:left;color:var(--muted);font-size:0.78rem">${r.description}</td>
      <td class="${isFull ? "synod-col win" : ""}">${money(r.totalSurplusMean)}</td>
      <td class="${deltaCls}">${deltaTxt}</td>
      <td>${pctFmt(r.dealRate)}</td>
      <td>${money(r.deceptiveSurplusMean)}</td>
    </tr>`;
  }
  table.innerHTML = head + body;
}

async function loadAb() {
  $("#ab-table").innerHTML = "<tbody><tr><td colspan='4' style='color:var(--muted);padding:.6rem'>Computing A/B comparison…</td></tr></tbody>";
  const report = await (await fetch("/api/ab")).json();
  state.abReport = report; // the disposition band's counterfactual reads from this
  const table = $("#ab-table");
  const n = report.rows[0]?.council.n ?? 1;
  let head = `<tr><th>hidden type</th><th>baseline (mean ± σ)</th><th class="synod-col">Synod (mean ± σ)</th><th>deal rate <span class="hint">n=${n}</span></th></tr>`;
  let body = "";
  for (const r of report.rows) {
    const win = r.council.surplusMean > r.baseline.surplusMean;
    body += `<tr${r.id.includes("deceptive") ? ` class="row-deceptive"` : ""}>
      <td>${r.typeName}</td>
      <td>${meanStd(r.baseline)}</td>
      <td class="synod-col ${win ? "win" : ""}">${meanStd(r.council)}</td>
      <td><span class="oc-lbl">B</span> ${pctFmt(r.baseline.dealRate)} <span class="hint">·</span> <span class="oc-lbl">S</span> ${pctFmt(r.council.dealRate)}</td>
    </tr>`;
  }
  const t = report.totals;
  body += `<tr>
    <td><b>total surplus</b></td>
    <td>${money(t.baselineSurplusMean)}</td>
    <td class="synod-col win">${money(t.councilSurplusMean)}</td>
    <td><span class="oc-lbl">B</span> ${pctFmt(t.baselineDealRate)} <span class="hint">·</span> <span class="oc-lbl">S</span> ${pctFmt(t.councilDealRate)}</td>
  </tr>`;
  table.innerHTML = head + body;
}

/* ====== INTERACTIVE TOUR — a moving spotlight that operates the real UI.
   Few words by default: one short headline per stop; a “+” reveals depth. ====== */

const TOUR_STEPS = [
  { sel: () => $(".stat-strip"), head: "One claim: $0 vs $3,000. Same opponent, ten runs.",
    more: "A strong single agent gets bluffed and walks; the council probes and closes. Every number on this page is seeded and reproducible." },
  { sel: () => $("#gm-select"), head: "Four ways to run it.",
    more: "Watch the council work · play the counterparty and try to bluff it · duel it on the same seed · or face a live, unscripted AI adversary." },
  { sel: () => state.round?.card?.querySelector(".cp-move"), head: "They move. The tags are behaviour.",
    more: "Signal tags — held firm, small concession, revealed — are the only evidence the belief system accepts." },
  { sel: () => state.round?.card?.querySelector(".empathy-broadcast"), head: "It reads conduct, not words.",
    more: "The belief bar moves on price movement, firmness, and reveals — never on talk. A bluffer and an honest buyer can say the same thing; only one will act it." },
  { sel: () => state.round?.card?.querySelector(".lens"), head: "Five worldviews, in parallel.",
    enter: (t) => t.classList.add("open"),
    more: "Gain · Position · Intent · Learning · Survival — each scores every action from its own worldview. Click any lens anytime to read its reasoning." },
  { sel: () => state.round?.card?.querySelector(".challenge-record"), head: "Disagreement, on record.",
    more: "The two most-opposed lenses file briefs against each other. It's causal: a genuinely persuaded defender concedes ground — which can flip a close round." },
  { sel: () => state.round?.decision?.querySelector(".rec-line") ?? state.round?.decision, head: "Votes converge. A calculator decides.",
    enter: () => { if (state.round?.engineResult) drawConvergence(state.round.engineResult); },
    more: "Replaying the synthesis: thick beams agreed with the verdict, faint ones dissented. The final pick is deterministic arithmetic — no LLM decides." },
  { sel: () => state.round?.card?.querySelector(".arbiter-section"), head: "Influence comes from terrain.",
    more: "The Arbiter weights the lenses by the situation — trust, uncertainty, hostility, exposure. It never reads their arguments, so persuasion can't buy weight." },
  { sel: () => state.round?.card?.querySelector(".receipt-chip"), head: "Signed.",
    enter: (t) => t.nextElementSibling?.classList.remove("hidden"),
    more: "Every round's decision is cryptographically signed and tamper-evident — a filed proceeding, not a chat log." },
  { sel: () => state.round?.card?.querySelector(".gavel"), head: "Your hand on the scales.",
    enter: (t) => t.setAttribute("open", ""),
    more: "Drag a slider — the deterministic engine recomputes the verdict live. Pile everything on one lens and you've rerun Exhibit B by hand." },
  { sel: () => $(".disposition"), head: "Case closed — and the baseline's fate.",
    more: "Outcome, trust, the declassified type, and what a strong single agent did against this same counterparty: usually walked with $0." },
  { sel: () => $("#exhibit-a"), head: "The evidence. Honest nulls included.",
    more: "n=10 with spread; Exhibit B removes one component at a time and publishes everything — even the parts whose removal costs nothing. The README adds adversarially-authored hold-out worlds and the belief confusion matrix." },
];

let tour = null; // { i, spot, card }

const waitForEl = (sel, timeoutMs = 120000) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const n = document.querySelector(sel);
    if (n) return resolve(n);
    if (Date.now() - t0 > timeoutMs) return resolve(null);
    setTimeout(tick, 350);
  };
  tick();
});

async function startTour() {
  if (tour) return;
  // No completed case on screen? Run one — the tour narrates real artifacts only.
  if (!document.querySelector(".disposition")) {
    $("#scenario-select").value = "type-c-deceptive";
    if ($("#gm-select")) $("#gm-select").value = "deterministic";
    const restoreSpeed = state.speed;
    state.speed = 4;
    run();
    state.speed = restoreSpeed;
    $("#guide-btn").textContent = "RUNNING…";
    await waitForEl(".disposition");
    $("#guide-btn").textContent = "GUIDE";
  }
  state.round?.card?.classList.remove("filed"); // tour walks the last round's record
  state.autoFollow = false;
  tour = { i: 0, spot: el("div", "tour-spot"), card: el("div", "tour-card") };
  document.body.appendChild(tour.spot);
  document.body.appendChild(tour.card);
  showTourStep(0, +1);
}

function endTour() {
  if (!tour) return;
  tour.spot.remove();
  tour.card.remove();
  tour = null;
}

function showTourStep(i, dir) {
  if (!tour) return;
  if (i < 0) i = 0;
  if (i >= TOUR_STEPS.length) return endTour();
  const s = TOUR_STEPS[i];
  const target = s.sel();
  if (!target) return showTourStep(i + dir, dir); // skip stops whose artifact is absent
  tour.i = i;
  s.enter?.(target);
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => {
    if (!tour) return;
    const r = target.getBoundingClientRect();
    const sx = window.scrollX, sy = window.scrollY;
    Object.assign(tour.spot.style, {
      left: `${r.left + sx - 6}px`, top: `${r.top + sy - 6}px`,
      width: `${r.width + 12}px`, height: `${r.height + 12}px`,
    });
    tour.card.innerHTML =
      `<div class="tc-head">${s.head}</div>` +
      `<div class="tc-more hidden">${s.more}</div>` +
      `<div class="tc-row">` +
        `<button class="tc-plus" title="more">+</button>` +
        `<span class="tc-count">${i + 1}/${TOUR_STEPS.length}</span>` +
        `<button class="tc-back" ${i === 0 ? "disabled" : ""}>‹</button>` +
        `<button class="tc-next">${i === TOUR_STEPS.length - 1 ? "DONE" : "›"}</button>` +
        `<button class="tc-end" title="end tour">✕</button>` +
      `</div>`;
    const cardW = 330;
    const left = Math.max(12, Math.min(r.left + sx, window.innerWidth + sx - cardW - 12));
    const below = r.bottom + sy + 14;
    const above = r.top + sy - 14;
    const useAbove = r.bottom > window.innerHeight - 170;
    Object.assign(tour.card.style, {
      left: `${left}px`,
      top: useAbove ? "" : `${below}px`,
      bottom: "",
    });
    if (useAbove) {
      tour.card.style.top = `${above - tour.card.offsetHeight}px`;
    }
    tour.card.querySelector(".tc-plus").addEventListener("click", (e) => {
      tour.card.querySelector(".tc-more").classList.toggle("hidden");
      e.target.textContent = e.target.textContent === "+" ? "−" : "+";
    });
    tour.card.querySelector(".tc-back").addEventListener("click", () => showTourStep(tour.i - 1, -1));
    tour.card.querySelector(".tc-next").addEventListener("click", () => showTourStep(tour.i + 1, +1));
    tour.card.querySelector(".tc-end").addEventListener("click", endTour);
  }, 420);
}

init();
