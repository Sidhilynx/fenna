// How a slide on the canvas changes on screen.
//
// The canvas never swaps a slide's whole markup while it stays on the same
// slide: it patches the DOM in place (patchSlide), so images don't reload and
// nothing flickers. When the change came from somewhere else (the AI, another
// editor), animateSlide also shows what happened: elements that moved glide
// from where they were, new ones arrive one after another with the AI's
// cursor visiting each, rewritten text types in (its layout is reserved, so
// nothing below it jumps), changed elements flash once, and removed ones fade
// out where they stood. A whole new slide builds the same way.
//
// Every animation is cut short by settle(): the next change, a click on the
// canvas, or text editing finish them at once, so the DOM is always left
// exactly as the markup says.

import { ELEMENTS, SLIDE_WIDTH } from "@opendeck/format";

const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const MOVE_MS = 200;
const ENTER_MS = 180;
const EXIT_MS = 150;
/** A changed element's ring: held, then faded. */
const FLASH_MS = 900;
/** Gap between one arriving element and the next... */
const STEP_MS = 70;
/** ...shrunk so that a whole slide builds within this. */
const BUILD_MS = 1100;
const TYPE_CHAR_MS = 9;
const TYPE_MAX_MS = 520;
const TYPE_MAX_CHARS = 600;
/** Attributes the editor sets on slide elements itself; a difference in them is not a change to the slide. */
const OWN_ATTRS = new Set(["data-od", "class", "contenteditable", "spellcheck"]);

export interface MotionHooks {
  /** The element the AI's cursor is on now (null: the run is over). */
  cursor(el: HTMLElement | null): void;
  /** Everything has come to rest; overlays can measure again. */
  settled(): void;
}

interface Patch {
  added: HTMLElement[];
  changed: HTMLElement[];
  retyped: HTMLElement[];
}

const isContainer = (el: Element) => Array.isArray(ELEMENTS[el.tagName.toLowerCase()]?.children);

function parse(html: string): HTMLElement | null {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement | null;
}

/** Make `cur`'s attributes those of `next`; true if a slide attribute (not one of the editor's own) differed. */
function patchAttrs(cur: Element, next: Element): boolean {
  let changed = false;
  for (const { name } of [...cur.attributes]) {
    if (next.hasAttribute(name)) continue;
    cur.removeAttribute(name);
    if (!OWN_ATTRS.has(name)) changed = true;
  }
  for (const { name, value } of [...next.attributes]) {
    if (cur.getAttribute(name) === value) continue;
    cur.setAttribute(name, value);
    if (!OWN_ATTRS.has(name)) changed = true;
  }
  return changed;
}

/** An element's markup without its address, which changes whenever it moves. */
const content = (el: Element) => el.outerHTML.replace(/ data-od="[^"]*"/g, "");

/**
 * Which old child stands for each new one: the same id; else an identical
 * element anywhere among the siblings (so a reordered element moves instead
 * of being rewritten in place); else the one at the same place with the same
 * tag (and no other id). Null: the new child is new.
 */
function partners(olds: Element[], news: Element[]): (Element | null)[] {
  const used = new Set<Element>();
  const take = (o: Element | undefined) => (o ? (used.add(o), o) : null);
  const out: (Element | null)[] = news.map((n) => {
    const id = n.getAttribute("id");
    return id ? take(olds.find((o) => !used.has(o) && o.getAttribute("id") === id)) : null;
  });
  const oldContent = new Map(olds.map((o) => [o, content(o)] as const));
  news.forEach((n, i) => {
    if (out[i]) return;
    const c = content(n);
    out[i] = take(olds.find((o) => !used.has(o) && oldContent.get(o) === c));
  });
  news.forEach((n, i) => {
    if (out[i]) return;
    const o = olds[i];
    if (o && !used.has(o) && o.tagName === n.tagName && (o.getAttribute("id") ?? "") === (n.getAttribute("id") ?? "")) out[i] = take(o);
  });
  return out;
}

