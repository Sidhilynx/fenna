import { CLI_NAMES, type Bot } from "@opendeck/crew";
import { modelText } from "@opendeck/shell";

export * from "./text.ts";

/** "Claude Code · sonnet · high": the brain as one line. */
export function brainLabel(b: Bot["brain"]): string {
  return [CLI_NAMES[b.cli], b.model && modelText(b.model), b.effort].filter(Boolean).join(" · ");
}
