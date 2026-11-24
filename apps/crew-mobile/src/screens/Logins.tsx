// Logins: the vault's sign-ins, edited and added here. Passwords are never
// shown or copied on the phone; a password can only be typed in.

import "./settings.css";
import { useEffect, useState } from "react";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { VaultItemInput, VaultItemView } from "../../../crew/src/shared/contract.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Header, IconButton, Row, Section, Sheet, Working } from "../ui.tsx";

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** The sites as typed, one per line or comma-separated, each made an origin. The server says what is wrong with one. */
function sitesOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const line = raw.trim();
    if (!line) continue;
    let origin = line;
    try {
      origin = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(line) ? line : `https://${line}`).origin;
    } catch {
      /* kept as typed */
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

export function Logins() {
  const { link } = useStore();
  const [items, setItems] = useState<VaultItemView[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<VaultItemView | "new" | null>(null);

  useEffect(() => {
    if (!link.ready) return;
    invoke("crew:vault").then(setItems, (e: unknown) => setError(errorText(e)));
  }, [link.ready]);

  useEffect(() => on("crew:vault", setItems), []);

  return (
    <>
      <Header back title="Logins" actions={<IconButton icon="plus" label="Add a login" onClick={() => setOpen("new")} />} />
      <ConnBar />
      <div className="m-body">
        <p className="st-note">Passwords can be seen only on your computer.</p>
        {items === null ? (
          error ? (
            <Empty title="Couldn't load logins" sub={error} />
          ) : (
            <div className="st-loading">
              <Working label="Loading logins" />
            </div>
          )
        ) : items.length === 0 ? (
          <Empty title="No logins yet" sub="Add one, and a bot you allow can sign in with it." />
        ) : (
          <Section>
            {items.map((i) => (
              <Row
                key={i.name}
                title={i.label}
                sub={[i.username, i.origins.map(hostOf).join(", "), i.usedBy.length ? `Used by ${i.usedBy.map((b) => b.name).join(", ")}` : ""].filter(Boolean).join(" · ")}
                right={i.hasTotp ? <span className="px-tag">2-factor</span> : undefined}
                onClick={() => setOpen(i)}
              />
            ))}
          </Section>
        )}
      </div>

      {open && <Edit item={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Edit({ item, onClose }: { item: VaultItemView | null; onClose(): void }) {
  const { link, toast } = useStore();
  const act = useAct();
  const ready = link.ready;
  const [label, setLabel] = useState(item?.label ?? "");
  const [sites, setSites] = useState(item ? item.origins.join("\n") : "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function save() {
    const origins = sitesOf(sites);
    if (!label.trim()) return setError("Give the login a label, like Work mail.");
    if (origins.length === 0) return setError("Add the site's address, like https://accounts.example.com.");
    if (!item && !password) return setError("Type the password. Crew keeps it encrypted on this computer and fills it in for your bots.");
    const input: VaultItemInput = {
      label: label.trim(),
      origins,
      username: username.trim(),
      notes: notes.trim(),
      ...(password ? { password } : { keepPassword: true }),
      ...(item ? { keepTotp: true } : {}),
    };
    setBusy(true);
    setError("");
    const r = await act(invoke("crew:vaultSave", input, item ? { replace: item.name } : undefined));
    setBusy(false);
    if (r) {
      toast("Saved");
      onClose();
    }
  }

  async function remove() {
    if (!item) return;
    const r = await act(invoke("crew:vaultRemove", item.name));
    if (!r) return;
    toast(r.bots.length ? `Removed ${item.label} from the vault and from ${r.bots.join(", ")}.` : `Removed ${item.label}.`);
    onClose();
  }

  return (
    <Sheet title={item ? item.label : "Add a login"} onClose={onClose}>
      <label className="m-field">
        <span className="m-label">Label</span>
        <input className="field" value={label} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="m-label">Sites, one per line</span>
        <textarea className="field" rows={2} value={sites} placeholder="https://accounts.example.com" spellCheck={false} autoCapitalize="off" onChange={(e) => setSites(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="m-label">Username</span>
        <input className="field" value={username} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="m-label">Password</span>
        <input
          className="field"
          type="password"
          autoComplete="off"
          value={password}
          placeholder={item?.hasPassword ? "Saved. Type to replace" : "Password"}
          onChange={(e) => setPassword(e.target.value)}
        />
        {item && <span className="m-help">Leave it empty to keep the saved password.</span>}
      </label>
      <label className="m-field">
        <span className="m-label">Notes</span>
        <textarea className="field" rows={2} value={notes} placeholder="Optional. Never given to a bot." onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
      {!ready && <p className="m-help st-reason">Connect to your computer to save changes.</p>}

      <div className="st-actions">
        <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void save()}>
          Save
        </button>
        {item && (
          <button type="button" className="btn m-danger" disabled={!ready} onClick={() => setRemoving(true)}>
            Remove
          </button>
        )}
      </div>
      {busy && <Working label="Saving" />}

      {removing && item && (
        <Sheet
          title={`Remove ${item.label}?`}
          onClose={() => setRemoving(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(false)}>
                Keep it
              </button>
              <button type="button" className="btn m-danger-fill" onClick={() => void remove()}>
                Remove {item.label}
              </button>
            </>
          }
        >
          <p className="st-sec-note">
            {item.usedBy.length
              ? `${item.usedBy.map((b) => b.name).join(", ")} ${item.usedBy.length === 1 ? "uses" : "use"} it and can no longer sign in with it. Its password is deleted from this computer.`
              : "No bot uses it. Its password is deleted from this computer."}
          </p>
        </Sheet>
      )}
    </Sheet>
  );
}
