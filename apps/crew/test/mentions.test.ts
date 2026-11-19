import { describe, expect, it } from "vitest";
import { openMention, splitMentions } from "../src/renderer/mentions.ts";

const bots = [
  { name: "Research", slug: "research" },
  { name: "Research Lead", slug: "research-lead" },
];

describe("splitMentions", () => {
  it("finds a mention, longest name first", () => {
    expect(splitMentions("hi @Research Lead, go", bots)).toEqual([{ text: "hi " }, { text: "@Research Lead", slug: "research-lead" }, { text: ", go" }]);
  });
  it("marks @all with no bot", () => {
    expect(splitMentions("@all stand up", bots)[0]).toEqual({ text: "@all", slug: "" });
  });
  it("ignores an email address and unknown names", () => {
    expect(splitMentions("a@research.com @nobody", bots)).toEqual([{ text: "a@research.com @nobody" }]);
  });
});

describe("openMention", () => {
  it("opens after an @ at a word start", () => {
    expect(openMention("ask @re", 7)).toEqual({ start: 4, query: "re" });
    expect(openMention("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("is closed after a space or inside a word", () => {
    expect(openMention("ask @re ", 8)).toBeNull();
    expect(openMention("a@b", 3)).toBeNull();
  });
});
