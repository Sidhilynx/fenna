// The pickers Details and New bot share: a bot's face, its schedule and its
// brain (CLI, model, effort). The logic is the desktop's (FacePicker,
// BrainPicker and the schedule examples); the controls are the phone's
// segmented buttons, 48px tall.

import { useEffect, useState, type CSSProperties } from "react";
import { AVATARS, AVATAR_COLORS, CLI_KINDS, CLI_NAMES, parseSchedule, type Avatar, type AvatarColor, type CliKind } from "@opendeck/crew";
import { errorText, invoke } from "../../../crew/src/shared/api.ts";
import type { CliStatus } from "../../../crew/src/shared/contract.ts";
import { Face } from "../ui.tsx";

export interface Brain {
  cli: CliKind;
  /** Empty: the CLI's default model. */
  model: string;
  /** Empty: the model's default effort. */
  effort: string;
}

export interface FaceChoice {
  avatar: Avatar;
  color: AvatarColor;
}

/** The schedules people pick most. `value` is the line bot.md keeps. */
export const SCHEDULE_PRESETS: { label: string; value: string }[] = [
  { label: "Only when I ask", value: "manual" },
  { label: "Weekdays at 9:00", value: "weekdays 09:00" },
  { label: "Every day at 8:00", value: "daily 08:00" },
  { label: "Mondays at 10:00", value: "mondays 10:00" },
  { label: "Every 2 hours, 8:00 to 18:00", value: "every 2h 08:00-18:00" },
];

const EFFORT_LABELS: Record<string, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** "Lantern, ochre": what a face is called in labels. */
export function faceName(avatar: Avatar, color: AvatarColor): string {
  return `${avatar.charAt(0).toUpperCase()}${avatar.slice(1)}, ${color}`;
}

/** Why a schedule line can't be read, in words, or null when it can. Backticks are left out: the phone shows plain text. */
export function scheduleProblem(text: string): string | null {
  const r = parseSchedule(text);
  return "error" in r ? r.error.replace(/`/g, "") : null;
}

/** A CLI can run a bot when it is installed and signed in (a CLI that doesn't say is taken as signed in). */
export function cliReady(c: CliStatus): boolean {
  return c.installed && c.signedIn !== false;
}

/** The CLIs on this computer, asked once. */
export function useClis(): { clis: CliStatus[] | null; error: string } {
  const [clis, setClis] = useState<CliStatus[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    invoke("crew:clis").then(
      (c) => {
        if (live) setClis(c);
      },
      (e) => {
        if (live) setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return { clis, error };
}

interface Option<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** A row of choices, one pressed. Each is 48px tall; the pressed one is aria-pressed. */
export function Seg<T extends string>({ label, options, value, onPick, disabled = false }: { label: string; options: Option<T>[]; value: T; onPick(v: T): void; disabled?: boolean }) {
  return (
    <div className="m-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="btn m-seg-btn" aria-pressed={o.value === value} title={o.title} disabled={disabled} onClick={() => o.value !== value && onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled Seg, the way a form field is laid out. */
export function SegField<T extends string>(props: { label: string; options: Option<T>[]; value: T; onPick(v: T): void; disabled?: boolean }) {
  return (
    <div className="m-field">
      <span className="m-label">{props.label}</span>
      <Seg {...props} />
    </div>
  );
}

/** The face: every design in the chosen color, then the colors. */
export function FacePicker({ value, onChange }: { value: FaceChoice; onChange(next: FaceChoice): void }) {
  return (
    <>
      <div className="dt-face-grid" role="radiogroup" aria-label="Design">
        {AVATARS.map((a) => (
          <button key={a} type="button" role="radio" className="dt-face-opt" aria-checked={a === value.avatar} aria-label={faceName(a, value.color)} title={faceName(a, value.color)} onClick={() => onChange({ avatar: a, color: value.color })}>
            <Face avatar={a} color={value.color} size={40} />
          </button>
        ))}
      </div>
      <div className="dt-colors" role="radiogroup" aria-label="Color">
        {AVATAR_COLORS.map((c) => (
          <button key={c} type="button" role="radio" className="dt-swatch" style={{ "--sw": `var(--av-${c})` } as CSSProperties} aria-checked={c === value.color} aria-label={c} title={c} onClick={() => onChange({ avatar: value.avatar, color: c })} />
        ))}
      </div>
    </>
  );
}

/** The schedule: the presets, then the line itself, checked as it is typed. */
export function SchedulePicker({ value, onChange }: { value: string; onChange(next: string): void }) {
  const problem = scheduleProblem(value);
  const current = value.trim().toLowerCase();
  return (
    <div className="m-field">
      <div className="dt-presets" role="group" aria-label="Schedule examples">
        {SCHEDULE_PRESETS.map((p) => (
          <button key={p.value} type="button" className="btn" aria-pressed={current === p.value} onClick={() => onChange(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      <label className="dt-line">
        <span className="m-label">Or write one</span>
        <input className="field" value={value} spellCheck={false} autoCapitalize="none" autoCorrect="off" aria-invalid={problem ? true : undefined} aria-describedby={problem ? "dt-schedule-error" : undefined} onChange={(e) => onChange(e.target.value)} />
      </label>
      {problem ? (
        <span id="dt-schedule-error" className="dt-error" role="alert">
          {problem}
        </span>
      ) : (
        <span className="m-help">Like weekdays 09:00, or every 2h 08:00-18:00.</span>
      )}
    </div>
  );
}

/** The brain: the CLI (installed and signed in, or the one the bot has), its model and its effort. */
export function BrainPicker({ value, clis, onChange }: { value: Brain; clis: CliStatus[]; onChange(next: Brain): void }) {
  const current = clis.find((c) => c.kind === value.cli);
  const offered = CLI_KINDS.filter((k) => k === value.cli || clis.some((c) => c.kind === k && cliReady(c)));
  const models = (current?.models ?? []).filter((m) => m.value && m.label !== "Default" && !m.local);
  const model = models.find((m) => m.value === value.model);
  // Without a model, the efforts every model of the CLI takes (the desktop's list).
  const efforts = model ? model.efforts : [...new Set(models.flatMap((m) => m.efforts))];
  return (
    <>
      <SegField label="CLI" options={offered.map((k) => ({ value: k, label: CLI_NAMES[k] }))} value={value.cli} onPick={(cli) => onChange({ cli, model: "", effort: "" })} />
      {current && !cliReady(current) && <p className="m-help">{current.installed ? "Sign in to it on your computer first." : "It isn't installed on your computer."}</p>}
      <SegField
        label="Model"
        options={[{ value: "", label: "Default" }, ...models.map((m) => ({ value: m.value, label: m.label }))]}
        value={value.model}
        onPick={(m) => {
          const next = models.find((x) => x.value === m);
          onChange({ ...value, model: m, effort: next && next.efforts.includes(value.effort) ? value.effort : "" });
        }}
      />
      {efforts.length > 0 && <SegField label="Effort" options={[{ value: "", label: "Default" }, ...efforts.map((e) => ({ value: e, label: effortLabel(e) }))]} value={value.effort} onPick={(e) => onChange({ ...value, effort: e })} />}
    </>
  );
}
