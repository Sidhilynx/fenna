import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { createSkillStore, nameFrom, grantsOf, revokeAll } = require("../src/main/skills.cjs");
const { createZip } = require("../src/main/ziplite.cjs");
const { buildPrompt } = require("../src/main/prompt.cjs");
const { createRunner } = require("../src/main/runner.cjs");
const F = require("../src/main/format.cjs");

const MB = 1024 * 1024;
const WEEKLY = "---\nname: weekly-report\ndescription: The format for the weekly status report\n---\n\n# Weekly\n\nStart with the wins.\n";
const RAW = "https://example.com/skills/house-style/SKILL.md";
const API = "https://api.github.com/repos/acme/skills/contents";
const folderUrl = "https://github.com/acme/skills/tree/main/skills/weekly-report";

let root: string;
let dir: string;
let served: Map<string, Buffer>;
let clock: number;
let skills: ReturnType<typeof createSkillStore>;

/** Serves the addresses the tests name; anything else is "nothing is there", as the network would say. */
async function fetchBytes(url: string, { max }: { max: number }): Promise<Buffer> {
  const data = served.get(url);
  if (!data) throw new Error("Nothing is at that address. Check the link.");
  if (data.length > max) throw new Error("It is bigger than the limit.");
  return data;
}

/** A skill folder somewhere on disk, from name → text (or a size, as a Buffer). */
function folderOf(files: Record<string, string | Buffer>, name = "weekly-report"): string {
  const base = path.join(root, "sources", name);
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(base, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
  return base;
}

function fileOf(name: string, text: string | Buffer): string {
  const file = path.join(root, "sources", name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const installed = (name: string) => path.join(dir, name);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-skills-"));
  dir = path.join(root, "Crew", "skills");
  served = new Map();
  clock = 0;
  skills = createSkillStore({ dir, fetchBytes, now: () => clock });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("adding a skill", () => {
  it("previews a folder in full, then adds it when committed", async () => {
    const src = folderOf({ "SKILL.md": WEEKLY, "refs/template.md": "Wins:\nRisks:\n" });
    const p = await skills.prepare({ kind: "folder", path: src });
    expect(p).toMatchObject({ name: "weekly-report", description: "The format for the weekly status report", replaces: false, size: WEEKLY.length + 13 });
    expect(p.body).toBe("# Weekly\n\nStart with the wins.");
    expect(p.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "refs/template.md"]);
    expect(existsSync(installed("weekly-report"))).toBe(false);

    const view = skills.commit(p.id);
    expect(view).toMatchObject({ name: "weekly-report", description: "The format for the weekly status report" });
    expect(readFileSync(path.join(installed("weekly-report"), "refs", "template.md"), "utf8")).toBe("Wins:\nRisks:\n");
  });

  it("adds a .md file with front matter under the name it gives", async () => {
    const p = await skills.prepare({ kind: "file", path: fileOf("anything.md", WEEKLY) });
    expect(p.name).toBe("weekly-report");
    skills.commit(p.id);
    expect(existsSync(installed("weekly-report"))).toBe(true);
  });

  it("makes a skill of a .md with no front matter: the file's name and its first paragraph", async () => {
    const p = await skills.prepare({ kind: "file", path: fileOf("House Style.md", "# House style\n\nWrite short sentences.\n") });
    expect(p).toMatchObject({ name: "house-style", description: "Write short sentences." });
    skills.commit(p.id);
    expect(readFileSync(path.join(installed("house-style"), "SKILL.md"), "utf8")).toMatch(/^# House style/);
  });

  it("takes a SKILL.md file's name from its folder", async () => {
    const file = folderOf({ "SKILL.md": "Check each claim against its source.\n" }, "fact-check");
    const p = await skills.prepare({ kind: "file", path: path.join(file, "SKILL.md") });
    expect(p.name).toBe("fact-check");
  });

  it("adds a zip of a skill folder, with the skill one folder inside", async () => {
    const zip = fileOf(
      "bundle.zip",
      createZip([
        { name: "review-checklist/", data: Buffer.alloc(0) },
        { name: "review-checklist/SKILL.md", data: Buffer.from("---\ndescription: Review checklist for diffs\n---\nRead each change.\n") },
        { name: "review-checklist/items.md", data: Buffer.from("- tests\n") },
      ]),
    );
    const p = await skills.prepare({ kind: "file", path: zip });
    expect(p.name).toBe("review-checklist");
    expect(p.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "items.md"]);
  });

  it("refuses a front matter name that is not a skill name, and says how to fix it", async () => {
    const src = folderOf({ "SKILL.md": "---\nname: Weekly Report\ndescription: x\n---\nBody." });
    await expect(skills.prepare({ kind: "folder", path: src })).rejects.toThrow(/lowercase letters/);
  });

  it("refuses a SKILL.md with no description", async () => {
    const src = folderOf({ "SKILL.md": "---\nname: weekly-report\n---\nBody." });
    await expect(skills.prepare({ kind: "folder", path: src })).rejects.toThrow(/Add "description:"/);
  });

  it("refuses a folder with no SKILL.md, and says what a skill is", async () => {
    const src = folderOf({ "notes.md": "hello" });
    await expect(skills.prepare({ kind: "folder", path: src })).rejects.toThrow(/There is no SKILL.md in it/);
  });

  it("refuses a SKILL.md over 100 KB", async () => {
    const src = folderOf({ "SKILL.md": `---\nname: weekly-report\ndescription: x\n---\n${"a".repeat(100_001)}` });
    await expect(skills.prepare({ kind: "folder", path: src })).rejects.toThrow(/SKILL.md is bigger than/);
  });

  it("refuses a folder over 5 MB", async () => {
    const files: Record<string, Buffer | string> = { "SKILL.md": WEEKLY };
    for (let i = 0; i < 6; i++) files[`data/${i}.bin`] = Buffer.alloc(MB);
    await expect(skills.prepare({ kind: "folder", path: folderOf(files) })).rejects.toThrow(/bigger than/);
  });

  it("refuses more than 200 files", async () => {
    const files: Record<string, string> = { "SKILL.md": WEEKLY };
    for (let i = 0; i < 200; i++) files[`f${i}.txt`] = "x";
    await expect(skills.prepare({ kind: "folder", path: folderOf(files) })).rejects.toThrow(/more than 200 files/);
  });

  it("refuses a zip entry that would leave the folder", async () => {
    const zip = fileOf("escape.zip", createZip([{ name: "../outside.txt", data: Buffer.from("x") }, { name: "SKILL.md", data: Buffer.from(WEEKLY) }]));
    await expect(skills.prepare({ kind: "file", path: zip })).rejects.toThrow(/unsafe name/);
  });

  it("refuses a file that is neither .md nor .zip", async () => {
    await expect(skills.prepare({ kind: "file", path: fileOf("skill.pdf", "x") })).rejects.toThrow(/Pick a SKILL.md file, or a .zip/);
  });

  const canLink = (() => {
    const probe = mkdtempSync(path.join(tmpdir(), "crew-link-"));
    try {
      symlinkSync(probe, path.join(probe, "l"), "dir");
      return true;
    } catch {
      return false;
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();

  it.runIf(canLink)("refuses a folder with a link in it", async () => {
    const src = folderOf({ "SKILL.md": WEEKLY, "real/a.md": "a" });
    symlinkSync(path.join(src, "real"), path.join(src, "alias"), "dir");
    await expect(skills.prepare({ kind: "folder", path: src })).rejects.toThrow(/is a link/);
  });

  it("replaces a skill of the same name, and says so in the preview", async () => {
    skills.commit((await skills.prepare({ kind: "folder", path: folderOf({ "SKILL.md": WEEKLY }) })).id);
    const again = await skills.prepare({ kind: "folder", path: folderOf({ "SKILL.md": WEEKLY.replace("Start with the wins.", "Start with the risks.") }) });
    expect(again.replaces).toBe(true);
    skills.commit(again.id);
    expect(skills.get("weekly-report").body).toMatch(/risks/);
  });

  it("drops a preview that sat for more than ten minutes", async () => {
    const p = await skills.prepare({ kind: "folder", path: folderOf({ "SKILL.md": WEEKLY }) });
    clock += 11 * 60_000;
    expect(() => skills.commit(p.id)).toThrow(/expired/);
    expect(skills.has("weekly-report")).toBe(false);
  });
});

describe("addresses", () => {
  it("reads a raw SKILL.md; its folder names it when it has no front matter", async () => {
    served.set(RAW, Buffer.from("Write short sentences.\n"));
    const p = await skills.prepare({ kind: "address", url: RAW });
    expect(p).toMatchObject({ name: "house-style", description: "Write short sentences." });
  });

  it("reads a GitHub folder through the contents API, relative to the folder", async () => {
    served.set(
      `${API}/skills/weekly-report?ref=main`,
      Buffer.from(
        JSON.stringify([
          { type: "file", path: "skills/weekly-report/SKILL.md", size: WEEKLY.length, download_url: "https://raw.example/SKILL.md" },
          { type: "dir", path: "skills/weekly-report/refs" },
        ]),
      ),
    );
    served.set(`${API}/skills/weekly-report/refs?ref=main`, Buffer.from(JSON.stringify([{ type: "file", path: "skills/weekly-report/refs/t.md", size: 3, download_url: "https://raw.example/t.md" }])));
    served.set("https://raw.example/SKILL.md", Buffer.from(WEEKLY));
    served.set("https://raw.example/t.md", Buffer.from("abc"));
    const p = await skills.prepare({ kind: "address", url: folderUrl });
    expect(p.name).toBe("weekly-report");
    expect(p.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "refs/t.md"]);
  });

  it("says what is wrong with an address it can't read", async () => {
    await expect(skills.prepare({ kind: "address", url: "http://example.com/SKILL.md" })).rejects.toThrow(/should start with https/);
    await expect(skills.prepare({ kind: "address", url: "https://github.com/acme/skills/blob/main/x/SKILL.md" })).rejects.toThrow(/folder's address/);
    await expect(skills.prepare({ kind: "address", url: "https://example.com/readme.txt" })).rejects.toThrow(/SKILL.md file or a GitHub folder/);
    await expect(skills.prepare({ kind: "address", url: "not a link" })).rejects.toThrow(/isn't a web address/);
    await expect(skills.prepare({ kind: "address", url: "https://example.com/missing/SKILL.md" })).rejects.toThrow(/Nothing is at that address/);
  });

  it("refuses a GitHub folder with no SKILL.md in it", async () => {
    served.set(`${API}/skills/weekly-report?ref=main`, Buffer.from(JSON.stringify([{ type: "file", path: "skills/weekly-report/notes.md", size: 2, download_url: "https://raw.example/n.md" }])));
    served.set("https://raw.example/n.md", Buffer.from("hi"));
    await expect(skills.prepare({ kind: "address", url: folderUrl })).rejects.toThrow(/There is no SKILL.md/);
  });
});

describe("installed skills", () => {
  beforeEach(async () => {
    skills.commit((await skills.prepare({ kind: "folder", path: folderOf({ "SKILL.md": WEEKLY, "refs/template.md": "Wins:\n" }) })).id);
    skills.commit((await skills.prepare({ kind: "file", path: fileOf("house.md", "House rules.\n") })).id);
  });

  it("lists each with its description, files and size, and leaves out what is not a skill", () => {
    mkdirSync(path.join(dir, "Bad Name"), { recursive: true });
    writeFileSync(path.join(dir, "Bad Name", "SKILL.md"), "x");
    mkdirSync(path.join(dir, "empty"), { recursive: true });
    const list = skills.list();
    expect(list.map((s: { name: string }) => s.name)).toEqual(["house", "weekly-report"]);
    const weekly = list.find((s: { name: string }) => s.name === "weekly-report");
    expect(weekly.description).toBe("The format for the weekly status report");
    expect(weekly.files.map((f: { path: string }) => f.path).sort()).toEqual(["SKILL.md", "refs/template.md"]);
  });

  it("gives one skill's instructions and files", () => {
    const s = skills.get("weekly-report");
    expect(s.body).toBe("# Weekly\n\nStart with the wins.");
    expect(() => skills.get("nope")).toThrow(/There is no skill "nope"/);
    expect(() => skills.get("../escape")).toThrow(/There is no skill/);
  });

  it("removes one; a name that isn't a skill name is refused", () => {
    skills.remove("house");
    expect(skills.has("house")).toBe(false);
    expect(() => skills.remove("../x")).toThrow(/There is no skill/);
  });

  it("copies the granted ones onto a bot's disk, and removes the rest", () => {
    const workspace = path.join(root, "bots", "research", "workspace");
    mkdirSync(path.join(workspace, "Skills", "old"), { recursive: true });
    writeFileSync(path.join(workspace, "Skills", "old", "SKILL.md"), "stale");
    const placed = skills.syncInto(workspace, ["weekly-report", "gone", "weekly-report"]);
    expect(placed).toEqual([{ name: "weekly-report", description: "The format for the weekly status report", path: "Files/Skills/weekly-report/SKILL.md" }]);
    expect(readFileSync(path.join(workspace, "Skills", "weekly-report", "refs", "template.md"), "utf8")).toBe("Wins:\n");
    expect(existsSync(path.join(workspace, "Skills", "old"))).toBe(false);

    expect(skills.syncInto(workspace, [])).toEqual([]);
    expect(existsSync(path.join(workspace, "Skills"))).toBe(false);
  });
});

describe("granted skills in bot.md", () => {
  it("names the bots that have a skill, and takes it away from them when it is removed", () => {
    const store = createStore(root);
    const a = store.createBot({ name: "Research", job: "Checks pricing" });
    const b = store.createBot({ name: "Inbox", job: "Sorts mail" });
    store.updateBot(a, { skills: ["weekly-report", "house"] });
    store.updateBot(b, { skills: ["house"] });
    expect(grantsOf(store).get("house")!.map((x: { name: string }) => x.name).sort()).toEqual(["Inbox", "Research"]);

    expect(revokeAll(store, "house").sort()).toEqual(["Inbox", "Research"]);
    expect(store.readBot(a).bot.skills).toEqual(["weekly-report"]);
    expect(store.readBot(b).bot.skills).toEqual([]);
    expect(revokeAll(store, "house")).toEqual([]);
  });
});

describe("skill names from files and folders", () => {
  it("makes a name from any text, at most 32 characters", () => {
    expect(nameFrom("House Style!")).toBe("house-style");
    expect(nameFrom("Résumé tips")).toBe("resume-tips");
    expect(nameFrom("  --  ")).toBe("");
    expect(nameFrom("a".repeat(40))).toHaveLength(32);
  });
});

describe("the prompt names granted skills", () => {
  const bot = F.newBot({ name: "Research", job: "Checks pricing" }).bot;
  const prompt = (list: { name: string; description: string; path: string }[]) =>
    buildPrompt({ slug: "research", bot, memory: "", library: [], others: [], team: null, trigger: "person", text: "hi", now: new Date(2026, 10, 20, 9, 30), skills: list });

  it("lists each skill with its name and description, and where its SKILL.md is", () => {
    const text = prompt([{ name: "weekly-report", description: "The format for the weekly status report", path: "Files/Skills/weekly-report/SKILL.md" }]);
    expect(text).toContain("Skills you have:\n- weekly-report: The format for the weekly status report (read Files/Skills/weekly-report/SKILL.md before that kind of task)");
  });

  it("says nothing about skills when none are granted", () => {
    expect(prompt([])).not.toContain("Skills you have");
  });
});

describe("a run whose skills can't be copied", () => {
  it("ends with the reason, and never starts the CLI", async () => {
    const store = createStore(root);
    const slug = store.createBot({ name: "Research", job: "Checks pricing" });
    let started = 0;
    const runner = createRunner({
      store,
      startRun: () => {
        started++;
        return { stop() {} };
      },
      serversFor: () => ({ servers: {}, trusted: [] }),
      link: { issue: () => "token", revoke() {} },
      waits: { cancelRun() {} },
      emitLive() {},
      onChange() {},
      skillsFor: () => {
        throw new Error("the disk is full");
      },
    });
    const r = runner.enqueue({ slug, trigger: "person", text: "hi" });
    const done = await r.done;
    expect(done.outcome).toBe("error");
    expect(done.message).toBe("Its skills couldn't be copied onto its disk: the disk is full");
    expect(started).toBe(0);
    runner.stopAll();
  });
});

describe("the folder layout on disk", () => {
  it("keeps each skill in its own folder under the skills folder", async () => {
    skills.commit((await skills.prepare({ kind: "folder", path: folderOf({ "SKILL.md": WEEKLY }) })).id);
    expect(readdirSync(dir)).toEqual(["weekly-report"]);
    expect(readdirSync(installed("weekly-report"))).toEqual(["SKILL.md"]);
  });
});
