import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(__dirname, "../renderer/chat.css"), "utf8");

/** The text inside every `@media <query> { … }` block, with the braces balanced. */
function mediaBlocks(query: string): string[] {
  const head = `@media ${query} {`;
  const out: string[] = [];
  let at = css.indexOf(head);
  while (at >= 0) {
    const start = at + head.length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(start, i - 1));
    at = css.indexOf(head, i);
  }
  return out;
}

const motion = mediaBlocks("(prefers-reduced-motion: no-preference)").join("\n");
const outside = css.replace(/@media \(prefers-reduced-motion: [a-z-]+\) \{[\s\S]*?\n\}\n/g, "");

describe("chat motion", () => {
  it("the entry duration is inside the 120–200 ms range", () => {
    const m = css.match(/--as-enter:\s*(\d+)ms/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(120);
    expect(Number(m![1])).toBeLessThanOrEqual(200);
  });

  it("the new entry motion is only under prefers-reduced-motion: no-preference", () => {
    for (const sel of [".chat-panel {", ".as-bubble", ".as-reply:not(.settled)", ".as-step", ".as-jump", ".as-cursor {"]) {
      expect(motion, sel).toContain(sel);
    }
  });

  it("no entry or blink animation is set outside a motion query", () => {
    expect(outside).not.toMatch(/animation:\s*as-open/);
    expect(outside).not.toMatch(/animation:\s*as-blink/);
    expect(outside).not.toMatch(/\.(as-bubble|as-reply|as-step|as-jump|as-cursor)\s*\{[^}]*animation:/);
    expect(outside).not.toMatch(/\.chat-panel\s*\{[^}]*animation:/);
  });

  it("the reduced-motion query switches the rest off", () => {
    const reduced = mediaBlocks("(prefers-reduced-motion: reduce)").join("\n");
    expect(reduced).toContain(".as-step.running .as-step-mark");
    expect(reduced).toContain(".as-jump");
  });
});
