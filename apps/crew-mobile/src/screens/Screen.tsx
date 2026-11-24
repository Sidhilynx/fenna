// A bot's browser on the phone. The computer sends a picture of the page
// when it changes (the next only after this one is drawn), and lays the page
// out at this screen's size, so sites show their phone layout. Taking control
// pauses the bot: a tap clicks, a drag scrolls, a long press is a right
// click, and the keyboard types into the page.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke, on, send } from "../../../crew/src/shared/api.ts";
import type { BrowserState, CursorEvent, ControlInput } from "../../../crew/src/shared/contract.ts";
import { onFrame } from "../bridge.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Header, haptic, IconButton, PixelIcon, Sheet, Working } from "../ui.tsx";

const LONG_PRESS_MS = 550;
const MOVE_PX = 8;
/** The bot's view of a pointer: where the last picture says the page is. */
interface Shown {
  url: string;
  viewWidth: number;
  viewHeight: number;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function Screen({ slug }: { slug: string }) {
  const { bot, link, gen, pop } = useStore();
  const act = useAct();
  const b = bot(slug);
  const [state, setState] = useState<BrowserState | null>(b?.browser ?? null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [cursor, setCursor] = useState<CursorEvent | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tabs, setTabs] = useState(false);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const control = !!state?.control;
  const controlRef = useRef(control);
  controlRef.current = control;

  // Watch while this screen is open and the computer is reachable; give control back when leaving.
  useEffect(() => {
    if (!link.ready) return;
    let alive = true;
    invoke("crew:watch", slug, "live").then(
      (s) => alive && setState(s),
      () => {},
    );
    return () => {
      alive = false;
      void invoke("crew:watch", slug, "off").catch(() => {});
      if (controlRef.current) void invoke("crew:control", slug, false).catch(() => {});
    };
  }, [slug, link.ready, gen]);

  useEffect(() => on("crew:browser", (e) => e.slug === slug && setState(e.state)), [slug]);
  useEffect(
    () =>
      on("crew:cursor", (c) => {
        if (c.slug !== slug) return;
        setCursor(c);
      }),
    [slug],
  );

  // Pictures: draw the newest, then tell the computer it may send the next.
  useEffect(() => {
    let last: string | null = null;
    const off = onFrame((f) => {
      if (f.slug !== slug) {
        f.ack();
        return;
      }
      const url = URL.createObjectURL(new Blob([f.jpeg as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
      const el = img.current;
      if (!el) {
        URL.revokeObjectURL(url);
        f.ack();
        return;
      }
      el.onload = el.onerror = () => {
        if (last && last !== url) URL.revokeObjectURL(last);
        last = url;
        f.ack();
      };
      el.src = url;
      setShown({ url, viewWidth: f.viewWidth, viewHeight: f.viewHeight });
    });
    return () => {
      off();
      if (last) URL.revokeObjectURL(last);
    };
  }, [slug]);

  // The page lays out at the size of the area it is shown in.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !link.ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tell = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      send("crew:viewport", slug, { width: Math.round(r.width), height: Math.round(r.height), scale: Math.min(2, window.devicePixelRatio || 1) });
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tell, 150);
    });
    ro.observe(el);
    tell();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [slug, link.ready, gen]);

  /** A point on the screen as page pixels, or null outside the picture. */
  const toPage = useCallback(
    (clientX: number, clientY: number) => {
      const el = img.current;
      if (!el || !shown) return null;
      const r = el.getBoundingClientRect();
      const aspect = shown.viewWidth / shown.viewHeight;
      let w = r.width;
      let h = r.width / aspect;
      if (h > r.height) {
        h = r.height;
        w = h * aspect;
      }
      const left = r.left + (r.width - w) / 2;
      const top = r.top + (r.height - h) / 2;
      const x = ((clientX - left) / w) * shown.viewWidth;
      const y = ((clientY - top) / h) * shown.viewHeight;
      if (x < 0 || y < 0 || x > shown.viewWidth || y > shown.viewHeight) return null;
      return { x: Math.round(x), y: Math.round(y), ratio: shown.viewWidth / w };
    },
    [shown],
  );

  const input = (ev: ControlInput) => send("crew:input", slug, ev);

  async function setControl(on: boolean) {
    setBusy(true);
    const s = await act(invoke("crew:control", slug, on));
    setBusy(false);
    if (s) {
      setState(s);
      haptic("tap");
    }
  }

  if (!b) {
    return (
      <>
        <Header back title="Screen" />
        <Empty title="This bot is gone" sub="It was deleted on your computer.">
          <button type="button" className="btn" onClick={pop}>
            Back
          </button>
        </Empty>
      </>
    );
  }

