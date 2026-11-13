// The page's side of the shell's preload (../main/preload.cjs): named
// messages to the main process. Apps build their own typed API on it; the
// shell's own parts (tabs, the assistant) are typed here.

export interface ShellBridge {
  platform: string;
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on<T = unknown>(channel: string, fn: (payload: T) => void): () => void;
}

declare global {
  interface Window {
    shell: ShellBridge;
  }
}

export const bridge = (): ShellBridge => window.shell;

/** What a page tells its tab in the window's strip. */
export const tabs = {
  meta: (meta: { title: string }) => bridge().send("tabs:meta", meta),
  activity: (activity: { working: boolean; label?: string }) => bridge().send("tabs:activity", activity),
};

/** The computer's account name, for a greeting ("" if unknown). */
export const userName = (): Promise<string> => bridge().invoke<string>("shell:userName");

/** A newer release of this app on GitHub, and opening its download in the browser. */
export const updates = {
  latest: (): Promise<{ version: string } | null> => bridge().invoke<{ version: string } | null>("shell:update"),
  open: (): Promise<void> => bridge().invoke<void>("shell:openUpdate"),
};
