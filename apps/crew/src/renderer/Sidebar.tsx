// The sidebar on the overview and in chats. Expanded: Overview, search, "+",
// every bot with its face and status, and the group chats; its right edge
// drags to resize. Collapsed (Ctrl+B): a 64px rail of faces, with new,
// connectors, vault and settings at the bottom.

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Menu, MenuButton, type MenuEntry } from "@opendeck/shell";
import { Face } from "./Avatar.tsx";
import { DeleteBotDialog } from "./DeleteBot.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import type { PixelIconName } from "./pixelIcons.ts";
import { TeamFaces } from "./Team.tsx";
import { botOf, useCrew } from "./crew.tsx";
import { PixelField } from "./PixelField.tsx";
import type { BotSummary } from "../shared/contract.ts";

/** A bot's right-click menu: where it opens, and the row to give focus back to. */
type BotMenu = { slug: string; anchor: { x: number; y: number } | HTMLElement; row: HTMLElement };

const WIDTH_KEY = "fenna:sidebar-width";
const COLLAPSED_KEY = "fenna:sidebar-collapsed";
const MIN_WIDTH = 232;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 288;
const NARROW = 1100;
const clampWidth = (w: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));

function readWidth(): number {
  try {
    return clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** What the person chose; until they choose, a narrow window starts collapsed. */
function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSED_KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch {
    // Nothing remembered.
  }
  return window.innerWidth < NARROW;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // It just isn't remembered.
  }
}

