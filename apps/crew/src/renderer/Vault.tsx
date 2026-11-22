// The Vault page: the person's site logins, kept encrypted on this
// computer. Each has a label, the sites (origins) it may be filled on, a
// username, a password and, if the site uses them, a 2-factor setup key.
// Bots are given logins in their Details (Grants.tsx); Crew fills them in
// and no bot ever sees a password. This page never holds a secret either:
// it shows them masked, a password only after Reveal (hidden again after
// 20 seconds), and Copy goes through the main process.

import { useEffect, useRef, useState } from "react";
import { Dialog, toast } from "@opendeck/shell";
import { LIMITS, MASK, checkOrigin } from "@opendeck/crew";
import { errorText, invoke } from "../shared/api.ts";
import type { LoginGrant, VaultItemInput, VaultItemView } from "../shared/contract.ts";
import { PixelEmpty } from "./Connectors.tsx";
import { loginSites } from "./Grants.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { useCrew, useVault } from "./crew.tsx";
import { plural, when } from "./util.ts";
import { PixelField } from "./PixelField.tsx";

const REVEAL_MS = 20_000;

/** A form opened with some fields already filled in. */
interface LoginPreset {
  label: string;
  origins: string[];
  usernamePlaceholder: string;
}

const GOOGLE_PRESET: LoginPreset = { label: "Google account", origins: ["https://accounts.google.com"], usernamePlaceholder: "name@gmail.com" };

const usedLine = (i: VaultItemView) => (i.usedBy.length ? `Used by ${i.usedBy.map((b) => b.name).join(", ")}` : "Not given to any bot");

