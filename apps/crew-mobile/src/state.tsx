// The app's state: the link to the computer, the crew as last seen (kept so
// the screens stay readable while the computer is away), where the person
// is in the app, and short messages.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LinkState } from "@opendeck/crew-link/phone";
import { errorText, invoke, on } from "../../crew/src/shared/api.ts";
import type { BotSummary, Overview } from "../../crew/src/shared/contract.ts";
import { linkState, onLinkState, onOpened, onResync } from "./bridge.ts";

export type Tab = "crew" | "inbox" | "settings";
export type Route =
  | { name: "tabs" }
  | { name: "chat"; slug: string }
  | { name: "group"; slug: string }
  | { name: "details"; slug: string }
  | { name: "screen"; slug: string }
  | { name: "newbot" }
  | { name: "newgroup" }
  | { name: "connectors" }
  | { name: "skills" }
  | { name: "logins" }
  | { name: "usage" };

interface Store {
  link: LinkState;
  /** The crew as last seen; null before the first load. */
  overview: Overview | null;
  /** The overview is from before the computer went away. */
  stale: boolean;
  bot(slug: string): BotSummary | null;
  reload(): void;
  /** Goes up when what the phone shows may be out of date (the computer restarted, events were missed): views that load once remount on it. */
  gen: number;
  tab: Tab;
  setTab(t: Tab): void;
  stack: Route[];
  push(r: Route): void;
  pop(): void;
  /** Back to the tabs, on this tab. */
  home(t?: Tab): void;
  toast(text: string): void;
  toastText: string | null;
}

const Ctx = createContext<Store | null>(null);
const CACHE = "crew.overview";

function cached(): Overview | null {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as Overview) : null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [link, setLink] = useState<LinkState>(linkState());
  const [overview, setOverview] = useState<Overview | null>(cached);
  const [fresh, setFresh] = useState(false);
  const [gen, setGen] = useState(0);
  const [tab, setTab] = useState<Tab>("crew");
  const [stack, setStack] = useState<Route[]>([{ name: "tabs" }]);
  const [toastText, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const keep = useCallback((o: Overview) => {
    setOverview(o);
    setFresh(true);
    try {
      localStorage.setItem(CACHE, JSON.stringify(o));
    } catch {
      /* a full or blocked storage only loses the offline copy */
    }
  }, []);

  const reload = useCallback(() => {
    invoke("crew:overview").then(keep, () => {});
  }, [keep]);

  useEffect(() => onLinkState(setLink), []);
  useEffect(() => on("crew:changed", keep), [keep]);
  useEffect(
    () =>
      onResync(() => {
        reload();
        setGen((g) => g + 1);
      }),
    [reload],
  );
  useEffect(() => {
    if (link.ready) reload();
    else setFresh(false);
  }, [link.ready, reload]);
  useEffect(() => {
    if (!link.paired) {
      setStack([{ name: "tabs" }]);
      setTab("crew");
      try {
        localStorage.removeItem(CACHE);
      } catch {
        /* nothing kept */
      }
      if (link.problem === null) setOverview(null);
    }
  }, [link.paired, link.problem]);
  useEffect(
    () =>
      onOpened((o) => {
        setTab("inbox");
        setStack([{ name: "tabs" }, { name: "chat", slug: o.slug }]);
      }),
    [],
  );

  const value = useMemo<Store>(
    () => ({
      link,
      overview,
      stale: !fresh,
      bot: (slug) => overview?.bots.find((b) => b.slug === slug) ?? null,
      reload,
      gen,
      tab,
      setTab: (t) => {
        setTab(t);
        setStack([{ name: "tabs" }]);
      },
      stack,
      push: (r) => setStack((s) => [...s, r]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      home: (t) => {
        if (t) setTab(t);
        setStack([{ name: "tabs" }]);
      },
      toast,
      toastText,
    }),
    [link, overview, fresh, reload, gen, tab, stack, toast, toastText],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Runs a call, showing its error as a toast; resolves with its result or null. */
export function useAct() {
  const { toast } = useStore();
  return useCallback(
    async <T,>(p: Promise<T>): Promise<T | null> => {
      try {
        return await p;
      } catch (e) {
        toast(errorText(e));
        return null;
      }
    },
    [toast],
  );
}
