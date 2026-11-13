import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadDeck } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../examples/sample-deck", import.meta.url));

it("the sample deck loads with no problems or diagnostics", async () => {
  const deck = await loadDeck({
    read: (p) => readFile(join(root, p), "utf8").catch(() => null),
    list: (d) => readdir(join(root, d)).catch(() => []),
  });
  expect(deck.problems).toEqual([]);
  expect(deck.slides.map((s) => s.id)).toEqual(["cover", "problem", "statement", "how", "roadmap", "business"]);
  for (const s of deck.slides) expect({ id: s.id, diagnostics: s.diagnostics }).toEqual({ id: s.id, diagnostics: [] });
});
