// The opening, staged by scroll: beat 1 — the claim; beat 2 — the bet.
// Progressive enhancement: without JS (or with reduced motion) both lines
// simply stand together; the stage collapses to a normal block.
(() => {
  const stage = document.getElementById("hero-stage");
  if (!stage) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return; // static: both beats visible, no pin, no cue motion

  stage.classList.add("hs-active");
  const track = stage.querySelector(".hs-track");
  const l1 = stage.querySelector(".hs-l1");
  const l2 = stage.querySelector(".hs-l2");
  const cue = stage.querySelector(".hs-cue");

  let ticking = false;
  const render = () => {
    ticking = false;
    const r = track.getBoundingClientRect();
    const span = r.height - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / span)); // 0 → 1 through the stage

    // beat 1 holds, then hands over; beat 2 arrives and stays
    const out = Math.min(1, Math.max(0, (p - 0.28) / 0.22)); // l1 exit 0.28–0.50
    const inn = Math.min(1, Math.max(0, (p - 0.46) / 0.22)); // l2 enter 0.46–0.68
    l1.style.opacity = String(1 - out);
    l1.style.transform = `translateY(${out * -26}px)`;
    l1.style.filter = out > 0 && out < 1 ? "blur(2px)" : "none";
    l2.style.opacity = String(inn);
    l2.style.transform = `translateY(${(1 - inn) * 26}px)`;
    cue.style.opacity = String(Math.max(0, 1 - p * 8));
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(render); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  render();
})();
