// Export: Word, PDF, Markdown, or a web page. What's typed is saved first.

import { type DocIndex, type LoadedTab, docMd, flattenTabs, tabLabel, tabMarkup } from "@opendeck/doc";
import { ExportButton, type ExportFormat } from "@opendeck/shell";
import { api, plainError } from "../api.ts";
import { type DocxImage, docxFromDoc } from "../export/docx.ts";
import { flushTyping, getState, toast, useDocs } from "../store.ts";

type Doc = { index: DocIndex; tabs: Map<string, LoadedTab> };

function imagePaths(doc: Doc): string[] {
  const out = new Set<string>();
  for (const t of doc.tabs.values()) for (const m of t.source.matchAll(/<img src="(assets\/[^"]+)"/g)) out.add(m[1]!);
  return [...out];
}

/** An image ready for Word: PNG, JPEG or GIF, with its size in pixels (others are drawn to PNG). */
async function loadImage(rel: string): Promise<DocxImage | null> {
  const a = await api().exports.asset(rel);
  if (!a) return null;
  const blob = new Blob([a.bytes as BlobPart], { type: a.mime });
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  const native = ({ "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif" } as const)[a.mime as "image/png"];
  if (native) return { bytes: a.bytes, ext: native, width: bmp.width, height: bmp.height };
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  const png = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { bytes: png, ext: "png", width: bmp.width, height: bmp.height };
}

async function dataUri(rel: string): Promise<string | null> {
  const a = await api().exports.asset(rel);
  if (!a) return null;
  let s = "";
  for (let i = 0; i < a.bytes.length; i += 0x8000) s += String.fromCharCode(...a.bytes.subarray(i, i + 0x8000));
  return `data:${a.mime};base64,${btoa(s)}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A web page that stands alone: styles inline, images inside it. */
async function htmlOf(doc: Doc): Promise<string> {
  const images = new Map<string, string>();
  for (const p of imagePaths(doc)) {
    const d = await dataUri(p);
    if (d) images.set(p, d);
  }
  const head = doc.index.fonts.headings === "serif" ? "Georgia, 'Times New Roman', serif" : "system-ui, 'Segoe UI', sans-serif";
  const text = doc.index.fonts.text === "serif" ? "Georgia, 'Times New Roman', serif" : "system-ui, 'Segoe UI', sans-serif";
  const body = flattenTabs(doc.index.tabs)
    .map((f) => {
      const t = doc.tabs.get(f.ref.id)?.tab;
      return t ? `<section id="${f.ref.id}"><h1 class="tab-title">${esc(tabLabel(doc.index.tabs, f.ref.id))}</h1>${tabMarkup(t, { assetBase: "", dropdowns: doc.index.dropdowns, images })}</section>` : "";
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.index.title)}</title><style>
body{margin:0;background:#fff;color:#1b1b1a;font:16px/1.6 ${text}}main{max-width:720px;margin:0 auto;padding:48px 24px}
h1,h2,h3{font-family:${head};line-height:1.25;font-weight:600}h1.tab-title{font-size:36px;font-weight:500;margin:48px 0 16px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d4d4d1;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f3f3f2}
blockquote{margin:0;padding-left:16px;border-left:3px solid #d4d4d1;color:#555}pre{background:#f5f5f4;padding:12px 14px;border-radius:6px;overflow:auto}
code{font-family:Consolas,monospace;font-size:.92em}figure{margin:16px 0;width:var(--od-w,100%)}img{max-width:100%}figcaption{font-size:14px;color:#666;text-align:center}
ul[data-checklist]{list-style:none;padding-left:4px}li[data-checked]{text-decoration:line-through;color:#777}.od-chip,.od-date{padding:1px 6px;border-radius:4px;background:#efefed;font-size:.9em}
mark{background:#fbeeb8}span[data-text=red]{color:#d93a3a}span[data-text=yellow]{color:#b8860b}span[data-text=green]{color:#2e8b57}span[data-text=teal]{color:#128a80}span[data-text=purple]{color:#7b4cc2}
ins{background:#e6f4ea;text-decoration:none}del{color:#a33}hr{border:0;border-top:1px solid #d4d4d1;margin:24px 0}a{color:#1f4fd1}
</style></head><body><main><h1>${esc(doc.index.title)}</h1>${body}</main></body></html>`;
}

async function run(kind: Kind) {
  await flushTyping();
  const doc = getState().doc;
  if (!doc) return;
  const title = doc.index.title;
  try {
    let saved: string | null;
    if (kind === "pdf") saved = await api().exports.pdf(title);
    else if (kind === "md") saved = await api().exports.save(title, "md", new TextEncoder().encode(docMd(doc)));
    else if (kind === "html") saved = await api().exports.save(title, "html", new TextEncoder().encode(await htmlOf(doc)));
    else {
      const images = new Map<string, DocxImage>();
      for (const p of imagePaths(doc)) {
        const img = await loadImage(p);
        if (img) images.set(p, img);
      }
      saved = await api().exports.save(title, "docx", docxFromDoc(doc, images));
    }
    if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`);
  } catch (e) {
    toast(`Couldn’t export: ${plainError(e)}`);
  }
}

type Kind = "docx" | "pdf" | "md" | "html";

const FORMATS: ExportFormat<Kind>[] = [
  { kind: "docx", icon: "doc", name: "Word", hint: "Editable .docx document" },
  { kind: "pdf", icon: "printer", name: "PDF", hint: "For printing and sharing" },
  { kind: "md", icon: "markdown", name: "Markdown", hint: "Plain-text .md file" },
  { kind: "html", icon: "globe", name: "Web page", hint: "One .html file with images inside" },
];

/** Export: a panel under the button with each format, as the reference has it. */
export function ExportMenu() {
  const title = useDocs((s) => s.doc?.index.title ?? "");
  return <ExportButton title={title} note="Save a copy to send or print. The doc itself stays a folder on this computer." formats={FORMATS} onExport={(k) => void run(k)} />;
}
