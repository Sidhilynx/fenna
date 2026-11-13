// The page: the tab's title, then its blocks in an editable <article>, with
// the margin (comments, suggestions) beside it, the AI's mark beside the
// line under the pointer, the "@" menu and the AI box on a line. The article's contents belong to page.ts, not React:
// React draws the frame, page.ts draws and reads the text.

import { useEffect, useLayoutEffect, useRef } from "react";
import { findTab } from "@opendeck/doc";
import { AtMenu } from "./panels/AtMenu.tsx";
import { useAssistant } from "./panels/assistant.tsx";
import { BlockHandle } from "./panels/BlockHandle.tsx";
import { ChipMenus } from "./panels/ChipMenus.tsx";
import { InlineAsk, openInlineAsk } from "./panels/InlineAsk.tsx";
import { Margin } from "./panels/Margin.tsx";
import { SelectionBar } from "./panels/SelectionBar.tsx";
import { caretInto } from "./editor/caret.ts";
import { changed, mountPage, paint, setBlockInserter, setImageInserter, setKeyCommands } from "./editor/page.ts";
import { insertImagesAt, insertPasted, setStyle, toggleCode, toggleList } from "./editor/commands.ts";
import { newComment } from "./editor/comments.ts";
import { openLinkDialog } from "./panels/LinkDialog.tsx";
import { currentTab, getState, renameTab, useDocs } from "./store.ts";

export function Page() {
  const ai = useAssistant();
  const article = useRef<HTMLElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const tab = useDocs((s) => s.tab);
  const paintN = useDocs((s) => s.paint);
  const fonts = useDocs((s) => s.doc?.index.fonts);
  const wide = useDocs((s) => s.doc?.index.wide ?? false);
  const flash = useDocs((s) => s.flash);
  const titleText = useDocs((s) => (s.doc && s.tab ? (findTab(s.doc.index.tabs, s.tab)?.title ?? "") : ""));
  const problems = useDocs((s) => currentTab(s)?.diagnostics.filter((d) => d.severity === "error") ?? []);

  // Mounted before the first paint below, so the page has somewhere to draw.
  useLayoutEffect(() => {
    if (!article.current) return;
    setKeyCommands({ style: setStyle, list: toggleList, link: openLinkDialog, code: toggleCode, comment: () => newComment() });
    setImageInserter(insertImagesAt);
    setBlockInserter(insertPasted);
    return mountPage(article.current);
  }, []);

  // Draw the tab from its file when it changes for a reason other than typing.
  useLayoutEffect(() => {
    const s = getState();
    paint(currentTab(s)?.tab ?? null, s.caret);
    if (title.current && document.activeElement !== title.current) title.current.textContent = s.tab ? tabTitle(s.tab) : "";
  }, [tab, paintN]);

  // A rename from elsewhere (the tab list, the AI) shows in the title unless it's being typed in.
  useEffect(() => {
    if (title.current && document.activeElement !== title.current && title.current.textContent !== titleText) title.current.textContent = titleText;
  }, [titleText]);

  // Blocks the AI just changed light up briefly; while it works, the page follows them.
  useEffect(() => {
    if (!flash || flash.tab !== tab || !article.current) return;
    const els = flash.blocks.map((id) => article.current!.querySelector<HTMLElement>(`:scope > [id="${CSS.escape(id)}"]`)).filter((e): e is HTMLElement => !!e);
    for (const e of els) {
      e.classList.remove("od-flash");
      void e.offsetWidth;
      e.classList.add("od-flash");
    }
    if (getState().agent && els[0]) els[0].scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const t = setTimeout(() => els.forEach((e) => e.classList.remove("od-flash")), 1600);
    return () => clearTimeout(t);
  }, [flash, tab]);

  const saveTitle = () => {
    const t = getState().tab;
    if (t && title.current) void renameTab(t, title.current.textContent ?? "");
  };

  // A click in the page column but off the text (the side margins, the gap under the title, below the last
  // line) puts the caret in the nearest text, so the whole column is one place to write.
  const onPaperDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const a = article.current;
    if (e.button !== 0 || !a || t.closest(".dp-body, .dp-title, button, a, input, textarea, [role='dialog'], .dp-margin")) return;
    const ar = a.getBoundingClientRect();
    if (e.clientY < ar.top - 8 && title.current) {
      e.preventDefault();
      title.current.focus();
      caretInto(title.current, true);
      return;
    }
    e.preventDefault();
    const x = Math.min(Math.max(e.clientX, ar.left + 1), ar.right - 1);
    const y = Math.min(Math.max(e.clientY, ar.top + 1), ar.bottom - 1);
    const pos = document.caretPositionFromPoint(x, y);
    a.focus({ preventScroll: true });
    if (!pos || !a.contains(pos.offsetNode)) return;
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  // "@Claude" in the empty page's hint: the AI box on the first line.
  const askOnFirstLine = async () => {
    const a = article.current;
    const first = a?.firstElementChild as HTMLElement | null;
    if (!a || !first) return;
    a.focus({ preventScroll: true });
    caretInto(first);
    if (!first.id) await changed();
    const id = (a.firstElementChild as HTMLElement | null)?.id;
    if (id) openInlineAsk(id);
  };

  return (
    <div onMouseDown={onPaperDown} className={`dp-paper${wide ? " wide" : ""} head-${fonts?.headings ?? "serif"} text-${fonts?.text ?? "sans"}`}>
      {problems.length > 0 && <div className="dp-problem" role="status">This tab has a problem in its file: {problems[0]!.message}. Editing it saves a corrected version.</div>}
      <div
        ref={title}
        className="dp-title"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-label="Tab title"
        data-placeholder="Title"
        spellCheck
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveTitle();
            article.current?.focus();
          }
          if (e.key === "Escape") title.current?.blur();
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " "));
        }}
      />
      <div className="dp-body-wrap">
        <article ref={article} className="dp-body" contentEditable suppressContentEditableWarning spellCheck aria-label="Doc text" aria-describedby="dp-hint" />
        <div id="dp-hint" className="dp-hint">
          Start typing, or ask{" "}
          <button className="dp-hint-ai" onMouseDown={(e) => e.preventDefault()} onClick={() => void askOnFirstLine()}>
            @{ai.name}
          </button>{" "}
          to write
        </div>
        <InlineAsk />
        <BlockHandle />
        <Margin />
      </div>
      <ChipMenus />
      <AtMenu />
      <SelectionBar />
    </div>
  );
}

/** The tab's own title; an unnamed tab shows the "Title" placeholder on the page, not its "Tab 3" label. */
function tabTitle(id: string): string {
  const doc = getState().doc;
  return doc ? (findTab(doc.index.tabs, id)?.title ?? "") : "";
}
