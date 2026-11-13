// One short message at a time, bottom center; it goes after 4 s or on click.
// Any part of an app can call toast(); the app mounts <Toast /> once.

import { useEffect, useSyncExternalStore } from "react";

interface ToastState {
  text: string;
  at: number;
}

let current: ToastState | null = null;
const listeners = new Set<() => void>();

function set(next: ToastState | null) {
  current = next;
  for (const l of listeners) l();
}

export function toast(text: string) {
  set({ text, at: Date.now() });
}

export function Toast() {
  const t = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => current?.at === t.at && set(null), 4000);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status" onClick={() => set(null)}>
      {t.text}
    </div>
  );
}
