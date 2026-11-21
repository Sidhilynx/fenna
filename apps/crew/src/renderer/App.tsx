// Fenna Crew's page: the window's header, the sidebar, and one of the
// views (overview, chat, a bot's computer, a team). The first screen is the
// CLI sign-in card when no CLI can answer yet; then Fenna, the lead bot,
// greets the person.

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_KINDS, ThemeToggle, Toast, isReady, useAgents } from "@opendeck/shell";
import { invoke, on } from "../shared/api.ts";
import type { CliStatus, TeamSummary } from "../shared/contract.ts";
import { Chat } from "./Chat.tsx";
import { CliDialog, SetupScreen } from "./Cli.tsx";
import { ConnectorsPage } from "./Connectors.tsx";
import { Computer } from "./Computer.tsx";
import { NewBotDialog, TeamDialog } from "./Dialogs.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { CrewMark } from "./Avatar.tsx";
import { Overview } from "./Overview.tsx";
import { CrewParade, PixelLoader } from "./PixelMotion.tsx";
import { SettingsDialog } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TeamView } from "./Team.tsx";
import { UsagePage } from "./UsagePage.tsx";
import { VaultPage } from "./Vault.tsx";
import { CrewProvider, botOf, useOverview, type Route } from "./crew.tsx";
import { PixelEdges } from "./PixelEdges.tsx";
import { PixelField } from "./PixelField.tsx";

type Dialog = null | { kind: "bot" } | { kind: "cli" } | { kind: "team"; team: TeamSummary | null } | { kind: "settings" };

export function App() {
  const { overview, error } = useOverview();
  const agents = useAgents();
  const [route, go] = useState<Route>({ name: "crew" });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [clis, setClis] = useState<CliStatus[]>([]);
  const [waited, setWaited] = useState(false);
  const greeted = useRef(false);

  const ready = AGENT_KINDS.some((k) => isReady(agents.catalogs[k]));
  const checked = AGENT_KINDS.every((k) => agents.catalogs[k]) || waited;
  const readyKey = AGENT_KINDS.map((k) => (isReady(agents.catalogs[k]) ? 1 : 0)).join("");

  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    invoke("crew:clis").then(setClis, () => undefined);
  }, [readyKey]);

  // The lead bot says hello, once, as soon as a CLI can answer.
  useEffect(() => {
    if (!overview || !ready || !overview.firstLaunch || greeted.current) return;
    greeted.current = true;
    invoke("crew:greet").then((r) => {
      if (!r) return;
      const lead = overview.bots.find((b) => b.name === "Fenna") ?? overview.bots[0];
      if (lead) go({ name: "chat", slug: lead.slug });
    }, () => undefined);
  }, [overview, ready]);

  // A notification the person clicked opens that bot's chat.
  useEffect(
    () =>
      on("crew:open", ({ slug }) => {
        setDialog(null);
        go({ name: "chat", slug });
      }),
    [],
  );

  // A bot or team that no longer exists sends the person back to the overview.
  const gone = overview && route.name !== "crew" && route.name !== "connectors" && route.name !== "vault" && route.name !== "usage" && route.name !== "settings" && (route.name === "team" ? !overview.teams.some((t) => t.slug === route.slug) : !botOf(overview, route.slug));
  useEffect(() => {
    if (gone) go({ name: "crew" });
  }, [gone]);

  const crew = useMemo(
    () =>
      overview && {
        overview,
        route,
        go,
        newBot: () => setDialog({ kind: "bot" }),
        newTeam: () => setDialog({ kind: "team", team: null }),
        editTeam: (team: TeamSummary) => setDialog({ kind: "team", team }),
        openCli: () => setDialog({ kind: "cli" }),
        openSettings: () => setDialog({ kind: "settings" }),
        ready,
        clis,
      },
    [overview, route, ready, clis],
  );

  let body;
  if (!overview || !crew) {
    body = (
      <div className="boot px-host" role="status">
        <PixelField density={12} alpha={0.55} glitch={0.12} />
        <CrewMark size={64} />
        {!error && <PixelLoader />}
        <p>{error ? `Fenna Crew can't start: ${error}` : "Starting"}</p>
      </div>
    );
  } else if (overview.firstLaunch && !ready) {
    body = checked ? (
      <SetupScreen agents={agents} />
    ) : (
      <div className="boot px-host" role="status">
        <PixelField density={12} alpha={0.55} glitch={0.12} />
        <CrewParade />
        <PixelLoader />
        <p>Checking sign-ins</p>
      </div>
    );
  } else {
    const view = gone ? { name: "crew" as const } : route;
    body = (
      <>
        {view.name !== "computer" && <Sidebar />}
        <ErrorBoundary resetKey={JSON.stringify(view)} onBack={() => go({ name: "crew" })}>
          {(view.name === "crew" || view.name === "settings") && <Overview />}
          {view.name === "connectors" && <ConnectorsPage />}
          {view.name === "vault" && <VaultPage />}
          {view.name === "usage" && <UsagePage />}
          {view.name === "chat" && <Chat slug={view.slug} />}
          {view.name === "computer" && <Computer slug={view.slug} open={view.open} launch={view.launch} />}
          {view.name === "team" && <TeamView slug={view.slug} />}
        </ErrorBoundary>
      </>
    );
  }

  const isComputer = route.name === "computer";

  const app = (
    <div className={`app${isComputer ? " app-computer" : ""}`}>
      {!isComputer && (
        <header className="app-head">
          <CrewMark size={18} />
          <span className="grow" />
          <ThemeToggle className="icon-btn" />
        </header>
      )}
      <div className="body">{body}</div>
      {dialog?.kind === "bot" && <NewBotDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "team" && <TeamDialog team={dialog.team} onClose={() => setDialog(null)} />}
      {dialog?.kind === "cli" && <CliDialog agents={agents} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "settings" || route.name === "settings") && (
        <SettingsDialog
          onClose={() => {
            setDialog(null);
            if (route.name === "settings") go({ name: "crew" });
          }}
        />
      )}
      <Toast />
      <PixelEdges />
    </div>
  );

  return crew ? <CrewProvider value={crew}>{app}</CrewProvider> : app;
}
