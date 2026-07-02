/* Synod UI — evidence + the §02 tableau + the guided tour. */
const pctFmt = (r) => `${Math.round(r * 100)}%`;

/* The MCP surface, on screen: list Synod's real MCP tools and invoke the data-only ones
   live, showing the exact request/response an MCP host exchanges — so the integration is
   demonstrable in a browser, not just asserted. */
async function loadMcp() {
  const box = $("#mcp-tools");
  if (!box) return;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let cat;
  try { cat = await (await fetch("/api/mcp/catalog")).json(); }
  catch { box.textContent = "MCP catalog unavailable in this build."; return; }
  box.innerHTML = cat.tools.map((t) =>
    `<button class="mcp-tool${t.live ? " live" : ""}" data-tool="${t.name}" ${t.live ? "" : "disabled"} title="${t.description.replace(/"/g, "&quot;")}">` +
    `${t.live ? "▶ " : ""}${t.name}${t.live ? "" : " · npm run mcp"}</button>`).join("");
  const io = $("#mcp-io");
  const invoke = async (tool) => {
    io.innerHTML = `<div class="mcp-wait">calling <b>${tool}</b> on the server…</div>`;
    try {
      const r = await (await fetch(`/api/mcp/invoke?tool=${tool}`)).json();
      io.innerHTML =
        `<div class="mcp-io-col"><div class="mcp-io-lbl">→ host request</div><pre>${esc(JSON.stringify(r.request, null, 2))}</pre></div>` +
        `<div class="mcp-io-col"><div class="mcp-io-lbl">← Synod response</div><pre>${esc(r.response.content[0].text)}</pre></div>`;
    } catch { io.innerHTML = `<div class="mcp-wait">invoke failed.</div>`; }
  };
  box.querySelectorAll(".mcp-tool.live").forEach((btn) => btn.addEventListener("click", () => invoke(btn.dataset.tool)));
  invoke("describe_council"); // show a real response by default
}
const meanStd = (s) => `${evMoney(s.surplusMean)} <span class="hint">±${evMoney(s.surplusStd)}</span>`;

async function loadAblation() {
  const box = $("#ablation-table");
  if (!box) return;
  const report = await (await fetch("/api/ablation")).json();
  const full = report.rows[0];
  const max = Math.max(...report.rows.map((r) => r.totalSurplusMean), 1);
  const bar = (r) => {
    const delta = r.totalSurplusMean - full.totalSurplusMean;
    const isFull = r === full;
    const isCausal = r.variant.includes("probe check"); // the "without the probe check" row — the biggest single loss
    const isLearning = r.variant.includes("only the Probe"); // single-lens Probe (ties full council here, loses on Exhibit C)
    const cls = isFull ? "full" : isCausal ? "causal" : delta <= -2000 ? "crater" : "drop";
    const deltaTxt = isFull ? "the full council" : delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${evMoney(Math.abs(delta))}`;
    return `<div class="drop-row${isCausal ? " drop-causal" : ""}">` +
      `<span class="drop-label">${isFull ? `<b>${r.variant}</b>` : r.variant}` +
        `${isCausal ? ` <span class="causal-chip">BIGGEST LOSS</span>` : ""}` +
        `${isLearning ? ` <span class="hint">ties here — but Exhibit C breaks it</span>` : ""}</span>` +
      `<span class="drop-track"><span class="drop-fill ${cls}" style="width:${Math.max(2, (r.totalSurplusMean / max) * 100)}%"></span></span>` +
      `<span class="drop-val">${evMoney(r.totalSurplusMean)} <span class="drop-delta ${delta < -100 ? "lose" : ""}">${deltaTxt}</span></span>` +
    `</div>`;
  };
  box.innerHTML = `<div class="dropbars">${report.rows.map(bar).join("")}</div>`;
}

/* Show the EXACT `npm run reproduce` output in the page — the real terminal result, not a
   description. Served verbatim from /api/reproduce (deterministic, cached). */
async function loadReproduce() {
  const badge = $("#repro-badge");
  if (!badge) return;
  const show = async (fresh) => {
    badge.textContent = fresh ? "re-running on the server…" : "checking the engine…";
    badge.className = "repro-badge";
    try {
      const d = await (await fetch(`/api/reproduce${fresh ? "?fresh=1" : ""}`)).json();
      badge.textContent = d.ok
        ? `✓ Determinism verified${fresh ? " just now" : ""} — the two runs are byte-identical`
        : "✕ determinism check failed";
      badge.className = "repro-badge " + (d.ok ? "ok" : "bad");
    } catch { badge.textContent = "repeatable — run npm run reproduce"; badge.className = "repro-badge"; }
  };
  $("#repro-run")?.addEventListener("click", () => show(true));
  show(false);
}

/* Exhibit D — the society vs any single general. Each bar is one general's fixed
   temperament deciding alone; the society (chair adapts) is the reference row. */
async function loadGeneralBench() {
  const box = $("#general-bench");
  if (!box) return;
  let report;
  try { report = await (await fetch("/api/general-bench")).json(); }
  catch { box.textContent = "Unavailable."; return; }
  const society = report.rows[0];
  const max = Math.max(...report.rows.map((r) => r.totalSurplusMean), 1);
  const bar = (r) => {
    const delta = r.totalSurplusMean - society.totalSurplusMean;
    const isSociety = r === society;
    const cls = isSociety ? "full" : delta === 0 ? "causal" : delta <= -2500 ? "crater" : "drop";
    const tag = isSociety ? "the society" : delta === 0 ? "ties" : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta))}`;
    return `<div class="drop-row${isSociety ? " drop-causal" : ""}">` +
      `<span class="drop-label">${isSociety ? `<b>${r.variant}</b>` : r.variant}` +
        `${delta === 0 && !isSociety ? ` <span class="hint">— Exhibit C breaks it</span>` : ""}</span>` +
      `<span class="drop-track"><span class="drop-fill ${cls}" style="width:${Math.max(2, (r.totalSurplusMean / max) * 100)}%"></span></span>` +
      `<span class="drop-val">${money(r.totalSurplusMean)} <span class="drop-delta ${delta < -100 ? "lose" : ""}">${tag}</span></span>` +
    `</div>`;
  };
  box.innerHTML = `<div class="dropbars">${report.rows.map(bar).join("")}</div>`;
}

