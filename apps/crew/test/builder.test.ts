import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createStore } = require("../src/main/store.cjs");
const { giveBuilder, BUILDER } = require("../src/main/crew.cjs");

let root: string;
let store: ReturnType<typeof createStore>;
const names = () => store.slugs().map((s: string) => store.readBot(s).bot.name).sort();

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "crew-builder-"));
  store = createStore(root);
  store.ensure();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the Builder bot Crew ships with", () => {
  it("joins a new crew once, with projects on and its own face", () => {
    store.createBot({ name: "Fenna", job: "Leads the crew", how: "Plan." });
    giveBuilder(store, root);
    giveBuilder(store, root);
    expect(names()).toEqual(["Builder", "Fenna"]);
    const slug = store.slugs().find((s: string) => store.readBot(s).bot.name === "Builder");
    const bot = store.readBot(slug).bot;
    expect(bot.projects).toBe("on");
    expect(bot.avatar).toBe(BUILDER.avatar);
    expect(bot.how).toContain("Files/Apps/<name>/");
    expect(existsSync(path.join(root, "builder-added.json"))).toBe(true);
  });

  it("joins an older crew that never had it", () => {
    store.createBot({ name: "Research", job: "Reads", how: "Read." });
    giveBuilder(store, root);
    expect(names()).toEqual(["Builder", "Research"]);
  });

  it("does not come back after the person deletes it", async () => {
    giveBuilder(store, root);
    const slug = store.slugs().find((s: string) => store.readBot(s).bot.name === "Builder");
    await store.deleteBot(slug);
    giveBuilder(store, root);
    expect(names()).toEqual([]);
  });

  it("is not added twice when the crew already has a bot called Builder", () => {
    store.createBot({ name: "Builder", job: "My own", how: "Mine." });
    giveBuilder(store, root);
    expect(names()).toEqual(["Builder"]);
    expect(store.readBot(store.slugs()[0]).bot.job).toBe("My own");
  });
});
