import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.ts";

const examplesDir = fileURLToPath(new URL("../../../examples", import.meta.url));

let client: Client;

beforeEach(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(examplesDir).connect(a);
  client = new Client({ name: "test-workspace-mcp", version: "0.0.1" });
  await client.connect(b);
});

afterEach(async () => {
  await client.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0]!.text, isError: !!r.isError };
}

describe("Fenna Workspace unified MCP server", () => {
  it("lists unified workspace tools and instructions", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("workspace_overview");
    expect(names).toContain("workspace_guide");
    expect(names).toContain("deck_overview");
    expect(names).toContain("doc_overview");
    expect(names).toContain("sheet_overview");
    expect(names).toContain("board_overview");
    expect(names).toContain("design_overview");
    expect(client.getInstructions()).toMatch(/Fenna Workspace unified MCP server/);
  });

  it("workspace_overview discovers all documents in the workspace", async () => {
    const res = JSON.parse((await call("workspace_overview")).text);
    expect(res.documents.length).toBeGreaterThanOrEqual(4);
    const kinds = res.documents.map((d: { kind: string }) => d.kind);
    expect(kinds).toContain("deck");
    expect(kinds).toContain("doc");
    expect(kinds).toContain("sheet");
    expect(kinds).toContain("board");
  });

  it("doc_overview reads the doc in the workspace", async () => {
    const res = JSON.parse((await call("doc_overview")).text);
    expect(res.title).toBe("Fenna Docs launch plan");
    expect(res.tabs.length).toBeGreaterThan(0);
  });

  it("sheet_overview reads the sheet in the workspace", async () => {
    const res = JSON.parse((await call("sheet_overview")).text);
    expect(res.title).toBe("Q3 Revenue & Launch Tracker");
    expect(res.sheets.length).toBeGreaterThan(0);
  });

  it("deck_overview reads the deck in the workspace", async () => {
    const res = JSON.parse((await call("deck_overview")).text);
    expect(res.title).toBe("Fenna — Sample Deck");
    expect(res.slides.length).toBeGreaterThan(0);
  });

  it("board_overview reads the whiteboard in the workspace", async () => {
    const res = JSON.parse((await call("board_overview")).text);
    expect(res.title).toBe("Product Roadmap");
    expect(res.itemCount).toBeGreaterThan(0);
  });

  it("workspace_guide returns instructions for all 5 formats", async () => {
    const res = await call("workspace_guide");
    expect(res.text).toMatch(/Slides/);
    expect(res.text).toMatch(/Docs/);
    expect(res.text).toMatch(/Sheets/);
    expect(res.text).toMatch(/Whiteboard/);
    expect(res.text).toMatch(/Design/);
  });
});
