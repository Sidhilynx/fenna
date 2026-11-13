import { describe, expect, it } from "vitest";
import { MAX_CHATS, activeChat, addChat, assistantOf, chatTitle, closeChat, newChat, parseChats, reorderChats, showChat, updateChat } from "../renderer/chats.ts";

const NOW = 1_800_000_000_000;
const said = (text: string) => ({ role: "user" as const, text });

describe("parseChats (reading what was saved)", () => {
  it("starts one empty, open chat when nothing was saved", () => {
    for (const raw of [null, undefined, "garbage", 42, { chats: "no" }]) {
      const b = parseChats(raw, NOW);
      expect(b.chats).toHaveLength(1);
      expect(b.open).toEqual([b.chats[0]!.id]);
      expect(b.active).toBe(b.chats[0]!.id);
    }
  });

  it("brings the single chat older versions saved forward, open and in front", () => {
    const b = parseChats({ kind: "claude", model: "opus", sessionId: "s1", sessionKind: "claude", items: [said("Make a deck"), { role: "assistant", text: "Done." }] }, NOW);
    const c = activeChat(b);
    expect(b.chats).toHaveLength(1);
    expect(c.kind).toBe("claude");
    expect(c.model).toBe("opus");
    expect(c.sessionId).toBe("s1");
    expect(c.items).toHaveLength(2);
  });

  it("drops steps left running when the app closed, and unknown items", () => {
    const b = parseChats({ chats: [{ id: "a", items: [said("hi"), { role: "tool", id: "t", label: "Wrote", status: "running" }, { role: "nope" }, { role: "tool", id: "u", label: "Read", status: "done" }] }], open: ["a"], active: "a" }, NOW);
    expect(activeChat(b).items.map((i) => i.role)).toEqual(["user", "tool"]);
  });

  it("ignores open ids that aren't chats, and repeats", () => {
    const b = parseChats({ chats: [{ id: "a", items: [] }, { id: "b", items: [] }], open: ["b", "x", "b", "a"], active: "x" }, NOW);
    expect(b.open).toEqual(["b", "a"]);
    expect(b.active).toBe("b");
  });

  it("rejects an assistant kind it doesn't know", () => {
    const b = parseChats({ chats: [{ id: "a", kind: "gpt-shell", items: [] }], open: ["a"], active: "a" }, NOW);
    expect(activeChat(b).kind).toBeNull();
  });
});

describe("chat tabs", () => {
  const base = () => {
    let b = parseChats(null, NOW);
    b = updateChat(b, b.active, (c) => ({ ...c, kind: "codex", model: "gpt-x", effort: "high", items: [said("first")] }));
    return b;
  };

  it("a new chat opens after the active tab, in front, with the same assistant, model and effort", () => {
    const b = addChat(base(), NOW + 1);
    expect(b.open).toHaveLength(2);
    expect(b.active).toBe(b.open[1]);
    expect(assistantOf(b)).toEqual({ kind: "codex", model: "gpt-x", effort: "high" });
    expect(activeChat(b).items).toEqual([]);
  });

  it("closing the active tab shows its right neighbour, else the left", () => {
    let b = addChat(addChat(base(), NOW + 1), NOW + 2);
    const [a, , c] = b.open;
    b = showChat(b, b.open[1]!);
    b = closeChat(b, b.active, NOW + 3);
    expect(b.active).toBe(c);
    b = closeChat(b, c!, NOW + 4);
    expect(b.active).toBe(a);
  });

  it("a closed chat stays in history; an empty one is simply gone", () => {
    let b = addChat(base(), NOW + 1);
    const emptyId = b.active;
    const firstId = b.open[0]!;
    b = closeChat(b, emptyId, NOW + 2);
    expect(b.chats.some((c) => c.id === emptyId)).toBe(false);
    b = addChat(b, NOW + 3);
    b = closeChat(b, firstId, NOW + 4);
    expect(b.open).not.toContain(firstId);
    expect(b.chats.some((c) => c.id === firstId)).toBe(true);
    b = showChat(b, firstId);
    expect(b.active).toBe(firstId);
    expect(b.open).toContain(firstId);
  });

  it("closing the last tab leaves a new, empty chat", () => {
    const one = base();
    const b = closeChat(one, one.active, NOW + 1);
    expect(b.open).toHaveLength(1);
    expect(b.active).not.toBe(one.active);
    expect(activeChat(b).items).toEqual([]);
  });

  it("reorders only with the same set of tabs", () => {
    const b = addChat(base(), NOW + 1);
    const rev = [...b.open].reverse();
    expect(reorderChats(b, rev).open).toEqual(rev);
    expect(reorderChats(b, [b.open[0]!]).open).toEqual(b.open);
  });

  it("keeps at most MAX_CHATS, letting the oldest closed ones go", () => {
    let b = base();
    for (let i = 0; i < MAX_CHATS + 10; i++) {
      b = updateChat(b, b.active, (c) => ({ ...c, items: [said(`chat ${i}`)], at: NOW + i }));
      const prev = b.active;
      b = addChat(b, NOW + i + 1);
      b = closeChat(b, prev, NOW + i + 1);
    }
    expect(b.chats.length).toBeLessThanOrEqual(MAX_CHATS);
    expect(b.chats.some((c) => chatTitle(c) === `chat ${MAX_CHATS + 9}`)).toBe(true);
    expect(b.chats.some((c) => chatTitle(c) === "chat 0")).toBe(false);
  });

  it("names a chat by its first message, on one line", () => {
    expect(chatTitle(newChat(undefined, NOW))).toBe("New chat");
    expect(chatTitle({ ...newChat(undefined, NOW), items: [{ role: "assistant", text: "x" }, said("  Make\n a deck  ")] })).toBe("Make a deck");
  });
});
