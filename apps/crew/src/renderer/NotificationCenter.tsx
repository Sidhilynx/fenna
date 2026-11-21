// The bot's notification center, in the taskbar tray: a bell with the count of
// notices the person has not seen, and a panel above the taskbar with what the
// bot's computer told them (site notifications, downloads, ended runs, fired
// watches, reminders). Opening the panel marks everything read.

import { useEffect, useRef, useState } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, Notice, NoticeState } from "../shared/contract.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import type { PixelIconName } from "./pixelIcons.ts";
import { clock, when } from "./util.ts";

const KIND_ICON: Record<Notice["kind"], PixelIconName> = { site: "site", download: "download", run: "run", watch: "eye", reminder: "clock", account: "lock" };

/** Whether an ISO time falls on the same local day as `now`. */
export function isToday(iso: string, now: Date): boolean {
  const at = new Date(iso);
  return !Number.isNaN(at.getTime()) && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
}

/** Notices from today and from before, each in the order given (newest first). */
export function groupNotices(items: readonly Notice[], now: Date): { today: Notice[]; earlier: Notice[] } {
  const today: Notice[] = [];
  const earlier: Notice[] = [];
  for (const n of items) (isToday(n.at, now) ? today : earlier).push(n);
  return { today, earlier };
}

// One request per site per session, shared by every notice from it.
const iconCache = new Map<string, Promise<string | null>>();
function siteIcon(origin: string): Promise<string | null> {
  let icon = iconCache.get(origin);
  if (!icon) {
    icon = invoke("crew:siteIcon", origin).catch(() => null);
    iconCache.set(origin, icon);
  }
  return icon;
}

/** A site's favicon, or the site glyph while it loads or when the site has none. */
function NoticeIcon({ notice }: { notice: Notice }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (notice.kind === "site" && notice.origin) {
      void siteIcon(notice.origin).then((s) => {
        if (alive) setSrc(s);
      });
    }
    return () => {
      alive = false;
    };
  }, [notice.kind, notice.origin]);
  if (src) return <img className="notice-favicon" src={src} alt="" width={16} height={16} />;
  return <PixelIcon name={KIND_ICON[notice.kind]} size={16} />;
}

function NoticeRow({ notice, now }: { notice: Notice; now: Date }) {
  return (
    <li className="notice-row">
      <span className="notice-icon">
        <NoticeIcon notice={notice} />
      </span>
      <span className="notice-text">
        <span className="notice-title">{notice.title}</span>
        {notice.body && <span className="notice-body">{notice.body}</span>}
      </span>
      <time className="notice-time" dateTime={notice.at}>
        {isToday(notice.at, now) ? clock(notice.at) : when(notice.at)}
      </time>
    </li>
  );
}

function NoticeGroup({ title, items, now }: { title: string; items: Notice[]; now: Date }) {
  if (!items.length) return null;
  return (
    <section className="notice-group">
      <h3 className="notice-group-title">{title}</h3>
      <ul className="notice-list">
        {items.map((n) => (
          <NoticeRow key={n.id} notice={n} now={now} />
        ))}
      </ul>
    </section>
  );
}

export function NotificationBell({ bot }: { bot: BotSummary }) {
  const [state, setState] = useState<NoticeState | null>(null);
  const [open, setOpen] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const now = new Date();

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke("crew:notices", bot.slug).then(
        (s) => {
          if (alive) setState(s);
        },
        () => {
          if (alive) setState({ items: [], unread: 0 });
        },
      );
    setState(null);
    setOpen(false);
    void load();
    const off = on("crew:notices", (ev) => {
      if (ev.slug === bot.slug) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [bot.slug]);

  // While the panel is open: Escape closes it from anywhere, a press outside closes it.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (trayRef.current && !trayRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      bellRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = state?.unread ?? 0;
  const total = state?.items.length ?? 0;

  function toggle() {
    if (open) {
      setOpen(false);
      bellRef.current?.focus();
      return;
    }
    setOpen(true);
    invoke("crew:readNotices", bot.slug).then(setState, (e) => toast(errorText(e)));
  }

  function clearAll() {
    invoke("crew:clearNotices", bot.slug).then(setState, (e) => toast(errorText(e)));
  }

  const { today, earlier } = groupNotices(state?.items ?? [], now);

  return (
    <div className="notice-tray" ref={trayRef}>
      <button
        ref={bellRef}
        type="button"
        className={`task notice-bell${open ? " active" : ""}`}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        onClick={toggle}
      >
        <PixelIcon name="bell" size={16} />
        {unread > 0 && <span className="notice-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div ref={panelRef} className="notice-panel" role="dialog" aria-label="Notifications" tabIndex={-1}>
          <div className="notice-head">
            <span className="notice-head-title">Notifications</span>
            <button type="button" className="btn ghost small" onClick={clearAll} disabled={total === 0}>
              Clear all
            </button>
          </div>
          {total === 0 ? (
            <p className="notice-empty">Nothing yet.</p>
          ) : (
            <div className="notice-scroll">
              <NoticeGroup title="Today" items={today} now={now} />
              <NoticeGroup title="Earlier" items={earlier} now={now} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
