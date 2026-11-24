// Skills: the instructions a bot follows for one kind of task (a folder with
// SKILL.md). The Skills page adds one once per computer, from a folder, a
// file or an address, shows what it says before it is added, and removes it.
// A bot's Details give it skills by name (SkillGrants). Nothing is added
// until the person has read the preview.

import { useEffect, useState } from "react";
import { Dialog, MenuButton, toast } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { SkillDetail, SkillLibraryGroup, SkillPreview, SkillView } from "../shared/contract.ts";
import { Fact, PixelEmpty } from "./Connectors.tsx";
import { Markdown } from "./Markdown.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { useCrew, useSkills } from "./crew.tsx";
import { formatSize } from "./diskPaths.ts";
import { PixelField } from "./PixelField.tsx";
import { plural } from "./util.ts";

const usedLine = (s: SkillView) => (s.usedBy.length ? `Used by ${s.usedBy.map((b) => b.name).join(", ")}` : "Not given to any bot");
const filesLine = (files: { length: number }, size: number) => `${plural(files.length, "file")}, ${formatSize(size)}`;

/** The files beside SKILL.md, each with its size. */
function OtherFiles({ files }: { files: { path: string; size: number }[] }) {
  const others = files.filter((f) => f.path !== "SKILL.md");
  if (!others.length) return null;
  return (
    <ul className="tool-list" aria-label="Other files">
      {others.map((f) => (
        <li key={f.path} className="tool-row">
          <span className="tool-top">
            <span className="tool-name">{f.path}</span>
          </span>
          <span className="list-sub">{formatSize(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SkillsPage() {
  const { skills, error } = useSkills();
  const [review, setReview] = useState<SkillPreview | null>(null);
  const [address, setAddress] = useState(false);
  const [removing, setRemoving] = useState<SkillView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const pick = (channel: "crew:skillFolder" | "crew:skillFile") =>
    invoke(channel).then(
      (p) => p && setReview(p),
      (e) => toast(errorText(e)),
    );
  const addFromLibrary = (category: string, name: string) => {
    setAdding(name);
    invoke("crew:skillLibraryPreview", category, name).then(
      (p) => {
        setAdding(null);
        setReview(p);
      },
      (e) => {
        setAdding(null);
        toast(errorText(e));
      },
    );
  };
  const adds = [
    { label: "From a folder", onSelect: () => void pick("crew:skillFolder") },
    { label: "From a file", onSelect: () => void pick("crew:skillFile") },
    { label: "From an address", onSelect: () => setAddress(true) },
  ];

  return (
    <main className="main overview conn-page px-host" aria-label="Skills">
      <PixelField density={2} alpha={0.3} />
      <div className="ov-head">
        <div className="ov-title">
          <h1>Skills</h1>
        </div>
        {skills && skills.length > 0 && (
          <MenuButton className="btn" label="Add skill" entries={adds}>
            Add skill
          </MenuButton>
        )}
      </div>
      {!skills ? (
        <p className="hint">{error || "Loading"}</p>
      ) : !skills.length ? (
        <>
          <PixelEmpty icon="skills">No skills added yet. Add one from the library below.</PixelEmpty>
          <div className="inline wrap">
            {adds.map((a) => (
              <button key={a.label} type="button" className="btn" onClick={a.onSelect}>
                {a.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="hint">Give a skill to a bot in its Details.</p>
          <ul className="conn-list">
            {skills.map((s) => (
              <SkillItem key={s.name} s={s} open={open === s.name} toggle={() => setOpen(open === s.name ? null : s.name)} onRemove={() => setRemoving(s)} />
            ))}
          </ul>
        </>
      )}
      <Library installed={new Set((skills ?? []).map((s) => s.name))} adding={adding} onAdd={addFromLibrary} />
      {address && (
        <AddressDialog
          onClose={() => setAddress(false)}
          onPreview={(p) => {
            setAddress(false);
            setReview(p);
          }}
        />
      )}
      {review && <SkillReview preview={review} onClose={() => setReview(null)} />}
      {removing && <RemoveSkill s={removing} onClose={() => setRemoving(null)} />}
    </main>
  );
}

/** The starter skills, by category. Add reads the skill into the same preview as any other source; nothing is added unseen. */
function Library({ installed, adding, onAdd }: { installed: Set<string>; adding: string | null; onAdd(category: string, name: string): void }) {
  const [groups, setGroups] = useState<SkillLibraryGroup[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    invoke("crew:skillLibrary").then(
      (g) => alive && setGroups(g),
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="conn-section library" aria-label="Library">
      <div className="section-title">Library</div>
      <p className="hint">Starter skills. Read one before you add it.</p>
      {!groups ? (
        <p className="hint">{error || "Loading"}</p>
      ) : (
        groups.map((g) => (
          <div key={g.category} className="library-group">
            <div className="section-title">{g.title}</div>
            <ul className="conn-list">
              {g.skills.map((s) => (
                <li key={s.name} className="cli-item">
                  <div className="library-row">
                    <span className="cli-text">
                      <span className="cli-name ell">{s.name}</span>
                      <span className="cli-sub ell" title={s.description}>
                        {s.description}
                      </span>
                    </span>
                    {s.saves && <span className="hint library-saves">Saves {s.saves}</span>}
                    {installed.has(s.name) ? (
                      <span className="hint">Added</span>
                    ) : (
                      <button
                        type="button"
                        className="btn small"
                        disabled={adding !== null}
                        aria-label={`Add ${s.name}`}
                        onClick={() => onAdd(g.category, s.name)}
                      >
                        {adding === s.name ? "Reading…" : "Add"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function SkillItem({ s, open, toggle, onRemove }: { s: SkillView; open: boolean; toggle(): void; onRemove(): void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState("");
  const id = `skill-${s.name}`;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    invoke("crew:skill", s.name).then(
      (d) => alive && setDetail(d),
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [open, s.name]);

  return (
    <li className={`cli-item conn-item${open ? " open" : ""}`}>
      <button type="button" className="cli-tile" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="cli-text">
          <span className="cli-name ell" title={s.name}>
            {s.name}
          </span>
          <span className="cli-sub ell" title={s.description}>
            {s.description}
          </span>
        </span>
        <span className="conn-used ell" title={usedLine(s)}>
          {usedLine(s)}
        </span>
        <span className="conn-chev" aria-hidden>
          <PixelIcon name="chevron-down" size={12} />
        </span>
      </button>
      {open && (
        <div className="cli-detail conn-detail" id={id}>
          {error && (
            <p className="conn-error" role="alert">
              {error}
            </p>
          )}
          <dl className="facts">
            <Fact label="Files" value={filesLine(s.files, s.size)} />
            <Fact label="Bots" value={s.usedBy.length ? s.usedBy.map((b) => b.name).join(", ") : "None yet"} />
          </dl>
          {detail ? (
            <>
              <div className="skill-body">
                <Markdown text={detail.body} />
              </div>
              <OtherFiles files={detail.files} />
            </>
          ) : (
            !error && <p className="hint">Loading</p>
          )}
          <div className="actions">
            <button type="button" className="btn danger" onClick={onRemove}>
              <PixelIcon name="trash" size={14} />
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The preview of a skill read from a folder, a file or an address: everything in it, before it is added. */
function SkillReview({ preview, onClose }: { preview: SkillPreview; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = () => {
    setBusy(true);
    setError("");
    invoke("crew:skillAdd", preview.id).then(
      (s) => {
        toast(`${preview.replaces ? "Replaced" : "Added"} ${s.name}.`);
        onClose();
      },
      (e) => {
        setBusy(false);
        setError(errorText(e));
      },
    );
  };

  return (
    <Dialog title={preview.replaces ? `Replace ${preview.name}?` : `Add ${preview.name}?`} onClose={onClose} width={680}>
      <div className="form">
        <dl className="facts">
          <Fact label="Name" value={preview.name} />
          <Fact label="Description" value={preview.description} />
          <Fact label="Files" value={filesLine(preview.files, preview.size)} />
        </dl>
        <div className="skill-body">
          <Markdown text={preview.body} />
        </div>
        <OtherFiles files={preview.files} />
        <p className="hint">A skill is instructions a bot will follow. Read it before you add it.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-acts">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={add} data-autofocus>
            Add skill
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function AddressDialog({ onClose, onPreview }: { onClose(): void; onPreview(p: SkillPreview): void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = () => {
    setBusy(true);
    setError("");
    invoke("crew:skillUrl", url.trim()).then(onPreview, (e) => {
      setBusy(false);
      setError(errorText(e));
    });
  };

  return (
    <Dialog title="Add a skill from an address" onClose={onClose} width={580}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) read();
        }}
      >
        <p className="hint">A SKILL.md address, or a GitHub folder, like https://github.com/owner/repo/tree/main/weekly-report</p>
        <label className="lab">
          Address
          <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" spellCheck={false} data-autofocus />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-acts">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !url.trim()}>
            {busy ? "Reading…" : "Read skill"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveSkill({ s, onClose }: { s: SkillView; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const names = s.usedBy.map((b) => b.name);
  return (
    <Dialog title={`Remove ${s.name}?`} onClose={onClose} width={440}>
      <p className="dialog-text">
        {names.length
          ? `${names.join(", ")} ${names.length === 1 ? "has" : "have"} it and will lose it. Its folder is deleted from this computer.`
          : "No bot has it. Its folder is deleted from this computer."}
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
            invoke("crew:skillRemove", s.name).then(
              (r) => {
                toast(r.bots.length ? `Removed ${s.name} from this computer and from ${r.bots.join(", ")}.` : `Removed ${s.name}.`);
                onClose();
              },
              (e) => {
                setBusy(false);
                toast(errorText(e));
              },
            );
          }}
        >
          Remove {s.name}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * A bot's skills, in its Details: a check for each installed skill. A granted
 * name that is no longer installed stays listed, so it can be unchecked.
 */
export function SkillGrants({ botName, granted, save }: { botName: string; granted: string[]; save(next: string[]): void }) {
  const { skills, error } = useSkills();
  const { go } = useCrew();
  if (!skills) return <p className="hint">{error || "Loading"}</p>;
  const installed = new Map(skills.map((s) => [s.name, s]));
  const names = [...skills.map((s) => s.name), ...granted.filter((n) => !installed.has(n))];

  return (
    <>
      {names.length > 0 && (
        <ul className="skill-checks">
          {names.map((name) => {
            const s = installed.get(name);
            return (
              <li key={name}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    className="pcheck"
                    checked={granted.includes(name)}
                    aria-label={`${name}: ${botName} may use it`}
                    onChange={(e) => save(e.target.checked ? [...granted, name] : granted.filter((n) => n !== name))}
                  />
                  <span className="skill-check-text">
                    <span className="ell">{name}</span>
                    <span className={`hint ell${s ? "" : " need"}`}>{s ? s.description : "Not installed on this computer"}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!skills.length && (
        <div className="inline wrap">
          <span className="hint">No skills yet.</span>
          <button type="button" className="btn small" onClick={() => go({ name: "skills" })}>
            Add a skill
          </button>
        </div>
      )}
    </>
  );
}
