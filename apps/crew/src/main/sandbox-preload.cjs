// The sandbox's only door. A sandboxed preload can load nothing but
// `electron` and the page's own globals, so this file is self-contained. It
// exposes a bridge that sends each call over the run's private channel and
// nothing else. The program's fenna API is built on this bridge by the page
// bootstrap (sandbox.cjs), so every value passed here is plain text or a number.

const { contextBridge, ipcRenderer } = require("electron");

function option(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

const channel = option("fenna-channel");
const config = JSON.parse(decodeURIComponent(option("fenna-config")) || "{}");

async function call(op, payload) {
  const r = await ipcRenderer.invoke(channel, { op, ...payload });
  if (!r || !r.ok) throw new Error(r && r.error ? r.error : "The sandbox didn't answer.");
  return r.value;
}

contextBridge.exposeInMainWorld("__fennaBridge", {
  args: Array.isArray(config.args) ? config.args.map(String) : [],
  cwd: typeof config.cwd === "string" ? config.cwd : "Files",
  readText: (path) => call("readText", { path }),
  writeText: (path, text) => call("writeText", { path, text }),
  list: (path) => call("list", { path }),
  exists: (path) => call("exists", { path }),
  print: (text) => call("print", { text }),
  exit: (code) => call("exit", { code }),
  done: (ok, message) => call("done", { ok, message }),
});
