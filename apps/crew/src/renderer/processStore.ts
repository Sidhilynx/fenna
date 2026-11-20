// The commands of every bot on this computer, kept live for the windows that
// show them (Processes, Console, the port notice and the Projects panel). One
// listener to the main process serves them all; a bot's list is loaded when a
// view first asks for it, and its output is kept while the app runs.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { ProcessInfo } from "../shared/contract.ts";
import { EMPTY_BUF, appendOutput, seedOutput, upsertProcess, type OutBuf } from "./processModel.ts";

export interface BotProcesses {
  /** Newest first. null until the first answer. */
  list: ProcessInfo[] | null;
  error: string;
  /** Output per command id. */
  out: Record<string, OutBuf>;
}

const EMPTY: BotProcesses = { list: null, error: "", out: {} };
const states = new Map<string, BotProcesses>();
const listeners = new Set<() => void>();
let listening = false;

function update(slug: string, next: (s: BotProcesses) => BotProcesses): void {
  states.set(slug, next(states.get(slug) ?? EMPTY));
  for (const l of listeners) l();
}

function listen(): void {
  if (listening) return;
  listening = true;
  on("crew:process", ({ slug, info }) => {
    update(slug, (s) => {
      const out = s.out[info.id] ? s.out : { ...s.out, [info.id]: seedOutput(info.tail) };
      return { ...s, list: upsertProcess(s.list ?? [], info), out };
    });
  });
  on("crew:processOutput", ({ slug, id, stream, text }) => {
    update(slug, (s) => ({ ...s, out: { ...s.out, [id]: appendOutput(s.out[id] ?? EMPTY_BUF, stream, text) } }));
  });
}

/** Asks the main process for a bot's commands and keeps what it says. */
export function loadProcesses(slug: string): void {
  listen();
  invoke("crew:processes", slug).then(
    (list) =>
      update(slug, (s) => {
        const out = { ...s.out };
        for (const p of list) if (!out[p.id]) out[p.id] = seedOutput(p.tail);
        return { ...s, list: list.reduce(upsertProcess, [] as ProcessInfo[]), error: "", out };
      }),
    (e) => update(slug, (s) => ({ ...s, error: errorText(e) })),
  );
}

/** Stops a running command; the list is replaced by what the main process returns. */
export function stopProcess(slug: string, id: string): void {
  invoke("crew:stopProcess", slug, id).then(
    (list) => update(slug, (s) => ({ ...s, list })),
    (e) => toast(errorText(e)),
  );
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A bot's commands and their output, live. Loads the list on first use and again when the bot changes. */
export function useBotProcesses(slug: string): BotProcesses {
  useEffect(() => {
    loadProcesses(slug);
  }, [slug]);
  return useSyncExternalStore(subscribe, () => states.get(slug) ?? EMPTY);
}
