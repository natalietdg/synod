/**
 * check-html — a fast structural guard for public/index.html.
 *
 * The frontend builds markup by hand, so an unbalanced tag (one stray `</div>`) silently
 * re-parents whole sections and breaks the layout — exactly the bug that shipped once.
 * This walks the file's tags and reports any container that isn't balanced, with the line
 * of the offending tag. Run via `npm run check:html`; exits non-zero on imbalance.
 */
import { readFileSync } from "node:fs";

const FILE = "public/index.html";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const html = readFileSync(FILE, "utf8");
const lines = html.split("\n");

const stack = [];
const errors = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

lines.forEach((text, i) => {
  const lineNo = i + 1;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const [, slash, nameRaw, selfClose] = m;
    const name = nameRaw.toLowerCase();
    if (VOID.has(name) || selfClose) continue;
    if (!slash) {
      stack.push({ name, lineNo });
    } else {
      const top = stack[stack.length - 1];
      if (!top) {
        errors.push(`line ${lineNo}: stray </${name}> with nothing open`);
      } else if (top.name !== name) {
        errors.push(`line ${lineNo}: </${name}> closes <${top.name}> opened on line ${top.lineNo} (mismatch)`);
        stack.pop();
      } else {
        stack.pop();
      }
    }
  }
});

for (const left of stack) errors.push(`line ${left.lineNo}: <${left.name}> never closed`);

if (errors.length) {
  console.error(`✗ ${FILE} — ${errors.length} structural problem(s):`);
  for (const e of errors.slice(0, 20)) console.error("  " + e);
  process.exit(1);
}
console.log(`✓ ${FILE} — tags balanced.`);
