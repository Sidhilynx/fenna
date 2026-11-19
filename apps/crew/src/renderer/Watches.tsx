// A bot's watches and to-do list, in its Details tab. A watch is something the
// bot waits for (Crew wakes it when one fires); a to-do is a thing it noted to
// do. The person sees both here and can remove them; the bot changes them
// through its own tools.

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, Todo, Watch, WatchSpec } from "../shared/contract.ts";
import { PixelCheck } from "./PixelCheck.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import type { PixelIconName } from "./pixelIcons.ts";
import { clock, plural, whenNext } from "./util.ts";

/** A web address as its host: "https://web.whatsapp.com/" → "web.whatsapp.com". */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** A watch in plain words: "Notifications from web.whatsapp.com containing “Sam”". */
export function describeWatch(spec: WatchSpec): string {
  switch (spec.kind) {
    case "notification":
      return `Notifications from ${hostOf(spec.origin)}${spec.match ? ` containing “${spec.match}”` : ""}`;
    case "element":
      return `Changes to an element on ${hostOf(spec.url)}`;
    case "page":
      return `Checks ${hostOf(spec.url)} every ${spec.every} min`;
    case "timer":
      return spec.every ? `Every ${spec.every} min` : `Timer, ${clock(spec.at)}`;
  }
}

/** What a watch has done so far: "Fired 3 times · last 14:02", or "Not fired yet". */
export function firedLine(w: Watch): string {
  if (!w.count || !w.fired) return "Not fired yet";
  return `Fired ${plural(w.count, "time")} · last ${clock(w.fired)}`;
}

const KIND_ICON: Record<WatchSpec["kind"], PixelIconName> = { notification: "bell", element: "eye", page: "site", timer: "clock" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dsec">
      <h3 className="dsec-title">{title}</h3>
      {children}
    </section>
  );
}

interface Data {
  watches: Watch[];
  todos: Todo[];
}

export function BotWatches({ bot }: { bot: BotSummary }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [doneOpen, setDoneOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke("crew:watches", bot.slug).then(
        (r) => {
          if (alive) setData({ watches: r.watches, todos: r.todos });
        },
        (e) => {
          if (alive) setError(errorText(e));
        },
      );
    void load();
    const off = on("crew:watches", (ev) => {
      if (ev.slug === bot.slug) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [bot.slug]);

  if (!data) return <p className="hint">{error || "Loading"}</p>;

  const removeWatch = (id: string) =>
    invoke("crew:removeWatch", bot.slug, id).then(
      (watches) => setData((d) => d && { ...d, watches }),
      (e) => toast(errorText(e)),
    );

  const setTodo = (id: string, patch: { done?: boolean; remove?: boolean }) =>
    invoke("crew:setTodo", bot.slug, id, patch).then(
      (todos) => setData((d) => d && { ...d, todos }),
      (e) => toast(errorText(e)),
    );

  const open = data.todos.filter((t) => !t.done);
  const done = data.todos.filter((t) => t.done);
  const todoRow = (t: Todo) => (
    <li key={t.id} className="todo">
      <PixelCheck checked={t.done} onChange={(checked) => void setTodo(t.id, { done: checked })} label={<span className={`todo-text ell${t.done ? " is-done" : ""}`} title={t.text}>{t.text}</span>} />
      {t.due && <span className="todo-due">Due {whenNext(t.due)}</span>}
      <button type="button" className="icon-btn todo-remove" aria-label="Remove to do" title="Remove" onClick={() => void setTodo(t.id, { remove: true })}>
        <PixelIcon name="close" size={12} />
      </button>
    </li>
  );

  return (
    <>
      <Section title="Watching">
        {data.watches.length ? (
          <ul className="watches">
            {data.watches.map((w) => {
              const desc = describeWatch(w);
              return (
                <li key={w.id} className="watch">
                  <span className="watch-icon">
                    <PixelIcon name={KIND_ICON[w.kind]} />
                  </span>
                  <span className="watch-text">
                    <span className="watch-desc ell" title={desc}>
                      {desc}
                    </span>
                    {w.note && <span className="watch-note">{w.note}</span>}
                    <span className="watch-status">{firedLine(w)}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label="Remove watch" title="Remove watch" onClick={() => void removeWatch(w.id)}>
                    <PixelIcon name="close" size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">No watches yet.</p>
        )}
      </Section>

      {data.todos.length > 0 && (
        <Section title="To do">
          {open.length > 0 && <ul className="todos">{open.map(todoRow)}</ul>}
          {done.length > 0 && (
            <>
              <button type="button" className="todo-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen((v) => !v)}>
                <PixelIcon name={doneOpen ? "chevron-down" : "chevron-right"} size={12} />
                Done ({done.length})
              </button>
              {doneOpen && <ul className="todos">{done.map(todoRow)}</ul>}
            </>
          )}
        </Section>
      )}
    </>
  );
}
