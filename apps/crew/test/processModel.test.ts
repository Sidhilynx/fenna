import { describe, expect, it } from "vitest";
import type { ProcessInfo } from "../src/shared/contract.ts";
import {
  EMPTY_BUF,
  OUTPUT_MAX,
  appendOutput,
  bufText,
  cleanOutput,
  formatDuration,
  headerLine,
  isFollowing,
  lastLines,
  portUrl,
  projectPath,
  runTime,
  runningByProject,
  seedOutput,
  statusText,
  upsertProcess,
} from "../src/renderer/processModel.ts";

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  id: "p1",
  slug: "ada",
  project: "site",
  command: "npm install express",
  background: false,
  status: "exited",
  exitCode: 0,
  port: null,
  startedAt: "2026-11-20T10:00:00.000Z",
  endedAt: "2026-11-20T10:00:04.200Z",
  tail: "",
  ...over,
});

describe("formatDuration", () => {
  it("shows tenths under ten seconds, whole seconds under a minute", () => {
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(0)).toBe("0.0 s");
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(59_999)).toBe("59 s");
  });

  it("counts minutes and hours", () => {
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(3_599_000)).toBe("59 min 59 s");
    expect(formatDuration(3_660_000)).toBe("1 h 1 min");
  });

  it("treats negative and unknown durations as nothing", () => {
    expect(formatDuration(-5)).toBe("0.0 s");
    expect(formatDuration(Number.NaN)).toBe("0.0 s");
  });
});

describe("runTime and status", () => {
  it("runs to the end time once a command has ended, and to now while it runs", () => {
    const now = Date.parse("2026-11-20T10:00:10.000Z");
    expect(runTime(proc(), now)).toBe(4200);
    expect(runTime(proc({ status: "running", endedAt: null }), now)).toBe(10_000);
  });

  it("returns 0 for a time it cannot read", () => {
    expect(runTime(proc({ startedAt: "nonsense" }), Date.now())).toBe(0);
  });

  it("names the status in a few words", () => {
    expect(statusText(proc())).toBe("Exited 0");
    expect(statusText(proc({ exitCode: 2 }))).toBe("Exited 2");
    expect(statusText(proc({ status: "running", exitCode: null }))).toBe("Running");
    expect(statusText(proc({ status: "stopped", exitCode: null }))).toBe("Stopped");
    expect(statusText(proc({ status: "failed", exitCode: null }))).toBe("Failed");
  });
});

describe("headerLine", () => {
  const now = Date.parse("2026-11-20T10:00:10.000Z");

  it("reads like a shell prompt, with the project and how the command ended", () => {
    expect(headerLine(proc(), now)).toBe("$ npm install express · Projects/site · exited 0 in 4.2 s");
  });

  it("says how a running, stopped or failed command stands", () => {
    expect(headerLine(proc({ status: "running", endedAt: null }), now)).toBe("$ npm install express · Projects/site · running for 10 s");
    expect(headerLine(proc({ status: "stopped", exitCode: null }), now)).toBe("$ npm install express · Projects/site · stopped after 4.2 s");
    expect(headerLine(proc({ status: "failed", exitCode: null }), now)).toBe("$ npm install express · Projects/site · failed after 4.2 s");
  });
});

describe("cleanOutput", () => {
  it("removes colour codes", () => {
    expect(cleanOutput("\x1b[32mok\x1b[0m done")).toBe("ok done");
  });

  it("keeps only what a carriage return left at the end of a line", () => {
    expect(cleanOutput("10%\r50%\r100%\nnext")).toBe("100%\nnext");
    expect(cleanOutput("a\r\nb")).toBe("a\nb");
  });
});

describe("lastLines", () => {
  it("gives the last lines, without the empty line after a final newline", () => {
    expect(lastLines("one\ntwo\nthree\nfour\n", 3)).toEqual(["two", "three", "four"]);
  });

  it("gives what there is when there are fewer lines", () => {
    expect(lastLines("only", 3)).toEqual(["only"]);
    expect(lastLines("", 3)).toEqual([]);
  });

  it("cleans the text first", () => {
    expect(lastLines("\x1b[2mwarn\x1b[0m\nready\n", 3)).toEqual(["warn", "ready"]);
  });
});

describe("output kept per command", () => {
  it("keeps every chunk while it is small", () => {
    let buf = EMPTY_BUF;
    buf = appendOutput(buf, "out", "hello ");
    buf = appendOutput(buf, "err", "oops\n");
    expect(bufText(buf)).toBe("hello oops\n");
    expect(buf.segs.map((s) => s.stream)).toEqual(["out", "err"]);
    expect(buf.cut).toBe(false);
  });

  it("drops the oldest output past the limit and says so", () => {
    let buf = EMPTY_BUF;
    for (let i = 0; i < 10; i++) buf = appendOutput(buf, "out", "x".repeat(10), 50);
    expect(bufText(buf).length).toBe(50);
    expect(buf.cut).toBe(true);
  });

  it("keeps the newest characters of one chunk longer than the limit", () => {
    const buf = appendOutput(EMPTY_BUF, "err", `start-${"y".repeat(20)}-end`, 8);
    expect(bufText(buf)).toBe("yyyyy-end".slice(-8));
    expect(buf.segs[0]!.stream).toBe("err");
    expect(buf.cut).toBe(true);
  });

  it("uses 64 KB as the limit by default", () => {
    expect(OUTPUT_MAX).toBe(64 * 1024);
    const buf = appendOutput(EMPTY_BUF, "out", "a".repeat(OUTPUT_MAX + 5));
    expect(bufText(buf).length).toBe(OUTPUT_MAX);
    expect(buf.cut).toBe(true);
  });

  it("ignores empty text", () => {
    expect(appendOutput(EMPTY_BUF, "out", "")).toBe(EMPTY_BUF);
  });

  it("starts from a command's tail when the console first sees it", () => {
    expect(bufText(seedOutput("last line\n"))).toBe("last line\n");
    expect(seedOutput("")).toBe(EMPTY_BUF);
  });
});

describe("the list of commands", () => {
  it("puts the newest first and replaces a command that changed", () => {
    const a = proc({ id: "a", startedAt: "2026-11-20T10:00:00.000Z" });
    const b = proc({ id: "b", startedAt: "2026-11-20T10:05:00.000Z" });
    let list = upsertProcess([], a);
    list = upsertProcess(list, b);
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
    list = upsertProcess(list, { ...a, status: "stopped", exitCode: null });
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
    expect(list[1]!.status).toBe("stopped");
  });

  it("counts running commands per project", () => {
    const counts = runningByProject([
      proc({ id: "1", status: "running", endedAt: null }),
      proc({ id: "2", status: "running", endedAt: null }),
      proc({ id: "3", project: "api", status: "running", endedAt: null }),
      proc({ id: "4" }),
    ]);
    expect(counts.get("site")).toBe(2);
    expect(counts.get("api")).toBe(1);
    expect(counts.has("other")).toBe(false);
  });
});

describe("following the end of a console", () => {
  it("follows while the console is at its end, within a few pixels", () => {
    expect(isFollowing(900, 1000, 100)).toBe(true);
    expect(isFollowing(892, 1000, 100)).toBe(true);
  });

  it("stops following once the person scrolls up", () => {
    expect(isFollowing(500, 1000, 100)).toBe(false);
  });
});

describe("addresses", () => {
  it("gives the local address of a port and the project folder", () => {
    expect(portUrl(5173)).toBe("http://localhost:5173");
    expect(projectPath("site")).toBe("Files/Projects/site");
  });
});
