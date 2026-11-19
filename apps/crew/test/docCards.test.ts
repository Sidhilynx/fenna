import { describe, expect, it } from "vitest";
import { parseRunLog } from "@opendeck/crew";
import { docCardAnchors, runDocs, runSpan, touchedDocs } from "../src/renderer/docCards.ts";
import type { LibraryItem, RunEvent } from "../src/shared/contract.ts";
import { folderFromResult, libraryFolder } from "../src/main/runner.cjs";

const at = (hm: string) => `2026-11-19T${hm}:00.000Z`;
const doc = (path: string, edited: string, kind: LibraryItem["kind"] = "doc"): LibraryItem => ({ path, kind, title: path, edited: at(edited) });
const start = (hm: string): RunEvent => ({ type: "start", at: at(hm), runId: "r", trigger: "person", text: "go", from: null, team: null, cli: "claude", model: "" } as RunEvent);
const end = (hm: string): RunEvent => ({ type: "end", at: at(hm), outcome: "done", message: null });
const text = (hm: string, t: string): RunEvent => ({ type: "text", at: at(hm), text: t });
/** A library tool call. `doc` undefined is an old log line with no doc field; null is a library call that named no document. */
const tool = (hm: string, docValue: string | null | undefined, id = "t1", server = "fenna", name = "edit_blocks"): RunEvent =>
  ({ type: "tool", at: at(hm), id, server, tool: name, label: "edit", status: "done", ...(docValue === undefined ? {} : { doc: docValue }) }) as RunEvent;

describe("runSpan", () => {
  it("reads the start and end of a run", () => {
    const s = runSpan([start("14:00"), text("14:01", "hi"), end("14:05")]);
    expect(s).toEqual({ start: Date.parse(at("14:00")), end: Date.parse(at("14:05")) });
  });

  it("has no end while the run is going", () => {
    expect(runSpan([start("14:00")])?.end).toBeNull();
  });

  it("falls back to the first event when there is no start", () => {
    expect(runSpan([text("14:00", "x")])?.start).toBe(Date.parse(at("14:00")));
  });

  it("is null for no events or unreadable times", () => {
    expect(runSpan([])).toBeNull();
    expect(runSpan([{ type: "text", at: "nope", text: "x" }])).toBeNull();
  });
});

describe("touchedDocs", () => {
  const span = { start: Date.parse(at("14:00")), end: Date.parse(at("14:05")) };

  it("keeps documents changed inside the span, oldest change first", () => {
    const lib = [doc("b", "14:04"), doc("a", "14:01"), doc("old", "13:00"), doc("later", "15:00")];
    expect(touchedDocs(lib, span, 0).map((d) => d.path)).toEqual(["a", "b"]);
  });

  it("allows a couple of seconds either side for writes that land late", () => {
    const item = (path: string, iso: string): LibraryItem => ({ path, kind: "doc", title: path, edited: iso });
    const lib = [item("just-before", "2026-11-19T13:59:59.000Z"), item("too-early", "2026-11-19T13:59:50.000Z"), item("just-after", "2026-11-19T14:05:01.000Z")];
    expect(touchedDocs(lib, span, 0).map((d) => d.path)).toEqual(["just-before", "just-after"]);
  });

  it("counts up to now for a run that is still going", () => {
    const running = { start: Date.parse(at("14:00")), end: null };
    const now = Date.parse(at("14:30"));
    expect(touchedDocs([doc("live", "14:20"), doc("after", "15:00")], running, now).map((d) => d.path)).toEqual(["live"]);
  });

  it("skips documents with an unreadable time", () => {
    const bad = { ...doc("bad", "14:01"), edited: "" };
    expect(touchedDocs([bad], span, 0)).toEqual([]);
  });
});

describe("docCardAnchors", () => {
  const runA = {
    key: "run-a.jsonl",
    events: [start("14:00"), text("14:02", "Made the memo"), end("14:03")],
  };
  const runB = {
    key: "run-b.jsonl",
    events: [start("15:00"), end("15:01")],
  };
  const items = [
    { key: "run-a.jsonl:0", kind: "you" },
    { key: "run-a.jsonl:1", kind: "steps" },
    { key: "run-a.jsonl:2", kind: "bot" },
    { key: "run-a.jsonl:3", kind: "end" },
    { key: "run-b.jsonl:0", kind: "note" },
    { key: "run-b.jsonl:1", kind: "end" },
  ];

  it("puts a run's cards after its last bot reply", () => {
    const lib = [doc("memo", "14:02", "doc"), doc("late", "14:09", "sheet")];
    const out = docCardAnchors(items, [runA, runB], lib, 0);
    expect([...out.keys()]).toEqual(["run-a.jsonl:2"]);
    expect(out.get("run-a.jsonl:2")?.map((d) => d.path)).toEqual(["memo"]);
  });

  it("falls back to the run's last item when it has no bot reply", () => {
    const quiet = { key: "run-b.jsonl", events: runB.events };
    const lib = [doc("sheet", "15:00", "sheet")];
    expect([...docCardAnchors(items, [quiet], lib, 0).keys()]).toEqual(["run-b.jsonl:1"]);
  });

  it("gives nothing when no documents changed or the library is empty", () => {
    expect(docCardAnchors(items, [runA, runB], [], 0).size).toBe(0);
    expect(docCardAnchors(items, [runA, runB], [doc("far", "09:00")], 0).size).toBe(0);
  });

  it("does not put a run's cards on another run's items", () => {
    const lib = [doc("sheet", "15:00", "sheet")];
    const out = docCardAnchors(items, [runA, runB], lib, 0);
    expect([...out.keys()]).toEqual(["run-b.jsonl:1"]);
  });

  it("puts a named document's card on the bot reply, not a time-window neighbour", () => {
    const named = { key: "run-a.jsonl", events: [start("14:00"), tool("14:01", "memo"), text("14:02", "Made it"), end("14:03")] };
    const lib = [doc("memo", "14:01"), doc("neighbour", "14:02")];
    expect(docCardAnchors(items, [named], lib, 0).get("run-a.jsonl:2")?.map((d) => d.path)).toEqual(["memo"]);
  });

  it("puts a document once on an anchor even when two runs name it", () => {
    const one = { key: "run-a.jsonl", events: [start("14:00"), tool("14:01", "memo"), tool("14:02", "memo", "t2"), text("14:02", "Done"), end("14:03")] };
    const two = { key: "run-b.jsonl", events: [start("14:00"), tool("14:01", "memo"), end("14:03")] };
    const shared = [
      { key: "run-a.jsonl:0", kind: "bot" },
      { key: "run-b.jsonl:0", kind: "bot" },
    ];
    const out = docCardAnchors(shared, [one, two], [doc("memo", "14:01")], 0);
    expect(out.get("run-a.jsonl:0")?.map((d) => d.path)).toEqual(["memo"]);
    expect(out.get("run-b.jsonl:0")?.map((d) => d.path)).toEqual(["memo"]);
  });
});