/**
 * The council vote tableau — the page's hero visual: one real round, deciding.
 * Counterparty statement → five lens votes (they disagree) → Arbiter → verdict →
 * outcome. Maps 1:1 to the track brief (decomposition · roles · conflict resolution).
 * Votes are the canonical deterministic round 1 of the deceptive scenario, verified
 * against a real run; the engine is frozen, so they hold.
 */
const CANON_VOTES = {
  message: "Here's where we stand: about 8,500. Can you work with that?",
  note: "deceptive counterparty · round 1 · hides claimed leverage",
  // by doctrine id → that lens's top action this round
  votes: { empathy: "counter_soft", battle: "counter_hard", war: "concede_term", probe: "probe", risk: "probe" },
  // Voices = the lens rationale the engine ACTUALLY produced for this canonical round
  // (snapshot of real mock output, like the votes/numbers — not handwritten drama).
  // In live mode these regenerate per round; Qwen writes them in character.
  voices: {
    empathy: "I read them as relationship — play what actually fits that, not what flatters us.",
    battle: "There's ground to take right now — press for it. Hesitation leaves it on the table.",
    war: "Don't torch the deal for one round's margin — hold the position, play the long game.",
    probe: "We're deciding blind — information is worth ~146, more than the probe costs. Buy it before we commit.",
    risk: "If we're wrong here it's irreversible — keep the deal alive and our options open.",
  },
  verdict: "probe",
  // Real per-round offer trajectory (canonical deterministic run): the probe pulls the
  // truth out in R2, and the offer on the table climbs because the bluff broke.
  trajectory: [
    { r: 1, offer: 8500, note: "probes" },
    { r: 2, offer: 10217, note: "+1,717", up: true },
    { r: 3, offer: 11000, note: "closes", up: true },
  ],
  synod: 3000, baseline: 0,
  // Why arbitration mattered — names the dissenter and what tipped it (real terrain).
  why: `<b>Pressure</b> pushed to counter hard. But the council isn't sure who it's facing yet (0%) and a lot is at stake (67%), so the chair sided with <b>Probe</b> — get information before committing. The decision changed <em>because</em> they disagreed.`,
};
// Pull the canonical round from the live engine (/api/canonical runs it for real through
// the active agents — mock or Qwen), so the votes/voices/verdict/offers in the tableau are
// never hand-written. Falls back to the snapshot only if the fetch fails.
async function fetchCanonical() {
  try {
    const data = await (await fetch("/api/canonical")).json();
    const traj = (data.trajectory ?? []).map((s, i, a) => {
      if (i === 0) return { r: s.r, offer: s.offer, note: data.verdict === "probe" ? "probes" : "opens" };
      const d = s.offer - a[i - 1].offer;
      const last = i === a.length - 1;
      return {
        r: s.r, offer: s.offer, up: d > 0,
        note: last && d > 0 ? "closes" : d > 0 ? `+${money(d)}` : d < 0 ? `−${money(-d)}` : "holds",
      };
    });
    return {
      message: data.message,
      note: `${data.live ? "live qwen · " : ""}deceptive counterparty · round 1 · hides claimed leverage`,
      votes: data.votes, voices: data.voices, verdict: data.verdict, why: data.why,
      trajectory: traj.length ? traj : CANON_VOTES.trajectory,
      synod: data.synod || CANON_VOTES.synod, baseline: data.baseline ?? CANON_VOTES.baseline,
      infoConfidence: data.infoConfidence, exposure: data.exposure,
    };
  } catch {
    return CANON_VOTES;
  }
}

