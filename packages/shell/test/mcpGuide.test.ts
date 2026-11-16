import { describe, expect, it } from "vitest";
import { MCP_APPS } from "../renderer/McpGuideDialog.tsx";

describe("MCP Setup Guide Apps definitions", () => {
  it("defines all five Fenna apps with consistent structure", () => {
    const keys = ["deck", "doc", "sheet", "board", "design"];
    for (const key of keys) {
      const app = MCP_APPS[key];
      expect(app).toBeDefined();
      expect(app!.id).toMatch(/^fenna-/);
      expect(app!.appName).toMatch(/^Fenna /);
      expect(app!.cli).toMatch(/-mcp$/);
      expect(app!.flag).toBe(key);
      expect(app!.tools.length).toBeGreaterThanOrEqual(8);
      for (const tool of app!.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
      }
    }
  });

  it("provides format_guide tool across all apps", () => {
    for (const app of Object.values(MCP_APPS)) {
      const hasGuide = app.tools.some((t) => t.name === "format_guide");
      expect(hasGuide).toBe(true);
    }
  });
});
