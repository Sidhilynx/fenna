// The phone's building blocks: the header, the connection bar, the tab bar,
// sheets, list rows, empty states and the toast. Screens compose these and
// keep their own styles to a few lines.

import { useEffect, useRef, type ReactNode } from "react";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Face } from "../../crew/src/renderer/Avatar.tsx";
import { PixelIcon } from "../../crew/src/renderer/PixelIcon.tsx";
import type { PixelIconName } from "../../crew/src/renderer/pixelIcons.ts";
import type { BotSummary } from "../../crew/src/shared/contract.ts";
import { clock, when } from "../../crew/src/renderer/text.ts";
import { native } from "./bridge.ts";
import { useStore, type Tab } from "./state.tsx";

export { Face, PixelIcon };

/** A short buzz for the moments that matter: send, approve, deny, a failure. */
export function haptic(kind: "tap" | "ok" | "no" | "fail") {
  if (!native) return;
  const p = kind === "tap" ? Haptics.impact({ style: ImpactStyle.Light }) : Haptics.notification({ type: kind === "ok" ? NotificationType.Success : kind === "no" ? NotificationType.Warning : NotificationType.Error });
  void p.catch(() => {});
}

// ── Android's back button: the newest open layer handles it first ─────

const backLayers: (() => boolean)[] = [];

/** While mounted, Android's back button calls fn first (a sheet closing itself). fn returns true when it handled it. */
export function useBackLayer(fn: () => boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const layer = () => ref.current();
    backLayers.push(layer);
    return () => {
      const i = backLayers.lastIndexOf(layer);
      if (i >= 0) backLayers.splice(i, 1);
    };
  }, []);
}

/** Back from the newest layer; false when nothing took it. */
export function backFromLayers(): boolean {
  for (let i = backLayers.length - 1; i >= 0; i--) if (backLayers[i]!()) return true;
  return false;
}

// ── Header ────────────────────────────────────────────────────────────

export function Header({ title, sub, bot, back = false, actions }: { title: string; sub?: string; bot?: BotSummary | null; back?: boolean; actions?: ReactNode }) {
  const { pop } = useStore();
  return (
    <header className="m-head">
      {back && (
        <button type="button" className="m-icon-btn" aria-label="Back" onClick={pop}>
          <PixelIcon name="back" size={20} />
        </button>
      )}
      {bot && <Face avatar={bot.avatar} color={bot.color} mood={bot.mood} size={32} title={bot.name} />}
      <div className="m-head-text">
        <h1 className="m-title ell">{title}</h1>
        {sub && <p className="m-sub ell">{sub}</p>}
      </div>
      {actions && <div className="m-head-acts">{actions}</div>}
    </header>
  );
}

export function IconButton({ icon, label, onClick, disabled, pressed }: { icon: PixelIconName; label: string; onClick(): void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className="m-icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      <PixelIcon name={icon} size={20} />
    </button>
  );
}

// ── The connection, in one place ──────────────────────────────────────

function since(ms: number | null): string {
  if (!ms) return "";
  const iso = new Date(ms).toISOString();
  const day = when(iso);
  return day.startsWith("Today") ? ` since ${clock(iso)}` : ` since ${day} ${clock(iso)}`;
}

/** What the link is doing, when it isn't simply up. Nothing when all is well. */
export function ConnBar() {
  const { link, stale } = useStore();
  if (!link.paired || link.ready) return null;
  const away = link.computer === "offline";
  const text = away ? `${link.computerName || "Your computer"} is asleep or Crew is closed${since(link.offlineSince)}.${stale ? " What you see may be out of date." : ""}` : "Connecting…";
  return (
    <div className="m-conn" role="status">
      <span className={away ? "m-conn-dot off" : "m-conn-dot"} aria-hidden="true" />
      <span className="grow">{text}</span>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: PixelIconName }[] = [
  { id: "crew", label: "Crew", icon: "bots" },
  { id: "inbox", label: "Inbox", icon: "bell" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function TabBar() {
  const { tab, setTab, overview } = useStore();
  const waiting = (overview?.waiting.length ?? 0) + (overview?.offers.length ?? 0);
  return (
    <nav className="m-tabs" aria-label="Sections">
      {TABS.map((t) => (
        <button key={t.id} type="button" className="m-tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
          <span className="m-tab-icon">
            <PixelIcon name={t.icon} size={20} />
            {t.id === "inbox" && waiting > 0 && <span className="m-badge">{waiting > 99 ? "99+" : waiting}</span>}
          </span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── Sheets ────────────────────────────────────────────────────────────

/** A panel that rises from the bottom over a scrim. Back, the scrim and Close close it. */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose(): void; children: ReactNode; actions?: ReactNode }) {
  useBackLayer(() => {
    onClose();
    return true;
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="m-sheet-wrap">
      <button type="button" className="m-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="m-sheet px-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="m-sheet-head">
          <h2 className="m-sheet-title ell">{title}</h2>
          <button type="button" className="m-icon-btn" aria-label="Close" onClick={onClose}>
            <PixelIcon name="close" size={16} />
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
        {actions && <div className="m-sheet-acts">{actions}</div>}
      </div>
    </div>
  );
}

// ── Lists ─────────────────────────────────────────────────────────────

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="m-section">
      {(title || action) && (
        <div className="m-section-head">
          {title && <h2 className="m-section-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ lead, title, sub, right, onClick, danger, chevron = !!onClick }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; danger?: boolean; chevron?: boolean }) {
  const body = (
    <>
      {lead && <span className="m-row-lead">{lead}</span>}
      <span className="m-row-text">
        <span className={danger ? "m-row-title danger ell" : "m-row-title ell"}>{title}</span>
        {sub && <span className="m-row-sub">{sub}</span>}
      </span>
      {right && <span className="m-row-right">{right}</span>}
      {chevron && <PixelIcon name="chevron-right" size={16} />}
    </>
  );
  return onClick ? (
    <button type="button" className="m-row" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="m-row">{body}</div>
  );
}

export function Empty({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="m-empty">
      <p className="m-empty-title">{title}</p>
      {sub && <p className="m-empty-sub">{sub}</p>}
      {children}
    </div>
  );
}

/** Three pixel blocks stepping, for "waiting on the computer". Still under reduced motion. */
export function Working({ label }: { label: string }) {
  return (
    <span className="m-working" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Toast() {
  const { toastText } = useStore();
  if (!toastText) return null;
  return (
    <div className="m-toast toast" role="status" aria-live="polite">
      {toastText}
    </div>
  );
}
