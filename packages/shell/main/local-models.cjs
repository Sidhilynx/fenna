// Models on this computer: what Ollama and LM Studio serve on their local
// ports. A model is named `local:<provider>/<name>` (for example
// `local:ollama/qwen3:8b`), and the assistant host runs it through Codex's
// open-source provider (agent.cjs argsFor). A server that isn't running lists
// nothing; asking never blocks anything for longer than the probe timeout.

const http = require("node:http");

const PROBE_MS = 800;
/** Anything longer than this is not a model name the CLI can be given (agent.cjs checks the same shape). */
const ID_SHAPE = /^[\w.:@/[\]-]{1,80}$/;

/** The local servers. `route` lists the models they serve. */
const PROVIDERS = {
  ollama: { name: "Ollama", port: 11434, route: "/api/tags", parse: (json) => fromOllama(json) },
  lmstudio: { name: "LM Studio", port: 1234, route: "/v1/models", parse: (json) => fromLmStudio(json) },
};

/** `local:ollama/qwen3:8b` → { provider: "ollama", name: "qwen3:8b" }; anything else → null. */
function parseLocalId(id) {
  const m = /^local:(ollama|lmstudio)\/(.+)$/.exec(String(id || ""));
  return m ? { provider: m[1], name: m[2] } : null;
}

function localId(provider, name) {
  return `local:${provider}/${name}`;
}

/**
 * Billions of parameters, from a size as a server states it ("8.0B", "670M")
 * or from a model name ("qwen3-8b" → 8; "qwen3-30b-a3b" → 30). null when neither says.
 */
function paramsB(text) {
  const s = String(text || "");
  const stated = /^\s*(\d+(?:\.\d+)?)\s*([BM])\s*$/i.exec(s);
  if (stated) return stated[2].toUpperCase() === "B" ? Number(stated[1]) : Number(stated[1]) / 1000;
  // "a3b" is an active-parameter count inside a mixture-of-experts name, so a letter before the number rules it out.
  const named = /(?<![\w.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(s);
  return named ? Number(named[1]) : null;
}

/** Embedding models can't chat, so they are not offered. */
const isChatModel = (name) => ID_SHAPE.test(name) && !/embed/i.test(name);

/** Ollama's /api/tags: { models: [{ name, size, details: { parameter_size } }] }. */
function fromOllama(json) {
  const list = json && Array.isArray(json.models) ? json.models : [];
  return list
    .filter((m) => m && typeof m.name === "string" && isChatModel(m.name))
    .map((m) => ({
      id: localId("ollama", m.name),
      provider: "ollama",
      name: m.name,
      sizeBytes: Number.isFinite(m.size) ? m.size : null,
      paramsB: paramsB(m.details && m.details.parameter_size) ?? paramsB(m.name),
    }));
}

/** LM Studio's /v1/models: { data: [{ id }] }. It doesn't give sizes, so the name is all there is. */
function fromLmStudio(json) {
  const list = json && Array.isArray(json.data) ? json.data : [];
  return list
    .filter((m) => m && typeof m.id === "string" && isChatModel(m.id))
    .map((m) => ({ id: localId("lmstudio", m.id), provider: "lmstudio", name: m.id, sizeBytes: null, paramsB: paramsB(m.id) }));
}

/** One GET to a local server: its JSON, or null when nothing answers in time. Never rejects. */
function probe(provider, timeoutMs = PROBE_MS) {
  const { port, route } = PROVIDERS[provider];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = http.get({ host: "127.0.0.1", port, path: route }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        body += d;
        if (body.length > 5_000_000) req.destroy();
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return finish(null);
        try {
          finish(JSON.parse(body));
        } catch {
          finish(null);
        }
      });
      res.on("error", () => finish(null));
    });
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on("error", () => finish(null));
  });
}

/**
 * Every chat model the running local servers serve:
 * [{ id, provider, name, sizeBytes, paramsB }]. Empty when none is running.
 */
async function discover(timeoutMs = PROBE_MS) {
  const lists = await Promise.all(
    Object.keys(PROVIDERS).map((provider) => probe(provider, timeoutMs).then((json) => (json ? PROVIDERS[provider].parse(json) : []))),
  );
  return lists.flat();
}

module.exports = { PROVIDERS, parseLocalId, localId, paramsB, fromOllama, fromLmStudio, probe, discover };
