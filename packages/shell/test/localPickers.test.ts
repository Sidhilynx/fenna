import { describe, expect, it } from "vitest";
import { type AgentCatalog, type AgentModel, formatSize, isLocalModel, isSmallModel, localHint, localMenuEntries, modelText, NEEDS_CODEX } from "../renderer/agents.ts";
import { setupOf } from "../renderer/useAgents.ts";

const local = (name: string, paramsB: number | null, sizeBytes: number | null = null, provider: "ollama" | "lmstudio" = "ollama"): AgentModel => ({
  value: `local:${provider}/${name}`,
  label: name,
  description: "",
  efforts: [],
  defaultEffort: null,
  local: { provider, sizeBytes, paramsB },
});
const cloud: AgentModel = { value: "gpt-5.5", label: "GPT-5.5", description: "", efforts: ["low", "high"], defaultEffort: "low" };

const codex = (over: Partial<AgentCatalog> = {}): AgentCatalog => ({
  kind: "codex",
  name: "Codex",
  installed: true,
  own: true,
  version: "0.166.0",
  signedIn: true,
  apiKey: false,
  account: null,
  models: [],
  accountMode: "own",
  installing: false,
  ...over,
});

describe("local model names and sizes", () => {
  it("tells a local model from a CLI's own", () => {
    expect(isLocalModel("local:ollama/qwen3:8b")).toBe(true);
    expect(isLocalModel("gpt-5.5")).toBe(false);
    expect(isLocalModel("")).toBe(false);
  });

  it("names a local model's server for a person", () => {
    expect(modelText("local:ollama/qwen3:8b")).toBe("qwen3:8b (Ollama)");
    expect(modelText("local:lmstudio/qwen/qwen3-8b")).toBe("qwen/qwen3-8b (LM Studio)");
    expect(modelText("gpt-5.5")).toBe("gpt-5.5");
  });

  it("formats sizes in GB or MB, and says nothing when unknown", () => {
    expect(formatSize(5_200_000_000)).toBe("5.2 GB");
    expect(formatSize(690_000_000)).toBe("690 MB");
    expect(formatSize(null)).toBe("");
  });

  it("gives a local model's menu line: server, parameters, size", () => {
    expect(localHint(local("qwen3:8b", 8, 5_200_000_000))).toBe("Ollama · 8B · 5.2 GB");
    expect(localHint(local("qwen3-8b", 8, null, "lmstudio"))).toBe("LM Studio · 8B");
    expect(localHint(local("mystery", null))).toBe("Ollama");
    expect(localHint(cloud)).toBe("");
  });

  it("flags a model under 7B, and only a local one with a known size", () => {
    expect(isSmallModel(local("tiny", 3))).toBe(true);
    expect(isSmallModel(local("seven", 7))).toBe(false);
    expect(isSmallModel(local("unknown", null))).toBe(false);
    expect(isSmallModel(cloud)).toBe(false);
  });
});

describe("the On this computer group", () => {
  it("is empty when there are no local models", () => {
    expect(localMenuEntries([cloud], { installed: true, checked: () => false, onSelect: () => undefined })).toEqual([]);
  });

  it("lists local models under a heading, after a separator, with the checked one marked", () => {
    const models = [cloud, local("qwen3:8b", 8, 5_200_000_000), local("llama3.1:8b", 8)];
    const entries = localMenuEntries(models, { installed: true, checked: (m) => m.value === "local:ollama/llama3.1:8b", onSelect: () => undefined });
    expect(entries.slice(0, 2)).toEqual(["separator", { heading: "On this computer" }]);
    expect(entries.slice(2).map((e) => (typeof e === "object" && "label" in e ? [e.label, e.hint, e.checked] : null))).toEqual([
      ["qwen3:8b", "Ollama · 8B · 5.2 GB", false],
      ["llama3.1:8b", "Ollama · 8B", true],
    ]);
  });

  it("says what it needs when Codex isn't installed, and selects the model", () => {
    const picked: string[] = [];
    const entries = localMenuEntries([local("qwen3:8b", 8)], { installed: false, checked: () => false, onSelect: (m) => picked.push(m.value) });
    const row = entries[2] as { label: string; hint: string; onSelect(): void };
    expect(row.hint).toBe(NEEDS_CODEX);
    row.onSelect();
    expect(picked).toEqual(["local:ollama/qwen3:8b"]);
  });
});

describe("setup for a local model", () => {
  it("needs no sign-in once Codex is installed", () => {
    expect(setupOf("codex", codex({ signedIn: false }), false, true)).toEqual({ step: "ready" });
    expect(setupOf("codex", codex({ signedIn: null }), false, true)).toEqual({ step: "ready" });
  });

  it("still needs Codex installed", () => {
    expect(setupOf("codex", codex({ installed: false }), false, true)).toEqual({ step: "install", kind: "codex" });
  });

  it("keeps asking for a sign-in for the CLI's own models", () => {
    expect(setupOf("codex", codex({ signedIn: false }), false, false)).toEqual({ step: "sign-in", kind: "codex" });
    expect(setupOf("codex", codex({ signedIn: false }), false)).toEqual({ step: "sign-in", kind: "codex" });
  });
});
