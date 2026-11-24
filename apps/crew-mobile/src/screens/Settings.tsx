// The Settings tab: this phone's computer, notifications, what the crew
// reaches (connectors, skills, logins, usage), the defaults a new bot starts
// with, runs at once, and feedback.

import "./settings.css";
import { useEffect, useState } from "react";
import { CLI_NAMES } from "@opendeck/crew";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { CliKind, CliStatus, Settings } from "../../../crew/src/shared/contract.ts";
import { link, notificationState, setUpNotifications } from "../bridge.ts";
import { plural } from "../../../crew/src/renderer/text.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Header, PixelIcon, Row, Section, Sheet, Working } from "../ui.tsx";

type Open = "disconnect" | "cli" | "model" | "effort" | "feedback";
type Notice = "on" | "off" | "unavailable";

const NOTICE: Record<Notice, string> = {
  on: "On",
  off: "Off — allow them in Android's settings",
  unavailable: "Not available in this build",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A list of choices, one tapped to pick it. */
function Choose<T extends string>({
  title,
  options,
  disabled,
  onPick,
  onClose,
}: {
  title: string;
  options: { value: T; label: string; sub?: string; checked: boolean }[];
  disabled: boolean;
  onPick(value: T): void;
  onClose(): void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="st-pick" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={o.checked}
            className="st-choice"
            disabled={disabled}
            onClick={() => {
              onPick(o.value);
              onClose();
            }}
          >
            <span className="st-choice-text">
              <span className="st-choice-title">{o.label}</span>
              {o.sub && <span className="st-choice-sub">{o.sub}</span>}
            </span>
            {o.checked && <PixelIcon name="check" size={16} />}
          </button>
        ))}
      </div>
      {disabled && <p className="m-help st-reason">Connect to your computer to change this.</p>}
    </Sheet>
  );
}

function Feedback({ ready, onClose }: { ready: boolean; onClose(): void }) {
  const { toast } = useStore();
  const act = useAct();
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canSend = ready && !busy && (rating !== null || text.trim() !== "");

  async function send() {
    setBusy(true);
    const r = await act(invoke("crew:feedback", { rating, text: text.trim() }));
    setBusy(false);
    if (r) {
      toast("Feedback sent");
      onClose();
    }
  }

  return (
    <Sheet
      title="Feedback"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!canSend} onClick={() => void send()}>
            Send
          </button>
        </>
      }
    >
      <div className="st-stack">
        <div className="m-seg" role="radiogroup" aria-label="How Crew is working for you">
          <button type="button" role="radio" aria-checked={rating === "up"} className="btn m-seg-btn" onClick={() => setRating(rating === "up" ? null : "up")}>
            Good
          </button>
          <button type="button" role="radio" aria-checked={rating === "down"} className="btn m-seg-btn" onClick={() => setRating(rating === "down" ? null : "down")}>
            Not good
          </button>
        </div>
        <label className="m-field">
          <span className="m-label">Tell us more (optional)</span>
          <textarea className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      {!ready && <p className="m-help st-reason">Connect to your computer to send feedback.</p>}
    </Sheet>
  );
}

