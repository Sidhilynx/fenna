// Preload for the tab strip view: window.shellStrip and nothing else.
const { contextBridge, ipcRenderer } = require("electron");

const str = (v) => (typeof v === "string" ? v.slice(0, 200) : "");
const num = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

contextBridge.exposeInMainWorld("shellStrip", {
  ready: () => ipcRenderer.send("strip:ready"),
  onState: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, state) => {
      try {
        cb(state);
      } catch {
        /* a bad state is skipped; the next one repaints */
      }
    };
    ipcRenderer.on("strip:state", handler);
    return () => ipcRenderer.removeListener("strip:state", handler);
  },
  activate: (id) => ipcRenderer.send("strip:activate", str(id)),
  close: (id) => ipcRenderer.send("strip:close", str(id)),
  newTab: () => ipcRenderer.send("strip:new"),
  move: (id, toIndex) => ipcRenderer.send("strip:move", str(id), num(toIndex)),
  menu: (id, x, y) => ipcRenderer.send("strip:menu", str(id), num(x), num(y)),
  listMenu: (x, y) => ipcRenderer.send("strip:list-menu", num(x), num(y)),
  focusPage: () => ipcRenderer.send("strip:focus-page"),
  prefetch: () => ipcRenderer.send("strip:prefetch"),
  home: () => ipcRenderer.send("strip:home"),
  preview: (id) =>
    ipcRenderer
      .invoke("strip:preview", str(id))
      .then((r) => ({ thumb: r && typeof r.thumb === "string" ? r.thumb : null }))
      .catch(() => ({ thumb: null })),
  setOverlay: (px) => ipcRenderer.send("strip:overlay", Math.max(0, Math.min(400, num(px)))),
  dblclickEmpty: () => ipcRenderer.send("strip:dblclick"),
});