export function VaultPage() {
  const { items, error } = useVault();
  const [dialog, setDialog] = useState<null | { edit: VaultItemView | null; preset?: LoginPreset }>(null);
  const [removing, setRemoving] = useState<VaultItemView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const term = q.trim().toLowerCase();
  const shown = items && term ? items.filter((i) => `${i.label} ${i.username} ${i.origins.join(" ")}`.toLowerCase().includes(term)) : items;

  return (
    <main className="main overview conn-page vault-page px-host" aria-label="Vault">
      <PixelField density={2} alpha={0.3} />
      <div className="ov-head">
        <div className="ov-title">
          <h1>Vault</h1>
          <p>Encrypted on this computer. Bots never see a password.</p>
        </div>
        <div className="inline">
          <button type="button" className="btn" onClick={() => setDialog({ edit: null, preset: GOOGLE_PRESET })} disabled={!!error}>
            Add a Google account
          </button>
          <button type="button" className="btn primary" onClick={() => setDialog({ edit: null })} disabled={!!error}>
            <PixelIcon name="plus" size={12} />
            Add login
          </button>
        </div>
      </div>
      {error ? (
        <p className="conn-error vault-error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <p className="hint">Loading</p>
      ) : !items.length ? (
        <PixelEmpty icon="vault">No logins yet.</PixelEmpty>
      ) : (
        <>
          {items.length > 8 && (
            <div className="vault-find">
              <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find among ${plural(items.length, "login")}`} aria-label="Find a login" />
            </div>
          )}
          <ul className="conn-list">
            {shown!.map((i) => (
              <VaultRow key={i.name} item={i} open={open === i.name} toggle={() => setOpen(open === i.name ? null : i.name)} onEdit={() => setDialog({ edit: i })} onRemove={() => setRemoving(i)} />
            ))}
            {term && !shown!.length && <li className="hint">No login matches “{q.trim()}”.</li>}
          </ul>
        </>
      )}
      {dialog && <LoginDialog editing={dialog.edit} preset={dialog.preset} onClose={() => setDialog(null)} />}
      {removing && <RemoveLoginDialog item={removing} onClose={() => setRemoving(null)} />}
    </main>
  );
}

function copy(name: string, what: "username" | "password" | "code", label: string) {
  invoke("crew:vaultCopy", name, what).then(
    (r) => toast(r.clearsIn ? `Copied the ${label}. The clipboard is cleared in ${r.clearsIn} seconds.` : `Copied the ${label}.`),
    (e) => toast(errorText(e)),
  );
}

const SHOWN_ICONS = 3;
const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

// Each site's icon is asked for once per session; the main process keeps the answer on disk.
const iconCache = new Map<string, Promise<string | null>>();
const siteIcon = (origin: string) => {
  let icon = iconCache.get(origin);
  if (!icon) {
    icon = invoke("crew:siteIcon", origin).catch(() => null);
    iconCache.set(origin, icon);
  }
  return icon;
};

/**
 * The icons of a login's sites: up to three overlapped, then "+N". Hover or
 * focus (of the row, or inside) spreads them out to show all. Icons load once
 * the stack scrolls into view; a site without one shows the pixel globe.
 */
export function SiteIcons({ sites }: { sites: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const key = sites.join("\n");

  useEffect(() => {
    if (ready || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    for (const site of key.split("\n").filter(Boolean)) {
      void siteIcon(site).then((src) => {
        if (live) setIcons((prev) => ({ ...prev, [site]: src }));
      });
    }
    return () => {
      live = false;
    };
  }, [ready, key]);

  if (!sites.length) return null;
  const more = sites.length - SHOWN_ICONS;
  return (
    <span className="site-icons" ref={ref} role="group" aria-label={`Sites: ${sites.map(hostOf).join(", ")}`}>
      <span className="site-icons-row">
        {sites.map((site, i) => {
          const src = icons[site];
          return (
            <span key={site} className={`site-icon${i >= SHOWN_ICONS ? " site-icon-extra" : ""}`} title={hostOf(site)}>
              {src ? (
                <img src={src} alt="" width={16} height={16} draggable={false} onError={() => setIcons((prev) => ({ ...prev, [site]: null }))} />
              ) : (
                <PixelIcon name="site" size={16} />
              )}
            </span>
          );
        })}
      </span>
      {more > 0 && <span className="site-icons-more">+{more}</span>}
    </span>
  );
}

function VaultRow({ item, open, toggle, onEdit, onRemove }: { item: VaultItemView; open: boolean; toggle(): void; onEdit(): void; onRemove(): void }) {
  const id = `login-${item.name}`;
  return (
    <li className={`cli-item conn-item${open ? " open" : ""}`}>
      <button type="button" className="cli-tile" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="lib-icon">
          <SiteIcons sites={item.origins} />
        </span>
        <span className="cli-text">
          <span className="cli-name ell" title={item.label}>
            {item.label}
          </span>
          <span className="cli-sub ell" title={[item.username, ...item.origins].filter(Boolean).join(" · ")}>
            {[item.username, loginSites(item.origins)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="conn-used ell" title={usedLine(item)}>
          {usedLine(item)}
        </span>
        {item.hasTotp && <span className="px-tag">2-factor</span>}
        <span className="conn-chev" aria-hidden>
          <PixelIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && (
        <div className="cli-detail conn-detail" id={id}>
          <dl className="facts">
            <div className="facts-row">
              <dt>{item.origins.length === 1 ? "Site" : "Sites"}</dt>
              <dd className="vault-sites">
                {item.origins.map((o) => (
                  <span key={o} className="ell" title={o}>
                    {o}
                  </span>
                ))}
              </dd>
            </div>
            <SecretRow label="Username" value={item.username || "None"} onCopy={item.username ? () => copy(item.name, "username", "username") : undefined} />
            <PasswordRow item={item} />
            {item.hasTotp && <SecretRow label="2-factor" value="Setup key saved" onCopy={() => copy(item.name, "code", "current code")} copyLabel="Copy code" />}
            {item.notes && <SecretRow label="Notes" value={item.notes} wrap />}
            <SecretRow label="Bots" value={item.usedBy.length ? item.usedBy.map((b) => `${b.name} (${b.level === "allow" ? "allow" : "ask"})`).join(", ") : "None yet"} />
            <SecretRow label="Last used" value={item.lastUsedAt ? when(item.lastUsedAt) : "Never"} />
          </dl>
          <div className="actions">
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn danger" onClick={onRemove}>
              <PixelIcon name="trash" size={12} />
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function SecretRow({ label, value, onCopy, copyLabel = "Copy", wrap = false }: { label: string; value: string; onCopy?(): void; copyLabel?: string; wrap?: boolean }) {
  return (
    <div className="facts-row">
      <dt className="ell" title={label}>
        {label}
      </dt>
      <dd className={wrap ? "vault-wrap" : "ell"} title={wrap ? undefined : value}>
        {value}
      </dd>
      {onCopy && (
        <button type="button" className="icon-btn px-ibtn" onClick={onCopy} title={copyLabel} aria-label={`${copyLabel} ${label.toLowerCase()}`}>
          <PixelIcon name="duplicate" size={12} />
        </button>
      )}
    </div>
  );
}

/** The password, masked; Reveal shows it until Hide, leaving the page, or 20 seconds. */
function PasswordRow({ item }: { item: VaultItemView }) {
  const [plain, setPlain] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const hide = () => {
    window.clearTimeout(timer.current);
    setPlain(null);
  };
  const reveal = () =>
    invoke("crew:vaultReveal", item.name).then(
      (r) => {
        setPlain(r.password);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setPlain(null), REVEAL_MS);
      },
      (e) => toast(errorText(e)),
    );
  return (
    <div className="facts-row">
      <dt>Password</dt>
      <dd className={plain === null ? "ell vault-mask" : "ell vault-plain"} aria-live="polite">
        {plain === null ? MASK : plain}
      </dd>
      <span className="vault-acts">
        <button type="button" className="icon-btn px-ibtn" aria-pressed={plain !== null} onClick={() => (plain === null ? void reveal() : hide())} title={plain === null ? "Reveal" : "Hide"} aria-label={plain === null ? "Reveal password" : "Hide password"}>
          <PixelIcon name="eye" size={12} />
        </button>
        <button type="button" className="icon-btn px-ibtn" onClick={() => copy(item.name, "password", "password")} title="Copy" aria-label="Copy password">
          <PixelIcon name="duplicate" size={12} />
        </button>
      </span>
    </div>
  );
}

function RemoveLoginDialog({ item, onClose }: { item: VaultItemView; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const names = item.usedBy.map((b) => b.name);
  return (
    <Dialog title={`Remove ${item.label}?`} onClose={onClose} width={440}>
      <p className="dialog-text">
        {names.length
          ? `${names.join(", ")} ${names.length === 1 ? "uses" : "use"} it and can no longer sign in with it. Its password${item.hasTotp ? " and setup key are" : " is"} deleted from this computer.`
          : `No bot uses it. Its password${item.hasTotp ? " and setup key are" : " is"} deleted from this computer.`}
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
            invoke("crew:vaultRemove", item.name).then(
              (r) => {
                toast(r.bots.length ? `Removed ${item.label} from the vault and from ${r.bots.join(", ")}.` : `Removed ${item.label}.`);
                onClose();
              },
              (e) => {
                setBusy(false);
                toast(errorText(e));
              },
            );
          }}
        >
          Remove {item.label}
        </button>
      </div>
    </Dialog>
  );
}

/** A page address pasted as a site becomes its origin ("https://a.example/login" → "https://a.example"). */
function asOrigin(line: string): string {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(line) ? line : `https://${line}`);
    if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
  } catch {
    /* checkOrigin says what is wrong */
  }
  return line;
}

/** The origins as typed, one per line, each made an origin, or the first problem. */
function readOrigins(text: string): { origins: string[] } | { error: string } {
  const out: string[] = [];
  for (const line of text.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean)) {
    const c = checkOrigin(asOrigin(line));
    if ("error" in c) return c;
    if (!out.includes(c.origin)) out.push(c.origin);
  }
  if (!out.length) return { error: "Add the site's origin, like https://accounts.example.com. Crew fills the login only there." };
  if (out.length > LIMITS.vaultOrigins) return { error: `A login can have at most ${LIMITS.vaultOrigins} sites.` };
  return { origins: out };
}

export function LoginDialog({ editing, preset, onClose }: { editing: VaultItemView | null; preset?: LoginPreset; onClose(): void }) {
  const { overview } = useCrew();
  const [label, setLabel] = useState(editing?.label ?? preset?.label ?? "");
  const [sites, setSites] = useState(editing ? editing.origins.join("\n") : (preset?.origins.join("\n") ?? ""));
  const [username, setUsername] = useState(editing?.username ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [totp, setTotp] = useState("");
  const [dropTotp, setDropTotp] = useState(false);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignments, setAssignments] = useState<{ slug: string; name: string; assigned: boolean; level: "ask" | "allow" }[]>(() =>
    overview.bots.map((b) => {
      const u = editing?.usedBy.find((x) => x.slug === b.slug);
      return { slug: b.slug, name: b.name, assigned: !!u, level: u?.level || "ask" };
    }),
  );

  const tidySites = () => {
    const r = readOrigins(sites);
    if ("origins" in r) setSites(r.origins.join("\n"));
  };

  const submit = async () => {
    if (!label.trim()) return setError("Give the login a label, like Work mail.");
    const o = readOrigins(sites);
    if ("error" in o) return setError(o.error);
    if (!editing && !password) return setError("Type the password. Crew keeps it encrypted on this computer and fills it in for your bots.");
    const input: VaultItemInput = {
      label: label.trim(),
      origins: o.origins,
      username: username.trim(),
      ...(password ? { password } : { keepPassword: true }),
      ...(totp.trim() ? { totp: totp.trim() } : dropTotp ? { totp: "" } : { keepTotp: !!editing }),
      notes: notes.trim(),
    };
    setBusy(true);
    setError("");
    try {
      const saved = await invoke("crew:vaultSave", input, editing ? { replace: editing.name } : {});
      for (const a of assignments) {
        try {
          const detail = await invoke("crew:bot", a.slug);
          if (!detail || !detail.bot) continue;
          const curLogins: LoginGrant[] = detail.bot.logins || [];
          const exists = curLogins.some((l: LoginGrant) => l.name === saved.name);
          if (a.assigned) {
            const nextLogins = exists
              ? curLogins.map((l: LoginGrant) => (l.name === saved.name ? { ...l, level: a.level } : l))
              : [...curLogins, { name: saved.name, level: a.level }];
            await invoke("crew:update", a.slug, { logins: nextLogins });
          } else if (exists) {
            const nextLogins = curLogins.filter((l: LoginGrant) => l.name !== saved.name);
            await invoke("crew:update", a.slug, { logins: nextLogins });
          }
        } catch {
          continue;
        }
      }
      toast(editing ? `Saved ${saved.label}.` : `Added ${saved.label} to the vault.`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={editing ? `Edit ${editing.label}` : "Add a login"} onClose={onClose} width={520}>
      <form
        className="form vault-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="hint">Encrypted on this computer. Bots never see the password.</p>
        <label className="lab">
          Label
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work mail" maxLength={LIMITS.vaultLabel} data-autofocus />
        </label>
        {editing && <SiteIcons sites={editing.origins} />}
        <label className="lab">
          Sites
          <textarea className="field area vault-sites-field" rows={2} value={sites} onChange={(e) => setSites(e.target.value)} onBlur={tidySites} placeholder="https://accounts.example.com" spellCheck={false} aria-describedby="sites-hint" />
          <span className="hint" id="sites-hint">
            One per line. Only these exact sites get the login.
          </span>
        </label>
        <label className="lab">
          Username
          <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={preset?.usernamePlaceholder ?? "you@example.com"} maxLength={LIMITS.vaultUsername} autoComplete="off" spellCheck={false} />
        </label>
        <label className="lab">
          Password
          <span className="inline">
            <input
              className="field"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing?.hasPassword ? "Saved. Type to replace" : "Password"}
              maxLength={LIMITS.vaultPassword}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button type="button" className="icon-btn px-ibtn" aria-pressed={show} onClick={() => setShow(!show)} title={show ? "Hide" : "Show"} aria-label={show ? "Hide the password" : "Show the password"}>
              <PixelIcon name="eye" size={12} />
            </button>
          </span>
        </label>
        <label className="lab">
          2-factor setup key
          <input
            className="field"
            type="password"
            value={totp}
            onChange={(e) => {
              setTotp(e.target.value);
              setDropTotp(false);
            }}
            placeholder={editing?.hasTotp && !dropTotp ? "Saved. Paste a new one to replace" : "Optional. The key or otpauth:// link"}
            autoComplete="off"
            spellCheck={false}
          />
          {editing?.hasTotp && !totp && (
            <label className="check-row small">
              <input type="checkbox" checked={dropTotp} onChange={(e) => setDropTotp(e.target.checked)} />
              Remove the saved key
            </label>
          )}
        </label>
        <label className="lab">
          Notes
          <textarea className="field area" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={LIMITS.vaultNotes} placeholder="Optional. Never given to a bot." />
        </label>
        <div className="lab">
          <span className="label">Used by</span>
          <div className="vault-bot-list">
            {assignments.map((a, i) => (
              <div key={a.slug} className="vault-bot-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={a.assigned}
                    onChange={(e) => {
                      const next = [...assignments];
                      next[i] = { ...a, assigned: e.target.checked };
                      setAssignments(next);
                    }}
                  />
                  <span className="vault-bot-name">{a.name}</span>
                </label>
                {a.assigned && (
                  <div className="seg px-seg" role="group" aria-label={`Permission for ${a.name}`}>
                    <button
                      type="button"
                      className="seg-btn px-seg-btn"
                      aria-pressed={a.level === "ask"}
                      onClick={() => {
                        const next = [...assignments];
                        next[i] = { ...a, level: "ask" };
                        setAssignments(next);
                      }}
                    >
                      Ask first
                    </button>
                    <button
                      type="button"
                      className="seg-btn px-seg-btn"
                      aria-pressed={a.level === "allow"}
                      onClick={() => {
                        const next = [...assignments];
                        next[i] = { ...a, level: "allow" };
                        setAssignments(next);
                      }}
                    >
                      Allow
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!assignments.length && <p className="hint">No bots created yet.</p>}
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-acts">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : "Add login"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
