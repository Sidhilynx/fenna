import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { otherSiteTab } = require("../src/main/browser.cjs");
const { createWaits } = require("../src/main/waits.cjs");

describe("one tab per site", () => {
  const tabs = [
    { id: 1, origin: "https://www.google.com" },
    { id: 7, origin: "https://web.whatsapp.com" },
  ];

  it("switches to the tab already on the site instead of opening a second one", () => {
    expect(otherSiteTab(tabs, "https://web.whatsapp.com", 1)).toMatchObject({ id: 7 });
  });

  it("opens as usual when the site isn't open, or is the tab already in front", () => {
    expect(otherSiteTab(tabs, "https://github.com", 1)).toBeNull();
    expect(otherSiteTab(tabs, "https://web.whatsapp.com", 7)).toBeNull();
  });
});

describe("a typed message answers the bot's open question", () => {
  it("finds the bot's question, and only that bot's", async () => {
    const waits = createWaits();
    expect(waits.askOf("fenna")).toBeNull();
    const w = waits.add({ kind: "ask", slug: "fenna", runId: "r1", question: "Reply now?", options: ["Yes", "No"] });
    waits.add({ kind: "approval", slug: "fenna", runId: "r1", action: "Send" });
    expect(waits.askOf("builder")).toBeNull();
    const asked = waits.askOf("fenna");
    expect(asked).toMatchObject({ kind: "ask", runId: "r1" });
    waits.answer(asked.id, ["Use the tab that's open"]);
    expect((await w.done).value).toEqual(["Use the tab that's open"]);
    expect(waits.askOf("fenna")).toBeNull();
  });
});
