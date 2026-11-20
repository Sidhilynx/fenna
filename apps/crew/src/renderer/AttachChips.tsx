// Files attached to a message. The composer shows them as removable chips above
// the input (images with a thumbnail); a sent message shows its files as chips
// too. An image chip opens in a small viewer (Esc closes, focus goes back); the
// other chips show their name and size.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RunAttachment } from "@opendeck/crew";
import type { BotSummary, DiskEntry } from "../shared/contract.ts";
import { formatSize } from "./diskPaths.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { ImageViewer, useDiskUrl } from "./Viewers.tsx";

export const ATTACH_MAX_FILES = 10;
export const ATTACH_MAX_BYTES = 200 * 1024 ** 2;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

export const isImageName = (name: string) => IMAGE.test(name);

/** The files to add to a message that already has `have`: the ones that fit, and what was left out, in words. */
export function pickFiles(have: number, picked: File[]): { files: File[]; error: string } {
  const big = picked.filter((f) => f.size > ATTACH_MAX_BYTES);
  const fit = picked.filter((f) => f.size <= ATTACH_MAX_BYTES);
  const room = Math.max(0, ATTACH_MAX_FILES - have);
  const errors: string[] = [];
  if (big.length === 1) errors.push(`${big[0]!.name} is larger than 200 MB.`);
  else if (big.length > 1) errors.push(`${big.length} files are larger than 200 MB.`);
  const left = fit.length - room;
  if (left > 0) errors.push(`You can attach at most ${ATTACH_MAX_FILES} files to a message. ${left} ${left === 1 ? "was" : "were"} not added.`);
  return { files: fit.slice(0, room), error: errors.join(" ") };
}

/** An object URL per picked image, revoked when the list changes or the composer goes. */
export function usePreviews(files: File[]): Map<File, string> {
  const [urls, setUrls] = useState<Map<File, string>>(() => new Map());
  useEffect(() => {
    const next = new Map<File, string>();
    for (const f of files) if (isImageName(f.name)) next.set(f, URL.createObjectURL(f));
    setUrls(next);
    return () => {
      for (const u of next.values()) URL.revokeObjectURL(u);
    };
  }, [files]);
  return urls;
}

function Chip({ name, size, src, onOpen, onRemove, removeLabel }: { name: string; size: number; src?: string | null; onOpen?(): void; onRemove?(): void; removeLabel?: string }) {
  const body: ReactNode = (
    <>
      {src && <img className="att-thumb" src={src} alt="" />}
      <span className="att-name ell" title={name}>
        {name}
      </span>
      <span className="att-size">{formatSize(size)}</span>
    </>
  );
  return (
    <div className="att-chip">
      {onOpen ? (
        <button type="button" className="att-open" onClick={onOpen} title={`Open ${name}`}>
          {body}
        </button>
      ) : (
        <span className="att-open">{body}</span>
      )}
      {onRemove && (
        <button type="button" className="icon-btn att-remove" aria-label={removeLabel ?? `Remove ${name}`} title="Remove" onClick={onRemove}>
          <PixelIcon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/** The files the composer holds, above its input. Removing one returns focus to the input. */
export function PendingFiles({ files, previews, onRemove }: { files: File[]; previews: Map<File, string>; onRemove(f: File): void }) {
  return (
    <ul className="att-list" aria-label="Attached files">
      {files.map((f, i) => (
        <li key={`${i}:${f.name}`}>
          <Chip name={f.name} size={f.size} src={previews.get(f) ?? null} onRemove={() => onRemove(f)} />
        </li>
      ))}
    </ul>
  );
}

/** A chip on a sent message: an image thumbnail (loaded from the bot's disk) opens the viewer; other files are name and size. */
function SentChip({ bot, file, at, onView }: { bot: BotSummary; file: RunAttachment; at: string; onView(e: DiskEntry): void }) {
  if (!isImageName(file.name)) return <Chip name={file.name} size={file.size} />;
  return <ImageChip bot={bot} file={file} at={at} onView={onView} />;
}

function ImageChip({ bot, file, at, onView }: { bot: BotSummary; file: RunAttachment; at: string; onView(e: DiskEntry): void }) {
  const { url } = useDiskUrl(bot.slug, file.path);
  const entry: DiskEntry = { path: file.path, name: file.name, kind: "image", size: file.size, edited: at };
  return <Chip name={file.name} size={file.size} src={url} onOpen={() => onView(entry)} />;
}

/** The files of a sent message. `at` is when it was sent. */
export function SentFiles({ bot, files, at }: { bot: BotSummary; files: RunAttachment[]; at: string }) {
  const [open, setOpen] = useState<DiskEntry | null>(null);
  return (
    <>
      <ul className="att-list sent" aria-label="Attached files">
        {files.map((f) => (
          <li key={f.path}>
            <SentChip bot={bot} file={f} at={at} onView={setOpen} />
          </li>
        ))}
      </ul>
      {open && <AttachViewer bot={bot} entry={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The files of a message that is still on its way: name and size only. */
export function SendingFiles({ files }: { files: { name: string; size: number }[] }) {
  return (
    <ul className="att-list sent" aria-label="Attached files">
      {files.map((f, i) => (
        <li key={`${i}:${f.name}`}>
          <Chip name={f.name} size={f.size} />
        </li>
      ))}
    </ul>
  );
}

/** A small modal image viewer. Esc closes it; focus goes back to whatever had it. */
export function AttachViewer({ bot, entry, onClose }: { bot: BotSummary; entry: DiskEntry; onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="att-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="att-modal" role="dialog" aria-modal="true" aria-label={entry.name} ref={dialog} tabIndex={-1}>
        <header className="att-modal-head">
          <span className="ell">{entry.name}</span>
          <button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <PixelIcon name="close" size={12} />
          </button>
        </header>
        <div className="att-modal-body">
          <ImageViewer bot={bot} entry={entry} />
        </div>
      </div>
    </div>
  );
}
