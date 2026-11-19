// The page's one door to the main process, shared by every app on the shell
// (a sandboxed preload can't load other files, so apps don't add their own).
// It passes named messages and nothing else: what each one may do is
// decided, and checked, by the main process handler for that name.
const { contextBridge, ipcRenderer, sharedTexture } = require("electron");

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

// Live frames a main process sends as GPU textures (a Crew bot's screen):
// each is drawn straight onto the page's <canvas data-live="<key>">, which
// then gets a "liveframe" event, with the page size the frame was laid out
// at in its data-view-width and data-view-height. The texture itself never
// enters the page's world, and a frame with no canvas to go to is dropped.
if (sharedTexture && typeof sharedTexture.setSharedTextureReceiver === "function") {
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, key, viewWidth, viewHeight) => {
    try {
      const canvas = typeof key === "string" ? document.querySelector(`canvas[data-live="${CSS.escape(key)}"]`) : null;
      if (!canvas) return;
      const frame = importedSharedTexture.getVideoFrame();
      try {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        canvas.getContext("2d").drawImage(frame, 0, 0);
      } finally {
        frame.close();
      }
      canvas.dataset.viewWidth = String(Number(viewWidth) || 0);
      canvas.dataset.viewHeight = String(Number(viewHeight) || 0);
      canvas.dispatchEvent(new Event("liveframe"));
    } finally {
      importedSharedTexture.release();
    }
  });
}
