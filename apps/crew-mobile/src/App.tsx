// The phone app: pairing until the phone knows a computer, then three tabs
// (Crew, Inbox, Settings) with screens pushed over them. Android's back
// button closes the newest sheet, then the newest screen, then goes to the
// Crew tab, then puts the app in the back.

import { useEffect } from "react";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { native, setUpNotifications } from "./bridge.ts";
import { useStore, type Route } from "./state.tsx";
import { backFromLayers, TabBar, Toast } from "./ui.tsx";
import { Pair } from "./screens/Pair.tsx";
import { CrewList } from "./screens/CrewList.tsx";
import { Inbox } from "./screens/Inbox.tsx";
import { Chat } from "./screens/Chat.tsx";
import { Screen } from "./screens/Screen.tsx";
import { Details } from "./screens/Details.tsx";
import { NewBot } from "./screens/NewBot.tsx";
import { Group, NewGroup } from "./screens/Group.tsx";
import { SettingsTab } from "./screens/Settings.tsx";
import { Connectors } from "./screens/Connectors.tsx";
import { Skills } from "./screens/Skills.tsx";
import { Logins } from "./screens/Logins.tsx";
import { Usage } from "./screens/Usage.tsx";

function Pushed({ route }: { route: Route }) {
  switch (route.name) {
    case "chat":
      return <Chat slug={route.slug} />;
    case "group":
      return <Group slug={route.slug} />;
    case "details":
      return <Details slug={route.slug} />;
    case "screen":
      return <Screen slug={route.slug} />;
    case "newbot":
      return <NewBot />;
    case "newgroup":
      return <NewGroup />;
    case "connectors":
      return <Connectors />;
    case "skills":
      return <Skills />;
    case "logins":
      return <Logins />;
    case "usage":
      return <Usage />;
    default:
      return null;
  }
}

/** The status bar follows the theme. */
function useStatusBar() {
  useEffect(() => {
    if (!native) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = media.matches;
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg) void StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
}

export function App() {
  const store = useStore();
  const { link, stack, tab, pop, setTab } = store;
  const top = stack[stack.length - 1] as Route;
  useStatusBar();

  // Android's back button, newest layer first.
  useEffect(() => {
    if (!native) return;
    const h = CapApp.addListener("backButton", () => {
      if (backFromLayers()) return;
      if (stack.length > 1) pop();
      else if (tab !== "crew") setTab("crew");
      else void CapApp.minimizeApp();
    });
    return () => {
      void h.then((x) => x.remove());
    };
  }, [stack.length, tab, pop, setTab]);

  // Once paired, notifications are asked for once.
  useEffect(() => {
    if (link.paired) void setUpNotifications();
  }, [link.paired]);

  if (!link.paired) {
    return (
      <div className="m-app">
        <Pair />
        <Toast />
      </div>
    );
  }

  return (
    <div className="m-app">
      {top.name === "tabs" ? (
        <div className="m-page">
          {tab === "crew" && <CrewList />}
          {tab === "inbox" && <Inbox />}
          {tab === "settings" && <SettingsTab />}
          <TabBar />
        </div>
      ) : (
        <div className="m-page m-slide" key={`${stack.length}:${top.name}`}>
          <Pushed route={top} />
        </div>
      )}
      <Toast />
    </div>
  );
}
