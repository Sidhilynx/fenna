import { describe, expect, it } from "vitest";
import { parseSkill, skillNameProblem } from "../src/index.ts";

const errors = (src: string, folder = "weekly-report") => parseSkill(src, folder).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("skill names", () => {
  it("takes the connector name rule: lowercase letters, digits and dashes, a letter first, up to 32", () => {
    expect(skillNameProblem("weekly-report")).toBeNull();
    expect(skillNameProblem("a".repeat(32))).toBeNull();
    expect(skillNameProblem("a".repeat(33))).toMatch(/up to 32/);
    expect(skillNameProblem("Weekly")).toMatch(/lowercase letters/);
    expect(skillNameProblem("1report")).toMatch(/lowercase letters/);
    expect(skillNameProblem("../escape")).toMatch(/lowercase letters/);
  });
});

describe("parseSkill", () => {
  it("reads the name, the description and the body after the front matter", () => {
    const doc = parseSkill("---\nname: weekly-report\ndescription: The weekly status format\n---\n\n# Weekly\n\nStart with the wins.\n", "folder-name");
    expect(doc.diagnostics).toEqual([]);
    expect(doc.name).toBe("weekly-report");
    expect(doc.description).toBe("The weekly status format");
    expect(doc.body).toBe("# Weekly\n\nStart with the wins.");
  });

  it("takes the name from the folder when the front matter gives none", () => {
    const doc = parseSkill("---\ndescription: Checks a diff\n---\nRead it.", "review-diff");
    expect(doc.name).toBe("review-diff");
    expect(doc.diagnostics).toEqual([]);
  });

  it("makes a skill of a SKILL.md with no front matter: the first paragraph is the description", () => {
    const doc = parseSkill("# House style\n\nWrite in short sentences. Use the active voice.\n\nMore below.", "house-style");
    expect(doc.name).toBe("house-style");
    expect(doc.description).toBe("Write in short sentences. Use the active voice.");
    expect(doc.body).toMatch(/^# House style/);
    expect(doc.diagnostics).toEqual([]);
  });

  it("uses the first heading when there is no paragraph", () => {
    expect(parseSkill("# Only a heading\n", "heading").description).toBe("Only a heading");
  });

  it("says what to fix when there is no description at all", () => {
    expect(errors("---\nname: weekly-report\n---\nBody.")[0]).toMatch(/Add "description:"/);
    expect(errors("")[0]).toMatch(/needs a description/);
  });

  it("refuses a description that is too long, and names both lengths", () => {
    const long = "x".repeat(501);
    expect(errors(`---\nname: weekly-report\ndescription: ${long}\n---\nBody.`)[0]).toMatch(/501 characters; the most is 500/);
  });

  it("refuses a name in the front matter that is not a skill name", () => {
    expect(errors("---\nname: Weekly Report\ndescription: x\n---\nBody.")[0]).toMatch(/lowercase letters/);
  });

  it("says where the front matter is wrong", () => {
    const e = parseSkill("---\nname: weekly-report\ndescription\n---\nBody.", "weekly-report").diagnostics.find((d) => d.severity === "error");
    expect(e).toBeDefined();
  });
});
