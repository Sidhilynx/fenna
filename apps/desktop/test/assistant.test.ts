import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const profile = require("../src/main/assistant.cjs");
const { _test } = require("@opendeck/shell/main/agent.cjs") as { _test: { describeTool(profile: unknown, name: string, params: unknown): string } };

describe("Fenna Slides' assistant profile", () => {
  it("names Fenna Slides' tools in plain words, whichever CLI called them", () => {
    expect(_test.describeTool(profile, "call_mcp_tool", { ServerName: "fenna-slides", ToolName: "write_slide", Arguments: { id: "cover" } })).toBe("Wrote slide “cover”");
    expect(_test.describeTool(profile, "mcp__fenna-slides__read_slides", { ids: ["a", "b"] })).toBe("Read a, b");
    expect(_test.describeTool(profile, "call_mcp_tool", { ToolName: "delete_slides", Arguments: '{"ids":["x"]}' })).toBe("Deleted x");
    expect(_test.describeTool(profile, "write_slides", { slides: [{}] })).toBe("Wrote 1 slide");
    expect(_test.describeTool(profile, "deck_overview", {})).toBe("Looked at the deck");
  });

  it("starts Fenna Slides' MCP server on the open deck", () => {
    const s = profile.mcpServer("/decks/q3");
    expect(s.args.at(-1)).toBe("--deck=/decks/q3");
    expect(s.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });
});
