// The bot's clock: the time in big pixels, today's date, what the bot will do
// next (its schedule, its timers and page checks), the week ahead, and a form
// to remind it of something. The window frame draws the title bar.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { nextRun, parseSchedule } from "@opendeck/crew";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, Watch } from "../shared/contract.ts";
import { clockRows, clockText, buildAgenda, itemsByDay, scheduledRuns, weekDays, type AgendaItem } from "./clockModel.ts";
import { PixelDateTime } from "./PixelDateTime.tsx";
import { gridRuns } from "./PixelIcon.tsx";
import { clock, whenNext } from "./util.ts";

const DAY_MS = 86_400_000;
/** Blocks shown per day column before "+N more". */
const DAY_BLOCKS = 4;

function BigClock({ now }: { now: Date }) {
  const text = clockText(now);
  const rows = clockRows(text);
  return (
    <svg className="clk-digits" viewBox={`0 0 ${rows[0]!.length} ${rows.length}`} role="img" aria-label={text} shapeRendering="crispEdges">
      {gridRuns(rows).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
      ))}
    </svg>
  );
}

function Upcoming({ items }: { items: AgendaItem[] }) {
  if (!items.length) return <p className="clk-empty">Nothing due in 7 days.</p>;
  return (
    <ul className="clk-agenda">
      {items.map((item) => (
        <li key={`${item.kind}-${item.at.getTime()}-${item.title}`} className="clk-row">
          <time className="clk-when" dateTime={item.at.toISOString()}>
            {whenNext(item.at.toISOString())}
          </time>
          <span className="clk-what">{item.title}</span>
        </li>
      ))}
    </ul>
  );
}

function Week({ items, now }: { items: AgendaItem[]; now: Date }) {
  const days = weekDays(now);
  const cols = itemsByDay(items, now);
  return (
    <div className="clk-week">
      {days.map((day, i) => {
        const list = cols[i]!;
        return (
          <div key={day.getTime()} className="clk-day">
            <span className="clk-day-name">{day.toLocaleDateString([], { weekday: "short" })}</span>
            <span className="clk-day-num">{day.getDate()}</span>
            <ul className="clk-blocks">
              {list.slice(0, DAY_BLOCKS).map((item) => (
                <li key={`${item.kind}-${item.at.getTime()}-${item.title}`} className="clk-block" title={`${clock(item.at.toISOString())} ${item.title}`}>
                  <time dateTime={item.at.toISOString()}>{clock(item.at.toISOString())}</time>
                  <span>{item.title}</span>
                </li>
              ))}
              {list.length > DAY_BLOCKS && <li className="clk-more">+{list.length - DAY_BLOCKS} more</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ClockApp({ bot }: { bot: BotSummary }) {
  const [now, setNow] = useState(() => new Date());
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The clock ticks each second but only re-renders when the minute or the day changes.
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setNow((prev) => (clockText(prev) === clockText(d) && prev.getDate() === d.getDate() ? prev : d));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke("crew:watches", bot.slug).then(
        (r) => {
          if (!alive) return;
          setWatches(r.watches);
          setFailed(false);
        },
        () => {
          if (alive) setFailed(true);
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

  const schedule = useMemo(() => {
    const parsed = parseSchedule(bot.schedule);
    return "schedule" in parsed ? parsed.schedule : null;
  }, [bot.schedule]);

  const agenda = useMemo(() => {
    const until = new Date(now.getTime() + 7 * DAY_MS);
    const runs = schedule ? scheduledRuns((from) => nextRun(schedule, from), now, until) : [];
    return buildAgenda({ now, until, runs, watches: watches ?? [] });
  }, [schedule, watches, now]);

  function remind(e: FormEvent) {
    e.preventDefault();
    const at = new Date(when);
    if (!when || Number.isNaN(at.getTime())) return setError("Pick a time.");
    if (at.getTime() <= Date.now()) return setError("Pick a time in the future.");
    if (!note.trim()) return setError("Write what to remind about.");
    setBusy(true);
    setError("");
    invoke("crew:addReminder", bot.slug, { at: at.toISOString(), note: note.trim() }).then(
      () => {
        setBusy(false);
        setWhen("");
        setNote("");
        toast(`Reminder set for ${whenNext(at.toISOString())}`);
      },
      (err) => {
        setBusy(false);
        setError(errorText(err));
      },
    );
  }

  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="clk">
      <div className="clk-top">
        <BigClock now={now} />
        <p className="clk-date">{date}</p>
      </div>

      <section className="clk-section">
        <h3 className="clk-title">Upcoming</h3>
        {failed ? <p className="clk-empty">Could not read the bot's watches.</p> : <Upcoming items={agenda} />}
      </section>

      <section className="clk-section">
        <h3 className="clk-title">This week</h3>
        <Week items={agenda} now={now} />
      </section>

      <section className="clk-section">
        <h3 className="clk-title" id="clk-remind">
          Remind {bot.name}
        </h3>
        <form className="clk-form" onSubmit={remind} aria-labelledby="clk-remind">
          <div className="clk-field">
            <span className="clk-label" aria-hidden>
              When
            </span>
            <PixelDateTime label="When" value={when} min={now} onChange={setWhen} />
          </div>
          <label className="clk-field clk-field-grow">
            <span className="clk-label">What</span>
            <input className="field" type="text" maxLength={300} placeholder="Call the dentist" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn primary small" disabled={busy}>
            Set reminder
          </button>
        </form>
        {error && (
          <p className="clk-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
