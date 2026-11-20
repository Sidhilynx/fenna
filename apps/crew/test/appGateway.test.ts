import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createGateway } = require("../src/main/gateway.cjs");

const APP_NOTES = { name: "notes-board", title: "Notes board", icon: "sheet", description: "", entry: "index.html", problems: [], pending: false, updatedAt: "", grant: { documents: "none", network: [], bot: false }, tools: [{ name: "add_note", description: "Adds a note.", input: { type: "object", properties: { text: { type: "string" } } } }] };
const APP_OFF = { ...APP_NOTES, name: "tracker", title: "Tracker", grant: null, tools: [{ name: "count", description: "Counts.", input: { type: "object" } }] };

function make({ callTool = async () => JSON.stringify({ count: 2 }), apps = [APP_NOTES, APP_OFF] } = {}) {
  const recorded: { runId: string; event: Record<string, unknown> }[] = [];
  const approve = vi.fn();
  const appList = vi.fn(() => apps);
  const gateway = createGateway({
    store: { readBot: () => ({ bot: { connectors: [] } }), updateBot: () => {} },
    connectors: { has: () => false },
    connections: {},
    approve,
    runner: { record: (runId: string, event: Record<string, unknown>) => recorded.push({ runId, event }) },
    onChange: () => {},
    apps: { list: appList, grantOf: (_slug: string, name: string) => apps.find((a) => a.name === name)?.grant ?? null },
    appHost: { callTool: vi.fn(callTool) },
  });
  return { gateway, recorded, approve, appList };
}

const ctx = { slug: "ada", runId: "run-1" };

describe("gateway: app tools", () => {
  it("lists the tools of granted apps only, named app__<app>__<tool>", async () => {
    const { gateway } = make();
    const r = (await gateway.handle(ctx, "gateway.list", {})) as { data: { tools: { name: string; description: string; inputSchema: object }[] } };
    expect(r.data.tools.map((t) => t.name)).toEqual(["app__notes-board__add_note"]);
    expect(r.data.tools[0]!.description).toBe("Adds a note.");
    expect(r.data.tools[0]!.inputSchema).toEqual(APP_NOTES.tools[0]!.input);
  });

  it("names a long app tool within the gateway's limit", async () => {
    const long = { ...APP_NOTES, name: "a".repeat(32), tools: [{ name: "t".repeat(40), description: "", input: {} }] };
    const { gateway } = make({ apps: [long] });
    const r = (await gateway.handle(ctx, "gateway.list", {})) as { data: { tools: { name: string }[] } };
    expect(r.data.tools[0]!.name.length).toBeLessThanOrEqual(50);
  });

  it("runs a call with no approval card, returns the JSON as text, and logs app_tool", async () => {
    const { gateway, recorded, approve } = make();
    await gateway.handle(ctx, "gateway.list", {});
    const r = (await gateway.handle(ctx, "gateway.call", { name: "app__notes-board__add_note", arguments: { text: "milk" } })) as { data: { content: { type: string; text: string }[]; isError: boolean } };
    expect(approve).not.toHaveBeenCalled();
    expect(r.data.content).toEqual([{ type: "text", text: JSON.stringify({ count: 2 }) }]);
    expect(r.data.isError).toBe(false);
    const ev = recorded.find((x) => x.event.type === "app_tool")!;
    expect(ev.runId).toBe("run-1");
    expect(ev.event).toMatchObject({ type: "app_tool", app: "notes-board", tool: "add_note", ok: true });
    expect(typeof ev.event.ms).toBe("number");
  });

  it("passes the arguments to the app's tool", async () => {
    const callTool = vi.fn(async () => "{}");
    const { gateway } = make({ callTool });
    await gateway.handle(ctx, "gateway.call", { name: "app__notes-board__add_note", arguments: { text: "milk" } });
    const host = (callTool as unknown as { mock: { calls: unknown[][] } }).mock;
    expect(host.calls[0]).toEqual(["ada", "notes-board", "add_note", { text: "milk" }]);
  });

  it("logs and rethrows a failed app tool call", async () => {
    const { gateway, recorded } = make({
      callTool: async () => {
        throw new Error("notes-board's tool \"add_note\" did not answer within 10 seconds.");
      },
    });
    await expect(gateway.handle(ctx, "gateway.call", { name: "app__notes-board__add_note", arguments: {} })).rejects.toThrow(/did not answer within 10 seconds/);
    expect(recorded.find((x) => x.event.type === "app_tool")!.event).toMatchObject({ ok: false, app: "notes-board" });
  });

  it("refuses an app whose grant was taken back during the run", async () => {
    const apps = [{ ...APP_NOTES, tools: [...APP_NOTES.tools] }];
    const { gateway, recorded } = make({ apps });
    await gateway.handle(ctx, "gateway.list", {});
    apps[0]!.grant = null as unknown as typeof APP_NOTES.grant;
    await expect(gateway.handle(ctx, "gateway.call", { name: "app__notes-board__add_note", arguments: {} })).rejects.toThrow(/has not allowed notes-board's permissions/);
    expect(recorded.find((x) => x.event.type === "app_tool")!.event).toMatchObject({ ok: false });
  });
});
