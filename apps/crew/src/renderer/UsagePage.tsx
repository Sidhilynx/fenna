// The Usage page: the runs of every bot on this computer, in runs, time,
// tokens and API value per assistant and per bot, a bar chart by day or by
// week, and the runs that stopped at a plan limit. Every number comes from
// the run logs (apps/crew/src/main/runstats.cjs). A number a CLI did not
// report reads "Not reported", never 0.

import { useEffect, useState } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { RunStats, UsageBucket, UsageRange } from "../shared/contract.ts";
import { PixelEmpty } from "./Connectors.tsx";
import { PixelField } from "./PixelField.tsx";

const RANGES: { id: UsageRange; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "12w", label: "12 weeks" },
];
const NOT_REPORTED = "Not reported";
const API_VALUE = "The cost at API prices, as the CLI estimates it. Plans are not billed per run.";
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const DOLLARS = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const WHEN = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const money = (usd: number) => (usd > 0 && usd < 0.01 ? "Under $0.01" : DOLLARS.format(usd));
const runsText = (n: number) => (n === 1 ? "1 run" : `${n} runs`);

export function UsagePage() {
  const [range, setRange] = useState<UsageRange>("30d");
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState("");

  // Reloads when the range changes and when anything in Crew changes; a reload asked for while one is running runs once more after it.
  useEffect(() => {
    let alive = true;
    let busy = false;
    let again = false;
    const load = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      invoke("crew:runStats", range)
        .then(
          (s) => {
            if (!alive) return;
            setStats(s);
            setError("");
          },
          (e) => alive && setError(errorText(e)),
        )
        .finally(() => {
          busy = false;
          if (again && alive) {
            again = false;
            load();
          }
        });
    };
    load();
    const off = on("crew:changed", load);
    return () => {
      alive = false;
      off();
    };
  }, [range]);

  const shown = stats && stats.range === range ? stats : null;

  return (
    <main className="main overview conn-page usage-page px-host" aria-label="Usage">
      <PixelField density={2} alpha={0.3} />
      <div className="ov-head">
        <div className="ov-title">
          <h1>Usage</h1>
          <p>Runs, time and tokens of your bots on this computer.</p>
        </div>
        {shown && shown.runsEver > 0 && (
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" className="seg-btn" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="conn-error" role="alert">
          {error}
        </p>
      )}
      {!shown ? (
        !error && <p className="hint">Loading</p>
      ) : shown.runsEver === 0 ? (
        <PixelEmpty icon="usage">No runs yet. Usage shows here after a bot's first run.</PixelEmpty>
      ) : (
        <Report stats={shown} grain={grain} onGrain={setGrain} />
      )}
    </main>
  );
}

