// A bot's brain: the CLI, the model and the effort. One button shows the logos
// and the effort bars; one menu sets all three. The New bot dialog and the bot
// panel both use it.

import { AgentLogo, effortLabel, MenuButton, modelLogo, type MenuEntry } from "@opendeck/shell";
import { CLI_KINDS, CLI_NAMES, type Bot } from "@opendeck/crew";
import type { CliStatus } from "../shared/contract.ts";
import { PixelIcon } from "./PixelIcon.tsx";

export type Brain = Bot["brain"];

const EFFORT_BARS: Record<string, number> = { minimal: 1, low: 1, medium: 2, high: 3, xhigh: 4, max: 4, ultra: 4 };

/** Four pixel bars: as many filled as the effort is high. */
function EffortBars({ effort }: { effort: string }) {
  const n = EFFORT_BARS[effort] ?? 0;
  return (
    <span className="bars" data-n={n} aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= n ? "on" : undefined} />
      ))}
    </span>
  );
}

/** "Ready", "Sign in" or "Not installed": what a CLI needs before a bot can use it. */
function cliWord(clis: CliStatus[], kind: Brain["cli"]): string {
  const c = clis.find((x) => x.kind === kind);
  return !c ? "" : !c.installed ? "Not installed" : c.signedIn === false ? "Sign in" : "Ready";
}

export function BrainPicker({ value, clis, onChange }: { value: Brain; clis: CliStatus[]; onChange(next: Brain): void }) {
  const cli = clis.find((c) => c.kind === value.cli);
  // The catalog's own "Default" duplicates the menu's Default, which already means "whatever the CLI picks".
  const models = (cli?.models ?? []).filter((m) => m.value && m.label !== "Default");
  const model = models.find((m) => m.value === value.model);
  const efforts = model ? model.efforts : [...new Set(models.flatMap((m) => m.efforts))];
  const effort = value.effort || model?.defaultEffort || "";
  const modelName = model?.label ?? (value.model || "Default");

  const modelMark = (label: string) => {
    const logo = modelLogo(value.cli, label);
    return <img src={logo.src} alt="" width={14} height={14} className={`as-logo${logo.invert ? " invert" : ""}`} draggable={false} />;
  };

  const entries: MenuEntry[] = [
    { heading: "CLI" },
    ...CLI_KINDS.map((k) => ({
      label: CLI_NAMES[k],
      icon: <AgentLogo kind={k} size={16} />,
      aside: cliWord(clis, k),
      checked: k === value.cli,
      onSelect: () => k !== value.cli && onChange({ cli: k, model: "", effort: "" }),
    })),
    "separator",
    { heading: "Model" },
    { label: "Default", hint: "Whatever the CLI picks", checked: !value.model, onSelect: () => onChange({ ...value, model: "", effort: "" }) },
    ...models.map((m) => ({
      label: m.label,
      hint: m.description || undefined,
      icon: modelMark(m.label),
      checked: m.value === value.model,
      onSelect: () => onChange({ ...value, model: m.value, effort: m.efforts.includes(value.effort) ? value.effort : "" }),
    })),
    ...(efforts.length
      ? [
          "separator" as const,
          { heading: "Effort" },
          { label: "Default", checked: !value.effort, onSelect: () => onChange({ ...value, effort: "" }) },
          ...efforts.map((e) => ({ label: effortLabel(e), icon: <EffortBars effort={e} />, checked: e === value.effort, onSelect: () => onChange({ ...value, effort: e }) })),
        ]
      : []),
  ];

  return (
    <MenuButton
      className="btn brain-row"
      label={`Brain: ${CLI_NAMES[value.cli]}, ${modelName}${effort ? `, ${effortLabel(effort)}` : ""}`}
      entries={entries}
    >
      <AgentLogo kind={value.cli} size={16} />
      {model && modelMark(model.label)}
      <span className="ell brain-model">{modelName}</span>
      {effort && (
        <span className="effort-chip">
          <EffortBars effort={effort} />
          {effortLabel(effort)}
        </span>
      )}
      <PixelIcon name="chevron-down" size={12} />
    </MenuButton>
  );
}