function patchElement(cur: HTMLElement, next: HTMLElement, p: Patch) {
  const attrsChanged = patchAttrs(cur, next);
  if (isContainer(cur)) {
    patchChildren(cur, next, p);
    if (attrsChanged) p.changed.push(cur);
    return;
  }
  if (cur.innerHTML !== next.innerHTML) {
    cur.innerHTML = next.innerHTML;
    p.changed.push(cur);
    p.retyped.push(cur);
  } else if (attrsChanged) p.changed.push(cur);
}

function patchChildren(cur: HTMLElement, next: HTMLElement, p: Patch) {
  const olds = [...cur.children];
  const news = [...next.children];
  const matched = partners(olds, news);
  const used = new Set(matched);
  const result: Element[] = [];
  news.forEach((n, i) => {
    const m = matched[i];
    if (m) {
      patchElement(m as HTMLElement, n as HTMLElement, p);
      result.push(m);
    } else {
      const fresh = document.importNode(n, true) as HTMLElement;
      p.added.push(fresh);
      result.push(fresh);
    }
  });
  for (const o of olds) if (!used.has(o)) o.remove();
  result.forEach((el, i) => {
    if (cur.children[i] !== el) cur.insertBefore(el, cur.children[i] ?? null);
  });
}

function patchInto(host: HTMLElement, html: string): Patch | null {
  const p: Patch = { added: [], changed: [], retyped: [] };
  const cur = host.firstElementChild as HTMLElement | null;
  const next = parse(html);
  if (!cur || !next || cur.tagName !== next.tagName) {
    host.innerHTML = html;
    return null;
  }
  patchElement(cur, next, p);
  return p;
}

/** Show new markup for the slide already on screen, changing only what differs. */
export function patchSlide(host: HTMLElement, html: string) {
  patchInto(host, html);
}

/** Pure text, short enough to type: layout is reserved, so typing never moves anything. */
function typeable(el: HTMLElement): string | null {
  if (el.children.length) return null;
  const text = el.textContent ?? "";
  return text.trim() && text.length <= TYPE_MAX_CHARS ? text : null;
}

/** Elements that arrive one by one: each added element, and inside a new group, its parts. */
function arrivals(added: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    out.push(el);
    if (isContainer(el)) for (const c of el.children) walk(c as HTMLElement);
  };
  added.forEach(walk);
  return out;
}

const inDocumentOrder = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

/**
 * Patch the slide in `host` to `html`, animating the difference. `from` is
 * what to start from when the host shows another slide: the slide's earlier
 * markup, or null for a slide that is new (it then builds from empty).
 * Returns settle(), which finishes every animation at once.
 */
