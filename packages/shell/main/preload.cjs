// The page's one door to the main process, shared by every app on the shell
// (a sandboxed preload can't load other files, so apps don't add their own).
// It passes named messages and nothing else: what each one may do is
// decided, and checked, by the main process handler for that name.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = /^[a-z][A-Za-z]*:[a-z][A-Za-z]*$/;

function checked(channel) {
  if (typeof channel !== "string" || !CHANNEL.test(channel)) throw new Error(`bad channel ${channel}`);
  return channel;
}

contextBridge.exposeInMainWorld("shell", {
  platform: process.platform,
  invoke: (channel, ...args) => ipcRenderer.invoke(checked(channel), ...args),
  send: (channel, ...args) => ipcRenderer.send(checked(channel), ...args),
  on: (channel, fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(checked(channel), handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
