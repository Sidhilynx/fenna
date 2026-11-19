// A typed door to the main process for the page, over the shell's preload.

import type { Calls, Events, Sends } from "./contract.ts";

interface ShellBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, fn: (payload: unknown) => void): () => void;
}

const bridge = (): ShellBridge => (window as unknown as { shell: ShellBridge }).shell;

/** Call the main process. Rejects with the main process's message. */
export function invoke<C extends keyof Calls>(channel: C, ...args: Calls[C]["args"]): Promise<Calls[C]["result"]> {
  return bridge().invoke(channel, ...args) as Promise<Calls[C]["result"]>;
}

/** Listen to an event; returns a function that stops listening. */
export function on<E extends keyof Events>(channel: E, fn: (payload: Events[E]) => void): () => void {
  return bridge().on(channel, fn as (p: unknown) => void);
}

export function send<S extends keyof Sends>(channel: S, ...args: Sends[S]): void {
  bridge().send(channel, ...args);
}

/** An invoke error's own words, without Electron's "Error invoking remote method" wrapper. */
export function errorText(e: unknown): string {
  return String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
