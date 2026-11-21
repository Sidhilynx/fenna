// Import memory: bring what another AI tool knows about the person into a bot's
// memory.md (or every bot's). Three ways in: paste the answer to a prompt given to
// another assistant, choose a file, or tick a memory file the CLIs keep on this
// computer. The facts are shown and approved before anything is written.

import { useEffect, useRef, useState } from "react";
import { Dialog, MenuButton, toast, type MenuEntry } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary, MemoryFact, MemoryRead, MemorySource } from "../shared/contract.ts";
import { PixelCheck } from "./PixelCheck.tsx";
import { Glyph } from "./Glyph.tsx";

type Mode = "ai" | "file" | "computer";

const MODES: { id: Mode; label: string }[] = [
  { id: "ai", label: "From another AI" },
  { id: "file", label: "From a file" },
  { id: "computer", label: "From this computer" },
];

const CATEGORY_ORDER = ["about", "work", "projects", "preferences", "style", "tools", "people", "routines", "avoid", "other"];
const CATEGORY_LABEL: Record<string, string> = {
  about: "About",
  work: "Work",
  projects: "Projects",
  preferences: "Preferences",
  style: "Writing style",
  tools: "Tools",
  people: "People",
  routines: "Routines",
  avoid: "Things to avoid",
  other: "Other",
};

const MAX_FACT = 500;
const MAX_FILE = 1_000_000;
const EVERY = "all";

interface Item extends MemoryFact {
  id: number;
  source: string;
  on: boolean;
}

interface Review {
  items: Item[];
  secretsLeftOut: number;
  tooMany: number;
}

const sizeText = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The facts of each source as review rows, numbered in order, all ticked. */
const itemsOf = (sources: { source: string; facts: MemoryFact[] }[]): Item[] =>
  sources.flatMap((s) => s.facts.map((f) => ({ category: f.category, text: f.text, source: s.source })))
    .map((row, id) => ({ ...row, id, on: true }));