export function Sidebar() {
  const { overview, route, go, newBot, newTeam } = useCrew();
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [width, setWidth] = useState(readWidth);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [botMenu, setBotMenu] = useState<BotMenu | null>(null);
  const [deleting, setDeleting] = useState<BotSummary | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const widthNow = useRef(width);
  widthNow.current = width;

  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    remember(COLLAPSED_KEY, next ? "1" : "0");
  };

  // Until the person chooses, the sidebar follows the window: a rail when it is narrow.
  useEffect(() => {
    const onResize = () => {
      try {
        if (localStorage.getItem(COLLAPSED_KEY) !== null) return;
      } catch {
        // Nothing remembered: follow the window.
      }
      setCollapsedState(window.innerWidth < NARROW);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        setCollapsedState((c) => {
          remember(COLLAPSED_KEY, c ? "0" : "1");
          return !c;
        });
      } else if (key === "k") {
        e.preventDefault();
        setCollapsedState(false);
        remember(COLLAPSED_KEY, "0");
        setSearching(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = q.trim().toLowerCase();
  const bots = term ? overview.bots.filter((b) => `${b.name} ${b.job}`.toLowerCase().includes(term)) : overview.bots;
  const teams = term ? overview.teams.filter((t) => `${t.name} ${t.purpose}`.toLowerCase().includes(term)) : overview.teams;
  const current = route.name === "chat" || route.name === "computer" ? route.slug : null;
  const menuBot = botMenu ? overview.bots.find((b) => b.slug === botMenu.slug) : undefined;
  const newEntries: MenuEntry[] = [
    { label: "New bot", onSelect: newBot },
    { label: "New group chat", onSelect: newTeam, disabled: overview.bots.length < 1 },
  ];

  const move = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("button.row, button.rail-btn") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => setWidth(clampWidth(ev.clientX - left));
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      remember(WIDTH_KEY, String(widthNow.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onHandleKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
    if (!step) return;
    e.preventDefault();
    const next = clampWidth(widthNow.current + step);
    setWidth(next);
    remember(WIDTH_KEY, String(next));
  };

  const toggle = (
    <button type="button" className="icon-btn" aria-label={collapsed ? "Show sidebar" : "Hide sidebar"} title={collapsed ? "Show sidebar (Ctrl+B)" : "Hide sidebar (Ctrl+B)"} onClick={() => setCollapsed(!collapsed)}>
      <PixelIcon name={collapsed ? "expand" : "collapse"} />
    </button>
  );

  const page = (name: "crew" | "connectors" | "vault" | "settings", label: string, icon: PixelIconName) => (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-current={route.name === name ? "page" : undefined} onClick={() => go({ name })}>
      <PixelIcon name={icon} />
    </button>
  );

  /** Right-click, or the menu key or Shift+F10 on a focused bot, opens its menu. */
  const menuOn = (slug: string) => ({
    onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setBotMenu({ slug, row: e.currentTarget, anchor: { x: e.clientX, y: e.clientY } });
    },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault();
      setBotMenu({ slug, row: e.currentTarget, anchor: e.currentTarget });
    },
  });

  const overlays = (
    <>
      {botMenu && menuBot && (
        <Menu
          label={menuBot.name}
          anchor={botMenu.anchor}
          onClose={() => {
            botMenu.row.focus();
            setBotMenu(null);
          }}
          entries={[
            { label: "Open chat", onSelect: () => go({ name: "chat", slug: menuBot.slug }) },
            { label: "Open computer", onSelect: () => go({ name: "computer", slug: menuBot.slug }) },
            "separator",
            { label: "Delete bot…", danger: true, onSelect: () => setDeleting(menuBot) },
          ]}
        />
      )}
      {deleting && <DeleteBotDialog bot={deleting} onClose={() => setDeleting(null)} />}
    </>
  );

  if (collapsed) {
    return (
      <aside className="sidebar rail px-host" aria-label="Crew">
        <PixelField density={3} alpha={0.3} glitch={0.04} />
        {toggle}
        {page("crew", "Overview", "overview")}
        <span className="rail-line" aria-hidden />
        <div className="rail-list" ref={list} onKeyDown={move}>
          {overview.bots.map((b) => (
            <button key={b.slug} type="button" className="rail-btn" aria-label={`${b.name}: ${b.statusLine}`} title={`${b.name}: ${b.statusLine}`} aria-current={current === b.slug ? "page" : undefined} onClick={() => go({ name: "chat", slug: b.slug })} {...menuOn(b.slug)}>
              <Face avatar={b.avatar} color={b.color} mood={b.mood} size={32} ring={current === b.slug} />
            </button>
          ))}
          {overview.teams.length > 0 && overview.bots.length > 0 && <span className="rail-line" aria-hidden />}
          {overview.teams.map((t) => (
            <button key={t.slug} type="button" className="rail-btn rail-team" aria-label={`${t.name}, group chat`} title={`${t.name}. Lead: ${botOf(overview, t.lead)?.name ?? t.lead}`} aria-current={route.name === "team" && route.slug === t.slug ? "page" : undefined} onClick={() => go({ name: "team", slug: t.slug })}>
              <TeamFaces team={t} size={24} />
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <MenuButton className="icon-btn" label="New" title="New bot or group chat" entries={newEntries}>
            <PixelIcon name="plus" />
          </MenuButton>
          {page("connectors", "Connectors", "connectors")}
          {page("vault", "Vault", "vault")}
          {page("settings", "Settings", "settings")}
        </div>
        {overlays}
      </aside>
    );
  }

  return (
    <aside className="sidebar px-host" aria-label="Crew" style={{ width: `min(${width}px, max(${MIN_WIDTH}px, 30vw))` }}>
      <PixelField density={3} alpha={0.3} glitch={0.04} />
      <div className="side-top">
        {toggle}
        <button type="button" className="row side-overview" aria-current={route.name === "crew" ? "page" : undefined} onClick={() => go({ name: "crew" })}>
          <PixelIcon name="overview" />
          <span className="ell">Overview</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Search bots"
          aria-pressed={searching}
          title="Search bots (Ctrl+K)"
          onClick={() => {
            if (searching) {
              setSearching(false);
              setQ("");
            } else {
              setSearching(true);
              requestAnimationFrame(() => input.current?.focus());
            }
          }}
        >
          <PixelIcon name="search" />
        </button>
        <MenuButton className="icon-btn" label="New" title="New bot or group chat" align="end" entries={newEntries}>
          <PixelIcon name="plus" />
        </MenuButton>
      </div>
      <button type="button" className="row side-overview side-link" aria-current={route.name === "connectors" ? "page" : undefined} onClick={() => go({ name: "connectors" })}>
        <PixelIcon name="connectors" />
        <span className="ell">Connectors</span>
      </button>
      <button type="button" className="row side-overview side-link" aria-current={route.name === "vault" ? "page" : undefined} onClick={() => go({ name: "vault" })}>
        <PixelIcon name="vault" />
        <span className="ell">Vault</span>
      </button>
      <button type="button" className="row side-overview side-link" aria-current={route.name === "settings" ? "page" : undefined} onClick={() => go({ name: "settings" })}>
        <PixelIcon name="settings" />
        <span className="ell">Settings</span>
      </button>
      {searching && (
        <input
          ref={input}
          className="field side-search"
          value={q}
          placeholder="Search bots"
          aria-label="Search bots"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearching(false);
              setQ("");
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              list.current?.querySelector<HTMLElement>("button.row")?.focus();
            }
          }}
        />
      )}
      <div className="side-list" ref={list} onKeyDown={move}>
        <div className="side-label">Bots</div>
        {bots.map((b) => (
          <button
            key={b.slug}
            type="button"
            className="row bot-row"
            aria-current={current === b.slug ? "page" : undefined}
            onClick={() => go({ name: "chat", slug: b.slug })}
            {...menuOn(b.slug)}
            title={`${b.name}: ${b.statusLine}`}
          >
            <Face avatar={b.avatar} color={b.color} mood={b.mood} size={32} />
            <span className="row-text">
              <span className="row-name ell">{b.name}</span>
              <span className={`row-sub ell${b.mood === "need" ? " need" : ""}`}>{b.statusLine}</span>
            </span>
          </button>
        ))}
        {term && !bots.length && <p className="side-none">No match.</p>}
        <div className="side-label">Group chats</div>
        {teams.map((t) => {
          const lead = botOf(overview, t.lead);
          const names = [t.lead, ...t.members.filter((m) => m !== t.lead)].map((m) => botOf(overview, m)?.name ?? m).join(", ");
          return (
            <button key={t.slug} type="button" className="row bot-row team-row" aria-current={route.name === "team" && route.slug === t.slug ? "page" : undefined} onClick={() => go({ name: "team", slug: t.slug })} title={`${t.name}. Lead: ${lead?.name ?? t.lead}`}>
              <TeamFaces team={t} size={24} />
              <span className="row-text">
                <span className="row-name ell">{t.name}</span>
                <span className="row-sub ell" title={names}>
                  {names}
                </span>
              </span>
            </button>
          );
        })}
        {!overview.teams.length && <p className="side-none">None yet.</p>}
        {term && overview.teams.length > 0 && !teams.length && <p className="side-none">No match.</p>}
      </div>
      <div className="side-drag" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0} onMouseDown={startResize} onKeyDown={onHandleKey} />
      {overlays}
    </aside>
  );
}
