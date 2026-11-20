import { describe, expect, it } from "vitest";
import { botYaml, checkBot, newBot, parseBot, parseRunLog, runLine, serializeBot, type RunEvent } from "../src/index.ts";

const BOT = `---
name: Research
job: Builds small sites
schedule: manual
brain:
  cli: claude
connectors: []
askBefore: []
---

Build the site.
`;

describe("bot.md projects", () => {
  it("is off by default and written only when on", () => {
    const { bot, diagnostics } = parseBot(BOT);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(bot!.projects).toBe("off");
    expect(serializeBot(bot!)).not.toContain("projects");
  });

  it("reads on and writes it back", () => {
    const { bot, diagnostics } = parseBot(BOT.replace("askBefore: []", "projects: on\naskBefore: []"));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(bot!.projects).toBe("on");
    const text = serializeBot(bot!);
    expect(text).toMatch(/^projects: on$/m);
    expect(parseBot(text).bot!.projects).toBe("on");
  });

  it("accepts any case and spaces around the word", () => {
    const { bot } = parseBot(BOT.replace("askBefore: []", "projects:  ON "));
    expect(bot!.projects).toBe("on");
  });

  it("refuses other words with a fix-it message", () => {
    const { diagnostics } = parseBot(BOT.replace("askBefore: []", "projects: yes\naskBefore: []"));
    const err = diagnostics.find((d) => d.severity === "error" && /projects/.test(d.message));
    expect(err).toBeDefined();
    expect(err!.message).toContain('not "yes"');
    expect(err!.message).toContain('Write "projects: on"');
    expect(err!.line).toBeGreaterThan(0);
  });

  it("refuses a list or map with the same fix-it message, without quoting it", () => {
    const { diagnostics } = parseBot(BOT.replace("askBefore: []", "projects:\n  - on\naskBefore: []"));
    const err = diagnostics.find((d) => d.severity === "error" && /projects should be/.test(d.message));
    expect(err).toBeDefined();
    expect(err!.message).not.toContain('not "');
  });

  it("is a key that can be changed through checkBot like the others", () => {
    const { bot } = parseBot(BOT);
    const on = checkBot({ ...bot!, projects: "on" });
    expect(on.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(on.bot.projects).toBe("on");
    expect(botYaml(on.bot).projects).toBe("on");
    const off = checkBot({ ...on.bot, projects: "off" });
    expect(botYaml(off.bot).projects).toBeUndefined();
  });

  it("newBot defaults to off and takes on", () => {
    expect(newBot({ name: "Site", job: "Makes a site" }).bot.projects).toBe("off");
    expect(newBot({ name: "Site", job: "Makes a site", projects: "on" }).bot.projects).toBe("on");
  });
});

describe("run log command event", () => {
  it("is read back as an event with its fields", () => {
    const ev: RunEvent = { type: "command", at: "2026-11-20T10:00:00.000Z", project: "site", command: "npm init -y", exitCode: 0, ms: 812, background: false };
    const bg: RunEvent = { type: "command", at: "2026-11-20T10:01:00.000Z", project: "site", command: "node server.js", exitCode: null, ms: 0, background: true, port: 3000 };
    const { events, skipped } = parseRunLog(runLine(ev) + runLine(bg));
    expect(skipped).toBe(0);
    expect(events).toEqual([ev, bg]);
  });
});
