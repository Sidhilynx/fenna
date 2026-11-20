// The app page's only door to Crew: one global, `crew`. A sandboxed preload
// can load nothing but `electron`, so this file is self-contained. It shows
// only what the app's grant allows (the grant is read from main once, at
// load), and every call goes over ipcRenderer.invoke to apps.cjs, which
// identifies the app by its session and checks the grant again. A tool the
// page defines is run here when main asks for it.

const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("crewapp:info");
const tools = new Map();

const call = (op, args) => ipcRenderer.invoke("crewapp:call", op, args);

if (info) {
  const crew = {
    app: { name: info.name, title: info.title, bot: info.bot },
    files: {
      read: (path) => call("files.read", { path }),
      write: (path, data) => (typeof data === "string" ? call("files.write", { path, text: data }) : call("files.write", { path, bytes: data })),
      list: (dir = "") => call("files.list", { path: dir }),
    },
    tools: {
      define: (name, fn) => {
        if (typeof fn !== "function") throw new Error("Give the tool's code as a function: crew.tools.define(name, async (input) => result).");
        return call("tools.define", { name }).then(() => {
          tools.set(name, fn);
        });
      },
    },
  };
  if (info.documents !== "none") {
    crew.docs = {
      list: () => call("docs.list", {}),
      read: (path) => call("docs.read", { path }),
    };
  }
  if (info.documents === "write") {
    crew.docs.writeCells = (path, sheet, cells) => call("docs.writeCells", { path, sheet, cells });
  }
  if (info.bot) {
    crew.bot = { tell: (text) => call("bot.tell", { text }) };
  }
  contextBridge.exposeInMainWorld("crew", crew);

  ipcRenderer.on("crewapp:callTool", async (_e, msg) => {
    let reply;
    try {
      const fn = tools.get(msg.name);
      if (!fn) throw new Error(`The app hasn't defined the tool ${msg.name}.`);
      const value = await fn(msg.input);
      reply = { id: msg.id, ok: true, text: JSON.stringify(value === undefined ? null : value) ?? "null" };
    } catch (err) {
      reply = { id: msg.id, ok: false, error: String(err && err.message ? err.message : err) };
    }
    ipcRenderer.send("crewapp:toolResult", reply);
  });
}