describe("runDocs", () => {
  const lib = [doc("memo", "09:00"), doc("memo-2", "09:00"), doc("sheet", "09:00", "sheet")];

  it("matches the library by exact path, not by prefix", () => {
    expect(runDocs(lib, [start("14:00"), tool("14:01", "memo"), end("14:05")], 0).map((d) => d.path)).toEqual(["memo"]);
  });

  it("keeps the order the run named them in, each once", () => {
    const events = [start("14:00"), tool("14:01", "sheet", "a"), tool("14:02", "memo", "b"), tool("14:03", "sheet", "c"), end("14:05")];
    expect(runDocs(lib, events, 0).map((d) => d.path)).toEqual(["sheet", "memo"]);
  });

  it("skips a named document that is no longer in the library", () => {
    const events = [start("14:00"), tool("14:01", "deleted-doc"), tool("14:02", "memo"), end("14:05")];
    expect(runDocs(lib, events, 0).map((d) => d.path)).toEqual(["memo"]);
  });

  it("does not fall back to the time window when the log has doc fields", () => {
    // memo-2 changed in the window, but this run named only memo.
    const events = [start("14:00"), tool("14:01", "memo"), tool("14:02", null, "x"), end("14:05")];
    const recent = [doc("memo", "09:00"), doc("memo-2", "14:02")];
    expect(runDocs(recent, events, 0).map((d) => d.path)).toEqual(["memo"]);
  });

  it("gives nothing for a run whose library calls named no document", () => {
    expect(runDocs(lib, [start("14:00"), tool("14:01", null), end("14:05")], 0)).toEqual([]);
  });

  it("falls back to the time window only when no event has a doc field", () => {
    const events = [start("14:00"), tool("14:01", undefined), end("14:05")];
    expect(runDocs([doc("memo", "14:02")], events, 0).map((d) => d.path)).toEqual(["memo"]);
  });
});

describe("libraryFolder", () => {
  it("takes the first segment under the library", () => {
    expect(libraryFolder("example-com-check")).toBe("example-com-check");
    expect(libraryFolder("example-com-check/tab-1.json")).toBe("example-com-check");
    expect(libraryFolder("./example-com-check/doc.json")).toBe("example-com-check");
    expect(libraryFolder("example-com-check\\tab-1.json")).toBe("example-com-check");
  });

  it("refuses absolute paths, climbing paths and anything that is not a plain name", () => {
    expect(libraryFolder("/etc/passwd")).toBeNull();
    expect(libraryFolder("C:\\Users\\me")).toBeNull();
    expect(libraryFolder("\\\\server\\share")).toBeNull();
    expect(libraryFolder("../secrets")).toBeNull();
    expect(libraryFolder("ok/../../secrets")).toBeNull();
    expect(libraryFolder(".hidden")).toBeNull();
    expect(libraryFolder("")).toBeNull();
    expect(libraryFolder("  ")).toBeNull();
    expect(libraryFolder(undefined)).toBeNull();
    expect(libraryFolder(42)).toBeNull();
  });

  it("reads the folder from new_document's result text", () => {
    expect(folderFromResult('Created the doc "Example.com check" at path "example-com-check" (tab-1 with 3 blocks).')).toBe("example-com-check");
    expect(folderFromResult('Created at path "../escape"')).toBeNull();
    expect(folderFromResult("Nothing made here.")).toBeNull();
    expect(folderFromResult(undefined)).toBeNull();
  });
});

describe("parseRunLog keeps doc a string or null", () => {
  it("drops a doc that is not a folder name", () => {
    const src = [
      JSON.stringify({ type: "tool", at: at("14:01"), id: "1", server: "fenna", tool: "read_tab", label: "x", status: "done", doc: 7 }),
      JSON.stringify({ type: "tool", at: at("14:02"), id: "2", server: "fenna", tool: "read_tab", label: "x", status: "done", doc: "memo" }),
    ].join("\n");
    const { events } = parseRunLog(src);
    expect(events[0]).not.toHaveProperty("doc");
    expect(events[1]).toHaveProperty("doc", "memo");
  });
});
