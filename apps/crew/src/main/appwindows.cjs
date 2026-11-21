// Seeing the app a bot just ran. A Flutter, Electron, Qt or native window, or an
// emulator, shows up as an ordinary window on the person's computer. The bot
// lists those windows and captures one as a picture, so it sees what the person
// sees, then clicks, types and presses keys in it by the picture's pixels
// (desktop-input.cjs). Crew's own windows never show up. Capture uses
// Electron's desktopCapturer, which only draws a window that is on screen.

const { handleOf } = require("./desktop-input.cjs");

const OWN_NAME = "Fenna Crew";
const OWN_PREFIX = "Fenna ";
const DEFAULT_WIDTH = 1280;
const MIN_WIDTH = 320;
const MAX_WIDTH = 1920;
const REF_RE = /^w\d+$/i;
const NO_CAPTURER = "Seeing app windows needs the Crew app.";
const NO_QUERY = "Name the window to capture: a ref like w1 from list, or part of its name.";

/** The capture width: 1280 by default, kept between 320 and 1920 pixels. */
function clampWidth(v) {
  if (v === undefined || v === null) return DEFAULT_WIDTH;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
}

/**
 * @param {object} o
 * @param {{ getSources: (opts: object) => Promise<Array<{ id: string, name: string, thumbnail: { isEmpty(): boolean, toPNG(): Buffer, getSize(): { width: number, height: number } } }>> } | null} o.desktopCapturer  Electron's desktopCapturer; null outside the Crew app
 * @param {ReturnType<import("./desktop-input.cjs").createDesktopInput> | null} [o.input]  clicks and keys in a window; null: the bot can only look
 */
function createAppWindows({ desktopCapturer, input = null }) {
  // ref (w1, w2, ...) -> { id, name } from the last list. Reassigned by each list.
  let last = new Map();
  // The last capture: its window and picture size, which clicks are measured in.
  let shot = null;

  const need = () => {
    if (!desktopCapturer) throw new Error(NO_CAPTURER);
    return desktopCapturer;
  };

  /** The windows the person can see, without Crew's own and without unnamed ones. */
  async function visible(thumbnailSize) {
    const sources = await need().getSources({ types: ["window"], thumbnailSize, fetchWindowIcons: false });
    const out = [];
    for (const s of sources) {
      const name = String(s.name ?? "").trim();
      if (!name || name === OWN_NAME || name.startsWith(OWN_PREFIX)) continue;
      out.push({ id: s.id, name, thumbnail: s.thumbnail });
    }
    return out;
  }

  /** The window a query names: a ref from the last list, or an exact or partial name (case does not matter). */
  function pick(sources, query) {
    if (REF_RE.test(query)) {
      const hit = last.get(query.toLowerCase());
      if (!hit) throw new Error(`There is no window ${query} in the last list. Run the list action again, then capture by its new ref or its name.`);
      const src = sources.find((s) => s.id === hit.id);
      if (!src) throw new Error(`"${hit.name}" is gone. Run the list action again to see the windows that are open.`);
      return src;
    }
    const lower = query.toLowerCase();
    const exact = sources.filter((s) => s.name.toLowerCase() === lower);
    const found = exact.length ? exact : sources.filter((s) => s.name.toLowerCase().includes(lower));
    if (found.length === 1) return found[0];
    if (!found.length) throw new Error(`No open window has "${query}" in its name. Run the list action to see the windows that are open.`);
    throw new Error(`Several windows match "${query}": ${found.map((s) => `"${s.name}"`).join(", ")}. Use a longer name, or the ref from list.`);
  }

  /** Every visible window, with a ref for each. */
  async function list() {
    const sources = await visible({ width: 0, height: 0 });
    last = new Map(sources.map((s, i) => [`w${i + 1}`, { id: s.id, name: s.name }]));
    if (!sources.length) return { text: "No app windows are open. Start the app with your shell first, then list again." };
    return { text: sources.map((s, i) => `w${i + 1}  ${s.name}`).join("\n") };
  }

  /** A picture of one window, at the given width. */
  async function capture({ window: query, width } = {}) {
    const q = typeof query === "string" ? query.trim() : "";
    if (!q) throw new Error(NO_QUERY);
    const w = clampWidth(width);
    const sources = await visible({ width: w, height: Math.round(w * 0.75) });
    const src = pick(sources, q);
    const thumb = src.thumbnail;
    if (thumb.isEmpty()) throw new Error("That window is minimized or hidden. Bring it to the front and capture again.");
    const size = thumb.getSize();
    shot = { id: src.id, name: src.name, width: size.width, height: size.height };
    return {
      text: `Captured "${src.name}" at ${size.width}×${size.height}.`,
      image: { data: thumb.toPNG().toString("base64"), mimeType: "image/png" },
    };
  }

  /** The window of the last capture, as desktop-input names it. Clicks and keys go only there. */
  function target(query) {
    if (!input) throw new Error("Clicking in app windows isn't available here.");
    if (!shot) throw new Error("Capture the window first: clicks are measured in the picture you saw.");
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    const ref = q && REF_RE.test(q) ? last.get(q) : null;
    if (q && !(ref ? ref.id === shot.id : shot.name.toLowerCase().includes(q))) throw new Error(`Your last capture was "${shot.name}". Capture the window you want to use first.`);
    return { title: shot.name, ...(handleOf(shot.id) ? { handle: handleOf(shot.id) } : {}) };
  }

  async function click(p) {
    const t = target(p.window);
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Give x and y: the point in your last capture's picture, in its pixels.");
    await input.click(t, { x: Math.round(x), y: Math.round(y), imageWidth: shot.width, imageHeight: shot.height, button: p.button === "right" ? "right" : "left", double: p.double === true });
    return { text: `Clicked at ${Math.round(x)},${Math.round(y)} in "${shot.name}". Capture again to see what changed.` };
  }

  async function type(p) {
    const text = typeof p.text === "string" ? p.text : "";
    if (!text) throw new Error("Say the text to type.");
    await input.type(target(p.window), text);
    return { text: `Typed ${text.length} characters in "${shot.name}". Capture again to see what changed.` };
  }

  async function press(p) {
    const key = typeof p.key === "string" ? p.key.trim() : "";
    if (!key) throw new Error("Say the key, like Enter or Control+S.");
    await input.press(target(p.window), key);
    return { text: `Pressed ${key} in "${shot.name}". Capture again to see what changed.` };
  }

  return {
    /** Every app window open on this computer, one line each. */
    list,
    /** A picture of one window: a ref from list, or part of its name. */
    capture,
    /** Whether an action moves the person's mouse or keyboard (the caller asks the person first). */
    usesInput: (action) => action === "click" || action === "type" || action === "press",
    /** The window tool: list, capture, and click, type or press in the last captured window. */
    async handle(ctx, p = {}) {
      need();
      const action = String(p.action ?? "");
      if (action === "list") return list();
      if (action === "capture") return capture({ window: p.window, width: p.width });
      if (action === "click") return click(p);
      if (action === "type") return type(p);
      if (action === "press") return press(p);
      throw new Error(`Use the action list, capture, click, type or press, not "${action.slice(0, 20)}".`);
    },
  };
}

module.exports = { createAppWindows };
