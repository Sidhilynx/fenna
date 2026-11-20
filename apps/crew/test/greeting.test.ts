import { describe, expect, it } from "vitest";
import { BUILT_IN_JOBS, greeting } from "../src/renderer/greeting.ts";
import { BOT_TEMPLATES } from "../src/renderer/templates.ts";

describe("greeting", () => {
  it("introduces Builder in its own words", () => {
    expect(greeting({ name: "Builder", job: BUILT_IN_JOBS.builder })).toBe(
      "Hi, I'm Builder. I build apps, tools and small websites for you, test them, and keep them working. Tell me what to make.",
    );
  });

  it("introduces Fenna in its own words", () => {
    expect(greeting({ name: "Fenna", job: BUILT_IN_JOBS.lead })).toBe("Hi, I'm Fenna. I plan the work and hand it to the right bot. Tell me what you want help with.");
  });

  it("has a line for every template", () => {
    for (const t of BOT_TEMPLATES) expect(greeting(t)).toMatch(new RegExp(`^Hi, I'm ${t.name}\\. \\S`));
  });

  it("uses the bot's own name, even when it was renamed", () => {
    const hn = BOT_TEMPLATES.find((t) => t.id === "hn-digest")!;
    expect(greeting({ name: "Morning news", job: hn.job })).toBe(
      "Hi, I'm Morning news. Each morning I read the Hacker News front page and write the five stories worth your time to a doc.",
    );
  });

  it("matches a template job with extra spaces around it", () => {
    const page = BOT_TEMPLATES.find((t) => t.id === "page-watch")!;
    expect(greeting({ name: page.name, job: `   ${page.job}  ` })).toBe("Hi, I'm Page watch. Every Monday I check a page and write what changed since last week. Tell me which page.");
  });

  it("says only hi for a bot the person wrote, or whose job they changed", () => {
    expect(greeting({ name: "Mia", job: "Water the plants on Sunday" })).toBe("Hi.");
    expect(greeting({ name: "Builder", job: `${BUILT_IN_JOBS.builder}, and docs` })).toBe("Hi.");
    expect(greeting({ name: "Empty", job: "" })).toBe("Hi.");
  });
});
