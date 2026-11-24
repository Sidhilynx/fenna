// Skills: the instructions installed on this computer, read in full, removed,
// and added from an address (a SKILL.md or a GitHub folder).

import "./settings.css";
import { useEffect, useState } from "react";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { SkillDetail, SkillPreview, SkillView } from "../../../crew/src/shared/contract.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Header, IconButton, Row, Section, Sheet, Working } from "../ui.tsx";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const usedBy = (s: SkillView) => (s.usedBy.length ? `Used by ${s.usedBy.map((b) => b.name).join(", ")}` : "Not given to any bot");

function Files({ files }: { files: SkillView["files"] }) {
  if (files.length === 0) return null;
  return (
    <>
      <h3 className="st-group-title">Files</h3>
      <ul className="st-files">
        {files.map((f) => (
          <li key={f.path} className="st-file">
            <span className="st-tool-name">{f.path}</span>
            <span className="st-muted">{size(f.size)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Skills() {
  const { link } = useStore();
  const [list, setList] = useState<SkillView[] | null>(null);
  const [error, setError] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!link.ready) return;
    invoke("crew:skills").then(setList, (e: unknown) => setError(errorText(e)));
  }, [link.ready]);

  useEffect(() => on("crew:skills", setList), []);

  const open = list?.find((s) => s.name === openName) ?? null;

  return (
    <>
      <Header back title="Skills" actions={<IconButton icon="plus" label="Add a skill" onClick={() => setAdding(true)} />} />
      <ConnBar />
      <div className="m-body">
        {list === null ? (
          error ? (
            <Empty title="Couldn't load skills" sub={error} />
          ) : (
            <div className="st-loading">
              <Working label="Loading skills" />
            </div>
          )
        ) : list.length === 0 ? (
          <Empty title="No skills yet" sub="Add one from an address, then give it to a bot." />
        ) : (
          <Section>
            {list.map((s) => (
              <Row
                key={s.name}
                title={s.name}
                sub={[s.description, size(s.size), usedBy(s)].filter(Boolean).join(" · ")}
                onClick={() => setOpenName(s.name)}
              />
            ))}
          </Section>
        )}
      </div>

      {open && <Detail s={open} onClose={() => setOpenName(null)} />}
      {adding && <Add onClose={() => setAdding(false)} />}
    </>
  );
}

function Detail({ s, onClose }: { s: SkillView; onClose(): void }) {
  const { link, toast } = useStore();
  const act = useAct();
  const [full, setFull] = useState<SkillDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke("crew:skill", s.name).then(
      (d) => {
        if (alive) setFull(d);
      },
      (e: unknown) => {
        if (alive) setLoadError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [s.name]);

  async function remove() {
    const r = await act(invoke("crew:skillRemove", s.name));
    if (!r) return;
    toast(r.bots.length ? `Removed ${s.name} from ${r.bots.join(", ")}.` : `Removed ${s.name}.`);
    onClose();
  }

  return (
    <Sheet title={s.name} onClose={onClose}>
      {s.description && <p className="st-sec-note">{s.description}</p>}
      <p className="st-muted">{usedBy(s)}</p>

      <h3 className="st-group-title">Instructions</h3>
      {full ? (
        <pre className="st-pre">{full.body}</pre>
      ) : loadError ? (
        <p className="st-error">{loadError}</p>
      ) : (
        <div className="st-loading">
          <Working label="Loading instructions" />
        </div>
      )}

      <Files files={s.files} />

      <div className="st-actions">
        <button type="button" className="btn m-danger" disabled={!link.ready} onClick={() => setRemoving(true)}>
          Remove
        </button>
      </div>
      {!link.ready && <p className="m-help st-reason">Connect to your computer to change this.</p>}

      {removing && (
        <Sheet
          title={`Remove ${s.name}?`}
          onClose={() => setRemoving(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setRemoving(false)}>
                Keep it
              </button>
              <button type="button" className="btn m-danger-fill" onClick={() => void remove()}>
                Remove {s.name}
              </button>
            </>
          }
        >
          <p className="st-sec-note">
            {s.usedBy.length
              ? `${s.usedBy.map((b) => b.name).join(", ")} ${s.usedBy.length === 1 ? "uses" : "use"} it and will lose it. It is deleted from this computer.`
              : "No bot uses it. It is deleted from this computer."}
          </p>
        </Sheet>
      )}
    </Sheet>
  );
}

/** An https address, read first, then added. */
function Add({ onClose }: { onClose(): void }) {
  const { link, toast } = useStore();
  const act = useAct();
  const ready = link.ready;
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function look() {
    setBusy(true);
    const r = await act(invoke("crew:skillUrl", url.trim()));
    setBusy(false);
    if (r) setPreview(r);
  }

  async function add() {
    if (!preview) return;
    setBusy(true);
    const r = await act(invoke("crew:skillAdd", preview.id));
    setBusy(false);
    if (!r) return;
    toast(preview.replaces ? `Replaced ${preview.name}.` : `Added ${preview.name}.`);
    onClose();
  }

  return (
    <Sheet title="Add a skill from an address" onClose={onClose}>
      {!preview ? (
        <>
          <label className="m-field">
            <span className="m-label">Address</span>
            <input className="field" type="url" inputMode="url" value={url} placeholder="https://" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
            <span className="m-help">A SKILL.md address, or a GitHub folder.</span>
          </label>
          {!ready && <p className="m-help st-reason">Connect to your computer to add a skill.</p>}
          <div className="st-actions">
            <button type="button" className="btn primary" disabled={!ready || busy || !url.trim()} onClick={() => void look()}>
              Preview
            </button>
          </div>
          {busy && <Working label="Reading the skill" />}
        </>
      ) : (
        <>
          <h3 className="st-group-title">{preview.name}</h3>
          {preview.description && <p className="st-sec-note">{preview.description}</p>}
          {preview.replaces && <p className="st-muted">A skill called {preview.name} is installed. Adding replaces it.</p>}
          <p className="st-muted">A skill is instructions a bot will follow.</p>

          <h3 className="st-group-title">Instructions</h3>
          <pre className="st-pre">{preview.body}</pre>

          <Files files={preview.files} />

          <p className="m-help st-reason">Adding from a folder or file is done on your computer.</p>
          <div className="st-actions">
            <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void add()}>
              Add skill
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              Use another address
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
