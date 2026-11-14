// Export: an artboard as a web page that needs no other file (its images
// and the app's font inside it), and from that page a PNG or a PDF made by
// the main process. Every export goes through the format's renderer, the
// same one the canvas shows.

import { pagesHtml, standaloneHtml, themeOf, type ArtboardDoc, type ElementNode } from "@opendeck/artboard";
import { toast, type MenuEntry } from "@opendeck/shell";
import { api, assetUrl, plainError, type ExportPage } from "./api.ts";
import { boardRect, getState, pageBoards, selectedFile } from "./store.ts";

export type ExportKind = "html" | "pdf" | "png";

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The Inter faces the page uses, as @font-face rules with the font inside. */
async function embeddedFonts(): Promise<string> {
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule) || !/Inter/.test(rule.style.getPropertyValue("font-family"))) continue;
      const url = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
      if (!url) continue;
      try {
        const data = await toDataUrl(await (await fetch(new URL(url, sheet.href ?? document.baseURI))).blob());
        rules.push(`@font-face{font-family:Inter;font-style:${rule.style.getPropertyValue("font-style") || "normal"};font-weight:100 900;src:url(${data}) format("woff2");unicode-range:${rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"}}`);
      } catch {
        /* the export falls back to the system font */
      }
    }
  }
  return rules.join("\n");
}

function imagesIn(n: ElementNode, out = new Set<string>()): Set<string> {
  if (n.tag === "img" && n.attrs.src) out.add(n.attrs.src);
  for (const c of n.children) if (c.type === "element") imagesIn(c, out);
  return out;
}

/** Each image the artboards use, as a data URL. One that can't be read is left out of the page. */
async function embeddedImages(docs: ArtboardDoc[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const src of new Set(docs.flatMap((d) => [...imagesIn(d.root)]))) {
    try {
      out.set(src, await toDataUrl(await (await fetch(assetUrl(src))).blob()));
    } catch {
      /* drawn without it */
    }
  }
  return out;
}

interface Page {
  file: string;
  title: string;
  doc: ArtboardDoc;
  width: number;
  height: number;
}

/** The artboards that can be exported, among `files`: one whose file has problems is skipped and named. */
function pagesOf(files: readonly string[]): Page[] {
  const s = getState();
  const pages: Page[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const doc = s.boards.get(file)?.doc;
    const r = boardRect(file, s);
    if (doc && r) pages.push({ file, title: s.index.boards[file]!.title, doc, width: r.w, height: r.h });
    else if (r) skipped.push(s.index.boards[file]!.title);
  }
  if (skipped.length) toast(`${skipped.join(", ")} can’t be exported: ${skipped.length === 1 ? "its file has" : "their files have"} problems.`);
  return pages;
}

const baseName = (file: string) => file.split(/[\\/]/).pop();

/** One artboard as HTML, PDF or PNG (at `scale` times its size). */
export async function exportArtboard(file: string, kind: ExportKind, scale = 1) {
  const [page] = pagesOf([file]);
  if (!page) return;
  const s = getState();
  try {
    const opts = { ...themeOf(s.index), title: page.title, assets: await embeddedImages([page.doc]), css: await embeddedFonts() };
    let saved: string | null;
    if (kind === "html") saved = await api().saveHtml(page.title, new TextEncoder().encode(standaloneHtml(page.doc, opts)));
    else if (kind === "png") saved = await api().exportPng(page.title, standaloneHtml(page.doc, opts), page.width, page.height, scale);
    else saved = await api().exportPdf(page.title, pagesHtml([page], opts), page.width, page.height);
    if (saved) toast(`Saved ${baseName(saved)}.`);
  } catch (e) {
    toast(`Couldn’t export: ${plainError(e)}`);
  }
}

/** Several artboards: one PDF with a sheet each, or a folder of PNGs. */
export async function exportArtboards(files: readonly string[], kind: "pdf" | "png", scale = 1) {
  const pages = pagesOf(files);
  if (!pages.length) {
    toast("There is no artboard to export.");
    return;
  }
  const s = getState();
  try {
    const opts = { ...themeOf(s.index), title: s.index.title, assets: await embeddedImages(pages.map((p) => p.doc)), css: await embeddedFonts() };
    if (kind === "pdf") {
      const saved = await api().exportPdf(s.index.title, pagesHtml(pages, opts), pages[0]!.width, pages[0]!.height);
      if (saved) toast(`Saved ${baseName(saved)}.`);
      return;
    }
    const list: ExportPage[] = pages.map((p) => ({ name: p.title, html: standaloneHtml(p.doc, { ...opts, title: p.title }), width: p.width, height: p.height }));
    const folder = await api().exportPngs(s.index.title, list, scale);
    if (folder) toast(`Saved ${list.length === 1 ? "1 image" : `${list.length} images`} in ${baseName(folder)}.`);
  } catch (e) {
    toast(`Couldn’t export: ${plainError(e)}`);
  }
}

/** The artboard the header's Export means: the selected one, or the first on the page. */
export const exportTarget = (): string | null => selectedFile() ?? pageBoards()[0] ?? null;

/** The header's Export: the selected artboard as a page or an image, or the whole page as a PDF. */
export async function exportDesign(kind: ExportKind) {
  const file = exportTarget();
  if (kind === "pdf") await exportArtboards(pageBoards(), "pdf");
  else if (file) await exportArtboard(file, kind, kind === "png" ? 2 : 1);
  else toast("There is no artboard to export.");
}

const count = (n: number) => (n === 1 ? "1 artboard" : `${n} artboards`);

/** The menu under an artboard's download button, as in the reference. */
export function artboardExportMenu(file: string): MenuEntry[] {
  const s = getState();
  const r = boardRect(file, s);
  if (!r) return [];
  const all = pageBoards(s);
  const picked = s.selection?.kind === "boards" && s.selection.files.length > 1 ? s.selection.files : [];
  return [
    { label: "PNG 1×", hint: `${r.w} × ${r.h} px`, onSelect: () => void exportArtboard(file, "png", 1) },
    { label: "PNG 2×", hint: `${r.w * 2} × ${r.h * 2} px`, onSelect: () => void exportArtboard(file, "png", 2) },
    { label: "PDF (.pdf)", hint: "One page at this artboard’s size", onSelect: () => void exportArtboard(file, "pdf") },
    { label: "HTML (.html)", hint: "A web page with its images inside", onSelect: () => void exportArtboard(file, "html") },
    "separator",
    { label: "All artboards (.pdf)", hint: `${count(all.length)} on this page, one PDF page each`, onSelect: () => void exportArtboards(all, "pdf") },
    { label: "All artboards (.png)", hint: `${count(all.length)} on this page, in a folder`, onSelect: () => void exportArtboards(all, "png", 2) },
    { label: "Selected artboards (.pdf)", hint: picked.length ? `${count(picked.length)}, one PDF page each` : "Select two or more artboards first", disabled: !picked.length, onSelect: () => void exportArtboards(picked, "pdf") },
  ];
}
