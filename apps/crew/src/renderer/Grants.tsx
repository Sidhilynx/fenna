// A bot's connectors, in its Details: which installed connectors it is
// given, and for each tool whether it runs without asking (allow), waits
// for the person's approval each call (ask), or is hidden from the bot
// (off). Crew's gateway holds the bot to this on every CLI.
//
// And its logins: which vault logins it may sign in with, each on allow
// (Crew fills it without asking) or ask (the person approves each time).
import { useState, type KeyboardEvent } from "react";
import { MenuButton, type MenuEntry } from "@opendeck/shell";
import { LOGIN_LEVELS, LOGIN_LEVEL_NOTES, TOOL_LEVELS, TOOL_LEVEL_NOTES, levelOf, newGrant, type Connector, type Grant, type LoginGrant, type ToolLevel } from "@opendeck/crew";
import type { ConnectorView, VaultItemView } from "../shared/contract.ts";
import { connectorState } from "./Connectors.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { useConnectors, useCrew, useVault } from "./crew.tsx";

const LEVEL_LABEL: Record<ToolLevel, string> = { allow: "Allow", ask: "Ask", off: "Off" };

/** A few choices in a row; arrows move between them, like radio buttons. */
function Levels<L extends ToolLevel>({ levels, notes, value, label, onChange }: { levels: readonly L[]; notes: Record<L, string>; value: L; label: string; onChange(l: L): void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = levels.indexOf(value);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const group = e.currentTarget;
    const l = levels[(next + levels.length) % levels.length]!;
    onChange(l);
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-level="${l}"]`)?.focus());
  };
  return (
    <div className="levels" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {levels.map((l) => (
        <button key={l} type="button" role="radio" data-level={l} className={`level ${l}`} aria-checked={value === l} tabIndex={value === l ? 0 : -1} title={notes[l]} onClick={() => value !== l && onChange(l)}>
          {LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

function GrantItem({ grant, connector, botName, onChange, onRemove }: { grant: Grant; connector: ConnectorView | undefined; botName: string; onChange(g: Grant): void; onRemove(): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const tools = connector?.tools ?? [];
  const counts = TOOL_LEVELS.map((l) => [l, tools.filter((t) => levelOf(grant, t.name) === l).length] as const).filter(([, n]) => n > 0);
  const state = connector ? connectorState(connector) : null;
  const sub = !connector ? "Not installed on this computer" : state!.warn || !tools.length ? state!.text : counts.map(([l, n]) => `${n} ${l}`).join(" · ");
  const term = q.trim().toLowerCase();
  const shown = term ? tools.filter((t) => `${t.name} ${t.title} ${t.description}`.toLowerCase().includes(term)) : tools;
  const setTool = (tool: string, level: ToolLevel) => onChange({ ...grant, tools: { ...grant.tools, [tool]: level } });
  const setAll = (level: ToolLevel) => onChange({ ...grant, tools: { ...grant.tools, ...Object.fromEntries(tools.map((t) => [t.name, level])) } });
  const id = `grant-${grant.name}`;

  return (
    <li className={`grant${open ? " open" : ""}`}>
      <div className="grant-head">
        <button type="button" className="grant-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className="conn-chev" aria-hidden>
            <PixelIcon name="chevron-down" size={12} />
          </span>
          <span className="row-text">
            <span className="grant-name ell" title={grant.name}>
              {grant.name}
            </span>
            <span className={`row-sub ell${!connector || state!.warn ? " need" : ""}`}>{sub}</span>
          </span>
        </button>
        <button type="button" className="icon-btn" aria-label={`Take ${grant.name} away from ${botName}`} title={`Take ${grant.name} away from ${botName}`} onClick={onRemove}>
          <PixelIcon name="close" size={12} />
        </button>
      </div>
      {open && (
        <div className="grant-body" id={id}>
          {!connector && <p className="hint">Install {grant.name} on Connectors, or take it away.</p>}
          {connector && connector.error && <p className="conn-error">{connector.error}</p>}
          {connector && !tools.length && <p className="hint">No tools yet. Test it on Connectors.</p>}
          {tools.length > 0 && (
            <div className="grant-tools-head">
              {tools.length > 8 ? <input className="field small" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" aria-label={`Find a tool of ${grant.name}`} /> : <span className="grow" />}
              <MenuButton className="btn small" label={`Set every tool of ${grant.name}`} align="end" entries={TOOL_LEVELS.map((l) => ({ label: `${LEVEL_LABEL[l]} all`, hint: TOOL_LEVEL_NOTES[l], onSelect: () => setAll(l) }))}>
                Set all
                <PixelIcon name="chevron-down" size={12} />
              </MenuButton>
            </div>
          )}
          <ul className="tool-levels">
            {shown.map((t) => (
              <li key={t.name} className="tool-level">
                <span className="tool-level-name">
                  <span className="tool-level-label" title={t.description ? `${t.name}: ${t.description}` : t.name}>
                    {t.name}
                  </span>
                  {t.destructive && <span className="px-tag tool-tag warn">Destructive</span>}
                </span>
                <Levels levels={TOOL_LEVELS} notes={TOOL_LEVEL_NOTES} value={levelOf(grant, t.name)} label={`${t.name}: what ${botName} may do`} onChange={(l) => setTool(t.name, l)} />
              </li>
            ))}
            {term && !shown.length && <li className="hint">No tool matches “{q.trim()}”.</li>}
            <li className="tool-level later">
              <span className="tool-level-name">
                <span className="ell">Tools it adds later</span>
              </span>
              <Levels levels={TOOL_LEVELS} notes={TOOL_LEVEL_NOTES} value={grant.default} label={`Tools ${grant.name} adds later`} onChange={(l) => onChange({ ...grant, default: l })} />
            </li>
          </ul>
        </div>
      )}
    </li>
  );
}

/** The bot's connectors, saved through save(connectors). */
export function Grants({ botName, connectors: list, save }: { botName: string; connectors: Connector[]; save(next: Connector[]): void }) {
  const { connectors: installed } = useConnectors();
  const { go } = useCrew();
  const grants = list.filter((c): c is Grant => c.type === "grant");
  const byName = new Map((installed ?? []).map((c) => [c.name, c]));
  const free = (installed ?? []).filter((c) => !grants.some((g) => g.name === c.name));
  const replace = (g: Grant) => save(list.map((c) => (c.type === "grant" && c.name === g.name ? g : c)));

  const entries: MenuEntry[] = [
    ...free.map((c) => ({ label: c.name, aside: connectorState(c).text, onSelect: () => save([...list, newGrant(c.name, c.tools)]) })),
    ...(free.length ? ["separator" as const] : []),
    { label: "Manage connectors", onSelect: () => go({ name: "connectors" }) },
  ];

  return (
    <>
      {grants.length > 0 && (
        <ul className="grants">
          {grants.map((g) => (
            <GrantItem key={g.name} grant={g} connector={byName.get(g.name)} botName={botName} onChange={replace} onRemove={() => save(list.filter((c) => !(c.type === "grant" && c.name === g.name)))} />
          ))}
        </ul>
      )}
      {installed && !installed.length ? (
        <div className="inline wrap">
          <span className="hint">No connectors are installed on this computer.</span>
          <button type="button" className="btn small" onClick={() => go({ name: "connectors" })}>
            Install connectors
          </button>
        </div>
      ) : (
        <span className="inline">
          <MenuButton className="btn" label="Give a connector" entries={entries}>
            Give a connector
          </MenuButton>
        </span>
      )}
    </>
  );
}

/** Where a login is used: its first site, and how many more. */
export function loginSites(origins: string[]): string {
  const site = (o: string) => o.replace(/^https:\/\//, "");
  if (!origins.length) return "";
  return origins.length === 1 ? site(origins[0]!) : `${site(origins[0]!)} and ${origins.length - 1} more`;
}

/** The bot's logins from the vault, saved through save(logins). */
export function LoginGrants({ botName, logins, save }: { botName: string; logins: LoginGrant[]; save(next: LoginGrant[]): void }) {
  const { items } = useVault();
  const { go } = useCrew();
  const byName = new Map((items ?? []).map((i) => [i.name, i]));
  const free = (items ?? []).filter((i) => !logins.some((g) => g.name === i.name));
  const entries: MenuEntry[] = [
    ...free.map((i: VaultItemView) => ({ label: i.label, aside: loginSites(i.origins), onSelect: () => save([...logins, { name: i.name, level: "ask" as const }]) })),
    ...(free.length ? ["separator" as const] : []),
    { label: "Open the vault", onSelect: () => go({ name: "vault" }) },
  ];

  return (
    <>
      <p className="hint">{botName} never sees the password.</p>
      {logins.length > 0 && (
        <ul className="grants">
          {logins.map((g) => {
            const item = byName.get(g.name);
            const name = item ? item.label : g.name;
            const sub = item ? [item.username, loginSites(item.origins), item.hasTotp ? "2-factor" : ""].filter(Boolean).join(" · ") : "Not in the vault on this computer";
            return (
              <li key={g.name} className="grant login-grant">
                <div className="grant-head">
                  <span className="row-text">
                    <span className="grant-name ell" title={item ? `${item.label} (${g.name})` : g.name}>
                      {name}
                    </span>
                    <span className={`row-sub ell${item ? "" : " need"}`} title={item ? item.origins.join(", ") : undefined}>
                      {sub}
                    </span>
                  </span>
                  <Levels levels={LOGIN_LEVELS} notes={LOGIN_LEVEL_NOTES} value={g.level} label={`${name}: how ${botName} may use it`} onChange={(level) => save(logins.map((x) => (x.name === g.name ? { ...x, level } : x)))} />
                  <button type="button" className="icon-btn" aria-label={`Take ${name} away from ${botName}`} title={`Take ${name} away from ${botName}`} onClick={() => save(logins.filter((x) => x.name !== g.name))}>
                    <PixelIcon name="close" size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {items && !items.length ? (
        <div className="inline wrap">
          <span className="hint">No logins in the vault.</span>
          <button type="button" className="btn small" onClick={() => go({ name: "vault" })}>
            Open the vault
          </button>
        </div>
      ) : (
        <span className="inline">
          <MenuButton className="btn" label="Give a login" entries={entries}>
            Give a login
          </MenuButton>
        </span>
      )}
    </>
  );
}
