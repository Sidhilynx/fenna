import { FENNA_APPS, LIMITS, WALLPAPERS, parseSchedule } from "@opendeck/crew";
import { describe, expect, it } from "vitest";
import { BOT_TEMPLATES } from "../src/renderer/templates.ts";

describe("bot templates", () => {
  const appIds: string[] = FENNA_APPS.map((a) => a.id);

  it.each(BOT_TEMPLATES.map((t) => [t.name, t] as const))("%s creates a valid bot", (_name, t) => {
    expect(parseSchedule(t.schedule)).not.toHaveProperty("error");
    for (const app of t.apps) expect(appIds).toContain(app);
    expect(WALLPAPERS).toContain(t.wallpaper);
    expect(t.name.length).toBeLessThanOrEqual(LIMITS.name);
    expect(t.job.trim()).not.toBe("");
    expect(t.job.length).toBeLessThanOrEqual(LIMITS.job);
  });

  it("are plain jobs without categories or marketing words", () => {
    for (const t of BOT_TEMPLATES) {
      expect(Object.keys(t).sort()).toEqual(["apps", "ask", "how", "id", "job", "name", "schedule", "wallpaper"]);
      expect(`${t.name} ${t.job} ${t.how}`).not.toMatch(/[&!]|\b(unleash|seamless|powerful|effortless|magic)\b/i);
    }
  });

  it("have unique ids and names", () => {
    expect(new Set(BOT_TEMPLATES.map((t) => t.id)).size).toBe(BOT_TEMPLATES.length);
    expect(new Set(BOT_TEMPLATES.map((t) => t.name)).size).toBe(BOT_TEMPLATES.length);
  });
});
