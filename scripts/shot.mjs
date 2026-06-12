import { chromium } from "playwright";

const scenario = process.argv[2] ?? "type-c-deceptive";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 2000 } });
await page.goto("http://localhost:4173", { waitUntil: "networkidle" });

// pick the requested hidden type
await page.selectOption("#scenario-select", scenario);
await page.click("#run-btn");

// wait for the negotiation to finish (terminal panel + A/B populated)
await page.waitForSelector("#terminal-panel:not(.hidden)", { timeout: 40000 });
await page.waitForFunction(() => document.querySelectorAll("#ab-table tr").length > 3, { timeout: 40000 });

// expand a couple of lens cards to show the thought process
const lenses = await page.$$(".lens");
if (lenses[3]) await lenses[3].click(); // Probe in round 1
if (lenses[4]) await lenses[4].click(); // Risk in round 1
await page.waitForTimeout(400);

await page.screenshot({ path: `/tmp/synod-${scenario}.png`, fullPage: true });
await browser.close();
console.log(`ok -> /tmp/synod-${scenario}.png`);