// The §02 tableau is the shared spine, but its one quoted move must match the active
// skin: the war track hears an armistice line, the negotiation track a deal line.
const WAR_CP = {
  lbl: "THE ADVERSARY",
  msg: "We hold the eastern bank — and there are reserves we haven't shown you. Pull your line back to the river, or the ceasefire ends Thursday.",
  note: "armistice · true strength hidden — bluff or real?",
};
let CANON_DEAL = { message: "", note: "" };
function applyTrackToTableau(track) {
  const lbl = $("#tb-cp-lbl"), msg = $("#tb-cp-msg"), note = $("#tb-cp-note");
  if (!msg) return;
  if (track === "war") {
    lbl.textContent = WAR_CP.lbl; msg.textContent = `“${WAR_CP.msg}”`; note.textContent = WAR_CP.note;
  } else {
    lbl.textContent = "COUNTERPARTY"; msg.textContent = `“${CANON_DEAL.message}”`; note.textContent = CANON_DEAL.note;
  }
}

async function renderCast() {
  const box = $("#council-tableau");
  if (!box) return;
  const c = await fetchCanonical();
  CANON_DEAL = { message: c.message, note: c.note };
  const voteRows = ORDER.map((d) => {
    const m = lens(d);
    const carried = c.votes[d] === c.verdict;
    return `<div class="tb-lens${carried ? " tb-carried" : ""}" data-d="${d}" title="${m.question}">` +
      `<span class="tb-name" style="color:${LENS_COLORS[d]}">${m.cogFunction}</span>` +
      `<span class="tb-q">“${c.voices[d]}”</span>` +
      `<span class="tb-vote">${label(c.votes[d])}${carried ? " ◄" : ""}</span>` +
    `</div>`;
  }).join("");
  box.innerHTML =
    `<div class="tb-cp"><span class="tb-cp-lbl" id="tb-cp-lbl">COUNTERPARTY</span>` +
      `<span class="tb-cp-msg" id="tb-cp-msg">“${c.message}”</span><span class="tb-cp-note" id="tb-cp-note">${c.note}</span></div>` +
    `<div class="tb-arrow">↓ five lenses score the move, in parallel</div>` +
    `<div class="tb-lenses">${voteRows}</div>` +
    `<div class="tb-weighing">⟳ the council is split — the chair reads the situation…</div>` +
    `<div class="tb-decision">` +
      `<div class="tb-arrow">↓ not by who argued best</div>` +
      `<div class="tb-verdict">VERDICT · <b>${label(c.verdict)}</b></div>` +
      `<div class="tb-why">${c.why}</div>` +
    `</div>`;

  // The range of outcomes + the needle: a deceptive deal can end at WALK ($0) or a
  // close ($3,000). Each round the needle sits at the real surplus on the table
  // (offer − floor, as a fraction of the achievable close). The probe is what tilts it.
  const FLOOR = 8000, BEST = c.synod; // $3,000 achievable surplus
  const pos = (offer) => Math.round(Math.max(0, Math.min(1, (offer - FLOOR) / BEST)) * 100);
  const marks = c.trajectory.map((s) =>
    `<span class="range-mark" style="left:${pos(s.offer)}%"><b>R${s.r}</b><span class="rm-note">${s.note}</span></span>`,
  ).join("");
  const cq = $("#consequence");
  if (cq) cq.innerHTML =
    `<div class="cq-title">a deceptive deal ends one of two ways. <b>The probe tilts the needle</b> — here's where it sits each round.</div>` +
    `<div class="range">` +
      `<div class="range-cap worst"><span class="range-tag">WORST</span>WALK · 0</div>` +
      `<div class="range-track">` +
        `<div class="range-fill" style="width:${pos(c.trajectory.at(-1).offer)}%"></div>` +
        `<span class="range-base" title="a single agent — bluffed, walks">✕ single agent</span>` +
        marks +
      `</div>` +
      `<div class="range-cap best"><span class="range-tag">BEST</span>CLOSE · ${money(BEST)}</div>` +
    `</div>` +
    `<div class="cq-foot">the needle starts near <b class="col-amber">WALK</b> — contested, ${Math.round((c.infoConfidence ?? 0.39) * 100)}% confident, so the council probes rather than commit. The probe exposes the bluff (<b>the claimed leverage was air</b>) and the needle slides to <b class="col-green">CLOSE</b>. A single agent never probes; its needle stays pinned at 0.</div>`;

  applyTrackToTableau(document.body.dataset.track || "war");
}

