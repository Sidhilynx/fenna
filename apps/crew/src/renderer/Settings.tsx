// Settings: the few choices that change how Fenna Crew behaves. Every control here is read somewhere.

import { useEffect, useState, type ReactNode } from "react";
import { Dialog, toast, ThemeToggle } from "@opendeck/shell";
import { CLI_KINDS, CLI_NAMES, type CliKind } from "@opendeck/crew";
import { errorText, invoke } from "../shared/api.ts";
import type { Settings } from "../shared/contract.ts";
import { FeedbackDialog } from "./Feedback.tsx";
import { ImportMemoryDialog } from "./ImportMemory.tsx";
import { Pick } from "./Pick.tsx";
import { useCrew } from "./crew.tsx";

type Section = "general" | "appearance" | "clis" | "runs" | "data";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "clis", label: "CLIs" },
  { id: "runs", label: "Runs" },
  { id: "data", label: "Data" },
];

const RUNS_AT_ONCE = [1, 2, 3, 4];

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Row({ name, sub, children, htmlFor }: { name: string; sub?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  const meta = (
    <div className="settings-meta">
      <span className="settings-name">{name}</span>
      {sub ? <span className="settings-sub">{sub}</span> : null}
    </div>
  );
  if (htmlFor !== undefined) {
    return (
      <label className="settings-row" htmlFor={htmlFor}>
        {meta}
        <div className="settings-ctrl">{children}</div>
      </label>
    );
  }
  return (
    <div className="settings-row">
      {meta}
      {children ? <div className="settings-ctrl">{children}</div> : null}
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const { clis, overview } = useCrew();
  const [section, setSection] = useState<Section>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    invoke("crew:settings")
      .then((s) => {
        setSettings(s);
        setLoading(false);
      })
      .catch((e) => {
        toast(errorText(e));
        setLoading(false);
      });
  }, []);

  const update = async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      setSettings(await invoke("crew:setSettings", patch));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const currentCli: CliKind = settings?.defaultCli ?? "claude";
  const models = clis.find((c) => c.kind === currentCli)?.models ?? [];
  const model = models.find((m) => m.value === settings?.defaultModel);
  const efforts = model ? model.efforts : [...new Set(models.flatMap((m) => m.efforts))];

  return (
    <>
    <Dialog title="Settings" onClose={onClose} width={680}>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="settings-nav-btn" aria-current={section === s.id ? "page" : undefined} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {loading ? (
            <p className="hint">Loading…</p>
          ) : !settings ? (
            <p className="hint">Settings didn't load. Close and reopen.</p>
          ) : (
            <div className="settings-pane">
              {section === "general" && (
                <>
                  <Row name="Open at login" sub="Start hidden in the tray, so scheduled bots run on time." htmlFor="set-login">
                    <input id="set-login" className="px-switch" type="checkbox" checked={settings.openAtLogin} disabled={saving} onChange={(e) => void update({ openAtLogin: e.target.checked })} />
                  </Row>
                  <Row name="Notifications" sub="When a bot needs you and Crew is out of sight." htmlFor="set-notify">
                    <input id="set-notify" className="px-switch" type="checkbox" checked={settings.notifications} disabled={saving} onChange={(e) => void update({ notifications: e.target.checked })} />
                  </Row>
                  <Row
                    name="Send anonymous usage counts"
                    sub={settings.usageLocked ? "Off on this computer: FENNA_NO_USAGE is set." : "Once a day: version, system and how many runs and approvals. Never your files, chats, jobs or sites."}
                    htmlFor="set-usage"
                  >
                    <input id="set-usage" className="px-switch" type="checkbox" checked={settings.usageCounts} disabled={saving || settings.usageLocked} onChange={(e) => void update({ usageCounts: e.target.checked })} />
                  </Row>
                  <Row name="What Fenna sends" sub="The full list of what Fenna sends over the network, and when.">
                    <button type="button" className="btn" onClick={() => void invoke("crew:usageDetails").catch((e) => toast(errorText(e)))}>
                      What's sent
                    </button>
                  </Row>
                  <Row name="Feedback" sub="Tell us how Crew is working for you.">
                    <button type="button" className="btn" onClick={() => setFeedback(true)}>
                      Send feedback
                    </button>
                  </Row>
                </>
              )}

              {section === "appearance" && (
                <Row name="Theme">
                  <ThemeToggle className="btn" />
                </Row>
              )}

              {section === "clis" && (
                <>
                  <p className="settings-desc">New bots start with these.</p>
                  <div className="settings-picks">
                    <Pick
                      label="CLI"
                      value={CLI_NAMES[currentCli]}
                      entries={CLI_KINDS.map((k) => ({
                        label: CLI_NAMES[k],
                        checked: k === currentCli,
                        onSelect: () => void update({ defaultCli: k, defaultModel: "", defaultEffort: "" }),
                      }))}
                    />
                    <Pick
                      label="Model"
                      value={model?.label ?? (settings.defaultModel || "CLI's choice")}
                      entries={[
                        { label: "CLI's choice", checked: !settings.defaultModel, onSelect: () => void update({ defaultModel: "", defaultEffort: "" }) },
                        ...models.map((m) => ({
                          label: m.label,
                          hint: m.description,
                          checked: m.value === settings.defaultModel,
                          onSelect: () => void update({ defaultModel: m.value, defaultEffort: m.efforts.includes(settings.defaultEffort) ? settings.defaultEffort : "" }),
                        })),
                      ]}
                    />
                    <Pick
                      label="Effort"
                      value={settings.defaultEffort ? cap(settings.defaultEffort) : "CLI's choice"}
                      entries={[
                        { label: "CLI's choice", checked: !settings.defaultEffort, onSelect: () => void update({ defaultEffort: "" }) },
                        ...efforts.map((e) => ({ label: cap(e), checked: e === settings.defaultEffort, onSelect: () => void update({ defaultEffort: e }) })),
                      ]}
                    />
                  </div>
                </>
              )}

              {section === "runs" && (
                <Row name="Runs at once" sub="Others wait. Applies on restart.">
                  <div className="seg px-seg" role="group" aria-label="Runs at once">
                    {RUNS_AT_ONCE.map((n) => (
                      <button key={n} type="button" className="seg-btn px-seg-btn" aria-pressed={settings.maxConcurrent === n} disabled={saving} onClick={() => void update({ maxConcurrent: n })}>
                        {n}
                      </button>
                    ))}
                  </div>
                </Row>
              )}

              {section === "data" && (
                <>
                  <Row name="Folder" sub={<span className="ell" title={settings.storagePath}>{settings.storagePath}</span>} />
                  <Row
                    name="Logins"
                    sub={settings.vaultEncrypted ? "Encrypted on this computer. Bots never see a password." : "No secure storage here, so logins can't be saved."}
                  />
                  <Row name="Memory" sub="Bring in what other AI tools know about you. Nothing is sent anywhere.">
                    <button type="button" className="btn" onClick={() => setImporting(true)}>
                      Import memory
                    </button>
                  </Row>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="form-acts">
        <button type="button" className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
    {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
    {importing && <ImportMemoryDialog bots={overview.bots} onClose={() => setImporting(false)} />}
    </>
  );
}
