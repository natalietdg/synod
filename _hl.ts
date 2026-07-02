import { runHoldout } from "./src/harness/holdout.js";
import { MockAgents } from "./src/agents/mock.js";
(async () => {
  const r = await runHoldout(new MockAgents(), 10, { singleLens: true });
  const rows = (r as any).rows ?? (r as any).worlds ?? r;
  for (const w of rows) {
    const l = (w as any).lenses ?? {};
    console.log(w.title, Object.entries(l).map(([k, v]: any) => `${k}=${Math.round(v.surplusMean)}`).join(" "));
  }
})();
