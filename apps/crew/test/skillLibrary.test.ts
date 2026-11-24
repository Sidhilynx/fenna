import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createSkillStore, libraryPath, readLibrary, LIBRARY_DIR } = require("../src/main/skills.cjs");
const F = require("../src/main/format.cjs");

const LIBRARY_SKILLS = [
  "startups/investor-update",
  "startups/pitch-deck-outline",
  "startups/competitor-scan",
  "startups/customer-interview-notes",
  "marketing/product-announcement",
  "marketing/seo-brief",
  "marketing/newsletter-draft",
  "marketing/social-calendar",
  "sales/cold-email-sequence",
  "sales/call-prep-brief",
  "sales/follow-up-after-meeting",
  "engineering/pr-review-checklist",
  "engineering/bug-report-triage",
  "engineering/release-notes",
  "writing-docs/meeting-minutes",
  "writing-docs/one-page-memo",
  "writing-docs/rewrite-for-clarity",
  "research-ops/weekly-report-from-sheet",
  "research-ops/market-research-brief",
  "research-ops/travel-plan",
];

/** Every SKILL.md in the shipped library, read straight from disk so a skill the listing drops still gets checked. */
function onDisk(): { category: string; name: string; file: string; text: string }[] {
  const out: { category: string; name: string; file: string; text: string }[] = [];
  for (const category of readdirSync(LIBRARY_DIR)) {
    if (!statSync(path.join(LIBRARY_DIR, category)).isDirectory()) continue;
    for (const name of readdirSync(path.join(LIBRARY_DIR, category))) {
      const file = path.join(LIBRARY_DIR, category, name, "SKILL.md");
      out.push({ category, name, file, text: readFileSync(file, "utf8") });
    }
  }
  return out;
}

const errorsOf = (text: string, folder: string) =>
  F.parseSkill(text, folder)
    .diagnostics.filter((d: { severity: string }) => d.severity === "error")
    .map((d: { message: string }) => d.message);

describe("the shipped skill library", () => {
  it("has the starter skills, all in the six categories", () => {
    const found = onDisk().map((s) => `${s.category}/${s.name}`).sort();
    expect(found).toEqual([...LIBRARY_SKILLS].sort());
    expect(found.length).toBeGreaterThanOrEqual(18);
    expect(found.length).toBeLessThanOrEqual(24);
  });

  it("validates every SKILL.md with the skill format, with the folder's name as the fallback", () => {
    for (const s of onDisk()) expect(errorsOf(s.text, s.name), s.file).toEqual([]);
  });

  it("names every skill after its folder, and keeps the category and saves in the front matter", () => {
    for (const s of onDisk()) {
      const fm = F.splitFrontMatter(s.text);
      expect(fm, s.file).not.toBeNull();
      const { value } = F.parseYaml(fm.yaml, 2);
      expect(value.name, s.file).toBe(s.name);
      expect(value.category, s.file).toBe(s.category);
      expect(typeof value.saves === "string" && value.saves.length > 0, s.file).toBe(true);
      expect(F.skillNameProblem(s.name), s.file).toBeNull();
    }
  });

  it("keeps every skill short: under 60 lines, and a description of one line", () => {
    for (const s of onDisk()) {
      expect(s.text.split("\n").length, s.file).toBeLessThanOrEqual(60);
      expect(F.parseSkill(s.text, s.name).description.length, s.file).toBeGreaterThan(20);
    }
  });

  it("has unique, valid skill names across all categories", () => {
    const names = onDisk().map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(F.skillNameProblem(name)).toBeNull();
  });
});

describe("the library listing", () => {
  it("groups the skills by category, in the page's order, with each category's heading", () => {
    const groups = readLibrary();
    expect(groups.map((g: { category: string }) => g.category)).toEqual(["startups", "marketing", "sales", "engineering", "writing-docs", "research-ops"]);
    expect(groups.map((g: { title: string }) => g.title)).toEqual(["Startups", "Marketing", "Sales", "Engineering", "Writing and docs", "Research and ops"]);
    const listed = groups.flatMap((g: { category: string; skills: { name: string }[] }) => g.skills.map((s) => `${g.category}/${s.name}`));
    expect(listed.sort()).toEqual([...LIBRARY_SKILLS].sort());
  });

  it("gives each skill its description and saves line", () => {
    const item = readLibrary()[0].skills.find((s: { name: string }) => s.name === "investor-update");
    expect(item.description).toMatch(/investor update/i);
    expect(item.saves).toBe("about 1 hour");
  });

  it("leaves out a category with no skills, and a skill that does not pass the format", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crew-library-"));
    try {
      const put = (rel: string, text: string) => {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        writeFileSync(path.join(dir, rel), text);
      };
      put("sales/good-one/SKILL.md", "---\nname: good-one\ndescription: A skill that passes the format.\nsaves: about 10 minutes\n---\nDo it.\n");
      put("sales/Bad_Name/SKILL.md", "---\ndescription: Not a valid folder name.\n---\nDo it.\n");
      put("sales/no-description/SKILL.md", "---\nname: no-description\n---\nDo it.\n");
      mkdirSync(path.join(dir, "startups"));
      const groups = readLibrary(dir);
      expect(groups).toEqual([{ category: "sales", title: "Sales", skills: [{ name: "good-one", description: "A skill that passes the format.", saves: "about 10 minutes" }] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads one library skill only through the listing: an unknown name or a path out of the library is refused", () => {
    expect(libraryPath("startups", "investor-update")).toBe(path.join(LIBRARY_DIR, "startups", "investor-update"));
    expect(() => libraryPath("startups", "travel-plan")).toThrow(/no library skill/);
    expect(() => libraryPath("startups", "../sales/travel-plan")).toThrow(/no library skill/);
    expect(() => libraryPath("../..", "investor-update")).toThrow(/no library skill/);
  });
});

describe("adding a library skill goes through the preview", () => {
  let root: string;
  let dir: string;
  let clock: number;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "crew-library-add-"));
    dir = path.join(root, "Crew", "skills");
    clock = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const store = () => createSkillStore({ dir, fetchBytes: async () => Buffer.alloc(0), now: () => clock });

  it("previews the library skill in full, and installs nothing until it is committed", async () => {
    const s = store();
    const preview = await s.prepare({ kind: "folder", path: libraryPath("marketing", "seo-brief") });
    expect(preview.name).toBe("seo-brief");
    expect(preview.body).toMatch(/SEO brief/);
    expect(preview.replaces).toBe(false);
    expect(s.has("seo-brief")).toBe(false);

    const added = s.commit(preview.id);
    expect(added?.name).toBe("seo-brief");
    expect(s.has("seo-brief")).toBe(true);
    expect(s.list().map((x: { name: string }) => x.name)).toEqual(["seo-brief"]);
  });

  it("says a preview replaces a skill already installed under its name", async () => {
    const s = store();
    s.commit((await s.prepare({ kind: "folder", path: libraryPath("sales", "call-prep-brief") })).id);
    const again = await s.prepare({ kind: "folder", path: libraryPath("sales", "call-prep-brief") });
    expect(again.replaces).toBe(true);
  });

  it("drops a library preview that sat too long, like any other preview", async () => {
    const s = store();
    const preview = await s.prepare({ kind: "folder", path: libraryPath("engineering", "release-notes") });
    clock = 11 * 60_000;
    expect(() => s.commit(preview.id)).toThrow(/expired/);
  });
});
