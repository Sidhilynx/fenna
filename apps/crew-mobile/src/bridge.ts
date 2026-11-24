// The phone's door to Crew on the computer. It keeps the phone link up, and
// installs window.shell with the same invoke / send / on the desktop page
// gets from Electron's preload, so the desktop's own models (the chat
// transcript, its hooks) run here unchanged over the link.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { Preferences } from "@capacitor/preferences";
import { createPhoneLink, type Frame, type LinkState } from "@opendeck/crew-link/phone";

/** Our own native plugin (android/app/src/main/java/.../CrewPushPlugin.java): notifications sealed by the computer. */
interface CrewPushPlugin {
  /** Whether Firebase is set up in this build (google-services.json), so notifications can work. */
  available(): Promise<{ available: boolean }>;
  /** Asks the person to allow notifications (Android 13+). */
  requestPermission(): Promise<{ granted: boolean }>;
  token(): Promise<{ token: string | null }>;
  /** The notification that opened the app, if one did and it wasn't read yet. */
  opened(): Promise<{ slug: string | null; id: string | null }>;
  addListener(event: "token", fn: (e: { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "opened", fn: (e: { slug: string; id: string }) => void): Promise<PluginListenerHandle>;
}
const CrewPush = registerPlugin<CrewPushPlugin>("CrewPush");

export const native = Capacitor.isNativePlatform();

const store = {
  get: async (key: string) => (await Preferences.get({ key })).value,
  set: (key: string, value: string) => Preferences.set({ key, value }),
  remove: (key: string) => Preferences.remove({ key }),
};

/** "Pixel 8" from the WebView's user agent, or a plain name. */
function phoneName(): string {
  const m = /Android [\d.]+; ([^;)]+?)(?: Build|\))/.exec(navigator.userAgent);
  const model = m && m[1] ? m[1].trim() : "";
  return model && model !== "K" ? model.slice(0, 60) : "Android phone";
}

type Fn = (payload: unknown) => void;
const listeners = new Map<string, Set<Fn>>();
const stateFns = new Set<(s: LinkState) => void>();
const frameFns = new Set<(f: Frame) => void>();
const resyncFns = new Set<() => void>();
const openedFns = new Set<(o: { slug: string; id: string }) => void>();
let state: LinkState = { paired: false, computerName: "", relay: "idle", computer: "unknown", ready: false, offlineSince: null, problem: null };

export const link = createPhoneLink({
  store,
  name: phoneName(),
  platform: Capacitor.getPlatform(),
  app: "0.9.11",
  onState: (s) => {
    state = s;
    for (const fn of stateFns) fn(s);
  },
  onEvent: (ch, p) => {
    for (const fn of listeners.get(ch) ?? []) fn(p);
  },
  onFrame: (f) => {
    if (!frameFns.size) f.ack();
    for (const fn of frameFns) fn(f);
  },
  onResync: () => {
    for (const fn of resyncFns) fn();
  },
});

// The desktop's api.ts talks to window.shell; here it is the link.
(window as unknown as { shell: unknown }).shell = {
  invoke: (ch: string, ...args: unknown[]) => link.invoke(ch, ...args),
  send: (ch: string, ...args: unknown[]) => link.send(ch, ...args),
  on: (ch: string, fn: Fn) => {
    const set = listeners.get(ch) ?? new Set<Fn>();
    set.add(fn);
    listeners.set(ch, set);
    return () => set.delete(fn);
  },
};

export const linkState = () => state;
export function onLinkState(fn: (s: LinkState) => void) {
  stateFns.add(fn);
  return () => void stateFns.delete(fn);
}
export function onFrame(fn: (f: Frame) => void) {
  frameFns.add(fn);
  return () => void frameFns.delete(fn);
}
export function onResync(fn: () => void) {
  resyncFns.add(fn);
  return () => void resyncFns.delete(fn);
}
/** The person tapped a notification: show that bot. */
export function onOpened(fn: (o: { slug: string; id: string }) => void) {
  openedFns.add(fn);
  return () => void openedFns.delete(fn);
}

let pushReady = false;
let pushStatus: "on" | "off" | "unavailable" | null = null;

/** What setUpNotifications last found, or null before it ran. */
export const notificationState = () => pushStatus;

/** Asks for notifications once paired, and gives the computer this phone's token. Quiet when the build has no Firebase. */
export async function setUpNotifications(): Promise<"on" | "off" | "unavailable"> {
  pushStatus = await notificationsNow();
  return pushStatus;
}

async function notificationsNow(): Promise<"on" | "off" | "unavailable"> {
  if (!native) return "unavailable";
  try {
    const { available } = await CrewPush.available();
    if (!available) return "unavailable";
    const { granted } = await CrewPush.requestPermission();
    if (!granted) {
      link.setPushToken(null);
      return "off";
    }
    if (!pushReady) {
      pushReady = true;
      await CrewPush.addListener("token", (e) => link.setPushToken(e.token));
    }
    const { token } = await CrewPush.token();
    if (token) link.setPushToken(token);
    return token ? "on" : "off";
  } catch {
    return "unavailable";
  }
}

/** Starts the link and follows the app's life: front or back, network changes, notifications tapped. */
export async function startBridge(): Promise<boolean> {
  if (native) {
    await CapApp.addListener("appStateChange", ({ isActive }) => link.setVisible(isActive));
    await Network.addListener("networkStatusChange", (s) => {
      if (s.connected) link.reconnect();
    });
    try {
      await CrewPush.addListener("opened", (o) => {
        for (const fn of openedFns) fn(o);
      });
      const first = await CrewPush.opened();
      if (first.slug && first.id) setTimeout(() => openedFns.forEach((fn) => fn({ slug: first.slug as string, id: first.id as string })), 0);
    } catch {
      /* a build without the native plugin: no notifications to open */
    }
  } else {
    document.addEventListener("visibilitychange", () => link.setVisible(document.visibilityState === "visible"));
    window.addEventListener("online", () => link.reconnect());
  }
  return link.load();
}