export function SettingsTab() {
  const { link: state, push, toast } = useStore();
  const act = useAct();
  const ready = state.ready;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clis, setClis] = useState<CliStatus[] | null>(null);
  const [counts, setCounts] = useState<{ connectors: number | null; skills: number | null; logins: number | null }>({ connectors: null, skills: null, logins: null });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    if (!ready) return;
    void act(invoke("crew:settings")).then((s) => {
      if (s) setSettings(s);
    });
    void act(invoke("crew:clis")).then((c) => {
      if (c) setClis(c);
    });
    void act(invoke("crew:connectors")).then((c) => {
      if (c) setCounts((n) => ({ ...n, connectors: c.length }));
    });
    void act(invoke("crew:skills")).then((s) => {
      if (s) setCounts((n) => ({ ...n, skills: s.length }));
    });
    void act(invoke("crew:vault")).then((v) => {
      if (v) setCounts((n) => ({ ...n, logins: v.length }));
    });
  }, [ready, act]);

  useEffect(() => {
    const offs = [
      on("crew:connectors", (c) => setCounts((n) => ({ ...n, connectors: c.length }))),
      on("crew:skills", (s) => setCounts((n) => ({ ...n, skills: s.length }))),
      on("crew:vault", (v) => setCounts((n) => ({ ...n, logins: v.length }))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  async function update(patch: Partial<Settings>) {
    const s = await act(invoke("crew:setSettings", patch));
    if (s) setSettings(s);
  }

  async function disconnect() {
    try {
      await link.unpair();
    } catch (e) {
      toast(errorText(e));
    }
  }

  const computer = state.computerName || "Your computer";
  const status = state.ready ? "Connected" : state.computer === "offline" ? "Asleep or Crew is closed" : "Connecting…";
  const cli = clis?.find((c) => c.kind === settings?.defaultCli) ?? null;
  const models = cli?.models ?? [];
  const model = models.find((m) => m.value === settings?.defaultModel) ?? null;
  const efforts = model?.efforts ?? [];
  const countOf = (n: number | null, text: (n: number) => string) => (n === null ? undefined : text(n));

  return (
    <>
      <Header title="Settings" />
      <ConnBar />
      <div className="m-body">
        {!ready && <p className="st-note">Connect to your computer to change settings.</p>}

        <Section title="Computer">
          <Row title={computer} sub={status} />
          <Row title="Disconnect this phone" danger onClick={() => setOpen("disconnect")} />
        </Section>

        <Section>
          <Row title="Notifications" sub={NOTICE[notice ?? notificationState() ?? "unavailable"]} onClick={() => void setUpNotifications().then(setNotice)} />
        </Section>

        <Section title="Your crew">
          <Row
            title="Connectors"
            sub={countOf(counts.connectors, (n) => (n ? plural(n, "connector") + " installed" : "None installed"))}
            onClick={() => push({ name: "connectors" })}
          />
          <Row title="Skills" sub={countOf(counts.skills, (n) => (n ? plural(n, "skill") + " installed" : "None installed"))} onClick={() => push({ name: "skills" })} />
          <Row title="Logins" sub={countOf(counts.logins, (n) => (n ? plural(n, "login") + " saved" : "None saved"))} onClick={() => push({ name: "logins" })} />
          <Row title="Usage" sub="Runs, time and limit hits" onClick={() => push({ name: "usage" })} />
        </Section>

        {settings && (
          <Section title="New bots start with">
            <Row title="CLI" right={cli?.name ?? CLI_NAMES[settings.defaultCli]} onClick={() => setOpen("cli")} />
            <Row title="Model" right={model?.label ?? "CLI's choice"} onClick={() => setOpen("model")} />
            <Row title="Effort" right={settings.defaultEffort ? cap(settings.defaultEffort) : "CLI's choice"} onClick={() => setOpen("effort")} />
          </Section>
        )}

        {settings && (
          <Section>
            <Row
              title="Runs at once"
              sub="Others wait. Applies when Crew restarts on your computer."
              right={
                <div className="m-seg" role="radiogroup" aria-label="Runs at once">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={settings.maxConcurrent === n}
                      className="btn m-seg-btn"
                      disabled={!ready}
                      onClick={() => void update({ maxConcurrent: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              }
            />
          </Section>
        )}

        {settings && (
          <Section>
            <Row
              title="Notifications on your computer"
              sub="When a bot needs you and Crew is out of sight."
              right={
                <input
                  type="checkbox"
                  role="switch"
                  className="m-switch"
                  aria-label="Notifications on your computer"
                  checked={settings.notifications}
                  disabled={!ready}
                  onChange={(e) => void update({ notifications: e.target.checked })}
                />
              }
            />
          </Section>
        )}

        <Section>
          <Row title="Feedback" sub="Tell us how Crew is working for you." onClick={() => setOpen("feedback")} />
        </Section>

        {!settings && ready && (
          <div className="st-loading">
            <Working label="Loading settings" />
          </div>
        )}

        <p className="st-hint">Fenna Crew for Android 0.9.11</p>
      </div>

      {open === "disconnect" && (
        <Sheet
          title="Disconnect this phone?"
          onClose={() => setOpen(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setOpen(null)}>
                Keep it
              </button>
              <button type="button" className="btn m-danger-fill" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          }
        >
          <p className="st-sec-note">
            Disconnect from {computer}? You can connect again with a new code.
          </p>
        </Sheet>
      )}

      {open === "cli" && settings && (
        <Choose<CliKind>
          title="CLI"
          disabled={!ready}
          options={(clis ?? []).map((c) => ({ value: c.kind, label: c.name, sub: c.installed ? undefined : "Not installed on this computer", checked: c.kind === settings.defaultCli }))}
          onPick={(v) => void update({ defaultCli: v, defaultModel: "", defaultEffort: "" })}
          onClose={() => setOpen(null)}
        />
      )}

      {open === "model" && settings && (
        <Choose<string>
          title="Model"
          disabled={!ready}
          options={[
            { value: "", label: "CLI's choice", checked: !settings.defaultModel },
            ...models.map((m) => ({ value: m.value, label: m.label, sub: m.description, checked: m.value === settings.defaultModel })),
          ]}
          onPick={(v) => {
            const m = models.find((x) => x.value === v);
            void update({ defaultModel: v, defaultEffort: m?.efforts.includes(settings.defaultEffort) ? settings.defaultEffort : "" });
          }}
          onClose={() => setOpen(null)}
        />
      )}

      {open === "effort" && settings && (
        <Choose<string>
          title="Effort"
          disabled={!ready}
          options={[{ value: "", label: "CLI's choice", checked: !settings.defaultEffort }, ...efforts.map((e) => ({ value: e, label: cap(e), checked: e === settings.defaultEffort }))]}
          onPick={(v) => void update({ defaultEffort: v })}
          onClose={() => setOpen(null)}
        />
      )}

      {open === "feedback" && <Feedback ready={ready} onClose={() => setOpen(null)} />}
    </>
  );
}
