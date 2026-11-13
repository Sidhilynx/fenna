import { describe, expect, it } from "vitest";
import { type ElementNode, mergeBlocks, serializeNode } from "../src/index.ts";

const p = (id: string, text: string): ElementNode => ({ type: "element", tag: "p", attrs: { id }, children: [{ type: "text", text }] });
const show = (bs: ElementNode[]) => bs.map((b) => `${b.attrs.id}:${serializeNode(b).replace(/<[^>]+>/g, "")}`).join(" ");
const base = [p("a", "one"), p("b", "two"), p("c", "three")];

describe("mergeBlocks (the user's typing and the AI's edit, at once)", () => {
  it("keeps the user's changed blocks and the AI's other changes", () => {
    const mine = [p("a", "ONE typed"), p("b", "two"), p("c", "three")];
    const theirs = [p("a", "one"), p("b", "TWO by ai"), p("c", "three")];
    expect(show(mergeBlocks(base, mine, theirs))).toBe("a:ONE typed b:TWO by ai c:three");
  });

  it("keeps blocks each side added, where each put them", () => {
    const mine = [p("a", "one"), p("m", "mine"), p("b", "two"), p("c", "three")];
    const theirs = [p("a", "one"), p("b", "two"), p("c", "three"), p("t", "theirs")];
    expect(show(mergeBlocks(base, mine, theirs))).toBe("a:one m:mine b:two c:three t:theirs");
  });

  it("deletes what one side deleted and the other left alone", () => {
    const mine = [p("a", "one"), p("c", "three")];
    const theirs = [p("a", "one"), p("b", "two")];
    expect(show(mergeBlocks(base, mine, theirs))).toBe("a:one");
  });

  it("keeps a block the user is typing in even if the AI deleted it", () => {
    const mine = [p("a", "one"), p("b", "two, still typing"), p("c", "three")];
    const theirs = [p("a", "one"), p("c", "three")];
    expect(show(mergeBlocks(base, mine, theirs))).toBe("a:one b:two, still typing c:three");
  });

  it("puts a new first block first", () => {
    const mine = [p("n", "new"), ...base];
    expect(show(mergeBlocks(base, mine, base))).toBe("n:new a:one b:two c:three");
  });
});
