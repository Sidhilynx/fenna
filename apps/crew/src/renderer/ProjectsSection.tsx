// The Projects part of a bot's Details: whether it may run commands in its
// projects (bot.md projects), the projects in Files/Projects and how many
// commands run in each. Open in Code opens the project in the Code window on
// the bot's computer.

import { useEffect, useState } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, DiskEntry } from "../shared/contract.ts";
import { useCrew } from "./crew.tsx";
import { projectPath, runningByProject } from "./processModel.ts";
import { useBotProcesses } from "./processStore.ts";

/** The project folders in a bot's Files/Projects, kept live while the section shows them. */
function useProjects(slug: string, enabled: boolean): { projects: DiskEntry[] | null; error: string } {
  const [projects, setProjects] = useState<DiskEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      invoke("crew:disk", slug, "Files/Projects").then(
        (listing) => {
          if (!alive) return;
          setProjects(listing.entries.filter((e) => e.kind === "folder"));
          setError("");
        },
        (e) => alive && setError(errorText(e)),
      );
    void load();
    const off = on("crew:disk", (p) => {
      if (alive && p.slug === slug) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [slug, enabled]);
  return { projects, error };
}

export function ProjectsSection({ bot, enabled, onToggle }: { bot: BotSummary; enabled: boolean; onToggle(on: boolean): void }) {
  const { go } = useCrew();
  const { projects, error } = useProjects(bot.slug, enabled);
  const { list } = useBotProcesses(bot.slug);
  const running = runningByProject(list ?? []);

  return (
    <>
      <div className="proj-toggle">
        <label htmlFor="proj-on" className="proj-toggle-name">
          Run commands
        </label>
        <input id="proj-on" className="px-switch" type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      </div>
      <p className="hint">{`Lets ${bot.name} run node, npm and npx in Files/Projects. Each project asks you first. Commands can reach the internet.`}</p>

      {enabled &&
        (!projects ? (
          <p className="hint">{error || "Loading"}</p>
        ) : !projects.length ? (
          <p className="hint">No projects yet. A project is a folder in Files/Projects.</p>
        ) : (
          <ul className="proj-list">
            {projects.map((p) => {
              const name = p.name;
              const n = running.get(name) ?? 0;
              return (
                <li key={p.path} className="proj-row">
                  <span className="proj-name ell" title={name}>
                    {name}
                  </span>
                  <span className="proj-run">{n ? `${n} running` : "Nothing running"}</span>
                  <button type="button" className="btn small" onClick={() => go({ name: "computer", slug: bot.slug, launch: { app: "code", props: { root: projectPath(name) } } })}>
                    Open in Code
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </>
  );
}
