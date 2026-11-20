// One of a bot's own apps (Files/Apps/<name>/) as a window on its computer. Until
// the person allows what the app asks for, the window is the install card; after
// that the app runs in a webview of its own partition. Also the hook that keeps a
// bot's app list live, for the desktop, the window and the Details panel.

import { useEffect, useRef, useState } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { AppInfo, BotSummary } from "../shared/contract.ts";
import { permissionLines, waitsForYou } from "./userApps.ts";

/** A bot's apps, kept live. `apps` is null until the first answer. */
export function useApps(slug: string): { apps: AppInfo[] | null; error: string } {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setApps(null);
    setError("");
    const load = () =>
      invoke("crew:apps", slug).then(
        (list) => {
          if (live) setApps(list);
        },
        (e) => {
          if (live) setError(errorText(e));
        },
      );
    void load();
    const off = on("crew:apps", (p) => {
      if (p.slug === slug) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [slug]);

  return { apps, error };
}

/** The current time, refreshed every minute, for the rules that look back over a few minutes. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function Problems({ problems }: { problems: string[] }) {
  return (
    <div className="userapp-body-pad">
      <p className="userapp-lead">The app's app.json needs fixing:</p>
      <ul className="userapp-list">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function InstallCard({ bot, info, onClose, onAllowed }: { bot: BotSummary; info: AppInfo; onClose(): void; onAllowed(): void }) {
  const [busy, setBusy] = useState(false);
  const lines = permissionLines(info.permissions, bot.name, info.tools);
  const allow = () => {
    setBusy(true);
    invoke("crew:appGrant", bot.slug, info.name, info.permissions).then(
      () => {
        setBusy(false);
        onAllowed();
      },
      (e) => {
        setBusy(false);
        toast(errorText(e));
      },
    );
  };
  return (
    <div className="userapp-body-pad">
      <section className="userapp-card px-panel" aria-label={`Allow ${info.title}`}>
        <h2 className="userapp-title">{info.title}</h2>
        {info.description && <p className="userapp-desc">{info.description}</p>}
        {info.pending && <p className="userapp-lead">It asks for more than you allowed. It runs with what you allowed before until you allow this.</p>}
        <p className="userapp-lead">It asks for:</p>
        <ul className="userapp-list">
          {lines.length ? lines.map((l) => <li key={l}>{l}</li>) : <li>Nothing outside its own folder.</li>}
        </ul>
        <div className="userapp-acts">
          <button type="button" className="btn small" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn small primary" onClick={allow} disabled={busy} aria-busy={busy}>
            Allow
          </button>
        </div>
      </section>
    </div>
  );
}

/** The app itself. It reloads when its files change; the Reload bar says so. */
function AppView({ bot, info }: { bot: BotSummary; info: AppInfo }) {
  const view = useRef<WebviewElement>(null);
  const loadedAt = useRef(info.updatedAt);
  const [nonce, setNonce] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const partition = `crewapp-${bot.slug}-${info.name}`;
  const src = `crewapp://${bot.slug}/${info.name}/${info.entry}`;
  const updated = info.updatedAt !== loadedAt.current;

  useEffect(() => {
    const wv = view.current;
    if (!wv) return;
    setReady(false);
    setFailed(false);
    const onReady = () => setReady(true);
    const onFail = (e: Event) => {
      if ((e as Event & { isMainFrame?: boolean }).isMainFrame !== false) setFailed(true);
    };
    wv.addEventListener("dom-ready", onReady);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      wv.removeEventListener("dom-ready", onReady);
      wv.removeEventListener("did-fail-load", onFail);
    };
  }, [nonce]);

  const reload = () => {
    loadedAt.current = info.updatedAt;
    setNonce((n) => n + 1);
  };

  return (
    <div className="userapp-view">
      <div className="win-bar">
        {updated && (
          <span className="userapp-note" role="status">
            Updated by {bot.name}.
          </span>
        )}
        <span className="grow" />
        <button type="button" className={`btn small${updated ? " primary" : ""}`} onClick={reload}>
          Reload
        </button>
      </div>
      <div className="userapp-frame">
        {failed ? (
          <p className="hint userapp-pad">The app did not load. Check its entry file in app.json.</p>
        ) : (
          <webview key={nonce} ref={view} partition={partition} src={src} className={`userapp-web${ready ? " ready" : ""}`} />
        )}
      </div>
    </div>
  );
}

/**
 * The app's window body: its problems, the install card while it waits for the person (or with `review`,
 * whenever the person asks to see what it asks for), or the app.
 */
export function UserApp({
  bot,
  name,
  apps,
  review,
  onClose,
  onTitle,
}: {
  bot: BotSummary;
  name: string;
  apps: AppInfo[] | null;
  review: boolean;
  onClose(): void;
  /** Sets the window's title to the app's own. */
  onTitle(title: string): void;
}) {
  const [card, setCard] = useState(review);
  const titled = useRef(onTitle);
  titled.current = onTitle;
  const info = apps?.find((a) => a.name === name);
  const title = info?.title;
  useEffect(() => setCard(review), [review]);
  useEffect(() => {
    if (title) titled.current(title);
  }, [title]);
  if (!apps) return <p className="hint userapp-pad">Loading</p>;
  if (!info) return <p className="hint userapp-pad">That app is no longer on this computer.</p>;
  if (info.problems.length) return <Problems problems={info.problems} />;
  if (card || waitsForYou(info)) return <InstallCard bot={bot} info={info} onClose={onClose} onAllowed={() => setCard(false)} />;
  return <AppView bot={bot} info={info} />;
}
