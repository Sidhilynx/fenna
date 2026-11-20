import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { FILE_KINDS } from "../src/shared/contract.ts";

const require = createRequire(import.meta.url);
const { kindOf } = require("../src/main/disk.cjs");

describe("file kinds on a bot's disk", () => {
  it.each([
    ["photo.PNG", "image"],
    ["clip.mkv", "video"],
    ["song.flac", "audio"],
    ["report.pdf", "pdf"],
    ["notes.md", "text"],
    ["run.log", "text"],
    ["data.csv", "table"],
    ["data.tsv", "table"],
    ["book.xlsx", "table"],
    ["old.xls", "table"],
    ["app.ts", "code"],
    ["index.html", "code"],
    ["config.json", "code"],
    ["bundle.zip", "archive"],
    ["backup.tar", "archive"],
    ["brief.docx", "other"],
    ["Makefile", "other"],
    [".csv", "other"],
    ["archive.tar.gz", "archive"],
  ])("%s is %s", (name, kind) => {
    expect(kindOf(name)).toBe(kind);
  });

  it("only uses kinds the contract lists", () => {
    const names = ["a.png", "a.mp4", "a.mp3", "a.pdf", "a.txt", "a.csv", "a.tsv", "a.xlsx", "a.xls", "a.js", "a.json", "a.zip", "a.bin"];
    for (const name of names) expect(FILE_KINDS).toContain(kindOf(name));
  });

  it("lists table among the contract's kinds", () => {
    expect(FILE_KINDS).toContain("table");
  });
});