export function ImportMemoryDialog({ bots, fixed, onDone, onClose }: { bots: BotSummary[]; fixed?: BotSummary; onDone?(): void; onClose(): void }) {
  const [mode, setMode] = useState<Mode>("ai");
  const [target, setTarget] = useState<string>(fixed ? fixed.slug : EVERY);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [fileName, setFileName] = useState("");
  const [scan, setScan] = useState<MemorySource[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke("crew:memoryPrompt").then(setPrompt, (e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    if (mode !== "computer" || scan) return;
    invoke("crew:memoryScan").then(setScan, (e) => {
      setScan([]);
      setError(errorText(e));
    });
  }, [mode, scan]);

  const pick = (next: Mode) => {
    setMode(next);
    setReview(null);
    setError("");
  };

  const readText = async (text: string, source: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await invoke("crew:memoryParse", text);
      if (!r.facts.length) {
        setError("No facts found in that. Paste the answer in the format from the first step, or choose another file.");
        setReview(null);
        return;
      }
      setReview({ items: itemsOf([{ source, facts: r.facts }]), secretsLeftOut: r.secretsLeftOut, tooMany: r.tooMany });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE) {
      setError("That file is bigger than 1 MB. Copy the part you want into a text file and choose that.");
      setReview(null);
      return;
    }
    await readText(await file.text(), `file ${file.name}`);
  };

  const readPicked = async () => {
    setBusy(true);
    setError("");
    try {
      const results: MemoryRead[] = await invoke("crew:memoryRead", picked);
      const failed = results.filter((r) => r.error).map((r) => r.error as string);
      const usable = results.filter((r) => !r.error && r.facts.length);
      if (!usable.length) {
        setError(failed.length ? failed.join(" ") : "No facts found in those files.");
        setReview(null);
        return;
      }
      setReview({
        items: itemsOf(usable.map((r) => ({ source: r.source, facts: r.facts }))),
        secretsLeftOut: usable.reduce((n, r) => n + r.secretsLeftOut, 0),
        tooMany: usable.reduce((n, r) => n + r.tooMany, 0),
      });
      if (failed.length) setError(failed.join(" "));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Copied the prompt.");
    } catch {
      toast("Could not copy. Select the prompt and copy it.");
    }
  };

  const setItem = (id: number, patch: Partial<Item>) => setReview((r) => (r ? { ...r, items: r.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : r));

  const chosen = review ? review.items.filter((it) => it.on && it.text.trim()) : [];
  const targetBots = target === EVERY ? bots : bots.filter((b) => b.slug === target);
  const targetName = target === EVERY ? "Every bot" : (bots.find((b) => b.slug === target)?.name ?? "Every bot");

  const add = async () => {
    if (!review || !chosen.length || busy) return;
    const groups = new Map<string, MemoryFact[]>();
    for (const it of chosen) {
      const list = groups.get(it.source) ?? [];
      list.push({ category: it.category, text: it.text.trim() });
      groups.set(it.source, list);
    }
    setBusy(true);
    setError("");
    try {
      const r = await invoke(
        "crew:memoryImport",
        targetBots.map((b) => b.slug),
        [...groups].map(([source, facts]) => ({ source, facts })),
      );
      const added = r.bots.reduce((n, b) => n + b.added, 0);
      const skipped = r.bots.reduce((n, b) => n + b.skipped, 0);
      const only = targetBots.length === 1 ? targetBots[0] : undefined;
      const where = only ? `${only.name}'s memory` : `${targetBots.length} bots`;
      const again = skipped ? ` ${skipped} ${plural(skipped, "was", "were")} already there.` : "";
      toast(`Added ${added} to ${where}.${again}`);
      onDone?.();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const groupsOf = (items: Item[]) => CATEGORY_ORDER.map((c) => ({ c, rows: items.filter((it) => it.category === c) })).filter((g) => g.rows.length);
  const sources = scan ? [...new Set(scan.map((s) => s.group))] : [];

  const targetEntries: MenuEntry[] = [
    { label: "Every bot", checked: target === EVERY, onSelect: () => setTarget(EVERY) },
    ...bots.map((b) => ({ label: b.name, checked: target === b.slug, onSelect: () => setTarget(b.slug) })),
  ];

  return (
    <Dialog title="Import memory" onClose={onClose} width={620}>
      <div className="im">
        <div className="im-top">
          {fixed ? (
            <span className="im-for">For {fixed.name}</span>
          ) : (
            <div className="pick">
              <span className="pick-label">Bot</span>
              <MenuButton className="btn pick-btn" label={`Bot: ${targetName}`} entries={targetEntries}>
                <span className="ell">{targetName}</span>
                <Glyph name="chevron" size={12} />
              </MenuButton>
            </div>
          )}
          <div className="seg px-seg" role="group" aria-label="Where the memory comes from">
            {MODES.map((m) => (
              <button key={m.id} type="button" className="seg-btn px-seg-btn" aria-pressed={mode === m.id} disabled={busy} onClick={() => pick(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {!review && mode === "ai" && (
          <>
            <p className="dialog-text">Paste this into ChatGPT, Claude, Gemini or another assistant you use, then paste its answer below.</p>
            <textarea className="field area im-prompt" readOnly rows={6} value={prompt ?? ""} aria-label="Prompt for another assistant" />
            <div className="form-acts">
              <button type="button" className="btn" disabled={!prompt} onClick={() => void copy()}>
                Copy
              </button>
            </div>
            <label className="dsec-title" htmlFor="im-answer">
              Its answer
            </label>
            <textarea id="im-answer" className="field area" rows={4} value={answer} placeholder="Paste the answer here" onChange={(e) => setAnswer(e.target.value)} />
            <div className="form-acts">
              <button type="button" className="btn primary" disabled={!answer.trim() || busy} onClick={() => void readText(answer, "another AI")}>
                Read answer
              </button>
            </div>
          </>
        )}

        {!review && mode === "file" && (
          <>
            <p className="dialog-text">Choose a memory export (.json), CLAUDE.md, AGENTS.md, GEMINI.md, or a text file of custom instructions.</p>
            <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.json,text/plain,application/json,text/markdown" className="im-hidden" tabIndex={-1} aria-hidden onChange={(e) => void chooseFile(e.target.files?.[0])} />
            <div className="form-acts">
              {fileName && <span className="hint ell">{fileName}</span>}
              <button type="button" className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
            </div>
          </>
        )}

        {!review && mode === "computer" && (
          <>
            <p className="dialog-text">Only the files you tick are read. Nothing is sent anywhere.</p>
            {!scan ? (
              <p className="hint">Looking…</p>
            ) : !scan.length ? (
              <p className="hint">No memory files from these tools on this computer.</p>
            ) : (
              <div className="im-files">
                {sources.map((group) => (
                  <div key={group} className="im-group">
                    <h3 className="dsec-title">{group}</h3>
                    {scan
                      .filter((s) => s.group === group)
                      .map((s) => (
                        <PixelCheck
                          key={s.id}
                          checked={picked.includes(s.id)}
                          disabled={busy}
                          onChange={(on) => setPicked((p) => (on ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                          label={
                            <span className="im-file">
                              <span>{s.label}</span>
                              <span className="hint ell" title={s.path}>
                                {sizeText(s.size)} · {s.path}
                              </span>
                            </span>
                          }
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
            <div className="form-acts">
              <button type="button" className="btn primary" disabled={!picked.length || busy} onClick={() => void readPicked()}>
                Read selected
              </button>
            </div>
          </>
        )}

        {review && (
          <div className="im-review">
            <p className="dialog-text">These become part of the bot's memory. It reads them as notes about you, not as instructions.</p>
            {review.secretsLeftOut > 0 && (
              <p className="hint">
                {review.secretsLeftOut} {plural(review.secretsLeftOut, "line that looked like a secret was", "lines that looked like secrets were")} left out.
              </p>
            )}
            {review.tooMany > 0 && <p className="hint">Only 300 facts fit at once. {review.tooMany} more were left out.</p>}
            {groupsOf(review.items).map(({ c, rows }) => (
              <section key={c} className="im-cat">
                <h3 className="dsec-title">{CATEGORY_LABEL[c]}</h3>
                {rows.map((it) => (
                  <div key={it.id} className="im-row">
                    <PixelCheck
                      checked={it.on}
                      onChange={(on) => setItem(it.id, { on })}
                      label={<span className="im-hidden">Keep this fact</span>}
                    />
                    <input
                      className="field small im-text"
                      value={it.text}
                      maxLength={MAX_FACT}
                      aria-label={`${CATEGORY_LABEL[c]} fact`}
                      disabled={!it.on}
                      onChange={(e) => setItem(it.id, { text: e.target.value })}
                    />
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-acts">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!review || !chosen.length || busy || !targetBots.length} onClick={() => void add()}>
            {chosen.length ? `Add ${chosen.length} to memory` : "Add to memory"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
