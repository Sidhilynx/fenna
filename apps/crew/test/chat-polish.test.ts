import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stepsSummary } from "../src/renderer/Chat.tsx";
import { splitTables } from "../src/renderer/Markdown.tsx";

const step = (id: string, status: "running" | "done" | "failed", label = `step ${id}`) => ({ id, label, status });

describe("stepsSummary", () => {
  it("counts finished steps in plain words", () => {
    expect(stepsSummary([step("1", "done"), step("2", "done"), step("3", "done"), step("4", "done")])).toEqual({ text: "Used 4 tools", failed: 0, running: false });
    expect(stepsSummary([step("1", "done")])).toEqual({ text: "Used 1 tool", failed: 0, running: false });
  });

  it("names the failures in the summary", () => {
    expect(stepsSummary([step("1", "done"), step("2", "failed"), step("3", "failed")])).toEqual({ text: "Used 3 tools, 2 failed", failed: 2, running: false });
  });

  it("shows the label of the running step while one runs", () => {
    expect(stepsSummary([step("1", "done", "Read notes"), step("2", "running", "Search the web")])).toEqual({ text: "Search the web", failed: 0, running: true });
  });

  it("shows the latest running step when several are open", () => {
    expect(stepsSummary([step("1", "running", "first"), step("2", "running", "second")]).text).toBe("second");
  });
});

describe("splitTables", () => {
  it("reads a header, a rule and rows as one table, with prose around it", () => {
    expect(splitTables("Totals:\n| Item | Qty |\n|---|---:|\n| Pens | 4 |\n| Pads | 2 |\nDone.")).toEqual([
      { t: "md", text: "Totals:" },
      {
        t: "table",
        head: ["Item", "Qty"],
        rows: [
          ["Pens", "4"],
          ["Pads", "2"],
        ],
      },
      { t: "md", text: "Done." },
    ]);
  });

  it("does not read a pipe line without a rule under it as a table", () => {
    expect(splitTables("a | b\n| c | d |")).toEqual([{ t: "md", text: "a | b\n| c | d |" }]);
  });

  it("leaves fenced code alone", () => {
    const src = "```\n| a | b |\n|---|---|\n```";
    expect(splitTables(src)).toEqual([{ t: "md", text: src }]);
  });
});

describe("chat overflow rules", () => {
  const css = readFileSync(new URL("../src/renderer/chat-polish.css", import.meta.url), "utf8");

  it("scrolls code sideways instead of wrapping it", () => {
    expect(css).toMatch(/\.md \.md-pre \{[^}]*white-space: pre;[^}]*overflow-x: auto;/);
  });

  it("scrolls tables inside the message", () => {
    expect(css).toMatch(/\.md-table \{[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\.md-table \{[^}]*max-width: 100%;/);
  });
});
