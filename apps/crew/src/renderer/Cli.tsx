// Signing in to the CLIs bots think with. The install and sign-in card is the
// shell's own (AgentSetup); this page only lists the three CLIs and shows
// the card for the one the person picked.

import { useEffect, useState } from "react";
import { AGENTS, AGENT_KINDS, AgentLogo, AgentSetup, Dialog, MenuButton, accountEntries, isReady, statusWord, type Agents, type AgentKind } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { Settings } from "../shared/contract.ts";
import { Glyph } from "./Glyph.tsx";
import { CrewParade } from "./PixelMotion.tsx";
import { PixelField } from "./PixelField.tsx";

export function CliList({ agents, autoPick }: { agents: Agents; autoPick?: boolean }) {
  const [kind, setKind] = useState<AgentKind | null>(null);
  const loaded = AGENT_KINDS.every((k) => agents.catalogs[k]);
  useEffect(() => {
    if (!autoPick || kind || !loaded) return;
    setKind(AGENT_KINDS.find((k) => isReady(agents.catalogs[k])) ?? "claude");
  }, [autoPick, kind, loaded, agents.catalogs]);

  return (
    <div className="cli-list">
      {AGENT_KINDS.map((k) => {
        const ready = isReady(agents.catalogs[k]);
        const on = kind === k;
        return (
          <div key={k} className={`cli-item${on ? " open" : ""}`}>
            <button type="button" className="cli-tile" aria-expanded={on} onClick={() => setKind(on ? null : k)}>
              <AgentLogo kind={k} size={22} />
              <span className="cli-text">
                <span className="cli-name">{AGENTS[k].name}</span>
                <span className="cli-sub">
                  {AGENTS[k].maker}'s agent. Uses your {AGENTS[k].plan}.
                </span>
              </span>
              <span className={`cli-state${ready ? " ok" : ""}`}>{statusWord(agents, k)}</span>
            </button>
            {on && (
              <div className="cli-detail">
                <AgentSetup agents={agents} kind={k} />
                {ready && (
                  <MenuButton className="btn" label={`${AGENTS[k].name} account`} entries={accountEntries(agents, k)}>
                    Account
                    <Glyph name="chevron" size={12} />
                  </MenuButton>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The first screen when no CLI is signed in. */
export function SetupScreen({ agents }: { agents: Agents }) {
  return (
    <main className="main setup-screen px-host">
      <PixelField density={10} alpha={0.55} glitch={0.12} />
      <div className="setup-card">
        <CrewParade />
        <h1>Sign in to start your bots</h1>
        <p>Bots run on the Claude Code, Codex or Antigravity plan you already pay for. Pick one and sign in once. There is no Fenna account, and your files stay on this computer.</p>
        <CliList agents={agents} autoPick />
      </div>
    </main>
  );
}

export function CliDialog({ agents, onClose }: { agents: Agents; onClose(): void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    invoke("crew:settings").then(setSettings, (e) => setError(errorText(e)));
  }, []);
  return (
    <Dialog title="Sign in" onClose={onClose} width={560}>
      <CliList agents={agents} />
      <div className="dialog-sep" />
      <label className="check-row">
        <input
          className="pcheck"
          type="checkbox"
          checked={!!settings?.openAtLogin}
          disabled={!settings}
          onChange={(e) =>
            invoke("crew:setSettings", { openAtLogin: e.target.checked }).then(
              (s) => {
                setSettings(s);
                setError("");
              },
              (err) => setError(errorText(err)),
            )
          }
        />
        <span>
          Open Fenna Crew at sign-in
          <span className="hint block">Bots keep running in the tray when the window is closed.</span>
        </span>
      </label>
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