export function animateSlide(host: HTMLElement, html: string, from: string | null | undefined, hooks: MotionHooks): () => void {
  const timers: number[] = [];
  const typing: (() => void)[] = [];
  const ghosts: HTMLElement[] = [];
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    typing.forEach((finish) => finish());
    ghosts.forEach((g) => g.remove());
    for (const a of host.getAnimations({ subtree: true })) a.finish();
    hooks.settled();
  };

  let patch: Patch | null;
  const before = new Map<Element, DOMRect>();
  const removed: { el: HTMLElement; rect: DOMRect }[] = [];
  if (from === null) {
    host.innerHTML = html;
    const sec = host.firstElementChild as HTMLElement | null;
    patch = sec ? { added: [...sec.children] as HTMLElement[], changed: [], retyped: [] } : null;
  } else {
    if (from !== undefined) host.innerHTML = from;
    const parents = new Map<Element, Element | null>();
    for (const el of host.querySelectorAll("[data-od]")) {
      before.set(el, el.getBoundingClientRect());
      parents.set(el, el.parentElement);
    }
    patch = patchInto(host, html);
    // Taken out of a group that is still here (not inline parts of rewritten text, not parts of something removed whole).
    for (const [el, parent] of parents) {
      if (!el.isConnected && parent?.isConnected && isContainer(parent)) removed.push({ el: el as HTMLElement, rect: before.get(el)! });
    }
  }
  const section = host.firstElementChild as HTMLElement | null;
  if (!patch || !section) {
    settle();
    return settle;
  }
  const secRect = section.getBoundingClientRect();
  const scale = secRect.width / SLIDE_WIDTH || 1;
  const addedSet = new Set<Element>(arrivals(patch.added));

  // Glide: everything still here that moved starts where it was (less what its parent already moves).
  const after = new Map<Element, DOMRect>();
  for (const el of host.querySelectorAll("[data-od]")) if (before.has(el)) after.set(el, el.getBoundingClientRect());
  const shift = new Map<Element, { x: number; y: number }>();
  for (const [el, now] of after) {
    const was = before.get(el)!;
    let x = (was.left - now.left) / scale;
    let y = (was.top - now.top) / scale;
    shift.set(el, { x, y });
    for (let a = el.parentElement; a && a !== host; a = a.parentElement) {
      const s = shift.get(a);
      if (s) {
        x -= s.x;
        y -= s.y;
        break;
      }
    }
    if (Math.abs(x) > 1 || Math.abs(y) > 1) (el as HTMLElement).animate([{ translate: `${x}px ${y}px` }, { translate: "0 0" }], { duration: MOVE_MS, easing: EASE });
  }

  // Fade out what was removed, where it stood.
  for (const { el, rect } of removed) {
    if (rect.width === 0 && rect.height === 0) continue;
    const g = el.cloneNode(true) as HTMLElement;
    for (const n of [g, ...g.querySelectorAll("[data-od]")]) n.removeAttribute("data-od");
    Object.assign(g.style, { position: "absolute", left: `${(rect.left - secRect.left) / scale}px`, top: `${(rect.top - secRect.top) / scale}px`, width: `${rect.width / scale}px`, height: `${rect.height / scale}px`, right: "auto", bottom: "auto", margin: "0", pointerEvents: "none", translate: "none" });
    section.appendChild(g);
    ghosts.push(g);
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, easing: EASE, fill: "forwards" }).finished.then(() => g.remove(), () => g.remove());
  }

  // Arrivals and changes, in reading order, one after another; the cursor visits each.
  const visits = [...new Set([...addedSet, ...patch.changed])].sort(inDocumentOrder) as HTMLElement[];
  const step = visits.length ? Math.min(STEP_MS, BUILD_MS / visits.length) : 0;
  const retyped = new Set(patch.retyped);
  // The flash: the UI's AI color, a fixed width on screen whatever the zoom.
  const flash = getComputedStyle(document.documentElement).getPropertyValue("--ai-flash").trim();
  const ring = (color: string) => ({ outline: `${2 / scale}px solid ${color}`, outlineOffset: `${4 / scale}px` });
  let end = MOVE_MS;
  visits.forEach((el, i) => {
    const delay = Math.round(i * step);
    if (addedSet.has(el)) el.animate([{ opacity: 0, translate: "0 12px" }, { opacity: 1, translate: "0 0" }], { duration: ENTER_MS, delay, easing: EASE, fill: "backwards" });
    else el.animate([ring(flash), { ...ring(flash), offset: 0.6 }, ring("transparent")], { duration: FLASH_MS, delay, easing: EASE });
    const text = addedSet.has(el) || retyped.has(el) ? typeable(el) : null;
    if (text) end = Math.max(end, delay + typeIn(el, text, delay, timers, typing));
    timers.push(window.setTimeout(() => hooks.cursor(el), delay));
    end = Math.max(end, delay + ENTER_MS);
  });
  timers.push(window.setTimeout(settle, end + 60));
  return settle;
}

/** Type `text` into `el` after `delay`; the untyped rest stays in place, invisible. Returns the duration. */
function typeIn(el: HTMLElement, text: string, delay: number, timers: number[], typing: (() => void)[]): number {
  const duration = Math.min(TYPE_MAX_MS, text.length * TYPE_CHAR_MS);
  const shown = document.createTextNode("");
  const rest = document.createElement("span");
  rest.className = "od-type-rest";
  rest.textContent = text;
  el.replaceChildren(shown, rest);
  let frame = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    if (rest.isConnected) el.textContent = text;
  };
  typing.push(finish);
  timers.push(
    window.setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (!rest.isConnected) return;
        const n = Math.min(text.length, Math.round((text.length * (now - t0)) / duration));
        shown.data = text.slice(0, n);
        rest.textContent = text.slice(n);
        if (n < text.length) frame = requestAnimationFrame(tick);
        else finish();
      };
      frame = requestAnimationFrame(tick);
    }, delay),
  );
  return duration;
}
