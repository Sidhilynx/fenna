// What every view shares: the overview (bots, teams, what waits on the
// person), where the person is, and the few actions that cross views.

import { createContext, useContext, useEffect, useState } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotDetail, BotSummary, CliStatus, ConnectorView, Overview, SkillView, TeamSummary, VaultItemView, Waiting } from "../shared/contract.ts";
import { absorbOverview } from "./screens.ts";

export type Route = { name: "crew" } | { name: "connectors" } | { name: "skills" } | { name: "vault" } | { name: "settings" } | { name: "chat"; slug: string } | { name: "computer"; slug: string; open?: string; launch?: { app: string; props?: Record<string, unknown>; key?: string; title?: string } } | { name: "team"; slug: string };

export interface Crew {
  overview: Overview;
  route: Route;
  go(route: Route): void;
  newBot(): void;
  newTeam(): void;
  editTeam(team: TeamSummary): void;
  openCli(): void;
  openSettings(): void;
  /** At least one CLI can answer now. */
  ready: boolean;
  clis: CliStatus[];
}

const Ctx = createContext<Crew | null>(null);
export const CrewProvider = Ctx.Provider;
export function useCrew(): Crew {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCrew outside CrewProvider");
  return c;
}

/** The overview, kept live. `error` is set while the main process can't be reached. */
export function useOverview(): { overview: Overview | null; error: string } {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const take = (o: Overview) => {
      absorbOverview(o);
      if (alive) setOverview(o);
    };
    invoke("crew:overview").then(
      (o) => {
        take(o);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    const off = on("crew:changed", take);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { overview, error };
}

/** One bot's detail (settings, memory, library, runs), refreshed when its runs or status change. */
export function useBotDetail(bot: BotSummary | undefined): { detail: BotDetail | null; setDetail(d: BotDetail): void; error: string } {
  const slug = bot?.slug;
  const stamp = bot ? `${bot.lastRunAt}|${bot.running}|${bot.status}` : "";
  const [detail, setDetail] = useState<BotDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    invoke("crew:bot", slug).then(
      (d) => {
        if (!alive) return;
        setDetail(d);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [slug, stamp]);
  return { detail: detail && detail.summary.slug === slug ? detail : null, setDetail, error };
}

/** The connectors installed on this computer, kept live. null until the first answer. */
export function useConnectors(): { connectors: ConnectorView[] | null; error: string } {
  const [connectors, setConnectors] = useState<ConnectorView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    invoke("crew:connectors").then(
      (list) => {
        if (!alive) return;
        setConnectors(list);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    const off = on("crew:connectors", (list) => alive && setConnectors(list));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { connectors, error };
}

/** The skills installed on this computer, kept live. null until the first answer. */
export function useSkills(): { skills: SkillView[] | null; error: string } {
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    invoke("crew:skills").then(
      (list) => {
        if (!alive) return;
        setSkills(list);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    const off = on("crew:skills", (list) => alive && setSkills(list));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { skills, error };
}

/** The logins in this computer's vault (never a secret), kept live. null until the first answer; error when the vault can't be opened. */
export function useVault(): { items: VaultItemView[] | null; error: string } {
  const [items, setItems] = useState<VaultItemView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    invoke("crew:vault").then(
      (list) => {
        if (!alive) return;
        setItems(list);
        setError("");
      },
      (e) => alive && setError(errorText(e)),
    );
    const off = on("crew:vault", (list) => alive && setItems(list));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { items, error };
}

export function waitingFor(overview: Overview, slug: string): Waiting[] {
  return overview.waiting.filter((w) => w.slug === slug);
}

export const botOf = (overview: Overview, slug: string): BotSummary | undefined => overview.bots.find((b) => b.slug === slug);
