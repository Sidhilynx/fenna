// Connectors: the ones installed on this computer, their tools and tests, and
// adding one from the MCP Registry (or a form of its own values).

import "./settings.css";
import { useEffect, useRef, useState } from "react";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { ConnectorInput, ConnectorState, ConnectorType, ConnectorValueInput, ConnectorView, RegistryEntry } from "../../../crew/src/shared/contract.ts";
import { plural } from "../../../crew/src/renderer/text.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Header, IconButton, Row, Section, Sheet, Working } from "../ui.tsx";

/** Where the connector runs: its web host, or its program and words. */
function where(c: { type: ConnectorType; command?: string; args?: string[]; url?: string }): string {
  if (c.type === "url") {
    try {
      return new URL(c.url ?? "").host;
    } catch {
      return c.url ?? "";
    }
  }
  return [c.command ?? "", ...(c.args ?? [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

/** The status in words, as the desktop says it. */
function statusWords(c: ConnectorView): string {
  if (c.auth.signingIn) return "Signing in";
  if (c.auth.oauth && !c.auth.signedIn) return "Sign in needed";
  const states: Record<ConnectorState, string> = { ready: "Ready", error: `Error: ${c.error || "it couldn't start"}`, untested: "Untested", starting: "Starting" };
  return states[c.status];
}

const usedBy = (c: ConnectorView) => (c.usedBy.length ? `Used by ${c.usedBy.map((b) => b.name).join(", ")}` : "Not given to any bot");

export function Connectors() {
  const { link } = useStore();
  const [list, setList] = useState<ConnectorView[] | null>(null);
  const [error, setError] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!link.ready) return;
    invoke("crew:connectors").then(setList, (e: unknown) => setError(errorText(e)));
  }, [link.ready]);

  useEffect(() => on("crew:connectors", setList), []);

  const open = list?.find((c) => c.name === openName) ?? null;

  return (
    <>
      <Header back title="Connectors" actions={<IconButton icon="plus" label="Add a connector" onClick={() => setAdding(true)} />} />
      <ConnBar />
      <div className="m-body">
        {list === null ? (
          error ? (
            <Empty title="Couldn't load connectors" sub={error} />
          ) : (
            <div className="st-loading">
              <Working label="Loading connectors" />
            </div>
          )
        ) : list.length === 0 ? (
          <Empty title="No connectors yet" sub="Add one, then give it to a bot." />
        ) : (
          <Section>
            {list.map((c) => (
              <Row
                key={c.name}
                title={c.name}
                sub={[statusWords(c), plural(c.tools.length, "tool"), usedBy(c)].join(" · ")}
                onClick={() => setOpenName(c.name)}
              />
            ))}
          </Section>
        )}
      </div>

      {open && <Detail c={open} onClose={() => setOpenName(null)} />}
      {adding && <Add onClose={() => setAdding(false)} />}
    </>
  );
}

function Detail({ c, onClose }: { c: ConnectorView; onClose(): void }) {
  const { link, toast } = useStore();
  const act = useAct();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ready = link.ready;

  async function test() {
    setBusy(true);
    const r = await act(invoke("crew:connectorTest", c.name));
    setBusy(false);
    if (r) toast(r.status === "ready" ? `${c.name} works: ${plural(r.tools.length, "tool")}.` : `${c.name} couldn't start.`);
  }

  async function signOut() {
    const r = await act(invoke("crew:connectorSignOut", c.name));
    if (r) toast("Signed out");
  }

  async function remove() {
    const r = await act(invoke("crew:connectorRemove", c.name));
    if (!r) return;
    toast(r.bots.length ? `Removed ${c.name} from ${r.bots.join(", ")}.` : `Removed ${c.name}.`);
    onClose();
  }

  return (
    <Sheet title={c.name} onClose={onClose}>
      <p className="st-muted">{where(c)}</p>
      <p className={c.status === "error" ? "st-error" : "st-muted"}>{statusWords(c)}</p>
      <p className="st-muted">{usedBy(c)}</p>

      {c.auth.oauth && !c.auth.signedIn && <p className="st-muted">Sign in on your computer.</p>}
      {c.auth.signedIn && c.auth.account && <p className="st-muted">Signed in as {c.auth.account}</p>}

      <h3 className="st-group-title">Tools</h3>
      {c.tools.length === 0 ? (
        <p className="st-muted">No tools yet. Test to list them.</p>
      ) : (
        <ul className="st-tools">
          {c.tools.map((t) => (
            <li key={t.name} className="st-tool">
              <div className="st-tool-top">
                <span className="st-tool-name">{t.name}</span>
                {t.readOnly && !t.destructive && <span className="px-tag">Read-only</span>}
                {t.destructive && <span className="px-tag">Destructive</span>}
              </div>
              {(t.description || t.title) && <span className="st-tool-desc">{t.description || t.title}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="st-actions">
        <button type="button" className="btn" disabled={!ready || busy} onClick={() => void test()}>
          Test
        </button>
        {c.auth.signedIn && (
          <button type="button" className="btn" disabled={!ready} onClick={() => void signOut()}>
            Sign out
          </button>
        )}
        <button type="button" className="btn m-danger" disabled={!ready} onClick={() => setRemoving(true)}>
          Remove
        </button>
      </div>
      {!ready && <p className="m-help st-reason">Connect to your computer to change this.</p>}

      {removing && (
        <Sheet
          title={`Remove ${c.name}?`}
          onClose={() => setRemoving(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(false)}>
                Keep it
              </button>
              <button type="button" className="btn m-danger-fill" onClick={() => void remove()}>
                Remove {c.name}
              </button>
            </>
          }
        >
          <p className="st-sec-note">
            {c.usedBy.length
              ? `${c.usedBy.map((b) => b.name).join(", ")} ${c.usedBy.length === 1 ? "uses" : "use"} it and will lose its tools. Its saved values, secrets too, are deleted from this computer.`
              : "No bot uses it. Its saved values, secrets too, are deleted from this computer."}
          </p>
        </Sheet>
      )}
    </Sheet>
  );
}

/** Search the registry, then fill in a connector's values and add it. */
function Add({ onClose }: { onClose(): void }) {
  const { link, toast } = useStore();
  const act = useAct();
  const ready = link.ready;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [chosen, setChosen] = useState<RegistryEntry | null>(null);
  const [values, setValues] = useState<ConnectorValueInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [canForce, setCanForce] = useState(false);
  const seq = useRef(0);

  // Two letters or more, and a pause after typing, before the registry is asked.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      seq.current++;
      setResults(null);
      setSearching(false);
      setSearchError("");
      return;
    }
    const timer = setTimeout(() => {
      const mine = ++seq.current;
      setSearching(true);
      setSearchError("");
      invoke("crew:registrySearch", q).then(
        (r) => {
          if (mine === seq.current) setResults(r);
        },
        (e: unknown) => {
          if (mine !== seq.current) return;
          setResults(null);
          setSearchError(errorText(e));
        },
      ).finally(() => {
        if (mine === seq.current) setSearching(false);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  function choose(r: RegistryEntry) {
    setChosen(r);
    setValues(r.connector ? (r.connector.type === "url" ? (r.connector.headers ?? []) : (r.connector.env ?? [])) : []);
    setSaveError("");
    setCanForce(false);
  }

  async function add(force: boolean) {
    const c = chosen?.connector;
    if (!c) return;
    const input: ConnectorInput = { ...c, ...(c.type === "url" ? { headers: values } : { env: values }) };
    setSaving(true);
    setSaveError("");
    setCanForce(false);
    const r = await act(force ? invoke("crew:connectorSave", input, { force: true }) : invoke("crew:connectorSave", input));
    setSaving(false);
    if (!r) return;
    if (!r.connector) {
      setSaveError(r.error || "Couldn't add it.");
      setCanForce(true);
      return;
    }
    if (r.needsSignIn) toast("Saved. Sign in on your computer to use it.");
    else toast(r.error ? `Saved ${c.name}, but it couldn't start. Open it to see why.` : `Added ${c.name}.`);
    onClose();
  }

  function setValue(i: number, value: string) {
    setValues((vs) => vs.map((v, k) => (k === i ? { ...v, value } : v)));
  }

  return (
    <Sheet title="Add a connector" onClose={onClose}>
      {!chosen ? (
        <>
          <label className="m-field">
            <span className="m-label">Search the MCP Registry</span>
            <input className="field" type="search" value={query} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
            <span className="m-help">{query.trim().length < 2 ? "Type at least 2 letters." : searching ? "Searching…" : ""}</span>
          </label>
          {searchError && <p className="st-error">{searchError}</p>}
          {results?.length === 0 && <p className="st-muted">No matches.</p>}
          {results && results.length > 0 && (
            <Section>
              {results.map((r) => (
                <Row
                  key={r.name}
                  title={r.title || r.name}
                  sub={
                    <>
                      {r.description && <span className="st-sub-line">{r.description}</span>}
                      {r.note && <span className="st-sub-line">{r.note}</span>}
                    </>
                  }
                  onClick={() => choose(r)}
                />
              ))}
            </Section>
          )}
        </>
      ) : (
        <>
          <h3 className="st-group-title">{chosen.title || chosen.name}</h3>
          {chosen.connector ? (
            <>
              <p className="st-muted">{where(chosen.connector)}</p>
              {values.map((v, i) => (
                <label key={`${v.key}-${i}`} className="m-field">
                  <span className="m-label">{v.key}</span>
                  <input
                    className="field"
                    type={v.secret ? "password" : "text"}
                    value={v.value}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(e) => setValue(i, e.target.value)}
                  />
                </label>
              ))}
            </>
          ) : (
            <p className="st-muted">{chosen.note}</p>
          )}
          {saveError && (
            <p className="st-error" role="alert">
              {saveError}
            </p>
          )}
          {!ready && <p className="m-help st-reason">Connect to your computer to add a connector.</p>}
          <div className="st-actions">
            {chosen.connector && (
              <button type="button" className="btn primary" disabled={!ready || saving} onClick={() => void add(false)}>
                Add
              </button>
            )}
            {canForce && (
              <button type="button" className="btn" disabled={!ready || saving} onClick={() => void add(true)}>
                Add anyway
              </button>
            )}
            <button type="button" className="btn" onClick={() => setChosen(null)}>
              Choose another
            </button>
          </div>
        </>
      )}
      {saving && <Working label="Adding" />}
    </Sheet>
  );
}
