import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseThreads } from "@opendeck/shell/threads";
import { docAnchor, loadDoc, suggestionsOf, textOf } from "@opendeck/doc";

const root = fileURLToPath(new URL("../../../examples/sample-doc", import.meta.url));
const read = (rel: string) => readFile(path.join(root, rel), "utf8").catch(() => null);

describe("the sample doc", () => {
  it("loads with no problems or diagnostics", async () => {
    const doc = await loadDoc({ read, list: (d) => readdir(path.join(root, d)).catch(() => []) });
    expect(doc.problems).toEqual([]);
    for (const t of doc.tabs.values()) expect(t.diagnostics, t.id).toEqual([]);
  });

  it("shows comments and suggestions, all anchored on real blocks and words", async () => {
    const doc = await loadDoc({ read, list: (d) => readdir(path.join(root, d)).catch(() => []) });
    const threads = parseThreads(await read("comments.json"), docAnchor);
    expect(threads.length).toBeGreaterThan(0);
    for (const t of threads) {
      const block = doc.tabs.get(t.tab)?.tab?.children.find((b) => b.type === "element" && b.attrs.id === t.block);
      expect(block, t.id).toBeTruthy();
      expect(textOf(block!)).toContain(t.quote);
    }
    const suggestions = [...doc.tabs.values()].flatMap((t) => (t.tab ? suggestionsOf(t.tab) : []));
    expect(suggestions.map((s) => s.by).sort()).toEqual(["ai", "you"]);
  });
});
