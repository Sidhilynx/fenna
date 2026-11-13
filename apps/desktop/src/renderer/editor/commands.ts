// Commands on the selection: everything the keyboard, menus and toolbars
// can do to elements. Each is one undo step.

import {
  type ElementNode,
  duplicate as dup,
  getAt,
  getStyle,
  group as groupOp,
  insert,
  insertHtml,
  lastIndex,
  parentAddress,
  parseFragment,
  removeMany,
  restack as restackOp,
  serializeNodes,
  setStyles,
  ungroup as ungroupOp,
} from "@opendeck/format";
import { api } from "../api.ts";
import { currentSlide, editSlide, editSlideWith, getState, setState, toast } from "./store.ts";

const sel = () => getState().selection;

export function selectedElements(): ElementNode[] {
  const s = currentSlide()?.slide;
  if (!s) return [];
  return sel()
    .map((a) => getAt(s, a))
    .filter((x): x is ElementNode => !!x);
}

export const isPinned = (el: ElementNode | null) => !!el && getStyle(el, "position") === "absolute";

export async function deleteSelection() {
  const addrs = sel();
  if (!addrs.length) return;
  await editSlide(addrs.length === 1 ? "Delete" : `Delete ${addrs.length} items`, (s, ctx) => removeMany(s, addrs, ctx), { selection: [], editing: null });
}

/** After inserting a node at `at`, where does an existing address `a` point? */
export function shiftAddress(a: string, at: string): string {
  const pa = a.split(".");
  const pt = at.split(".");
  const d = pt.length - 1;
  if (pa.length <= d || pa.slice(0, d).join(".") !== pt.slice(0, d).join(".")) return a;
  if (Number(pa[d]) >= Number(pt[d])) pa[d] = String(Number(pa[d]) + 1);
  return pa.join(".");
}

export async function duplicateSelection() {
  if (!sel().length) return;
  const copies = await editSlideWith("Duplicate", (s, ctx) => {
    let cur = s;
    let todo = [...sel()];
    const out: string[] = [];
    while (todo.length) {
      const a = todo.shift()!;
      const r = dup(cur, a, ctx);
      cur = r.slide;
      todo = todo.map((t) => shiftAddress(t, r.at));
      for (let i = 0; i < out.length; i++) out[i] = shiftAddress(out[i]!, r.at);
      out.push(r.at);
    }
    return { slide: cur, value: out };
  });
  if (copies) setState({ selection: copies });
}

export async function nudge(dx: number, dy: number) {
  const s = currentSlide()?.slide;
  if (!s) return;
  const addrs = sel().filter((a) => isPinned(getAt(s, a)));
  if (!addrs.length) return toast("Only pinned items move freely. Pin it from the Design panel.");
  const root = document.querySelector<HTMLElement>(".stage .od-slide");
  await editSlide("Move", (slide, ctx) => {
    let cur = slide;
    for (const a of addrs) {
      const dom = root?.querySelector<HTMLElement>(`[data-od="${a}"]`);
      if (!dom) continue;
      cur = setStyles(cur, a, { ...anchorToTopLeft(getAt(cur, a)!, dom), left: `${Math.round(dom.offsetLeft + dx)}px`, top: `${Math.round(dom.offsetTop + dy)}px` }, ctx);
    }
    return cur;
  });
}

/**
 * Before moving by left/top, drop right/bottom anchoring, keeping the size the
 * element had because of it.
 */
export function anchorToTopLeft(el: ElementNode, dom: HTMLElement): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (getStyle(el, "right") !== undefined) {
    out.right = null;
    if (getStyle(el, "width") === undefined && getStyle(el, "left") !== undefined) out.width = `${dom.offsetWidth}px`;
  }
  if (getStyle(el, "bottom") !== undefined) {
    out.bottom = null;
    if (getStyle(el, "height") === undefined && getStyle(el, "top") !== undefined) out.height = `${dom.offsetHeight}px`;
  }
  return out;
}

/** Pin elements where they are now (position:absolute with their current box), or put them back in the layout. */
export async function setPinned(on: boolean) {
  const s = currentSlide()?.slide;
  const root = document.querySelector<HTMLElement>(".stage .od-slide");
  if (!s || !root) return;
  const addrs = sel();
  await editSlide(on ? "Pin" : "Unpin", (slide, ctx) => {
    let cur = slide;
    for (const a of addrs) {
      const dom = root.querySelector<HTMLElement>(`[data-od="${a}"]`);
      if (!dom || a === "") continue;
      if (on) {
        // Measure against the box it will be positioned in: the slide or the nearest position:relative group.
        const host = dom.offsetParent as HTMLElement | null;
        const sr = (host ?? root).getBoundingClientRect();
        const r = dom.getBoundingClientRect();
        const scale = root.getBoundingClientRect().width / 1920;
        cur = setStyles(
          cur,
          a,
          {
            position: "absolute",
            left: `${Math.round((r.left - sr.left) / scale)}px`,
            top: `${Math.round((r.top - sr.top) / scale)}px`,
            width: `${Math.round(r.width / scale)}px`,
            ...(["img", "svg", "x-shape", "div", "table"].includes(getAt(cur, a)!.tag) ? { height: `${Math.round(r.height / scale)}px` } : {}),
            right: null,
            bottom: null,
          },
          ctx,
        );
      } else cur = setStyles(cur, a, { position: null, left: null, top: null, right: null, bottom: null }, ctx);
    }
    return cur;
  });
}

export async function restack(where: "front" | "back" | "forward" | "backward") {
  const a = sel()[0];
  if (a === undefined || sel().length !== 1) return;
  await editSlideWith(
    "Arrange",
    (s, ctx) => {
      const r = restackOp(s, a, where, ctx);
      return { slide: r.slide, value: r.at };
    },
    (at) => ({ selection: [at] }),
  );
}

