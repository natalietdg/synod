/* Synod UI — the war room, the fit explorer, the track switcher; init() runs last. */
/* ============================ THE WAR ROOM ============================
   An agent society: five generals, each OWNING one lens (a distinct judgment faculty).
   You don't set the weighting — the chair decides on the terrain. Convene the council
   and the five deliberate live on Qwen; the chair integrates them; the order divides the
   labor. (No human weight-knob: that would let persuasion override the situation.) */
const WR = { data: null };

/* Each general OWNS a decision procedure, not just a personality — naming the computation
   in the live view is what keeps it "five procedures," not "five personas" (Option B). */
const WR_PROC = {
  battle: "immediate advantage",
  war: "the long game",
  empathy: "who they most likely are",
  probe: "the value of scouting — EVI",
  risk: "the worst case — minimax",
};

/* The recon-capability artifact: two belief traces — with vs without the Probe lens. The
   proof is the belief curve, not the score: with recon, belief resolves (spikes); without,
   it stalls and the council never probes. Same adversary, same seed. */
async function loadCapability() {
  const box = $("#cap-demo");
  if (!box) return;
  let d;
  try { d = await (await fetch("/api/capability")).json(); }
  catch { box.textContent = "Unavailable."; return; }
  const FULL = d.full.surplus;
  // one belief-trace column: bars per round + outcome line.
  const col = (title, t, isFull) => {
    const max = Math.max(...t.belief.map((b) => b.deceptive), 0.8);
    const bars = t.belief.map((b) =>
      `<span class="cap-bar"><i style="height:${Math.round((b.deceptive / max) * 100)}%"></i>` +
      `<span class="cap-bar-v">${Math.round(b.deceptive * 100)}%</span><span class="cap-bar-r">R${b.round}</span></span>`).join("");
    return `<div class="cap-col${isFull ? " with" : ""}">` +
      `<div class="cap-col-h">${title}</div>` +
      `<div class="cap-trace" title="how sure the council is that the opponent is bluffing, per round">${bars}</div>` +
      `<div class="cap-meta">${t.probed ? "✓ scouts — <b>figures out the bluff</b>" : "✕ never scouts — <b>stays in the dark</b>"} (got to ${Math.round(t.peak * 100)}% sure)</div>` +
      `<div class="cap-out${isFull ? " close" : ""}">won <b>${money(t.surplus)}</b> <span class="cap-of">of ${money(FULL)}</span></div>` +
    `</div>`;
  };
  const draw = (g) => {
    const stage = $("#cap-stage");
    if (!g) {
      stage.innerHTML = `<div class="cap-cols">${col("FULL COUNCIL", d.full, true)}</div>` +
        `<p class="cap-note">The full council works out the bluff and wins the whole ${money(FULL)}. <b>Switch off a general</b> above to see what it loses.</p>`;
      return;
    }
    const load = g.delta <= -500;
    const verdict = load
      ? `<b>${g.name} is the one that matters here.</b> Take him away and ${g.off.probed ? "" : "no one can scout — so "}the council ${g.off.probed ? "still works it out" : "never finds out the bluff is fake"}; it wins <b>${money(g.off.surplus)}</b> instead of ${money(FULL)} (<b>${g.delta}</b>).`
      : `<b>${g.name} off: barely changes a thing</b> (${g.delta || "±0"}). The others already agreed with this call — but ${g.name} still has their own part in the war plan.`;
    stage.innerHTML = `<div class="cap-cols">${col("FULL COUNCIL", d.full, true)}<span class="cap-vs">vs</span>${col(`${g.name.toUpperCase()} OFF`, g.off, false)}</div>` +
      `<p class="cap-note">${verdict}</p>`;
  };
  const btns = `<button class="cap-btn active" data-off="">Full council</button>` +
    d.generals.map((g) => `<button class="cap-btn" data-off="${g.id}" title="${g.lensName}">✕ ${g.name} <span class="cap-btn-lens">${g.lensName}</span></button>`).join("");
  box.innerHTML = `<div class="cap-btns">${btns}</div><div class="cap-stage" id="cap-stage"></div>`;
  box.querySelectorAll(".cap-btn").forEach((btn) => btn.addEventListener("click", () => {
    box.querySelectorAll(".cap-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.dataset.off;
    draw(id ? d.generals.find((x) => x.id === id) : null);
  }));
  draw(null);
}

/* The switch-off, across ALL THREE counterparty types — the on-screen rebuttal to "one
   rule, four narrators". Remove each general per opponent; the decisive one (biggest loss)
   changes with who you face: Probe for the bluffer, Hedge for the firm-floor negotiator. */
async function loadSwitchMatrix() {
  const box = $("#switch-matrix");
  if (!box) return;
  let d;
  try { d = await (await fetch("/api/switch-matrix")).json(); }
  catch { box.textContent = "Unavailable."; return; }
  const gens = d.generals; // [{ id, name, lens, lensName }]
  const TYPE = { relationship: "Values the relationship", soft_floor: "Firm hidden floor", deceptive: "Bluffing leverage" };
  const head = `<div class="sm-row sm-head"><span class="sm-op"></span>` +
    gens.map((g) => `<span class="sm-cell sm-h-cell" style="color:${LENS_COLORS[g.lens]}">${g.name}<span class="sm-cog">${g.lensName}</span></span>`).join("") + `</div>`;
  const rows = d.rows.map((r) => {
    const min = Math.min(...gens.map((g) => r.offs[g.id] ?? 0));
    const cells = gens.map((g) => {
      const delta = Math.round(r.offs[g.id] ?? 0);
      const decisive = delta === min && delta < 0;
      return `<span class="sm-cell${decisive ? " decisive" : ""}${delta < 0 ? " loss" : ""}"${decisive ? ` style="--c:${LENS_COLORS[g.lens]}"` : ""}>${delta === 0 ? "·" : delta}</span>`;
    }).join("");
    const label = r.holdout ? `${r.scenario} <i class="sm-ho">hold-out</i>` : (TYPE[r.type] || r.type);
    return `<div class="sm-row"><span class="sm-op">${label}<span class="sm-full">council keeps ${Math.round(r.full)}</span></span>${cells}</div>`;
  }).join("");
  box.innerHTML = `<div class="sm-grid">${head}${rows}</div>` +
    `<p class="sm-take"><b>The decisive general changes with the opponent</b> — Sun Tzu (Probe) carries the bluffers; Kutuzov (Hedge) carries the firm floor and is the <em>whole deal</em> against the hair-trigger ally (−2,800). ` +
    `<b>Honestly read:</b> across all eight opponents only these two are ever the swing vote — Patton, Zhukov and Eisenhower never flip a call by removal here. Their value shows on the other axis: bet on any one judge <em>alone</em> and it craters somewhere (Exhibit C), and each writes their own part of the plan. ` +
    `<span class="hint">(“·” = removing that judge changed nothing against that opponent · hold-out rows are the Claude-authored stress worlds)</span></p>`;
}

async function loadWarRoom() {
  const box = $("#warroom-body");
  if (!box) return;
  let data;
  try { data = await (await fetch("/api/warroom")).json(); }
  catch { box.textContent = "War room unavailable."; return; }
  WR.data = data;

  const step = (n, title, inner) =>
    `<div class="wr-step" data-step="${n}"><div class="wr-step-h"><span class="wr-step-n">${n}</span>${title}</div>${inner}</div>`;
  const conn = (txt) => `<div class="wr-conn">↓ <span>${txt}</span></div>`;

  const STEPPER = ["The move", "Who says what", "The argument", "The call", "What happens", "The war plan"];
  const stepper = `<div class="wr-stepper" id="wr-stepper">` +
    STEPPER.map((s, i) =>
      `<span class="wr-stp" data-i="${i + 1}"><i>${i + 1}</i>${s}</span>` +
      (i < STEPPER.length - 1 ? `<span class="wr-stp-arr">→</span>` : ""),
    ).join("") + `</div>`;

  box.innerHTML =
    wrCastHTML(data) +
    wrTimelineHTML(data) +
    stepper +
    // The move is the setup.
    `<div class="wr-flow">` +
      step(1, "The move",
        `<div class="wr-move"><span class="wr-move-lbl">ACROSS THE TABLE</span>` +
          `<span class="wr-move-msg">“${data.move}”</span>` +
          `<span class="wr-move-note">the other side · true strength hidden — bluff or real?</span></div>`) +
    `</div>` +
    // The run control — live only. The chair decides on the terrain (no human knob, no
    // deterministic replay): convening means the five generals actually deliberate on Qwen.
    // You may REMOVE a general first: they don't read, don't argue, and the chair decides
    // without their faculty — the switch-off, live (a fresh Qwen run per removal-set).
    `<div class="wr-runbar">` +
      `<div class="wr-facing" id="wr-facing">` +
        `<span class="wr-facing-lbl">FACING</span>` +
        `<select id="wr-scenario" title="Pick the kind of opponent the live council convenes against">` +
          `<option value="type-c-deceptive">A bluffed threat — reserves that may not exist</option>` +
          `<option value="type-b-soft-floor">A firm red line — one term they truly won't move</option>` +
          `<option value="type-a-relationship">An ally worth keeping — the relationship is the stake</option>` +
        `</select>` +
        `<span class="hint">a different opponent makes a different general decisive</span>` +
      `</div>` +
      `<div class="wr-remove" id="wr-remove">` +
        `<div class="wr-remove-head"><span class="wr-opt">OPTIONAL</span> <b>Click a general to remove them</b> — then convene to watch the council decide without that judge, live.</div>` +
        `<div class="wr-remove-chips">` +
          data.generals.map((g) =>
            `<button class="wr-rm-chip" data-lens="${g.leadLens}" data-name="${g.name}" style="--c:${LENS_COLORS[g.leadLens]}" title="click to remove ${g.name} (${g.lead}) from the live council">` +
              `<span class="wr-rm-x">✕</span><i></i><span class="wr-rm-name">${g.name}</span><span class="wr-rm-lens">${g.lead}</span></button>`,
          ).join("") +
        `</div>` +
      `</div>` +
      `<button class="wr-play wr-play-primary" id="wr-live">` +
        `<span class="wr-play-ico">▶</span>` +
        `<span class="wr-play-txt"><span class="wr-play-main">Convene the war council</span>` +
        `<span class="wr-play-sub" id="wr-live-tag">watch 5 generals reason &amp; argue it out — live on Qwen</span></span>` +
      `</button>` +
      `<span class="wr-live-status" id="wr-live-status"></span>` +
    `</div>` +
    // The proceedings — hidden until the user runs them.
    `<div class="wr-proceedings hidden" id="wr-proceedings">` +
      conn("five generals read the same move") +
      step(2, "The room splits", wrSplitHTML(data)) +
      conn("the room argues — and can change its mind") +
      step(3, "The argument", wrDebateStep(data)) +
      conn("the chair reads the situation — not who argued loudest") +
      step(4, "The chair decides", wrArbiterHTML(data)) +
      conn("so what actually happens?") +
      step(5, "The range of outcomes", wrOutcomeHTML(data) + `<div class="wr-wargame" id="wr-wargame"></div>`) +
      conn("now the plan — each general writes their own part") +
      step(6, "The war plan", wrPlanHTML(data)) +
    `</div>`;

  wrRenderWargame(data.wargame);
  wrWirePlan(); // no-op unless a plan is already present (live only)
  box.querySelector("#wr-live")?.addEventListener("click", wrRunLive);
  // Removal toggles: click a general to bench them before convening. The convene tag
  // updates to say how many will reason and who's out; the set is read at convene time.
  box.querySelectorAll(".wr-rm-chip").forEach((chip) => chip.addEventListener("click", () => {
    chip.classList.toggle("off");
    const off = [...box.querySelectorAll(".wr-rm-chip.off")];
    const tag = box.querySelector("#wr-live-tag");
    if (tag) tag.textContent = off.length
      ? `${5 - off.length} generals reason live — without ${off.map((c) => c.dataset.name).join(" & ")}`
      : "watch 5 generals reason & argue it out — live on Qwen";
  }));
  // Live only: no human-set weighting, no deterministic replay — convene and the chair
  // decides on the terrain.
}

/* Graceful degradation: if a live convene fails mid-judging (no key, rate-limit, timeout),
   don't leave a dead button — reveal the DETERMINISTIC proceedings already in the DOM and
   say plainly it's the reproducible replay on the identical engine. A Qwen outage should
   read as "same decision, run offline," never as "the AI isn't real." */
function wrFallback(why) {
  const status = $("#wr-live-status");
  if (status) {
    status.innerHTML = `${why} — showing the <b>reproducible deterministic replay</b> (identical engine, no live model call)`;
    status.className = "wr-live-status warn";
  }
  // Keep the nav badge honest — the live call did NOT run, so it must not read "live".
  const badge = document.querySelector("#provider-badge");
  if (badge) badge.textContent = "QWEN UNAVAILABLE · DETERMINISTIC REPLAY";
  // The mock proceedings (steps 1–5) were built at load and sit hidden — reveal them so the
  // demo still walks a full decision. (The operational order is live-only, so step 6 stays a prompt.)
  $("#wr-proceedings")?.classList.remove("hidden");
  wrPlay();
}

/* On-demand: each of the five generals reasons LIVE on Qwen (their own five-lens read).
   Replaces the mock split/voices with genuinely model-generated ones, and flags it LIVE.
   The default stays mock (free, reproducible); this proves the personas are real agents. */
async function wrRunLive() {
  const btn = $("#wr-live"), status = $("#wr-live-status");
  if (!btn || WR.liveRunning) return;
  WR.liveRunning = true;
  btn.disabled = true;
  const off = [...document.querySelectorAll(".wr-rm-chip.off")].map((c) => c.dataset.lens);
  const offNames = [...document.querySelectorAll(".wr-rm-chip.off")].map((c) => c.dataset.name);
  status.textContent = off.length
    ? `${5 - off.length} generals reasoning on Qwen — without ${offNames.join(" & ")}…`
    : "5 generals reasoning on Qwen…";
  status.className = "wr-live-status working";
  try {
    const scenario = document.querySelector("#wr-scenario")?.value || "type-c-deceptive";
    const qs = `?scenario=${encodeURIComponent(scenario)}${off.length ? `&off=${encodeURIComponent(off.join(","))}` : ""}`;
    const res = await fetch(`/api/warroom-live${qs}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      wrFallback(e.error === "no-key" ? "Live Qwen isn't configured here" : `Live Qwen unavailable (${e.message || res.status})`);
      return;
    }
    const live = await res.json();
    // Full live consistency: replace the WHOLE proceedings dataset with the live reads —
    // split, debate, chair verdict, terrain, and why all come from the same Qwen council.
    WR.data.generals = live.generals.map((g) => ({ ...g, doctrine: g.voice }));
    WR.data.benched = live.benched;
    WR.data.convenedNote = live.convenedNote;
    WR.data.council = live.council;
    WR.data.councilLabel = live.councilLabel;
    WR.data.deliberation = live.deliberation;
    WR.data.why = live.why;
    WR.data.terrain = live.terrain;
    if (live.wargame) WR.data.wargame = live.wargame;
    if (live.plan) WR.data.plan = live.plan;
    WR.live = true;
    // Rebuild every step from the live data so nothing downstream contradicts the split.
    const set = (step, title, inner) => {
      const host = document.querySelector(`#wr-proceedings .wr-step[data-step='${step}']`);
      if (host) host.innerHTML = `<div class="wr-step-h"><span class="wr-step-n">${step}</span>${title}` +
        `<span class="wr-live-flag">⚡ LIVE · Qwen</span></div>${inner}`;
    };
    // The scenario may differ from the mock default — sync the move (step 1) to what the
    // live council actually faced, so nothing upstream contradicts the proceedings.
    if (live.move) {
      WR.data.move = live.move;
      const msg = document.querySelector("#warroom-body .wr-move-msg");
      if (msg) msg.textContent = `“${live.move}”`;
      const note = document.querySelector("#warroom-body .wr-move-note");
      if (note && live.scenarioLabel) note.textContent = `the other side · ${live.scenarioLabel.toLowerCase()} — what's real, what's theatre?`;
    }
    // Rebuild the turning-point timeline from the live verdict so nothing mock-derived shows.
    const tl = document.querySelector("#warroom-body .wr-timeline");
    if (tl) tl.outerHTML = wrTimelineHTML(WR.data);
    set(2, "The room splits", wrSplitHTML(WR.data));
    set(3, "The argument", wrDebateStep(WR.data));
    set(4, "The chair decides", wrArbiterHTML(WR.data));
    set(5, "The range of outcomes", wrOutcomeHTML(WR.data) + `<div class="wr-wargame" id="wr-wargame"></div>`);
    set(6, "The war plan", wrPlanHTML(WR.data));
    wrWirePlan();
    // HONEST REPLAY LABELING: each configuration runs on Qwen once and is then served as
    // a recording (that's why a repeat click answers instantly). Say which one this was —
    // a fast repeat must never masquerade as a fresh model call.
    const ageMs = live.ranAt ? Date.now() - new Date(live.ranAt).getTime() : 0;
    const fresh = ageMs < 20_000;
    const ranClock = live.ranAt ? new Date(live.ranAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
    status.textContent = fresh
      ? (offNames.length
          ? `✓ live — decided without ${offNames.join(" & ")}, straight from Qwen just now`
          : "✓ live — the whole proceedings came from Qwen just now")
      : `✓ replaying this configuration's recorded live run (ran on Qwen at ${ranClock}) — change the opponent or remove a general to run fresh`;
    status.className = "wr-live-status ok";
    const badge = document.querySelector("#provider-badge");
    if (badge) badge.textContent = fresh ? "⚡ RAN LIVE ON QWEN" : "⚡ LIVE RUN · RECORDED";
    $("#wr-proceedings")?.classList.remove("hidden");
    wrPlay();
    wrRenderWargame(WR.data.wargame);
  } catch (err) {
    wrFallback("Live Qwen unavailable");
  } finally {
    btn.disabled = false;
    WR.liveRunning = false;
  }
}

/* "Watch the council deliberate" — stage the reveal so the room reads as a live
   deliberation, not a static dump: the move lands, the room argues, then the chair's
   verdict flashes in. Re-runnable from the ▶ button. */
function wrPlay() {
  const flow = $("#wr-proceedings");
  if (!flow) return;
  flow.classList.remove("hidden"); // reveal the proceedings the user chose to run
  flow.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // Walk the flow top to bottom: each numbered step (and its connector) fades in; inside
  // step 2, the five generals speak one by one; at step 4 the verdict flashes.
  const blocks = [...flow.children].filter((c) => c.classList.contains("wr-step") || c.classList.contains("wr-conn"));
  const gcards = [...flow.querySelectorAll(".wr-gcard")];
  [...blocks, ...gcards].forEach((e) => { e.classList.add("wr-stage"); e.classList.remove("wr-stage-in"); });

  const stps = [...document.querySelectorAll("#wr-stepper .wr-stp")];
  const tlNodes = [...document.querySelectorAll(".wr-timeline .wr-tl-node")];
  const litStep = (n) => {
    stps.forEach((s) => s.classList.toggle("on", +s.dataset.i <= n));
    tlNodes.forEach((nd) => nd.classList.toggle("on", +nd.dataset.step <= n));
  };
  stps.forEach((s) => s.classList.remove("on"));
  tlNodes.forEach((nd) => nd.classList.remove("on"));

  let t = 350;
  // Slower beats + scroll each numbered step into view as it lands, so it reads as a guided
  // walkthrough (one step at a time) rather than the whole flow appearing at once.
  const GAP = 900, GCARD = 480;
  blocks.forEach((b) => {
    const step = b.classList.contains("wr-step") ? b.dataset.step : null;
    setTimeout(() => {
      b.classList.add("wr-stage-in");
      if (step) { litStep(+step); b.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }, t);
    if (step === "4") {
      const v = b.querySelector(".wr-verdict");
      setTimeout(() => { if (v) { v.classList.remove("wr-flip"); void v.offsetWidth; v.classList.add("wr-flip"); } }, t + 200);
    }
    if (step === "2") {
      // The five generals speak one at a time, each scrolled to as it lands.
      gcards.forEach((g, i) => setTimeout(() => { g.classList.add("wr-stage-in"); g.scrollIntoView({ behavior: "smooth", block: "center" }); }, t + 300 + i * GCARD));
      t += 300 + gcards.length * GCARD + 300;
    } else {
      t += GAP;
    }
  });
}

/* The cast — who is in the room. States the society's size and structure up front so a
   judge gets it in two seconds: five distinct agents + a doctrine-free chair, vs one
   adversary. Tab-aware: generals here, the raw lenses on the negotiation table. */
function wrCastHTML(data) {
  const generals = (data.roster || []).map((g) =>
    `<span class="cast-chip" title="${g.doctrine}">${g.name}</span>`).join("");
  return `<div class="cast">` +
    `<span class="cast-lbl">THE ROOM</span>` +
    `<span class="cast-grp" title="Every general sees the same situation; each evaluates it through a different decision procedure — that's the distinct capability, cognitive not tool-based."><b>5 generals</b> <span class="cast-sub">one procedure each</span>${generals}</span>` +
    `<span class="cast-op">+</span>` +
    `<span class="cast-grp"><b>1 chair</b> <span class="cast-chip chair" title="Takes no side — reads the situation and makes the call">neutral chair</span></span>` +
    `<span class="cast-op">vs</span>` +
    `<span class="cast-grp"><b>1 opponent</b> <span class="cast-sub">true strength hidden</span></span>` +
  `</div>`;
}

/* The turning point — the causal chain, with the PIVOT (the moment the room bought
   information instead of committing) emphasized. This is the sentence a judge retells:
   "the council didn't know if the claim was true, so it bought information before it
   committed." Commitment delayed until uncertainty is reduced. Always visible up top so
   the eye follows the causality before the detail; nodes light up in sync with play. */
function wrTimelineHTML(data) {
  const split = data.generals.reduce((s, g) => s.add(g.action), new Set()).size;
  const probed = data.council === "probe";
  // node: [label, sub, isPivot, stepToSyncWith]
  const nodes = probed
    ? [
        ["Claim received", "bluffed strength", false, 1],
        [`Council split ${split} ways`, "no consensus", false, 2],
        ["Probe ordered", "buy information before committing", true, 4],
        ["Bluff exposed", "the reserves were air", false, 5],
        ["War avoided", "armistice holds", false, 5],
      ]
    : [
        ["Claim received", "bluffed strength", false, 1],
        [`Council split ${split} ways`, "no consensus", false, 2],
        [`Chair commits — ${data.councilLabel.toLowerCase()}`, "reading the situation", true, 4],
        ["Outcome locked", "", false, 5],
      ];
  const cells = nodes.map(([lbl, sub, pivot, step], i) =>
    `<span class="wr-tl-node${pivot ? " pivot" : ""}" data-step="${step}">` +
      `${pivot ? `<span class="wr-tl-pivot-tag">⟳ THE TURNING POINT</span>` : ""}` +
      `<b>${lbl}</b><span class="wr-tl-sub">${sub}</span></span>` +
      (i < nodes.length - 1 ? `<span class="wr-tl-arr">→</span>` : ""),
  ).join("");
  return `<div class="wr-timeline">` +
    `<div class="wr-tl-chain">${cells}</div>` +
    `<div class="wr-tl-thesis"><b>The big idea: don't commit while you're unsure — check first.</b> ` +
      `The council wasn't sure the threat was real, so it tested it before giving anything up.</div>` +
  `</div>`;
}

/* Step 2 — THE SPLIT is the event, not the cards. Reverse the hierarchy: the vote
   tally is the hero (big counts, center stage), then the generals are grouped UNDER the
   position they landed on (not five equal rows). Reasoning is demoted to a quiet line;
   confidence is dropped from the first view — the interesting thing is WHERE they landed,
   not 29 vs 30 vs 32. The cards are evidence the split happened; the split is the story. */
function wrSplitHTML(data) {
  const groups = {};
  data.generals.forEach((g) => { (groups[g.action] ??= []).push(g); });
  const ordered = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  // Hero: the split, big.
  const hero = ordered.map(([action, gs]) => {
    const win = action === data.council;
    return `<div class="wr-split-col${win ? " win" : ""}">` +
      `<span class="wr-split-n">${gs.length}</span>` +
      `<span class="wr-split-act">${data.actions[action]}</span>` +
      `${win ? `<span class="wr-split-win">◄ the chair's call</span>` : ""}</div>`;
  }).join(`<span class="wr-split-sep">vs</span>`);

  // Grouped: who landed where, reasoning demoted.
  const groupCards = ordered.map(([action, gs]) => {
    const win = action === data.council;
    const rows = gs.map((g) => {
      const lc = LENS_COLORS[g.leadLens];
      return `<div class="wr-gcard" style="border-left-color:${lc}">` +
        `<div class="wr-gc-head"><b class="wr-gc-name">${g.name}</b>` +
          `<span class="wr-gc-tag" style="color:${lc}">▤ ${g.lead}</span></div>` +
        `<div class="wr-gc-proc">computes ${WR_PROC[g.leadLens] || "its own read"}</div>` +
        `<div class="wr-gc-say">“${g.doctrine}”</div></div>`;
    }).join("");
    return `<div class="wr-group${win ? " win" : ""}">` +
      `<div class="wr-group-h"><span class="wr-group-act">${data.actions[action]}</span>` +
        `<span class="wr-group-n">${gs.length} general${gs.length > 1 ? "s" : ""}</span></div>` +
      `<div class="wr-group-rows">${rows}</div></div>`;
  }).join("");

  // Adaptive participation: who the chair called in for THIS situation, and who sat out.
  const benched = (data.benched && data.benched.length)
    ? `<div class="wr-benched"><b>The chair convened ${data.generals.length} of 5 for this call.</b> ` +
      `Sitting out: ${data.benched.map((b) => `<span class="wr-bench-x">${b.name} <i>(${b.lensName})</i> — ${b.why}</span>`).join(", ")}. ` +
      `<span class="hint">A different situation calls in a different set — the council isn't always the same committee.</span></div>`
    : (data.convenedNote ? `<div class="wr-benched"><b>All five convened</b> — ${data.convenedNote.replace(/^.*chair convened all five\.?/i, "this call was uncertain and high-stakes enough to need everyone.")}</div>` : "");
  const n = data.generals.length;
  return `<div class="wr-split">` +
    `<div class="wr-split-lbl">THE ROOM SPLIT — same move, ${n} read${n > 1 ? "s" : ""}</div>` +
    benched +
    `<div class="wr-split-hero">${hero}</div>` +
    `<div class="wr-groups">${groupCards}</div>` +
  `</div>`;
}

/* Step 4: arbitration as a checklist, not prose. The terrain factors the chair reads,
   each ticked, landing on the verdict — "why the chair chose X" in scannable lines. */
function wrArbiterHTML(data) {
  const t = data.terrain || {};
  const factors = [
    [`Belief unresolved — ${pct(t.infoConfidence ?? 0)} sure who they are`, (t.infoConfidence ?? 1) < 0.5],
    [`Exposure high — ${pct(t.exposure ?? 0)} on the line`, (t.exposure ?? 0) > 0.5],
    [`Reads as a bluff — ${pct(t.adversarialSignal ?? 0)} adversarial`, (t.adversarialSignal ?? 0) > 0.4],
    [`Information worth more than the probe costs`, !!t.eviWorthIt],
  ];
  const list = factors.map(([txt, on]) =>
    `<div class="wr-arb-f${on ? " on" : ""}">${on ? "✓" : "·"} ${txt}</div>`).join("");
  return `<div class="wr-verdict"><span class="wr-verdict-tag">WHY THE CHAIR CHOSE</span>` +
    `<span class="wr-verdict-act">${data.councilLabel}</span>` +
    `<div class="wr-arb-checks">${list}</div>` +
    `<div class="wr-verdict-why">${data.why}</div></div>`;
}

/* Step 5 lead-in: the outcome punch. The decision lands hard before the war-game detail. */
function wrOutcomeHTML(data) {
  const probed = data.council === "probe";
  const headline = probed
    ? "Bluff exposed — the reserves were air. The armistice holds."
    : `The council commits: ${data.councilLabel.toLowerCase()}.`;
  return `<div class="wr-outcome ${probed ? "win" : ""}"><span class="wr-outcome-tag">RESULT</span>` +
    `<span class="wr-outcome-line">${headline}</span></div>`;
}

/* Step 3 — the deliberation. Live: a genuine multi-round argument among all five generals
   (their progression, the whole room's split each round, and which lens is moving them).
   Mock: the deterministic single exchange, with a prompt to run live for the full room. */
const WR_SHORT = { accept: "Sign", counter_hard: "Press", counter_soft: "Soften", hold: "Hold", probe: "Probe", concede_term: "Trade", walk: "Break" };

function wrDebateStep(data) {
  return data.deliberation ? wrDeliberationHTML(data) : wrChallengeHTML(data);
}

/* The verifiable artifact: show the EXACT room that was fed into one general, and the
   response he conditioned on it — so a viewer can see B read A and change his mind, rather
   than taking the inter-agent message-passing on faith. Built from the rounds the API
   already returns (each round's room is the prior round's calls + argument lines). */
function wrInfluenceHTML(data) {
  const rounds = data.deliberation.rounds;
  let found = null;
  for (let i = 1; i < rounds.length && !found; i++) {
    // prefer a general who changed their CALL; fall back to one whose leading lens moved.
    const t = rounds[i].turns.find((x) => x.changedFrom !== undefined)
          ?? rounds[i].turns.find((x) => x.lensMovedFrom !== undefined);
    if (t) found = { round: rounds[i].round, turn: t, prev: rounds[i - 1] };
  }
  if (!found) return ""; // the room held — no one moved, so there's nothing to show here
  const { round, turn, prev } = found;
  const roomRows = prev.turns.filter((x) => x.id !== turn.id).map((x) =>
    `<div class="wr-inf-row"><span class="wr-inf-who" style="color:${LENS_COLORS[x.leadLens]}">${x.name}</span>` +
    `<span class="wr-inf-call">${WR_SHORT[x.call]}</span><span class="wr-inf-line">“${x.line}”</span></div>`).join("");
  const moved = turn.changedFrom !== undefined
    ? `<b>${turn.name} moves: ${WR_SHORT[turn.changedFrom]} → ${WR_SHORT[turn.call]}</b>`
    : `<b>${turn.name} reframes: ${LENSES_SHORT(turn.lensMovedFrom)} → ${turn.lead}</b> (held the call, shifted the reasoning)`;
  return `<div class="wr-influence">` +
    `<div class="wr-inf-lbl">⟲ WATCH ONE GENERAL READ THE ROOM AND MOVE <span class="hint">— the exact room fed into ${turn.name} at round ${round}, and how he answered it. Proof the debate is real, not parallel re-scoring.</span></div>` +
    `<div class="wr-inf-room"><div class="wr-inf-room-h">The room ${turn.name} saw going into round ${round} (from round ${round - 1}):</div>${roomRows}</div>` +
    `<div class="wr-inf-resp"><div class="wr-inf-arrow">↓ ${turn.name} answers (round ${round})</div>` +
      `<div class="wr-inf-resp-line">“${turn.line}”</div>` +
      `<div class="wr-inf-shift">${moved} — <span class="wr-inf-cause">caused by reading the room, not a re-roll</span></div></div>` +
  `</div>`;
}

function wrDeliberationHTML(data) {
  const del = data.deliberation;
  const rounds = del.rounds;
  const ids = rounds[0].turns.map((t) => ({ id: t.id, name: t.name }));

  // 1) Progression grid — each general's call across rounds; the whole room at a glance.
  const head = `<div class="wr-pg-h">GENERAL</div>` +
    rounds.map((r) => `<div class="wr-pg-h">R${r.round}</div>`).join("");
  const rows = ids.map(({ id, name }) => {
    const cells = rounds.map((r) => {
      const t = r.turns.find((x) => x.id === id);
      const moved = t.changedFrom !== undefined;
      const lensMoved = t.lensMovedFrom !== undefined;
      return `<div class="wr-pg-cell${moved ? " moved" : ""}" title="${t.lead} → ${t.label}">` +
        `<span class="wr-pg-call">${WR_SHORT[t.call]}</span>` +
        `<span class="wr-pg-lens${lensMoved ? " lmoved" : ""}" style="color:${LENS_COLORS[t.leadLens]}">▤ ${t.lead}</span></div>`;
    }).join("");
    return `<div class="wr-pg-name">${name}</div>${cells}`;
  }).join("");
  const grid = `<div class="wr-pg" style="grid-template-columns:7rem repeat(${rounds.length},1fr)">${head}${rows}</div>`;

  // 2) The room split per round — the society moving (or not).
  const roomStrip = rounds.map((r) => {
    const split = r.split.map((s) => `<b>${s.count}</b> ${WR_SHORT[s.action]}`).join(" · ");
    const lens = r.lensTally.map((l) => `${l.cog} ${l.count}`).join(", ");
    return `<div class="wr-room-row"><span class="wr-room-r">R${r.round}</span>` +
      `<span class="wr-room-split">${split}</span><span class="wr-room-lens">lenses leading: ${lens}</span></div>`;
  }).join("");

  // 3) The arguments themselves, round by round (the five genuinely talking).
  const transcript = rounds.filter((r) => r.kind === "deliberation").map((r) => {
    const turns = r.turns.map((t) => {
      const shift = t.changedFrom !== undefined
        ? `<span class="wr-shift">↳ shifted ${WR_SHORT[t.changedFrom]} → ${WR_SHORT[t.call]}</span>` : "";
      const lshift = t.lensMovedFrom !== undefined
        ? `<span class="wr-lshift">lens: ${LENSES_SHORT(t.lensMovedFrom)} → ${t.lead}</span>` : "";
      return `<div class="wr-dturn">` +
        `<span class="wr-dturn-name" style="color:${LENS_COLORS[t.leadLens]}">${t.name}</span>` +
        `<span class="wr-dturn-tag" style="color:${LENS_COLORS[t.leadLens]}">▤ ${t.lead}</span>` +
        `<span class="wr-dturn-line">“${t.line}”</span>${shift}${lshift}</div>`;
    }).join("");
    return `<div class="wr-dround"><div class="wr-dround-h">ROUND ${r.round}</div>${turns}</div>`;
  }).join("");

  const capNote = `${rounds.length} round${rounds.length > 1 ? "s" : ""} ` +
    `(arbiter cap ${del.cap}, stopped: ${del.stopReason === "consensus" ? "consensus reached" : del.stopReason === "stable" ? "room settled" : "cap hit"})`;

  // Did the debate actually move the chair's call vs round-1? Causality, stated honestly.
  const causal = del.changedCall
    ? `<div class="wr-causal yes">⚖ <b>The argument changed the call.</b> Before they argued, the chair would have picked <b>${del.round1Label}</b>; after some generals were talked round, it's <b>${del.finalLabel}</b>.</div>`
    : `<div class="wr-causal no">⚖ <b>The argument didn't change the call</b> — it stayed <b>${del.finalLabel}</b>. That's on purpose: the chair decides on the <b>situation</b>, not on who argues hardest. The argument's job is to <b>put the disagreement on the record</b> and test the leading idea — not to talk anyone into it.</div>`;
  return `<div class="wr-delib">` +
    `<div class="wr-delib-lbl">THE ARGUMENT, ROUND BY ROUND <span class="hint">— all five argue each round and may change their mind; ${capNote}</span></div>` +
    causal +
    wrInfluenceHTML(data) +
    `<div class="wr-pg-wrap">${grid}</div>` +
    `<div class="wr-room"><div class="wr-room-lbl">THE ROOM, ROUND BY ROUND</div>${roomStrip}</div>` +
    `<div class="wr-transcript">${transcript}</div>` +
  `</div>`;
}
const LENSES_SHORT = (d) => (state.meta?.lenses?.[d]?.cogFunction ?? d);

/* Step 6 — the operational order. The decision becomes a complex deliverable: a
   multi-division plan, each division drafted by the general whose doctrine owns it
   (task decomposition + role assignment, made literal). Live only. */
function wrPlanHTML(data) {
  if (!data.plan) {
    return `<div class="wr-plan-empty">Convene the live council to issue the order — each general writes their own part.</div>`;
  }
  // The war plan as a real operational order: a masthead, the situation, then one numbered
  // division per general — the officer, HOW their lens reasons about it, the objective, and
  // the concrete tasks they allocate. Colour-coded by author; hover/click a general to isolate.
  const plan = data.plan;
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  // Contributor presence — like Google Docs collaborators, top-right. Click one to see only their edits.
  const people = `<button class="gdoc-ava all active" data-lens="all" title="Everyone's contributions">All</button>` +
    plan.sections.map((s) =>
      `<button class="gdoc-ava" data-lens="${s.lens}" style="--c:${LENS_COLORS[s.lens]}" title="${s.general} · ${s.cog} — show only their contribution"><i>${initials(s.general)}</i></button>`,
    ).join("");
  // Stash each author's "why I own this" for the on-focus comment (keyed by lens).
  WR.planWho = {};
  plan.sections.forEach((s) => {
    WR.planWho[s.lens] = { name: s.general, cog: s.cog, why: s.reasoning, initials: initials(s.general), color: LENS_COLORS[s.lens] };
  });
  // ONE war plan: the order flows as a single document; each passage carries a faint
  // authorship tint. No per-general headings — you see WHO wrote what by hovering a
  // contributor (their passages light up, everyone else's tint drops away).
  const paras = plan.sections.map((s) => {
    const tasks = (s.tasks || []).length
      ? `<ul class="wp-tasks">${s.tasks.map((t) => `<li>${t}</li>`).join("")}</ul>` : "";
    return `<div class="wp-para${s.ok ? "" : " failed"}" data-lens="${s.lens}" style="--c:${LENS_COLORS[s.lens]}">` +
      `<p class="wp-lead"><b>${s.title}.</b> ${s.objective || ""}</p>${tasks}</div>`;
  }).join("");
  return `<div class="gdoc" id="wpdoc" data-focus="all">` +
    `<div class="gdoc-bar">` +
      `<div class="gdoc-titlewrap"><span class="gdoc-file">▤ OPERATIONAL ORDER · shared</span>` +
        `<div class="gdoc-title">THE CALL — <b>${plan.directive}</b></div></div>` +
      `<div class="gdoc-people" title="contributors — hover to see their passages">${people}</div>` +
    `</div>` +
    `<div class="gdoc-sub">One war plan · ${plan.sections.length} contributors · drafted live on Qwen · <b>hover a contributor</b> to light up their passages</div>` +
    `<div class="gdoc-situation"><span class="gdoc-sk">SITUATION</span>${data.move || "the other side's move on the table"}</div>` +
    `<div class="gdoc-body">${paras}</div>` +
    `<div class="gdoc-note" id="wp-note"><span class="gdoc-note-hint">Hover a contributor to see why they own their part of the plan.</span></div>` +
  `</div>`;
}

/* Wire the ONE war plan: hover a contributor avatar (or a passage) to light up that author's
   passages and surface their "why I own this" note; everyone else's authorship tint drops
   away. Click an avatar to lock it; click again (or "All") to release. */
function wrWirePlan() {
  const doc = document.querySelector("#wpdoc");
  if (!doc) return;
  const avas = [...doc.querySelectorAll(".gdoc-ava[data-lens]")];
  const paras = [...doc.querySelectorAll(".wp-para")];
  const note = doc.querySelector("#wp-note");
  let locked = "all"; // sticky selection; hover previews over it, leaving restores it

  const setNote = (focus) => {
    if (!note) return;
    const w = focus && WR.planWho ? WR.planWho[focus] : null;
    note.classList.toggle("has", !!w);
    note.innerHTML = w
      ? `<span class="gdoc-ava xs" style="--c:${w.color}"><i>${w.initials}</i></span>` +
        `<div class="gdoc-cbody"><div class="gdoc-cname">${w.name}<span class="gdoc-creason">why I own this</span></div><p>${w.why}</p></div>`
      : `<span class="gdoc-note-hint">Hover a contributor to see why they own their part of the plan.</span>`;
  };
  const apply = (lens) => {
    const focus = lens && lens !== "all" ? lens : null;
    doc.dataset.focus = focus || "all";
    paras.forEach((p) => {
      p.classList.toggle("focus", !!focus && p.dataset.lens === focus);
      p.classList.toggle("mute", !!focus && p.dataset.lens !== focus);
    });
    avas.forEach((a) => a.classList.toggle("active", a.dataset.lens === (focus || "all")));
    setNote(focus);
  };

  avas.forEach((a) => {
    a.addEventListener("mouseenter", () => apply(a.dataset.lens));
    a.addEventListener("mouseleave", () => apply(locked));
    a.addEventListener("click", () => { locked = locked === a.dataset.lens ? "all" : a.dataset.lens; apply(locked); });
  });
  paras.forEach((p) => {
    p.addEventListener("mouseenter", () => apply(p.dataset.lens));
    p.addEventListener("mouseleave", () => apply(locked));
  });
}

/* The room argues: the engine's real lens-level challenge this round, voiced by the
   generals who embody those lenses. One side concedes (causal) or holds — the society
   resolving a disagreement, not just registering it. */
function wrChallengeHTML(data) {
  const ch = data.challenge || [];
  const challenge = ch.find((c) => c.role === "challenge");
  const defense = ch.find((c) => c.role === "defense");
  if (!challenge || !defense) return "";
  const fromColor = LENS_COLORS[ORDER.find((d) => lens(d).cogFunction === challenge.fromLens)] || "var(--ink)";
  const defColor = LENS_COLORS[ORDER.find((d) => lens(d).cogFunction === defense.fromLens)] || "var(--ink)";
  const outcome = defense.conceded
    ? `<span class="wr-concede">${defense.fromName} concedes ground — ${defense.originalScore.toFixed(2)} → ${defense.revisedScore.toFixed(2)} on the contested move</span>`
    : `<span class="wr-hold">${defense.fromName} holds the line</span>`;
  return `<div class="wr-argue">` +
    `<div class="wr-argue-lbl">THE ROOM ARGUES <span class="hint">— the round’s sharpest split; one side may concede (causal, score-changing)</span></div>` +
    `<div class="wr-turn">` +
      `<span class="wr-turn-who" style="color:${fromColor}">${challenge.fromName} <em>· ${challenge.fromLens}</em></span>` +
      `<span class="wr-turn-txt">“${challenge.text}”</span>` +
    `</div>` +
    `<div class="wr-turn wr-turn-d">` +
      `<span class="wr-turn-who" style="color:${defColor}">${defense.fromName} <em>· ${defense.fromLens}</em></span>` +
      `<span class="wr-turn-txt">“${defense.text}”</span>` +
    `</div>` +
    `<div class="wr-argue-out">${outcome} → the chair’s call stands: <b>${data.councilLabel}</b></div>` +
  `</div>`;
}

function wrRenderWargame(wg) {
  const maxTerms = Math.max(...wg.perType.map((o) => o.expectedTerms), 1);
  const rows = wg.perType.map((o) => {
    const width = Math.round((o.expectedTerms / maxTerms) * 100);
    return `<div class="wr-wg-row">` +
      `<span class="wr-wg-type">${TYPE_SHORT[o.type]}</span>` +
      `<span class="wr-wg-bel">${pct(o.belief)} likely</span>` +
      `<div class="wr-wg-bar"><div class="wr-wg-fill" style="width:${width}%"></div><span class="wr-wg-val">${money(o.expectedTerms)}</span></div>` +
      `<span class="wr-wg-arm">${pct(o.armisticeRate)} hold</span>` +
    `</div>`;
  }).join("");
  $("#wr-wargame").innerHTML =
    `<div class="wr-wg-lbl">WAR-GAME — we play it out ${wg.nSeeds * wg.perType.length} times ` +
      `<span class="hint">— once for each kind of opponent they might really be</span></div>` +
    rows +
    `<div class="wr-wg-blend">Most likely: <b>${money(wg.blended.expectedTerms)}</b> won · the ceasefire <b>holds ${pct(wg.blended.armisticeRate)}</b> of the time` +
      `<span class="hint"> (war breaks out ${pct(wg.blended.warRate)})</span></div>`;
}

/* ===================== FIT EXPLORER (the negotiation table) =====================
   Which framing fits which counterparty personality — and which backfires. Each single
   lens-led framing vs each personality, from real runs. Money is real here ($): this is
   a business deal, not the war room. The COUNCIL column matches the best framing every
   time — the point: no single framing wins everywhere, so the society never has to bet. */
const deal = (x) => `$${Math.round(x).toLocaleString()}`;

const FIT_WHY = {
  relationship: "Values the relationship over the last point — collaborative framing closes; pressure makes it walk.",
  soft_floor: "Soft on the surface, firm underneath — Frame/Probe find the real floor and trade; over-trust leaves value on the table.",
  deceptive: "Bluffs leverage it doesn't have — Probe calls the bluff and closes; pressure caves the deal into a walk.",
};

/* Tab the skin, share the spine. A single global track switches the FRAMED surfaces —
   hero, the result, and the live interactive — between the War Room (armistice, abstract
   stakes) and the Negotiation table (a business deal, real money). The spine — how it
   decides, the evidence, the architecture — is shared and never duplicated. Track-specific
   blocks are tagged .track-pane[data-track]; everything else is common to both. */
function setupTracks() {
  const panes = [...document.querySelectorAll(".track-pane")];
  if (!panes.length) return;
  const swap = document.querySelector("#scenario-swap");
  const idEl = document.querySelector("#track-id");
  const toEl = document.querySelector("#scenario-swap-to");
  // War Room is the standing experience; the business deal is the "same architecture,
  // different domain" reveal — a single subordinate swap, not a co-equal Mode 1 / Mode 2.
  const LABEL = {
    war: { id: "⚔ The War Council", to: "🤝 Business deal →" },
    nego: { id: "🤝 Business Negotiation", to: "← ⚔ Back to the War Council" },
  };
  const set = (which) => {
    panes.forEach((p) => p.classList.toggle("hidden", p.dataset.track !== which));
    document.body.dataset.track = which;
    if (idEl) idEl.textContent = LABEL[which].id;
    if (toEl) toEl.innerHTML = LABEL[which].to;
    applyTrackToTableau(which); // the §02 tableau quote follows the scenario
    // One set of runs, reskinned per scenario: $ in the business deal, abstract stakes in
    // the war. Re-render so the evidence units follow the active scenario.
    loadAb(); loadAblation(); loadHoldout();
  };
  if (swap) swap.addEventListener("click", () => set(document.body.dataset.track === "nego" ? "war" : "nego"));
  // End-of-result transitions: "see how Synod applies this to negotiations & M&A" (and back).
  document.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    set(el.dataset.goto);
    document.getElementById(el.dataset.goto === "nego" ? "proceedings" : "warroom")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  set("war");
}

/* Evidence numbers follow the active track: real dollars at the negotiation table,
   abstract stakes in the war room (where money would be the wrong frame). Same runs. */
const evMoney = (x) => `${document.body.dataset.track === "nego" ? "$" : ""}${Math.round(x).toLocaleString()}`;

async function loadFit() {
  const box = $("#fit-lab");
  if (!box) return;
  let d;
  try { d = await (await fetch("/api/fit")).json(); }
  catch { box.textContent = "Fit explorer unavailable."; return; }
  const maxS = Math.max(...d.matrix.flatMap((r) => [...r.cells.map((c) => c.surplus), r.council.surplus]), 1);
  const cog = (id) => lens(id).cogFunction;

  const head = `<div class="fit-h fit-rowlbl"></div>` +
    d.lenses.map((l) => `<div class="fit-h" style="color:${LENS_COLORS[l.id]}">${l.cog}</div>`).join("") +
    `<div class="fit-h fit-council">COUNCIL</div>`;

  const cell = (c, row) => {
    const walk = c.dealRate < 0.5;
    const best = c.lens === row.bestLens && !walk;
    const intensity = walk ? 0 : c.surplus / maxS;
    const bg = walk ? "rgba(207,98,88,0.20)" : `hsl(${Math.round(intensity * 120)} 42% ${13 + intensity * 9}%)`;
    return `<div class="fit-cell${best ? " fit-best" : ""}${walk ? " fit-walk-cell" : ""}" style="background:${bg}" ` +
      `title="${c.cog} framing vs ${row.name}">` +
      `${best ? `<span class="fit-fits">✓ ${c.cog} fits</span>` : walk ? `<span class="fit-walk">✕ WALK</span>` : `<span class="fit-amt">${deal(c.surplus)}</span>`}</div>`;
  };

  const body = d.matrix.map((row) =>
    `<div class="fit-rowlbl"><b>${row.name}</b><span>${row.tell}</span></div>` +
    row.cells.map((c) => cell(c, row)).join("") +
    `<div class="fit-cell fit-council">${deal(row.council.surplus)}</div>` +
    `<div class="fit-why" style="grid-column:1/-1">${FIT_WHY[row.type] || ""} ` +
      `<b style="color:${LENS_COLORS[row.bestLens]}">${cog(row.bestLens)} fits</b> · ` +
      `<b style="color:${LENS_COLORS[row.worstLens]}">${cog(row.worstLens)} backfires</b></div>`,
  ).join("");

  box.innerHTML =
    `<div class="fit-headline"><b>Wrong worldview → walk away. Right worldview → close.</b> There is no universal strategy.</div>` +
    `<div class="fit-lbl">Which judge fits which opponent ` +
      `<span class="hint">— each judge alone vs each kind of opponent · real games · the <b>COUNCIL matches the best fit every time</b></span></div>` +
    `<div class="fit-grid" style="grid-template-columns: 9rem repeat(${d.lenses.length}, 1fr) 5.5rem">${head}${body}</div>` +
    `<div class="fit-foot">The council doesn't label the opponent and then pick a judge. All five weigh the uncertainty at once and the chair decides — it just happens to land on the best fit. <b>Judging under uncertainty, not sorting into boxes.</b></div>`;
}

init();