function Report({ stats, grain, onGrain }: { stats: RunStats; grain: "day" | "week"; onGrain(g: "day" | "week"): void }) {
  const t = stats.totals;
  const cliName = (cli: string) => stats.clis.find((c) => c.cli === cli)?.name ?? cli;
  const botMs = stats.bots.reduce((sum, b) => sum + b.ms, 0);
  const botRuns = stats.bots.reduce((sum, b) => sum + b.runs, 0);
  const week = grain === "week";

  return (
    <>
      <dl className="usage-stats">
        <Stat label="Runs" value={String(t.runs)} note={`${t.failed} failed`} />
        <Stat label="Time" value={duration(t.ms)} />
        <Stat label="Tokens" value={t.tokens ? COMPACT.format(t.tokens.input + t.tokens.output) : NOT_REPORTED} muted={!t.tokens} />
        <Stat label="Limit hits" value={String(t.limitHits)} />
      </dl>

      <section className="usage-section" aria-labelledby="usage-clis">
        <h2 id="usage-clis">By assistant</h2>
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col">Assistant</th>
              <th scope="col" className="num">Runs</th>
              <th scope="col" className="num">Failed</th>
              <th scope="col" className="num">Time</th>
              <th scope="col" className="num">Tokens</th>
              <th scope="col" className="num" title={API_VALUE}>
                API value
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.clis.map((c) => (
              <tr key={c.cli}>
                <th scope="row">{c.name}</th>
                <td className="num">{c.runs}</td>
                <td className="num">{c.failed}</td>
                <td className="num">{duration(c.ms)}</td>
                <td className="num" title={c.tokens ? `Input ${COMPACT.format(c.tokens.input)}, output ${COMPACT.format(c.tokens.output)}` : undefined}>
                  {c.tokens ? (
                    <>
                      {COMPACT.format(c.tokens.input + c.tokens.output)}
                      {c.tokenRuns < c.runs && <span className="usage-note">{c.tokenRuns} of {c.runs} runs</span>}
                    </>
                  ) : (
                    <span className="usage-muted">{NOT_REPORTED}</span>
                  )}
                </td>
                <td className="num" title={API_VALUE}>
                  {c.costUsd !== null ? money(c.costUsd) : <span className="usage-muted">{NOT_REPORTED}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="usage-section" aria-labelledby="usage-bots">
        <h2 id="usage-bots">By bot</h2>
        {stats.bots.length ? (
          <table className="usage-table">
            <thead>
              <tr>
                <th scope="col">Bot</th>
                <th scope="col">Assistant</th>
                <th scope="col" className="num">Runs</th>
                <th scope="col" className="num">Time</th>
                <th scope="col" className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {stats.bots.map((b) => {
                const pct = botMs > 0 ? (b.ms / botMs) * 100 : botRuns > 0 ? (b.runs / botRuns) * 100 : 0;
                return (
                  <tr key={b.slug}>
                    <th scope="row" className="usage-name">
                      {b.name}
                    </th>
                    <td>{b.cli ? cliName(b.cli) : NOT_REPORTED}</td>
                    <td className="num">{b.runs}</td>
                    <td className="num">{duration(b.ms)}</td>
                    <td className="num usage-share-cell">
                      <span className="usage-share" aria-hidden>
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span className="usage-pct">{Math.round(pct)}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="hint">No runs in this range.</p>
        )}
      </section>

      <section className="usage-section" aria-labelledby="usage-time">
        <div className="usage-section-head">
          <h2 id="usage-time">Over time</h2>
          <div className="seg" role="group" aria-label="Chart by">
            <button type="button" className="seg-btn" aria-pressed={!week} onClick={() => onGrain("day")}>
              By day
            </button>
            <button type="button" className="seg-btn" aria-pressed={week} onClick={() => onGrain("week")}>
              By week
            </button>
          </div>
        </div>
        <Bars buckets={week ? stats.weeks : stats.days} week={week} />
      </section>

      <section className="usage-section" aria-labelledby="usage-hits">
        <h2 id="usage-hits">Limit hits</h2>
        {stats.limitHits.length ? (
          <ul className="usage-hits">
            {stats.limitHits.map((h, i) => (
              <li key={`${h.at}-${h.slug}-${i}`} className="usage-hit">
                <div className="usage-hit-head">
                  <span>{WHEN.format(new Date(h.at))}</span>
                  <span>{h.name}</span>
                  <span>{cliName(h.cli)}</span>
                </div>
                <p>{h.message}</p>
                <p className="usage-muted">Resets: {h.resetsAt ? WHEN.format(new Date(h.resetsAt)) : NOT_REPORTED}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No limit hits.</p>
        )}
        {t.limitHits > stats.limitHits.length && <p className="usage-note">Showing the newest {stats.limitHits.length} of {t.limitHits}.</p>}
      </section>
    </>
  );
}

function Stat({ label, value, note, muted }: { label: string; value: string; note?: string; muted?: boolean }) {
  return (
    <div className="usage-stat">
      <dt>{label}</dt>
      <dd className={muted ? "usage-muted" : undefined}>{value}</dd>
      {note && <p className="usage-note">{note}</p>}
    </div>
  );
}

/** Runs per bucket as bars, tallest at the largest count; a label under every fifth day, or every week. */
function Bars({ buckets, week }: { buckets: UsageBucket[]; week: boolean }) {
  const max = Math.max(0, ...buckets.map((b) => b.runs));
  const every = week ? 1 : 5;
  return (
    <ol className="usage-bars" aria-label={week ? "Runs per week" : "Runs per day"}>
      {buckets.map((b, i) => {
        const label = SHORT_DAY.format(new Date(b.start));
        return (
          <li key={b.start} className="usage-col" title={`${week ? `Week of ${label}` : label}: ${runsText(b.runs)}, ${duration(b.ms)}`}>
            <span className="usage-fill" style={{ height: `${max ? (b.runs / max) * 100 : 0}%` }} />
            {(i % every === 0 || i === buckets.length - 1) && <span className={`usage-label${i === 0 ? " first" : i === buckets.length - 1 ? " last" : ""}`}>{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}
