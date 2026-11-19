// Embedded mode: the page is shown inside Fenna Crew (its URL ends with
// #embed). The editor then shows only its document and its comments go to
// the bot that owns the document, not to a CLI assistant.
//
// The mode is decided once, when the page loads, and kept for the page's
// life: an editor may rewrite its hash later (tabs, slides), and the page
// must not lose its mode then. The session flag keeps it across a reload
// whose hash lost the marker. Storage can be blocked, so it is wrapped.

import { useEffect, useState } from "react";
import { bridge } from "./bridge.ts";

export const EMBED_FLAG = "fenna:embed";
const EMBED_HASH = /(^#|&)embed(&|$)/;

/** Decide once from the hash and the session flag; later calls return the same answer. */
export function createEmbedCheck(readHash: () => string, storage: Pick<Storage, "getItem" | "setItem"> | null): () => boolean {
  let decided: boolean | null = null;
  return () => {
    if (decided !== null) return decided;
    const fromHash = EMBED_HASH.test(readHash());
    let flagged = false;
    try {
      flagged = storage?.getItem(EMBED_FLAG) === "1";
    } catch {
      flagged = false;
    }
    if (fromHash) {
      try {
        storage?.setItem(EMBED_FLAG, "1");
      } catch {
        // Without storage the hash at load still decides; a reload may lose the mode.
      }
    }
    decided = fromHash || flagged;
    return decided;
  };
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

const EMBEDDED = createEmbedCheck(() => (typeof location === "undefined" ? "" : location.hash), sessionStore())();

/** True when the page is loaded inside Fenna Crew: the editor shows only its document. Fixed at load. */
export function isEmbedded(): boolean {
  return EMBEDDED;
}

let botName: Promise<string> | null = null;

/** The name of the bot that owns the document this page shows ("the bot" if the host can't say). */
export function embedBotName(): Promise<string> {
  botName ??= bridge()
    .invoke<{ bot?: unknown }>("embed:host")
    .then((r) => (typeof r?.bot === "string" && r.bot.trim() ? r.bot.trim() : "the bot"))
    .catch(() => "the bot");
  return botName;
}

/** The embedded page's bot name, or "the bot" until it is known. */
export function useEmbedBotName(): string {
  const [name, setName] = useState("the bot");
  useEffect(() => {
    if (!isEmbedded()) return;
    let live = true;
    void embedBotName().then((n) => live && setName(n));
    return () => {
      live = false;
    };
  }, []);
  return name;
}

/** Ask the bot about a comment. The host adds the answer to the thread; rejects if the host refuses. */
export function askEmbedBot(comment: { thread: string; text: string; quote?: string }): Promise<void> {
  return bridge().invoke<void>("embed:comment", comment);
}