  const active = state?.tabs.find((t) => t.id === state.active) ?? null;
  const blank = !state || !active || !active.url;
  return (
    <>
      <Header
        back
        bot={b}
        title={b.name}
        sub={active ? active.title || hostOf(active.url) || "New tab" : "Browser"}
        actions={
          <button type="button" className={control ? "btn scr-take on" : "btn primary scr-take"} disabled={busy || !link.ready} onClick={() => void setControl(!control)}>
            {busy ? <Working label="Switching" /> : control ? "Give back" : "Take control"}
          </button>
        }
      />
      <ConnBar />
      {control && (
        <div className="scr-banner" role="status">
          You are in control. {b.name} is paused and doesn't see what you type.
        </div>
      )}
      {control && state && (
        <div className="scr-tools">
          <IconButton icon="back" label="Back" disabled={!state.canGoBack} onClick={() => void act(invoke("crew:browserGo", slug, "back"))} />
          <IconButton icon="reload" label={state.loading ? "Stop" : "Reload"} onClick={() => void act(invoke("crew:browserGo", slug, state.loading ? "stop" : "reload"))} />
          <button type="button" className="scr-address" onClick={() => setAddress(active?.url ?? "")}>
            {state.loading && <Working label="Loading" />}
            <span className="ell">{active?.url ? hostOf(active.url) : "Go to an address"}</span>
          </button>
          <button type="button" className="scr-tabs-btn" aria-label={`${state.tabs.length} tabs`} onClick={() => setTabs(true)}>
            {state.tabs.length}
          </button>
        </div>
      )}

      <div className={control ? "scr-stage control" : "scr-stage"} ref={stage}>
        <img ref={img} className="scr-img" alt={active ? `${b.name}'s browser: ${active.title || active.url}` : `${b.name}'s browser`} hidden={!shown} draggable={false} />
        {!shown && (
          <div className="scr-wait">
            {!link.ready ? (
              <span>The screen shows when your computer is reachable.</span>
            ) : state && blank ? (
              <span>{control ? "Nothing open. Tap the address above to go to a site." : "Nothing open. Take control to go to a site."}</span>
            ) : (
              <Working label="Loading the screen" />
            )}
          </div>
        )}
        {shown && blank && !control && <p className="scr-hint">Nothing open. Take control to go to a site.</p>}
        {!control && cursor && shown && <Cursor cursor={cursor} shown={shown} img={img.current} name={b.name} />}
        {control && <Touch toPage={toPage} input={input} />}
      </div>

      {control && <Keys input={input} />}

      {address !== null && (
        <Sheet
          title="Go to"
          onClose={() => setAddress(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setAddress(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!address.trim()}
                onClick={() => {
                  const url = address.trim();
                  setAddress(null);
                  void act(invoke("crew:navigate", slug, url));
                }}
              >
                Go
              </button>
            </>
          }
        >
          <label className="m-field">
            <span className="m-label">Address</span>
            <input className="field" type="url" inputMode="url" value={address} onChange={(e) => setAddress(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
          </label>
        </Sheet>
      )}

      {tabs && state && (
        <Sheet
          title="Tabs"
          onClose={() => setTabs(false)}
          actions={
            <button type="button" className="btn primary" disabled={state.tabs.length >= 8} onClick={() => void act(invoke("crew:tab", slug, "new")).then(() => setTabs(false))}>
              New tab
            </button>
          }
        >
          <ul className="scr-tab-list">
            {state.tabs.map((t) => (
              <li key={t.id} className="scr-tab">
                <button type="button" className="m-row" aria-current={t.id === state.active ? "true" : undefined} onClick={() => void act(invoke("crew:tab", slug, "switch", t.id)).then(() => setTabs(false))}>
                  <span className="m-row-text">
                    <span className="m-row-title ell">{t.title || hostOf(t.url) || "New tab"}</span>
                    <span className="m-row-sub ell">{t.url ? hostOf(t.url) : "Empty"}</span>
                  </span>
                  {t.id === state.active && <PixelIcon name="check" size={16} />}
                </button>
                <IconButton icon="close" label={`Close ${t.title || "tab"}`} onClick={() => void act(invoke("crew:tab", slug, "close", t.id))} />
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}

/** Where the bot is about to act, with its name. */
function Cursor({ cursor, shown, img, name }: { cursor: CursorEvent; shown: Shown; img: HTMLImageElement | null; name: string }) {
  if (!img) return null;
  const r = img.getBoundingClientRect();
  const stage = img.parentElement?.getBoundingClientRect();
  if (!stage) return null;
  const aspect = shown.viewWidth / shown.viewHeight;
  let w = r.width;
  let h = r.width / aspect;
  if (h > r.height) {
    h = r.height;
    w = h * aspect;
  }
  const left = r.left - stage.left + (r.width - w) / 2 + (cursor.x / shown.viewWidth) * w;
  const top = r.top - stage.top + (r.height - h) / 2 + (cursor.y / shown.viewHeight) * h;
  return (
    <div className="scr-cursor" style={{ transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)` }} aria-hidden="true">
      <span className="scr-cursor-dot" />
      <span className="scr-cursor-tag">{name}</span>
    </div>
  );
}

/** Touch over the picture, as the page's mouse. */
function Touch({ toPage, input }: { toPage: (x: number, y: number) => { x: number; y: number; ratio: number } | null; input: (ev: ControlInput) => void }) {
  const g = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean; long: boolean; timer: ReturnType<typeof setTimeout> | null; dx: number; dy: number; raf: number } | null>(null);

  function click(clientX: number, clientY: number, button: "left" | "right") {
    const p = toPage(clientX, clientY);
    if (!p) return;
    input({ type: "mouseMove", x: p.x, y: p.y });
    input({ type: "mouseDown", x: p.x, y: p.y, button, clickCount: 1 });
    input({ type: "mouseUp", x: p.x, y: p.y, button, clickCount: 1 });
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (g.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, long: false, timer: null as ReturnType<typeof setTimeout> | null, dx: 0, dy: 0, raf: 0 };
    s.timer = setTimeout(() => {
      if (!g.current || g.current.moved) return;
      g.current.long = true;
      haptic("tap");
      click(s.x, s.y, "right");
    }, LONG_PRESS_MS);
    g.current = s;
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_PX) {
      s.moved = true;
      if (s.timer) clearTimeout(s.timer);
    }
    if (!s.moved) return;
    s.dx += e.clientX - s.lastX;
    s.dy += e.clientY - s.lastY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    // One scroll a frame: the finger's travel as page pixels, the page moving with it.
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => {
        const cur = g.current;
        if (!cur) return;
        cur.raf = 0;
        const p = toPage(cur.lastX, cur.lastY) ?? toPage(cur.x, cur.y);
        if (!p) return;
        input({ type: "mouseWheel", x: p.x, y: p.y, deltaX: Math.round(-cur.dx * p.ratio), deltaY: Math.round(-cur.dy * p.ratio) });
        cur.dx = 0;
        cur.dy = 0;
      });
    }
  }

  function up(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.raf) cancelAnimationFrame(s.raf);
    g.current = null;
    if (!s.moved && !s.long && e.type === "pointerup") click(s.x, s.y, "left");
  }

  return <div className="scr-touch" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />;
}

/**
 * The phone's keyboard into the page. Android keyboards compose words, so
 * what was typed is read as the change to a hidden field (characters added,
 * characters deleted) rather than as key events. A marker character keeps
 * Backspace working on an empty field.
 */
const MARK = "​";

function Keys({ input }: { input: (ev: ControlInput) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const last = useRef(MARK);
  const [open, setOpen] = useState(false);

  const key = (k: string) => {
    input({ type: "keyDown", key: k });
    input({ type: "keyUp", key: k });
  };
  const typeChar = (ch: string) => {
    input({ type: "keyDown", key: ch });
    input({ type: "char", key: ch });
    input({ type: "keyUp", key: ch });
  };

  function changed(value: string) {
    const before = last.current;
    let same = 0;
    while (same < before.length && same < value.length && before[same] === value[same]) same++;
    for (let i = 0; i < before.length - same; i++) key("Backspace");
    for (const ch of value.slice(same)) {
      if (ch === "\n") key("Enter");
      else if (ch !== MARK) typeChar(ch);
    }
    // Keep the marker at the front, so deleting on an "empty" field still says Backspace.
    if (!value.startsWith(MARK)) {
      const next = MARK + value.replace(/\n/g, "");
      if (field.current) field.current.value = next;
      last.current = next;
    } else last.current = value.replace(/\n/g, "");
    if (field.current && field.current.value.includes("\n")) field.current.value = last.current;
  }

  function toggle() {
    const el = field.current;
    if (!el) return;
    if (open) {
      el.blur();
      return;
    }
    el.value = MARK;
    last.current = MARK;
    el.focus();
  }

  return (
    <div className="scr-keys">
      <textarea
        ref={field}
        className="scr-keyfield"
        aria-label="Type into the page"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onInput={(e) => changed(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            key("Enter");
          } else if (e.key === "Tab") {
            e.preventDefault();
            key("Tab");
          }
        }}
      />
      <button type="button" className="btn scr-key-btn" aria-pressed={open} onPointerDown={(e) => e.preventDefault()} onClick={toggle}>
        <PixelIcon name="keyboard" size={20} /> {open ? "Hide keyboard" : "Keyboard"}
      </button>
      <button type="button" className="btn scr-key-btn" onPointerDown={(e) => e.preventDefault()} onClick={() => key("Escape")}>
        Esc
      </button>
    </div>
  );
}
