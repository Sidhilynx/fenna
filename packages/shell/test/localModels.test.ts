import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const local = require("../main/local-models.cjs") as {
  parseLocalId(id: string): { provider: string; name: string } | null;
  localId(provider: string, name: string): string;
  paramsB(text: string | undefined): number | null;
  fromOllama(json: unknown): { id: string; provider: string; name: string; sizeBytes: number | null; paramsB: number | null }[];
  fromLmStudio(json: unknown): { id: string; provider: string; name: string; sizeBytes: number | null; paramsB: number | null }[];
};

const { _test } = require("../main/agent.cjs") as {
  _test: {
    argsFor(profile: { id: string; note: string; mcpServer(root: string): { command: string; args: string[]; env: Record<string, string> }; toolLabel(): null }, kind: string, opts: { sessionId?: string | null; model?: string; effort?: string; root: string }): string[];
    friendly(kind: string, raw: string, localProvider?: string | null): { message: string; fix: string | null };
  };
};

const app = { id: "crew", note: "", mcpServer: () => ({ command: "node", args: ["server.js"], env: {} }), toolLabel: () => null };

/** The value after `flag` in an argument list, e.g. -m <name>. */
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("local models: ids", () => {
  it("reads local:<provider>/<name> and nothing else", () => {
    expect(local.parseLocalId("local:ollama/qwen3:8b")).toEqual({ provider: "ollama", name: "qwen3:8b" });
    expect(local.parseLocalId("local:lmstudio/qwen/qwen3-8b")).toEqual({ provider: "lmstudio", name: "qwen/qwen3-8b" });
    expect(local.parseLocalId("gpt-5.5")).toBeNull();
    expect(local.parseLocalId("local:vllm/llama")).toBeNull();
    expect(local.parseLocalId("")).toBeNull();
    expect(local.localId("ollama", "qwen3:8b")).toBe("local:ollama/qwen3:8b");
  });
});

describe("local models: size", () => {
  it("reads parameters from a stated size or from the name", () => {
    expect(local.paramsB("8.0B")).toBe(8);
    expect(local.paramsB("670M")).toBeCloseTo(0.67);
    expect(local.paramsB("qwen3-8b")).toBe(8);
    expect(local.paramsB("llama3.1:8b")).toBe(8);
    expect(local.paramsB("gpt-oss-20b")).toBe(20);
    // An active-parameter count in a mixture-of-experts name is not the model's size.
    expect(local.paramsB("qwen3-30b-a3b")).toBe(30);
    expect(local.paramsB("mixtral-8x7b")).toBeNull();
    expect(local.paramsB("gemma3:270m")).toBeNull();
    expect(local.paramsB(undefined)).toBeNull();
  });
});

describe("local models: what the servers say", () => {
  it("lists Ollama's models with size and parameters, without embedding models", () => {
    const json = {
      models: [
        { name: "qwen3:8b", model: "qwen3:8b", size: 5200000000, details: { parameter_size: "8.0B", family: "qwen3" } },
        { name: "nomic-embed-text:latest", size: 274000000, details: { parameter_size: "137M" } },
        { name: "llama3.1:latest", size: 4900000000, details: {} },
        { size: 1 },
      ],
    };
    expect(local.fromOllama(json)).toEqual([
      { id: "local:ollama/qwen3:8b", provider: "ollama", name: "qwen3:8b", sizeBytes: 5200000000, paramsB: 8 },
      { id: "local:ollama/llama3.1:latest", provider: "ollama", name: "llama3.1:latest", sizeBytes: 4900000000, paramsB: null },
    ]);
  });

  it("lists LM Studio's models by id, with no size it can't give", () => {
    const json = { data: [{ id: "qwen3-8b", object: "model" }, { id: "text-embedding-nomic-embed-text-v1.5" }, { id: "has spaces in it" }] };
    expect(local.fromLmStudio(json)).toEqual([{ id: "local:lmstudio/qwen3-8b", provider: "lmstudio", name: "qwen3-8b", sizeBytes: null, paramsB: 8 }]);
  });

  it("lists nothing from answers it doesn't understand", () => {
    expect(local.fromOllama(null)).toEqual([]);
    expect(local.fromOllama({ error: "nope" })).toEqual([]);
    expect(local.fromLmStudio({ data: "not a list" })).toEqual([]);
  });
});

describe("local models: runs through Codex", () => {
  it("passes a local model as Codex's provider override and its own name, with no sign-in flag", () => {
    const args = _test.argsFor(app, "codex", { root: "/tmp/doc", model: "local:ollama/qwen3:8b" });
    expect(args).toContain('model_provider="ollama"');
    expect(args[args.indexOf('model_provider="ollama"') - 1]).toBe("-c");
    expect(after(args, "-m")).toBe("qwen3:8b");
    expect(args).not.toContain("--oss");
    expect(args.some((a) => a.startsWith("model_reasoning_effort="))).toBe(false);
  });

  it("drops the effort for a local model even when one is asked for", () => {
    const args = _test.argsFor(app, "codex", { root: "/tmp/doc", model: "local:lmstudio/qwen3-8b", effort: "high" });
    expect(args).toContain('model_provider="lmstudio"');
    expect(after(args, "-m")).toBe("qwen3-8b");
    expect(args.some((a) => a.startsWith("model_reasoning_effort="))).toBe(false);
  });

  it("keeps the override on a resumed session", () => {
    const args = _test.argsFor(app, "codex", { root: "/tmp/doc", sessionId: "01a1fe6d-3191", model: "local:ollama/qwen3:8b" });
    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args).toContain('model_provider="ollama"');
    expect(after(args, "-m")).toBe("qwen3:8b");
  });

  it("leaves a Codex model and its effort exactly as before", () => {
    const args = _test.argsFor(app, "codex", { root: "/tmp/doc", model: "gpt-5.5", effort: "high" });
    expect(after(args, "-m")).toBe("gpt-5.5");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args.some((a) => a.startsWith("model_provider="))).toBe(false);
  });

  it("explains a local server that isn't running, by port or by the provider it was for", () => {
    expect(_test.friendly("codex", "Connection failed: connect ECONNREFUSED 127.0.0.1:11434").message).toBe("Ollama isn’t running. Start it, then try again.");
    expect(_test.friendly("codex", "error sending request for url (http://127.0.0.1:1234/v1/responses)").message).toBe("LM Studio’s server isn’t running. Start it in LM Studio, then try again.");
    expect(_test.friendly("codex", "Reconnecting... (Connection failed: error sending request)", "ollama").message).toBe("Ollama isn’t running. Start it, then try again.");
    expect(_test.friendly("codex", "ECONNREFUSED", "lmstudio").fix).toBeNull();
  });

  it("leaves other Codex errors alone", () => {
    expect(_test.friendly("codex", "rate limit exceeded (429)").message).toMatch(/usage limit/);
    expect(_test.friendly("codex", "error sending request").message).toBe("error sending request");
  });
});
