// A bot's library: the Fenna documents it makes, one folder each, under
// <bot>/library/. New ones are made here with the format packages' own
// starters, so they open in Fenna Docs, Sheets and Slides like any other.

import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FENNA_APPS, LIMITS, slugify, type LibraryKind } from "@opendeck/crew";
import { indexText as docIndexText, newDocFiles, sanitizeBlocks, serializeTab, tabFile } from "@opendeck/doc";
import { indexText as sheetIndexText, newWorkbookFiles, sheetFile } from "@opendeck/sheet";
import { newDeckFiles } from "@opendeck/format";

export const LIBRARY_KINDS = FENNA_APPS.map((a) => a.kind) as LibraryKind[];

/** Write a new document folder all at once: built beside, then renamed into place. */
async function writeFolder(root: string, name: string, files: Record<string, string>) {
  const tmp = path.join(root, `.${name}.${process.pid}.tmp`);
  await rm(tmp, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(tmp, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  await rename(tmp, path.join(root, name));
}

export async function newDocument(root: string, kind: LibraryKind, title: string, html?: string): Promise<{ path: string; text: string }> {
  const t = title.trim();
  if (!t) throw new Error("Give the document a title, like \"Pricing check\".");
  if (t.length > 200) throw new Error(`The title is ${t.length} characters; the most is 200.`);
  await mkdir(root, { recursive: true });
  const taken = new Set((await readdir(root)).map((n) => n.toLowerCase()));
  let name = slugify(t).slice(0, LIMITS.name);
  for (let n = 2; taken.has(name); n++) name = `${slugify(t).slice(0, LIMITS.name - 3)}-${n}`;

  if (kind === "doc") {
    const { index, tabs } = newDocFiles(t);
    const files: Record<string, string> = { "doc.json": docIndexText(index) };
    for (const [id, src] of Object.entries(tabs)) files[tabFile(id)] = src;
    let wrote = "one empty tab, tab-1";
    if (html && html.trim()) {
      const blocks = sanitizeBlocks(html);
      if (!blocks.length) throw new Error("The html had no blocks a doc can hold. Use <h1>, <h2>, <p>, <ul><li>, <ol><li>, <table> and similar.");
      files[tabFile("tab-1")] = serializeTab({ type: "element", tag: "article", attrs: { id: "tab-1" }, children: blocks });
      wrote = `tab-1 with ${blocks.length} block${blocks.length === 1 ? "" : "s"}`;
    }
    await writeFolder(root, name, files);
    return {
      path: name,
      text: `Created the doc "${t}" at path "${name}" (${wrote}). To change it, use the fenna tools with path "${name}": read_tab {path: "${name}", id: "tab-1"}, then write_tab or edit_blocks.`,
    };
  }
  if (html) throw new Error("html is only for docs. Create the sheet or deck, then fill it with the fenna tools.");
  if (kind === "sheet") {
    const { index, sheets } = newWorkbookFiles(t);
    const files: Record<string, string> = { "sheet.json": sheetIndexText(index) };
    for (const [id, src] of Object.entries(sheets)) files[sheetFile(id)] = src;
    await writeFolder(root, name, files);
    return { path: name, text: `Created the sheet "${t}" at path "${name}" with one empty sheet, sheet-1. Fill it with write_cells {path: "${name}", …}.` };
  }
  const { index, slides } = newDeckFiles(t);
  const files: Record<string, string> = { "deck.json": JSON.stringify(index, null, 2) + "\n" };
  for (const [id, src] of Object.entries(slides)) files[`slides/${id}.html`] = src;
  await writeFolder(root, name, files);
  return { path: name, text: `Created the deck "${t}" at path "${name}" with a cover slide. Read it with read_slides {path: "${name}"}; add slides with write_slide.` };
}
