// Comment threads on slides. Threads themselves (comments.json, the store,
// the card) are the shell's; the anchor (a slide id, an element address and
// a snippet of its text) is the format's, shared with the MCP server so a
// thread an AI starts lands where a person's would.

import { type SlideAnchor, slideAnchor } from "@opendeck/format";
import { type Thread as ShellThread, parseThreads, serializeThreads } from "@opendeck/shell";

export { type SlideAnchor, anchorOf, slideAnchor, snippetOf } from "@opendeck/format";

export type Thread = ShellThread<SlideAnchor>;

export const parseComments = (text: string | null): Thread[] => parseThreads(text, slideAnchor);
export const serializeComments = serializeThreads;