/**
 * The pre-verdict hesitation beat: when the council scene scrolls into view, the
 * five votes reveal one by one, the Arbiter "weighs the terrain" for a moment, then
 * the verdict stamps in. Makes the decision feel arrived-at, not computed. Pure
 * theater — skipped under reduced-motion or without IntersectionObserver (static).
 */
function armTableauReveal() {
  const scene = $("#scene-council");
  const tableau = $("#council-tableau");
  if (!scene || !tableau) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !("IntersectionObserver" in window)) return; // leave fully visible
  tableau.classList.add("tb-anim");
  $("#consequence")?.classList.add("tb-anim");
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    playTableau();
  }, { threshold: 0.3 });
  io.observe(scene);
}

function playTableau() {
  const t = $("#council-tableau");
  if (!t) return;
  const lenses = [...t.querySelectorAll(".tb-lens")];
  const base = 250, step = 170;
  lenses.forEach((el, i) => setTimeout(() => el.classList.add("show"), base + i * step));
  const afterVotes = base + lenses.length * step + 250;
  const weigh = t.querySelector(".tb-weighing");
  const decision = t.querySelector(".tb-decision");
  setTimeout(() => weigh?.classList.add("show"), afterVotes);
  setTimeout(() => {
    weigh?.classList.remove("show");
    decision?.classList.add("show");
    $("#consequence")?.classList.add("show");
  }, afterVotes + 1000);
}

function renderProvenance() {
  const card = $("#provenance-card");
  const p = state.meta.provenance;
  if (!card || !p) return;
  const rows = [
    ["hold-out worlds", p.holdoutAuthor],
    ["", p.holdoutFrozen],
    ["baseline", p.baseline],
    ["seeds", p.seeds],
    ["determinism", p.determinism],
    ["evaluated on commit", `<code>${p.commit}</code>`],
  ];
  card.innerHTML = rows.map(([k, v]) =>
    `<div class="prov-row"><span class="prov-k">${k}</span><span class="prov-v">${v}</span></div>`,
  ).join("");
}

