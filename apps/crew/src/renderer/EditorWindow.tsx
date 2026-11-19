// A library document open in its Fenna editor (Docs, Sheets or Slides), as
// the body of a window on the bot's computer. The editor is the real one: the
// bot's edits land in it live, and the person can edit too. The window frame
// owns the title bar; this is the body only.

import { useEffect, useRef, useState } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary, LibraryItem } from "../shared/contract.ts";
import { KIND_LABEL } from "./util.ts";

export function EditorWindow({ bot, item, onTitle }: { bot: BotSummary; item: LibraryItem; onTitle(title: string): void }) {
  const view = useRef<WebviewElement>(null);
  const titled = useRef(onTitle);
  titled.current = onTitle;
  const [failed, setFailed] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wv = view.current;
    if (!wv) return;
    let live = true;
    let bound = false;
    setFailed("");
    setReady(false);
    const onReady = () => {
      if (bound) {
        if (live) setReady(true);
        return;
      }
      bound = true;
      invoke("crew:editor", bot.slug, item.path, wv.getWebContentsId())
        .then((r) => {
          if (!live) return;
          titled.current(r.title);
          return wv.loadURL(r.src);
        })
        .catch((e) => live && setFailed(errorText(e)));
    };
    wv.addEventListener("dom-ready", onReady);
    return () => {
      live = false;
      wv.removeEventListener("dom-ready", onReady);
    };
  }, [bot.slug, item.path]);

  return (
    <div className="editor-window" role="group" aria-label={KIND_LABEL[item.kind]}>
      <div className="win-bar">
        <span className="win-count">{KIND_LABEL[item.kind]}</span>
        <span className="grow" />
        <button type="button" className="btn small" onClick={() => invoke("crew:reveal", bot.slug, item.path).catch((e) => toast(errorText(e)))}>
          Show in folder
        </button>
      </div>
      {bot.running && (
        <div className="editor-note" role="status">
          <span>{bot.name} is working. The last change wins.</span>
          <button type="button" className="btn small" onClick={() => invoke("crew:stop", bot.slug).catch((e) => toast(errorText(e)))}>
            Stop {bot.name}
          </button>
        </div>
      )}
      <div className="editor-body">
        {failed ? <p className="hint ws-empty-viewer">{failed}</p> : <webview ref={view} src="about:blank" className={`editor-view${ready ? " ready" : ""}`} />}
      </div>
    </div>
  );
}
