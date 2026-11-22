// The Connectors page: what is installed on this computer for bots to use
// (a program this computer starts, or a server on the web), its status and
// tools, and adding (search the MCP Registry, a command, or an address),
// testing, editing and removing one. Bots are given connectors, tool by
// tool, in their Details (Grants.tsx).
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, toast } from "@opendeck/shell";
import { connectorNameProblem, connectorUrlProblem, FENNA_APPS, type ConnectorType } from "@opendeck/crew";
import { errorText, invoke } from "../shared/api.ts";
import type { ConnectorInput, ConnectorTool, ConnectorView, RegistryEntry } from "../shared/contract.ts";
import { CATEGORIES, CONNECTOR_CATALOG, type CatalogEntry, type ConnectorCategory } from "./connectorCatalog.ts";
import { fennaAppIcon } from "./appIcons.ts";
import { CONNECTOR_LOGOS } from "./connectorLogos.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import type { PixelIconName } from "./pixelIcons.ts";
import { useConnectors } from "./crew.tsx";
import { plural, when } from "./util.ts";
import { PixelField } from "./PixelField.tsx";

/** Where a connector is: its command line, or its web address's host. */
function connectorWhere(c: Pick<ConnectorView, "type" | "command" | "args" | "url">): string {
  if (c.type === "url") {
    try {
      return new URL(c.url).host;
    } catch {
      return c.url;
    }
  }
  return [c.command, ...c.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

export function connectorState(c: ConnectorView): { text: string; warn: boolean } {
  if (c.auth?.signingIn) return { text: "Signing in", warn: false };
  if (c.auth?.oauth && !c.auth.signedIn) return { text: "Sign in needed", warn: true };
  if (c.status === "starting") return { text: "Starting", warn: false };
  if (c.status === "error") return { text: "Couldn't start", warn: true };
  if (c.status === "untested") return { text: "Not started yet", warn: false };
  return { text: `Ready · ${plural(c.tools.length, "tool")}`, warn: false };
}

const usedLine = (c: ConnectorView) => (c.usedBy.length ? `Used by ${c.usedBy.map((b) => b.name).join(", ")}` : "Not given to any bot");

/** A pixel icon at 48px in a framed square, and one line of what is true. */
export function PixelEmpty({ icon, children }: { icon: PixelIconName; children: ReactNode }) {
  return (
    <div className="px-empty">
      <span className="px-empty-art" aria-hidden>
        <PixelIcon name={icon} size={48} />
      </span>
      <p className="hint">{children}</p>
    </div>
  );
}

export function ConnectorsPage() {
  const { connectors, error } = useConnectors();
  const [dialog, setDialog] = useState<null | { edit: ConnectorView | null; preset?: CatalogEntry }>(null);
  const [removing, setRemoving] = useState<ConnectorView | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <main className="main overview conn-page px-host" aria-label="Connectors">
      <PixelField density={2} alpha={0.3} />
      <div className="ov-head">
        <div className="ov-title">
          <h1>Connectors</h1>
        </div>
        <button type="button" className="btn" onClick={() => setDialog({ edit: null })}>
          Add custom
        </button>
      </div>
      {!connectors ? (
        <p className="hint">{error || "Loading"}</p>
      ) : (
        <>
          {connectors.length > 0 && (
            <section className="conn-section" aria-label="Installed">
              <h2 className="section-title">Installed</h2>
              <ul className="conn-list">
                {connectors.map((c) => (
                  <ConnectorItem key={c.name} c={c} open={open === c.name} toggle={() => setOpen(open === c.name ? null : c.name)} onEdit={() => setDialog({ edit: c })} onRemove={() => setRemoving(c)} />
                ))}
              </ul>
            </section>
          )}
          <BuiltIn />
          <Catalog installed={connectors} onAdd={(preset) => setDialog({ edit: null, preset })} />
        </>
      )}
      {dialog && <ConnectorDialog editing={dialog.edit} preset={dialog.preset} onClose={() => setDialog(null)} />}
      {removing && <RemoveDialog c={removing} onClose={() => setRemoving(null)} />}
    </main>
  );
}

/** A vendor's real brand logo, or a small plug when we have none. */
function Logo({ entry }: { entry: Pick<CatalogEntry, "id" | "logo"> }) {
  const markup = CONNECTOR_LOGOS[entry.id];
  return markup ? (
    <span className="conn-logo" aria-hidden dangerouslySetInnerHTML={{ __html: markup }} />
  ) : (
    <span className="conn-logo" aria-hidden>
      <svg viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges" focusable="false">
        <rect x="4" y="1" width="2" height="4" />
        <rect x="10" y="1" width="2" height="4" />
        <rect x="3" y="5" width="10" height="4" />
        <rect x="5" y="9" width="6" height="2" />
        <rect x="7" y="11" width="2" height="4" />
      </svg>
    </span>
  );
}

/** The Fenna apps every bot can use; they are turned off per bot in its computer. */
function BuiltIn() {
  return (
    <section className="conn-section" aria-label="Built in">
      <h2 className="section-title">Built in</h2>
      <ul className="conn-grid">
        {FENNA_APPS.map((a) => (
          <li key={a.id} className="conn-card">
            <span className="conn-logo" aria-hidden>
              <img src={fennaAppIcon(a.id)} alt="" />
            </span>
            <span className="conn-card-text">
              <span className="conn-card-name">
                <span className="ell" title={a.name}>
                  {a.name}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const sameConnector =(e: CatalogEntry, c: ConnectorView) => c.name === e.id || (e.kind === "url" ? c.url === e.url : c.command === e.command && c.args.join(" ") === (e.args ?? []).join(" "));

function Catalog({ installed, onAdd }: { installed: ConnectorView[]; onAdd(e: CatalogEntry): void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | ConnectorCategory>("All");
  const term = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      CONNECTOR_CATALOG.filter((e) => (category === "All" || e.category === category) && (!term || `${e.name} ${e.vendor} ${e.description}`.toLowerCase().includes(term))).sort(
        (a, b) => Number(!!b.featured) - Number(!!a.featured),
      ),
    [term, category],
  );
  return (
    <section className="conn-section" aria-label="Add a connector">
      <h2 className="section-title">Add a connector</h2>
      <div className="conn-filter">
        <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connectors" aria-label="Search connectors" spellCheck={false} />
        <div className="seg-row" role="tablist" aria-label="Category">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button key={c} type="button" role="tab" className="tab" aria-selected={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ul className="conn-grid">
          {shown.map((e) => {
            const added = installed.some((c) => sameConnector(e, c));
            return (
              <li key={e.id} className="conn-card">
                <Logo entry={e} />
                <span className="conn-card-text">
                  <span className="conn-card-name">
                    <span className="ell" title={e.name}>
                      {e.name}
                    </span>
                    {e.vendor !== e.name && (
                      <span className="conn-card-vendor ell" title={e.vendor}>
                        {e.vendor}
                      </span>
                    )}
                    {e.featured && <span className="px-tag conn-card-featured">Featured</span>}
                  </span>
                  <span className="conn-card-desc" title={e.description}>
                    {e.description}
                  </span>
                </span>
                {added ? (
                  <span className="px-tag conn-card-added">Added</span>
                ) : (
                  <button type="button" className="icon-btn px-ibtn" title={`Add ${e.name}`} aria-label={`Add ${e.name}`} onClick={() => onAdd(e)}>
                    <PixelIcon name="plus" size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <PixelEmpty icon="search">No match for “{query.trim()}”. Try Add custom.</PixelEmpty>
      )}
    </section>
  );
}

function ConnectorItem({ c, open, toggle, onEdit, onRemove }: { c: ConnectorView; open: boolean; toggle(): void; onEdit(): void; onRemove(): void }) {
  const [testing, setTesting] = useState(false);
  const state = connectorState(c);
  const id = `conn-${c.name}`;
  const values = c.type === "url" ? c.headers : c.env;

  const test = async () => {
    setTesting(true);
    try {
      const r = await invoke("crew:connectorTest", c.name);
      toast(r.status === "ready" ? `${c.name} works: ${plural(r.tools.length, "tool")}.` : `${c.name} couldn't start.`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className={`cli-item conn-item${open ? " open" : ""}`}>
      <button type="button" className="cli-tile" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <Logo entry={CONNECTOR_CATALOG.find((e) => sameConnector(e, c)) ?? { id: c.name, logo: false }} />
        <span className="cli-text">
          <span className="cli-name ell" title={c.name}>
            {c.name}
          </span>
          <span className="cli-sub ell" title={connectorWhere(c)}>
            {connectorWhere(c)}
          </span>
        </span>
        <span className="conn-used ell" title={usedLine(c)}>
          {usedLine(c)}
        </span>
        <span className={`px-tag cli-state${state.warn ? " warn" : c.status === "ready" ? " ok" : ""}`}>{state.text}</span>
        <span className="conn-chev" aria-hidden>
          <PixelIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && (
        <div className="cli-detail conn-detail" id={id}>
          {c.error && (
            <p className="conn-error" role="alert">
              {c.error}
            </p>
          )}
          {c.auth?.oauth && <SignIn c={c} />}
          <dl className="facts">
            <Fact label={c.type === "url" ? "Address" : "Command"} value={c.type === "url" ? c.url : connectorWhere(c)} />
            {values.map((v) => (
              <Fact key={v.key} label={v.key} value={v.secret ? (v.set ? "Secret, saved" : "Secret, not set") : v.value || "Empty"} />
            ))}
            <Fact label="Bots" value={c.usedBy.length ? c.usedBy.map((b) => b.name).join(", ") : "None yet"} />
            <Fact label="Checked" value={c.checkedAt ? when(c.checkedAt) : "Never"} />
          </dl>
          <div className="actions">
            <button type="button" className="btn" disabled={testing} onClick={() => void test()}>
              {testing ? "Testing…" : "Test"}
            </button>
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn danger" onClick={onRemove}>
              <PixelIcon name="trash" size={14} />
              Remove
            </button>
          </div>
          <ToolList tools={c.tools} />
        </div>
      )}
    </li>
  );
}

/**
 * A web connector's sign-in: who is signed in and Sign out, or Sign in
 * (which opens the person's browser) and, while it waits, Cancel. A server
 * that doesn't let apps register asks for a client ID first.
 */
export function SignIn({ c, onSignedIn }: { c: ConnectorView; onSignedIn?(c: ConnectorView): void }) {
  const [error, setError] = useState("");
  const [askId, setAskId] = useState(false);
  const [clientId, setClientId] = useState(c.auth.clientId);
  const [busy, setBusy] = useState(false);
  const host = connectorWhere(c);
  const waiting = c.auth.signingIn || busy;

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await invoke("crew:connectorSignIn", c.name, askId || clientId ? { clientId: clientId.trim() } : {});
      if (r.error) {
        if (r.error !== "Sign-in was cancelled.") setError(r.error);
        setAskId(r.needsClientId);
        return;
      }
      setAskId(false);
      toast(`Signed in to ${host}${r.connector.auth.account ? ` as ${r.connector.auth.account}` : ""}. ${plural(r.connector.tools.length, "tool")}.`);
      onSignedIn?.(r.connector);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const signOut = () =>
    invoke("crew:connectorSignOut", c.name).then(
      () => toast(`Signed out of ${host}. Bots can't use ${c.name} until you sign in again.`),
      (e) => setError(errorText(e)),
    );

  return (
    <div className="signin" role="group" aria-label="Sign-in">
      {c.auth.signedIn ? (
        <>
          <span className="signin-text">
            <span className="signin-dot ok" aria-hidden />
            {c.auth.account ? `Signed in as ${c.auth.account}` : `Signed in to ${host}`}
          </span>
          <button type="button" className="btn small" onClick={() => void signOut()}>
            Sign out
          </button>
        </>
      ) : waiting ? (
        <>
          <span className="signin-text" role="status">
            Finish in your browser.
          </span>
          <button type="button" className="btn small" onClick={() => void invoke("crew:connectorSignInCancel", c.name)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="signin-text">
            <span className="signin-dot" aria-hidden />
            Sign in to {host}.
          </span>
          <button type="button" className="btn primary small" onClick={() => void signIn()}>
            Sign in
          </button>
        </>
      )}
      {askId && !waiting && !c.auth.signedIn && (
        <label className="lab signin-id">
          Client ID
          <input className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From the server's app or developer settings" spellCheck={false} autoComplete="off" />
        </label>
      )}
      {error && (
        <p className="form-error signin-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="facts-row">
      <dt className="ell" title={label}>
        {label}
      </dt>
      <dd className="ell" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ToolList({ tools }: { tools: ConnectorTool[] }) {
  const [q, setQ] = useState("");
  if (!tools.length) return <p className="hint">No tools yet. Test to list them.</p>;
  const term = q.trim().toLowerCase();
  const shown = term ? tools.filter((t) => `${t.name} ${t.title} ${t.description}`.toLowerCase().includes(term)) : tools;
  return (
    <section className="tools" aria-label="Tools">
      <div className="tools-head">
        <h3 className="label">{plural(tools.length, "tool")}</h3>
        {tools.length > 8 && <input className="field small" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" aria-label="Find a tool" />}
      </div>
      <ul className="tool-list">
        {shown.map((t) => (
          <li key={t.name} className="tool-row">
            <span className="tool-top">
              <span className="tool-name">
                {t.name}
              </span>
              {t.readOnly && !t.destructive && <span className="px-tag tool-tag">Read-only</span>}
              {t.destructive && <span className="px-tag tool-tag warn">Destructive</span>}
            </span>
            {(t.title || t.description) && <span className="list-sub clamp">{t.description || t.title}</span>}
          </li>
        ))}
        {!shown.length && <li className="hint">No tool matches “{q.trim()}”.</li>}
      </ul>
    </section>
  );
}

function RemoveDialog({ c, onClose }: { c: ConnectorView; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const names = c.usedBy.map((b) => b.name);
  return (
    <Dialog title={`Remove ${c.name}?`} onClose={onClose} width={440}>
      <p className="dialog-text">
        {names.length
          ? `${names.join(", ")} ${names.length === 1 ? "uses" : "use"} it and will lose its tools. Its saved values, secrets too, are deleted from this computer.`
          : "No bot uses it. Its saved values, secrets too, are deleted from this computer."}
      </p>
      <div className="form-acts">
        <button type="button" className="btn" onClick={onClose} data-autofocus>
          Keep it
        </button>
        <button
          type="button"
          className="btn primary danger-fill"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            invoke("crew:connectorRemove", c.name).then(
              (r) => {
                toast(r.bots.length ? `Removed ${c.name} from this computer and from ${r.bots.join(", ")}.` : `Removed ${c.name}.`);
                onClose();
              },
              (e) => {
                setBusy(false);
                toast(errorText(e));
              },
            );
          }}
        >
          Remove {c.name}
        </button>
      </div>
    </Dialog>
  );
}

// ── Adding and editing ─────────────────────────────────────────────────

type Tab = "registry" | ConnectorType;
const TABS: { id: Tab; label: string }[] = [
  { id: "registry", label: "Registry" },
  { id: "command", label: "Command" },
  { id: "url", label: "Web address" },
];

interface Row {
  id: number;
  key: string;
  value: string;
  secret: boolean;
  /** Editing: a secret saved before, left as it is until something is typed. */
  keep: boolean;
}

/** Words as typed, with "double quotes" holding a space. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? "");
}
const joinWords = (args: string[]) => args.map((a) => (/\s/.test(a) || !a ? `"${a}"` : a)).join(" ");

let rowId = 0;
const toRows = (list: { key: string; value: string; secret: boolean; set?: boolean }[], editing: boolean): Row[] =>
  list.map((v) => ({ id: ++rowId, key: v.key, value: v.value, secret: v.secret, keep: editing && v.secret && !!v.set }));

export function ConnectorDialog({ editing, preset, onClose }: { editing: ConnectorView | null; preset?: CatalogEntry; onClose(): void }) {
  const [tab, setTab] = useState<Tab>(editing ? editing.type : preset ? (preset.kind === "url" ? "url" : "command") : "registry");
  const [name, setName] = useState(editing?.name ?? preset?.id ?? "");
  const [command, setCommand] = useState(editing?.command ?? preset?.command ?? "");
  const [args, setArgs] = useState(editing ? joinWords(editing.args) : joinWords(preset?.args ?? []));
  const [url, setUrl] = useState(editing?.url ?? preset?.url ?? "");
  const [env, setEnv] = useState<Row[]>(() => toRows(editing?.env ?? (preset?.env ?? []).map((v) => ({ key: v.name, value: "", secret: v.secret })), !!editing));
  const [headers, setHeaders] = useState<Row[]>(() => toRows(editing?.headers ?? [], !!editing));
  const [origin, setOrigin] = useState(editing?.origin ?? (preset ? "catalog" : ""));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { connectors } = useConnectors();
  const pending = saved ? (connectors?.find((x) => x.name === saved) ?? null) : null;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const type: ConnectorType = tab === "url" ? "url" : "command";
  const verb = editing ? "Save" : "Add";

  const submit = async (force = false) => {
    const n = name.trim();
    const problem = connectorNameProblem(n) ?? (type === "url" ? connectorUrlProblem(url.trim()) : !command.trim() ? "Say which program starts it, like npx, uvx or node." : null);
    if (problem) {
      setError(problem);
      return;
    }
    const rows = (type === "url" ? headers : env).filter((r) => r.key.trim() || r.value);
    const values = rows.map((r) => ({ key: r.key.trim(), value: r.keep ? "" : r.value, secret: r.secret, ...(r.keep ? { keep: true } : {}) }));
    const input: ConnectorInput = type === "url" ? { name: n, type, url: url.trim(), headers: values, origin: origin || "url" } : { name: n, type, command: command.trim(), args: words(args), env: values, origin: origin || "command" };
    setBusy(true);
    setError("");
    setFailed("");
    try {
      const r = await invoke("crew:connectorSave", input, { ...(editing ? { replace: editing.name } : {}), force });
      if (!r.connector) {
        setFailed(r.error);
        return;
      }
      if (r.needsSignIn) {
        setSaved(r.connector.name);
        return;
      }
      toast(r.error ? `Saved ${n}, but it couldn't start. Open it to see why.` : `${editing ? "Saved" : "Installed"} ${n} with ${plural(r.connector.tools.length, "tool")}.`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    const mine = ++searchSeq.current;
    setSearching(true);
    setError("");
    try {
      const r = await invoke("crew:registrySearch", q);
      if (mine === searchSeq.current) setResults(r);
    } catch (e) {
      if (mine === searchSeq.current) {
        setResults(null);
        setError(errorText(e));
      }
    } finally {
      if (mine === searchSeq.current) setSearching(false);
    }
  };

  const setUp = (r: RegistryEntry) => {
    const c = r.connector;
    if (!c) return;
    setName(c.name);
    setOrigin(c.origin ?? "");
    setNote(r.note);
    setFailed("");
    setError("");
    if (c.type === "url") {
      setUrl(c.url ?? "");
      setHeaders(toRows(c.headers ?? [], false));
      setTab("url");
    } else {
      setCommand(c.command ?? "");
      setArgs(joinWords(c.args ?? []));
      setEnv(toRows(c.env ?? [], false));
      setTab("command");
    }
  };

  const form = (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {note || (origin === "catalog" && preset?.auth === "oauth") ? (
        <p className="hint">{[note, origin === "catalog" && preset?.auth === "oauth" ? "Your browser opens to sign in once it is added." : ""].filter(Boolean).join(" ")}</p>
      ) : (
        type === "command" && <p className="hint">Only add programs you trust.</p>
      )}
      <label className="lab">
        Name
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "url" ? "tracker" : "calendar"} disabled={!!editing} spellCheck={false} data-autofocus={!editing || undefined} />
      </label>
      {type === "command" ? (
        <>
          <label className="lab">
            Command
            <input className="field" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" spellCheck={false} data-autofocus={editing ? true : undefined} />
          </label>
          <label className="lab">
            Arguments
            <input className="field" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @example/calendar-mcp" spellCheck={false} />
          </label>
          {preset?.env && <p className="hint">Needs {preset.env.map((v) => v.label).join(", ")}.</p>}
          <Values label="Environment" what="value" rows={env} setRows={setEnv} keyHint="API_TOKEN" />
        </>
      ) : (
        <>
          <label className="lab">
            Address
            <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" spellCheck={false} data-autofocus={editing ? true : undefined} />
          </label>
          <Values label="Headers" what="header" rows={headers} setRows={setHeaders} keyHint="Authorization" />
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {failed && (
        <div className="conn-error" role="alert">
          <p>{failed}</p>
          <p className="hint">Fix it and try again, or {editing ? "save" : "add"} it anyway and test it later.</p>
        </div>
      )}
      <div className="form-acts">
        {failed && (
          <button type="button" className="btn left" disabled={busy} onClick={() => void submit(true)}>
            {verb} anyway
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Connecting…" : editing ? "Save and test" : "Add and test"}
        </button>
      </div>
    </form>
  );

  if (pending) {
    return (
      <Dialog title={`Sign in to ${connectorWhere(pending)}`} onClose={onClose} width={580}>
        <div className="form">
          <p className="hint">Installed {pending.name}. Sign-in is kept encrypted on this computer.</p>
          <SignIn
            c={pending}
            onSignedIn={() => {
              onClose();
            }}
          />
          <div className="form-acts">
            <button type="button" className="btn" onClick={onClose}>
              {pending.auth.signedIn ? "Done" : "Sign in later"}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={editing ? `Edit ${editing.name}` : preset ? `Add ${preset.name}` : "Add a custom connector"} onClose={onClose} width={680}>
      {!editing && (
        <div className="seg-row" role="tablist" aria-label="How to add it">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setError("");
                setFailed("");
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === "registry" ? (
        <div className="form">
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the MCP Registry, like calendar or github" aria-label="Search the MCP Registry" data-autofocus />
            <button type="submit" className="btn" disabled={searching || !query.trim()}>
              Search
            </button>
          </form>
          {searching && <p className="hint">Searching…</p>}
          {!results && !searching && <p className="hint">Pick one to fill in its details.</p>}
          {results && !searching && !results.length && <p className="hint">Nothing found for “{query.trim()}”.</p>}
          <div className="list">
            {results?.map((r) => (
              <div key={`${r.name}@${r.version}`} className="list-row">
                <span className="list-main">
                  <span className="list-title ell" title={r.name}>
                    {r.title || r.name}
                  </span>
                  <span className="list-sub clamp">{r.description}</span>
                  {r.note && <span className="list-note">{r.note}</span>}
                </span>
                <button type="button" className="btn" disabled={!r.connector} onClick={() => setUp(r)}>
                  Set up
                </button>
              </div>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        form
      )}
    </Dialog>
  );
}

function Values({ label, what, rows, setRows, keyHint }: { label: string; what: "value" | "header"; rows: Row[]; setRows(r: Row[]): void; keyHint: string }) {
  const change = (id: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <fieldset className="lab fieldset">
      <legend>{label}</legend>
      {rows.length > 0 && (
        <ul className="values">
          {rows.map((r, i) => (
            <li key={r.id} className="value-row">
              <input className="field" value={r.key} onChange={(e) => change(r.id, { key: e.target.value })} placeholder={keyHint} aria-label={`${label} ${i + 1} name`} spellCheck={false} />
              <input
                className="field"
                type={r.secret ? "password" : "text"}
                value={r.value}
                onChange={(e) => change(r.id, { value: e.target.value, keep: false })}
                placeholder={r.keep ? "Saved. Type to replace" : r.secret ? "Secret" : "Value"}
                aria-label={`${label} ${i + 1} value`}
                autoComplete="off"
                spellCheck={false}
              />
              <label className="check-row small" title="Stored encrypted on this computer and never shown again">
                <input className="pcheck" type="checkbox" checked={r.secret} onChange={(e) => change(r.id, { secret: e.target.checked, keep: e.target.checked && r.keep })} />
                Secret
              </label>
              <button type="button" className="icon-btn" aria-label={`Remove ${r.key || `${what} ${i + 1}`}`} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>
                <PixelIcon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="inline">
        <button type="button" className="btn small" onClick={() => setRows([...rows, { id: ++rowId, key: "", value: "", secret: what === "header", keep: false }])}>
          <PixelIcon name="plus" size={12} />
          Add {what === "header" ? "a header" : "a value"}
        </button>
        <span className="hint">Secrets are encrypted on this computer.</span>
      </span>
    </fieldset>
  );
}