async function loadHoldout() {
  const box = $("#holdout-table");
  if (!box) return;
  const report = await (await fetch("/api/holdout?lenses=1")).json();
  const lensNames = Object.keys(report.rows[0]?.lenses ?? {});
  const cols = ["council", ...lensNames];
  // Heatmap: red = a worldview wiped out on this world, green = thrived. The eye finds
  // the red cells (a lens that craters) instantly — no number-parsing required.
  const all = report.rows.flatMap((r) => [r.council.surplusMean, ...lensNames.map((n) => r.lenses[n].surplusMean)]);
  const max = Math.max(...all, 1);
  const pre = document.body.dataset.track === "nego" ? "$" : "";
  const k = (v) => (v >= 1000 ? `${pre}${(v / 1000).toFixed(1)}k` : `${pre}${Math.round(v)}`);
  const heat = (v) => `hsl(${Math.round((Math.min(v, max) / max) * 130)} 48% ${14 + (v / max) * 12}%)`;
  const colOf = (r, c) => (c === "council" ? r.council : r.lenses[c]);

  const headCells = cols.map((c) => `<div class="hm-h${c === "council" ? " hm-council" : ""}">${c === "council" ? "COUNCIL" : c}</div>`).join("");
  const rows = report.rows.map((r) => {
    const cells = cols.map((c) => {
      const s = colOf(r, c);
      return `<div class="hm-cell${c === "council" ? " hm-council" : ""}" style="background:${heat(s.surplusMean)}" ` +
        `title="${c} · ${r.title}: ${evMoney(s.surplusMean)}, ${pctFmt(s.dealRate)} settled">${k(s.surplusMean)}</div>`;
    }).join("");
    return `<div class="hm-rowlabel" title="${r.targets.replace(/"/g, "&quot;")}">${r.title}</div>${cells}`;
  }).join("");

  const totals = cols.map((c) => report.rows.reduce((sum, r) => sum + colOf(r, c).surplusMean, 0));
  const best = Math.max(...totals);
  const totalCells = totals.map((tot, i) =>
    `<div class="hm-total${cols[i] === "council" ? " hm-council" : ""}${tot >= best ? " hm-best" : ""}">${k(tot)}</div>`).join("");

  box.innerHTML =
    `<div class="heatmap" style="grid-template-columns: 8.5rem repeat(${cols.length}, 1fr)">` +
      `<div class="hm-corner"></div>${headCells}` +
      rows +
      `<div class="hm-rowlabel hm-totlabel">total</div>${totalCells}` +
    `</div>` +
    `<div class="chart-total">red = that lens got wiped out in that world · the council's column never goes red, and captures the most overall</div>`;
}

async function loadAb() {
  const report = await (await fetch("/api/ab")).json();
  state.abReport = report; // the disposition band's counterfactual reads from this
  const n = report.rows[0]?.council.n ?? 1;
  const max = Math.max(...report.rows.map((r) => Math.max(r.baseline.surplusMean, r.council.surplusMean)), 1);
  const w = (v) => `${Math.max(1.5, (v / max) * 100)}%`;
  const pair = (r) => {
    const dec = r.id.includes("deceptive");
    return `<div class="pbar-group${dec ? " pbar-hot" : ""}">` +
      `<div class="pbar-label">${r.typeName}</div>` +
      `<div class="pbar-row"><span class="pbar-who">one agent</span>` +
        `<span class="pbar-track"><span class="pbar-fill base" style="width:${w(r.baseline.surplusMean)}"></span></span>` +
        `<span class="pbar-val">${r.baseline.dealRate === 0 ? "<b class='walktag'>WALK · 0</b>" : evMoney(r.baseline.surplusMean)} <span class="hint">${pctFmt(r.baseline.dealRate)} held</span></span></div>` +
      `<div class="pbar-row"><span class="pbar-who syn">the council</span>` +
        `<span class="pbar-track"><span class="pbar-fill syn" style="width:${w(r.council.surplusMean)}"></span></span>` +
        `<span class="pbar-val"><b>${evMoney(r.council.surplusMean)}</b> <span class="hint">±${evMoney(r.council.surplusStd)} · ${pctFmt(r.council.dealRate)} held</span></span></div>` +
    `</div>`;
  };
  const t = report.totals;
  $("#ab-table").innerHTML =
    `<div class="pbars">${report.rows.map(pair).join("")}</div>` +
    `<div class="chart-total">captured across all three opponents · one agent alone <b>${evMoney(t.baselineSurplusMean)}</b> · the council <b class="win">${evMoney(t.councilSurplusMean)}</b> <span class="hint">(${n} runs each · ± is the spread across the ${n} seeded instances, not a stochastic CI — seeds are fixed)</span></div>`;
}

