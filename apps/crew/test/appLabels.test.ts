import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createToolLabel } = require("../src/main/labels.cjs");

const titles: Record<string, string> = { "ada/notes-board": "Notes board" };
const toolLabel = createToolLabel({ appTitle: (slug: string, name: string) => titles[`${slug}/${name}`] ?? null });

describe("labels for the app tool", () => {
  it("says what the bot did to its app, by its title", () => {
    expect(toolLabel("app", { action: "list" }, "crew", "ada")).toBe("Looked at its apps");
    expect(toolLabel("app", { action: "open", name: "notes-board" }, "crew", "ada")).toBe("Opened the app Notes board");
    expect(toolLabel("app", { action: "snapshot", name: "notes-board" }, "crew", "ada")).toBe("Read Notes board");
    expect(toolLabel("app", { action: "click", name: "notes-board", ref: "e1" }, "crew", "ada")).toBe("Clicked in Notes board");
    expect(toolLabel("app", { action: "type", name: "notes-board", ref: "e2", text: "x" }, "crew", "ada")).toBe("Typed in Notes board");
    expect(toolLabel("app", { action: "press", name: "notes-board", key: "Enter" }, "crew", "ada")).toBe("Pressed Enter in Notes board");
    expect(toolLabel("app", { action: "close", name: "notes-board" }, "crew", "ada")).toBe("Closed Notes board");
  });

  it("falls back to the app's name when it has no title, and returns null for an unknown action", () => {
    expect(toolLabel("app", { action: "open", name: "tracker" }, "crew", "ada")).toBe("Opened the app tracker");
    expect(toolLabel("app", { action: "fly" }, "crew", "ada")).toBeNull();
  });
});

describe("labels for an app's tools", () => {
  it("says which app's tool the bot used, in the app's title", () => {
    expect(toolLabel("app__notes-board__add_note", {}, "gateway", "ada")).toBe("Used Notes board: add note");
  });

  it("keeps the connector labels as they were", () => {
    expect(toolLabel("notes__add_note", { text: "x" }, "gateway", "ada")).toBe("notes: add note");
  });
});