export async function groupSelection() {
  const addrs = sel();
  if (addrs.length < 2) return;
  await editSlideWith(
    "Group",
    (s, ctx) => {
      const r = groupOp(s, addrs, ctx);
      return { slide: r.slide, value: r.at };
    },
    (at) => ({ selection: [at] }),
  );
}

export async function ungroupSelection() {
  const a = sel()[0];
  const s = currentSlide()?.slide;
  if (a === undefined || !s || getAt(s, a)?.tag !== "div") return;
  await editSlide("Ungroup", (slide, ctx) => ungroupOp(slide, a, ctx), { selection: [] });
}

// ── Inserting ───────────────────────────────────────────────────────────

/**
 * Insert new elements. They go after the selected element, in its container,
 * when one is selected (so a new text box lands inside the card you're
 * working on); otherwise at the end of the slide. Pinned inserts land
 * centred on the slide.
 */
export async function insertElements(html: string, label: string, opts: { edit?: boolean } = {}) {
  const s = currentSlide()?.slide;
  if (!s) return;
  const anchor = sel().length === 1 ? sel()[0]! : null;
  const anchorEl = anchor !== null ? getAt(s, anchor) : null;
  // A selected group (not a pinned box) takes the new element inside it.
  const intoGroup = anchorEl && anchorEl.tag === "div" && !isPinned(anchorEl);
  const parent = anchor === null ? "" : intoGroup ? anchor : parentAddress(anchor);
  const index = anchor === null || intoGroup ? undefined : lastIndex(anchor) + 1;
  await editSlideWith(
    label,
    (slide, ctx) => {
      const r = insertHtml(slide, parent, html, index, ctx);
      return { slide: r.slide, value: r.at };
    },
    (at) => ({ selection: [at], editing: opts.edit ? at : null }),
  );
}

export function insertText() {
  return insertElements(`<p style="font-size:32px">Text</p>`, "Add text", { edit: true });
}

export function insertTable(rows = 3, cols = 3) {
  const head = `<tr>${"<th>Column</th>".repeat(cols)}</tr>`;
  const body = `<tr>${"<td></td>".repeat(cols)}</tr>`.repeat(rows);
  return insertElements(`<table style="font-size:28px">${head}${body}</table>`, "Add table");
}

export function insertShape(kind: string) {
  const line = kind === "line";
  const size = line ? "width:480px;height:4px" : kind.startsWith("arrow") ? "width:320px;height:160px" : "width:320px;height:320px";
  return insertElements(`<x-shape kind="${kind}" style="position:absolute;left:${960 - (line ? 240 : 160)}px;top:${540 - (line ? 2 : kind.startsWith("arrow") ? 80 : 160)}px;${size};background:#8a867f"></x-shape>`, "Add shape");
}

export async function insertImages(paths?: string[]) {
  const files = paths ?? (await api().pickImages());
  if (!files.length) return;
  const html = files.map((src, i) => `<img src="${src}" alt="" style="position:absolute;left:${560 + i * 32}px;top:${240 + i * 32}px;width:800px;height:600px;object-fit:cover">`).join("");
  await insertElements(html, files.length === 1 ? "Add image" : "Add images");
}

// ── Clipboard ───────────────────────────────────────────────────────────

const MIME = "application/x-opendeck";

export function copySelection(e: ClipboardEvent, cut = false): boolean {
  const els = selectedElements();
  if (!els.length || !e.clipboardData) return false;
  const html = serializeNodes(els);
  e.clipboardData.setData(MIME, html);
  e.clipboardData.setData("text/plain", els.map((el) => textOfEl(el)).join("\n"));
  e.preventDefault();
  if (cut) void deleteSelection();
  return true;
}

function textOfEl(el: ElementNode): string {
  return el.children.map((c) => (c.type === "text" ? c.text : textOfEl(c))).join("");
}

export async function paste(e: ClipboardEvent) {
  const data = e.clipboardData;
  if (!data) return;
  const ours = data.getData(MIME);
  const s = currentSlide()?.slide;
  if (!s) return;
  e.preventDefault();
  if (ours) {
    // Pasted pinned items shift so they don't land exactly on their originals.
    let nodes;
    try {
      nodes = parseFragment(ours, "section");
    } catch {
      return toast("That can’t be pasted here.");
    }
    for (const n of nodes) {
      if (n.type !== "element" || getStyle(n, "position") !== "absolute") continue;
      n.style = n.style.map((d) => (d.name === "left" || d.name === "top") && /^-?\d+(\.\d+)?(px)?$/.test(d.value) ? { name: d.name, value: `${parseFloat(d.value) + 24}px` } : d);
    }
    await editSlideWith(
      "Paste",
      (slide, ctx) => {
        const r = insert(slide, "", nodes, undefined, ctx);
        const first = lastIndex(r.at);
        return { slide: r.slide, value: nodes.filter((n) => n.type === "element").map((_, i) => String(first + i)) };
      },
      (addrs) => ({ selection: addrs }),
    );
    return;
  }
  const file = [...data.files].find((f) => f.type.startsWith("image/"));
  if (file) {
    const path = await api().importAsset(file.name || "pasted.png", new Uint8Array(await file.arrayBuffer()));
    return insertImages([path]);
  }
  const text = data.getData("text/plain").trim();
  if (text) {
    const esc = text.slice(0, 5000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const paras = esc.split(/\n{2,}/).map((p) => `<p style="font-size:32px">${p.replace(/\n/g, "<br>")}</p>`).join("");
    await insertElements(paras, "Paste text");
  }
}
