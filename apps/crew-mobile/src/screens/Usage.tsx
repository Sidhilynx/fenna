// Usage: runs, time, tokens and limit hits over 7 days, 30 days or 12 weeks,
// by assistant and by bot. The bars are plain divs, one pixel height per count.

import "./settings.css";
import { useEffect, useState } from "react";
import { errorText, invoke } from "../../../crew/src/shared/api.ts";
import type { RunStats, UsageBucket, UsageRange } from "../../../crew/src/shared/contract.ts";
import { plural } from "../../../crew/src/renderer/text.ts";
import { useStore } from "../state.tsx";
import { ConnBar, Empty, Header, Row, Section, Working } from "../ui.tsx";

const RANGES: { id: UsageRange; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "12w", label: "12 weeks" },
];
const BAR_MAX = 64;
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const stamp = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

export function Usage() {
  const { link } = useStore();
  const [range, setRange] = useState<UsageRange>("7d");
  const [loaded, setLoaded] = useState<RunStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!link.ready) return;
    let alive = true;
    invoke("crew:runStats", range).then(
      (s) => {
        if (!alive) return;
        setLoaded(s);
        setError("");
      },
      (e: unknown) => {
        if (alive) setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [range, link.ready]);

  // A result for another range is not shown under this one's label.
  const stats = loaded && loaded.range === range ? loaded : null;

  return (
    <>
      <Header back title="Usage" />
      <ConnBar />
      <div className="m-body">
        <div className="st-pad">
          <div className="m-seg" role="radiogroup" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={range === r.id} className="btn m-seg-btn" onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {!stats ? (
          error ? (
            <Empty title="Couldn't load usage" sub={error} />
          ) : !link.ready ? (
            <Empty title="Usage is on your computer" sub="Connect to your computer to see it." />
          ) : (
            <div className="st-loading">
              <Working label="Loading usage" />
            </div>
          )
        ) : (
          <Body s={stats} range={range} />
        )}
      </div>
    </>
  );
}

function Body({ s, range }: { s: RunStats; range: UsageRange }) {
  const t = s.totals;
  const buckets: UsageBucket[] = range === "12w" ? s.weeks : range === "7d" ? s.days.slice(-7) : s.days;
  const max = Math.max(1, ...buckets.map((b) => b.runs));
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const cliName = (kind: string | null) => s.clis.find((c) => c.cli === kind)?.name ?? "";

  return (
    <>
      <dl className="st-stats">
        <div className="st-stat">
          <dt>Runs</dt>
          <dd>{t.runs}</dd>
          <dd className="note">
            {t.ok} ok · {t.failed} failed
          </dd>
        </div>
        <div className="st-stat">
          <dt>Time</dt>
          <dd>{duration(t.ms)}</dd>
        </div>
        <div className="st-stat">
          <dt>Tokens</dt>
          {t.tokens ? <dd>{COMPACT.format(t.tokens.input + t.tokens.output)}</dd> : <dd className="none">Not reported</dd>}
        </div>
        <div className="st-stat">
          <dt>Limit hits</dt>
          <dd>{t.limitHits}</dd>
        </div>
      </dl>

      {buckets.length > 0 && first && last && (
        <div className="st-chart">
          <div className="st-bars" role="img" aria-label={range === "12w" ? "Runs per week" : "Runs per day"}>
            {buckets.map((b) => {
              const h = Math.max(2, Math.round((b.runs / max) * BAR_MAX));
              return <span key={b.start} className={b.runs === 0 ? "st-bar zero" : "st-bar"} style={{ height: h }} title={`${dayLabel(b.start)}: ${plural(b.runs, "run")}, ${duration(b.ms)}`} />;
            })}
          </div>
          <div className="st-bar-axis">
            <span>{dayLabel(first.start)}</span>
            <span>{dayLabel(last.start)}</span>
          </div>
        </div>
      )}

      <Section title="By assistant">
        {s.clis.length === 0 ? (
          <p className="st-note">No runs in these days.</p>
        ) : (
          s.clis.map((c) => (
            <Row key={c.cli} title={c.name} sub={[plural(c.runs, "run"), `${c.failed} failed`, duration(c.ms), c.tokens ? `${COMPACT.format(c.tokens.input + c.tokens.output)} tokens` : ""].filter(Boolean).join(" · ")} />
          ))
        )}
      </Section>

      <Section title="By bot">
        {s.bots.length === 0 ? (
          <p className="st-note">No runs in these days.</p>
        ) : (
          s.bots.map((b) => (
            <Row key={b.slug} title={b.name} sub={[plural(b.runs, "run"), duration(b.ms), cliName(b.cli)].filter(Boolean).join(" · ")} />
          ))
        )}
      </Section>

      <Section title="Limit hits">
        {s.limitHits.length === 0 ? (
          <p className="st-note">No limit hits.</p>
        ) : (
          s.limitHits.slice(0, 10).map((h) => (
            <Row
              key={`${h.at}-${h.slug}`}
              title={h.message}
              sub={[h.name, stamp(h.at), h.resetsAt ? `Resets ${stamp(h.resetsAt)}` : ""].filter(Boolean).join(" · ")}
            />
          ))
        )}
      </Section>
    </>
  );
}
