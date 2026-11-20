// The bot's own apps (Files/Apps/<name>/) as the person sees them: the lines
// that say what an app asks for, when its icon shows a dot, and where its icon
// goes on the desktop. All pure; the components only draw what these return.

import type { AppGrant, AppInfo, AppToolDef, DesktopShortcut } from "../shared/contract.ts";
import { SHORTCUT_LABEL_MAX } from "../shared/contract.ts";
import { FILE_ICON_NAMES, type FileIconName } from "./fileIcons.ts";

/** How long an app's icon shows the dot after its files change. */
export const CHANGED_MS = 10 * 60 * 1000;

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** One plain line per thing an app asks for, in the order the install card shows them. */
export function permissionLines(asks: AppGrant, botName: string, tools: readonly AppToolDef[]): string[] {
  const lines: string[] = [];
  if (asks.documents === "read") lines.push("Read your documents");
  if (asks.documents === "write") lines.push("Change your documents");
  for (const origin of asks.network) lines.push(`Connect to ${hostOf(origin)}`);
  if (asks.bot) lines.push(`Send ${botName} messages`);
  if (tools.length) lines.push(`Gives ${botName} these tools: ${tools.map((t) => t.name).join(", ")}`);
  return lines;
}

/** What a grant allows, in one line for the Details panel. */
export function grantLine(grant: AppGrant | null, botName: string): string {
  if (!grant) return "Nothing allowed yet";
  return permissionLines(grant, botName, []).join(", ") || "Nothing outside its own folder";
}

/** An app waits for the person when nothing is allowed yet, or what it asks for is more than what is allowed. */
export const waitsForYou = (app: Pick<AppInfo, "grant" | "pending">): boolean => app.grant === null || app.pending;

export type AppBadge = "needs" | "changed" | null;

/** The dot on an app's icon: amber when it waits for the person, plain when its files changed lately. */
export function appBadge(app: Pick<AppInfo, "grant" | "pending" | "updatedAt">, now: number): AppBadge {
  if (waitsForYou(app)) return "needs";
  const at = Date.parse(app.updatedAt);
  if (Number.isFinite(at) && now - at < CHANGED_MS) return "changed";
  return null;
}

/** An app's icon name when it is one Crew draws; anything else is the generic icon. */
export function userAppIcon(name: string): FileIconName {
  return (FILE_ICON_NAMES as readonly string[]).includes(name) ? (name as FileIconName) : "other";
}

export const userAppId = (name: string): string => `app-${name}`;

/**
 * The desktop with one icon per app: an app with no icon gets one in the next free
 * slot, and an icon whose app is gone is removed. Icons the person renamed or moved
 * are kept as they are. Returns the same list when nothing changes.
 */
export function syncAppIcons(items: DesktopShortcut[], apps: readonly Pick<AppInfo, "name" | "title">[]): DesktopShortcut[] {
  const listed = new Set(apps.map((a) => a.name));
  const kept = items.filter((i) => i.kind !== "userapp" || listed.has(i.app));
  const have = new Set(kept.flatMap((i) => (i.kind === "userapp" ? [i.app] : [])));
  const added: DesktopShortcut[] = apps
    .filter((a) => !have.has(a.name))
    .map((a) => ({ id: userAppId(a.name), kind: "userapp", app: a.name, label: a.title.trim().slice(0, SHORTCUT_LABEL_MAX).trim() || a.name }));
  if (kept.length === items.length && !added.length) return items;
  return [...kept, ...added];
}

/** The app's own title, for a window or an icon's label. */
export const appTitleOf = (apps: readonly Pick<AppInfo, "name" | "title">[], name: string): string => apps.find((a) => a.name === name)?.title ?? name;