/* Exhibit E — the adaptive policy layer vs a fixed clamp: the measured algorithmic delta. */
async function loadAdaptive() {
  const box = $("#adaptive-bench");
  if (!box) return;
  let d;
  try { d = await (await fetch("/api/adaptive-bench")).json(); }
  catch { box.textContent = "Computing…"; return; }
  const max = Math.max(d.adaptive, d.fixed, 1);
  const bar = (label, v, win) =>
    `<div class="drop-row"><span class="drop-label">${win ? `<b>${label}</b>` : label}</span>` +
    `<span class="drop-track"><span class="drop-fill ${win ? "full" : "drop"}" style="width:${Math.max(2, (v / max) * 100)}%"></span></span>` +
    `<span class="drop-val">${evMoney(v)} <span class="drop-delta ${win ? "" : "lose"}">${win ? "adaptive" : "−" + evMoney(d.delta)}</span></span></div>`;
  box.innerHTML = `<div class="dropbars">${bar("adaptive — situation-conditioned", d.adaptive, true)}${bar("fixed clamp — situation-blind", d.fixed, false)}</div>`;
}

/* ====== INTERACTIVE TOUR — a moving spotlight that operates the real UI.
   Few words by default: one short headline per stop; a “+” reveals depth. ====== */

const TOUR_STEPS = [
  { sel: () => $(".stat-strip"), head: "One claim: 0 vs 3,000. Same opponent, ten runs.",
    more: "A strong single agent gets bluffed and walks; the council probes and closes. Every number on this page comes from a fixed setup and repeats exactly." },
  { sel: () => $("#gm-select"), head: "Four ways to run it.",
    more: "Watch the council work · play the counterparty and try to bluff it · duel it on the same seed · or face a live, unscripted AI adversary." },
  { sel: () => state.round?.card?.querySelector(".turn-cp"), head: "They move. The tags are behaviour.",
    more: "Signal tags — held firm, small concession, revealed — are the only evidence the belief system accepts." },
  { sel: () => state.round?.card?.querySelector(".empathy-broadcast"), head: "It reads conduct, not words.",
    more: "The belief bar moves on price movement, firmness, and reveals — never on talk. A bluffer and an honest buyer can say the same thing; only one will act it." },
  { sel: () => state.round?.card?.querySelector(".lens"), head: "Five worldviews, in parallel.",
    enter: (t) => t.classList.add("open"),
    more: "Trust · Pressure · Frame · Probe · Hedge — each scores every action from its own worldview. Click any lens anytime to read its reasoning." },
  { sel: () => state.round?.card?.querySelector(".challenge-record"), head: "Disagreement, on record.",
    more: "The two most-opposed lenses file briefs against each other. It's causal: a genuinely persuaded defender concedes ground — which can flip a close round." },
  { sel: () => state.round?.decision?.querySelector(".rec-line") ?? state.round?.decision, head: "Votes converge. A calculator decides.",
    enter: () => { if (state.round?.engineResult) drawConvergence(state.round.engineResult); },
    more: "Replaying the synthesis: thick beams agreed with the verdict, faint ones dissented. The final pick is deterministic arithmetic — no LLM decides." },
  { sel: () => state.round?.card?.querySelector(".arbiter-section"), head: "The weight comes from the situation.",
    more: "The chair weighs the judges by the situation — how sure we are, how much is at stake, how hostile. It never reads their arguments, so arguing louder can't buy influence." },
  { sel: () => state.round?.card?.querySelector(".receipt-chip"), head: "Signed.",
    enter: (t) => t.nextElementSibling?.classList.remove("hidden"),
    more: "Every round's decision is cryptographically signed and tamper-evident — a filed proceeding, not a chat log." },
  { sel: () => state.round?.card?.querySelector(".gavel"), head: "Your hand on the scales.",
    enter: (t) => t.setAttribute("open", ""),
    more: "Drag a slider — the deterministic engine recomputes the verdict live. Pile everything on one lens and you've rerun Exhibit B by hand." },
  { sel: () => $(".disposition"), head: "Case closed — and the baseline's fate.",
    more: "Outcome, trust, the declassified type, and what a strong single agent did against this same counterparty: usually walked with 0." },
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
  ensureTabVisible(target); // a step may live in a non-active tab
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

