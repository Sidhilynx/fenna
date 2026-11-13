// Charts on the sheet. Each reads its range live; dragging or resizing one
// is shown as it happens and saved once, on release. A selected chart can be
// renamed (double-click its title), switched to another type, or deleted.

import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_TYPES, type ChartSpec, type ChartType, type EvalValue, formatCellRef, formatCellValue, type NumberFormatKind, parseRangeRef, type SheetData } from "@opendeck/sheet";
import { Icon, MenuButton } from "@opendeck/shell";
import { deleteChart, getState, updateChart } from "../store.ts";

const SERIES = 6;
const TYPE_LABEL: Record<ChartType, string> = { bar: "Bar", line: "Line", area: "Area", pie: "Pie" };

interface Series {
  name: string;
  values: number[];
}

function chartData(sheet: SheetData, values: Map<string, EvalValue>, chart: ChartSpec) {
  const r = parseRangeRef(chart.range);
  if (!r) return { labels: [] as string[], series: [] as Series[], sample: undefined as NumberFormatKind | undefined };
  const wb = getState().workbook;
  const shows = (row: number, col: number) => {
    const ref = formatCellRef(row, col);
    const v = values.get(ref) ?? sheet.cells[ref]?.v ?? null;
    return wb ? formatCellValue(v, sheet.cells[ref], wb.index) : String(v ?? "");
  };
  const num = (row: number, col: number) => {
    const ref = formatCellRef(row, col);
    const v = values.get(ref) ?? sheet.cells[ref]?.v;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const header = chart.headerRow !== false && r.r2 > r.r1;
  const first = header ? r.r1 + 1 : r.r1;
  const oneCol = r.c2 === r.c1;
  const labels: string[] = [];
  const series: Series[] = [];
  for (let c = oneCol ? r.c1 : r.c1 + 1; c <= r.c2; c++) series.push({ name: header ? shows(r.r1, c) || `Series ${series.length + 1}` : `Series ${series.length + 1}`, values: [] });
  for (let row = first; row <= r.r2; row++) {
    labels.push(oneCol ? String(row + 1) : shows(row, r.c1));
    series.forEach((s, i) => s.values.push(num(row, oneCol ? r.c1 : r.c1 + 1 + i) ?? 0));
  }
  const sampleRef = formatCellRef(first, oneCol ? r.c1 : r.c1 + 1);
  return { labels, series: series.filter((s) => s.values.some((v) => v !== 0)), sample: sheet.cells[sampleRef]?.s?.numFmt };
}

function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
}

/** Round steps for an axis: 1, 2 or 5 times a power of ten. */
function ticks(min: number, max: number): number[] {
  const span = max - min || 1;
  const raw = span / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

function Chart({ chart, sheet, values, zoom, origin }: { chart: ChartSpec; sheet: SheetData; values: Map<string, EvalValue>; zoom: number; origin: { x: number; y: number } }) {
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selected, setSelected] = useState(false);
  const [naming, setNaming] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const { labels, series, sample } = useMemo(() => chartData(sheet, values, chart), [sheet, values, chart]);
  const box = live ?? { x: chart.x, y: chart.y, w: chart.w, h: chart.h };

  useEffect(() => {
    if (!selected) return;
    const away = (e: MouseEvent) => {
      if (!card.current?.contains(e.target as Node) && !(e.target instanceof Element && e.target.closest(".menu"))) setSelected(false);
    };
    window.addEventListener("mousedown", away, true);
    return () => window.removeEventListener("mousedown", away, true);
  }, [selected]);

  const startDrag = (e: React.MouseEvent, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(true);
    card.current?.focus();
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { x: chart.x, y: chart.y, w: chart.w, h: chart.h };
    let last = o;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      last = mode === "move" ? { ...o, x: Math.max(0, Math.round(o.x + dx)), y: Math.max(0, Math.round(o.y + dy)) } : { ...o, w: Math.max(240, Math.round(o.w + dx)), h: Math.max(180, Math.round(o.h + dy)) };
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (last !== o) void updateChart({ ...chart, ...last }).then(() => setLive(null));
      else setLive(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const W = box.w * zoom;
  const H = box.h * zoom;
  const head = 36;
  const legend = series.length > 1 || chart.type === "pie" ? 24 : 0;
  const w = W - 24;
  const h = Math.max(60, H - head - legend - 12);
  const all = series.flatMap((s) => s.values);
  const wb = getState().workbook;
  const fmt = (n: number) => (sample && sample !== "auto" && wb ? formatCellValue(n, { s: { numFmt: sample } }, wb.index).replace(/\.00(?=\D*$)/, "") : short(n));
  const tk = ticks(Math.min(0, ...all), Math.max(0, ...all, 1));
  const lo = tk[0]!;
  const hi = tk[tk.length - 1]!;
  const padL = Math.min(72, 12 + Math.max(...tk.map((t) => fmt(t).length)) * 6.5);
  const padB = 22;
  const plotW = Math.max(20, w - padL - 6);
  const plotH = Math.max(20, h - padB - 6);
  const yOf = (v: number) => 6 + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const xOf = (i: number) => padL + ((i + 0.5) / Math.max(1, labels.length)) * plotW;
  const every = Math.max(1, Math.ceil((labels.length * 52) / plotW));

  return (
    <div
      ref={card}
      className={`chart${selected ? " on" : ""}`}
      style={{ left: origin.x + box.x * zoom, top: origin.y + box.y * zoom, width: W, height: H }}
      tabIndex={0}
      role="figure"
      aria-label={`${TYPE_LABEL[chart.type]} chart${chart.title ? `: ${chart.title}` : ""} of ${chart.range}`}
      onMouseDown={(e) => startDrag(e, "move")}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && !naming) {
          e.preventDefault();
          void deleteChart(chart.id);
        }
        if (e.key === "Escape") setSelected(false);
      }}
      onFocus={() => setSelected(true)}
    >
      <div className="chart-head">
        {naming ? (
          <input
            className="chart-name"
            autoFocus
            defaultValue={chart.title}
            maxLength={200}
            aria-label="Chart title"
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setNaming(false);
              if (e.target.value.trim() !== chart.title) void updateChart({ ...chart, title: e.target.value.trim() });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setNaming(false);
            }}
          />
        ) : (
          <span className={`chart-title${chart.title ? "" : " empty"}`} onDoubleClick={() => setNaming(true)} title="Double-click to rename">
            {chart.title || "Untitled chart"}
          </span>
        )}
        {selected && !naming && (
          <span className="chart-tools" onMouseDown={(e) => e.stopPropagation()}>
            <MenuButton className="btn ghost chart-type" label="Chart type" entries={() => CHART_TYPES.map((t) => ({ label: TYPE_LABEL[t], checked: t === chart.type, onSelect: () => void updateChart({ ...chart, type: t }) }))}>
              {TYPE_LABEL[chart.type]} <Icon name="chevronDown" size={12} />
            </MenuButton>
            <button className="icon-btn" title="Rename" aria-label="Rename chart" onClick={() => setNaming(true)}>
              <Icon name="pencil" size={15} />
            </button>
            <button className="icon-btn" title="Delete chart (Delete)" aria-label="Delete chart" onClick={() => void deleteChart(chart.id)}>
              <Icon name="trash" size={15} />
            </button>
          </span>
        )}
      </div>
      {!series.length ? (
        <div className="chart-empty">No numbers to chart in {chart.range}.</div>
      ) : (
        <svg width={w} height={h} className="chart-svg" aria-hidden>
          {chart.type === "pie" ? (
            (() => {
              const vals = series[0]!.values.map((v) => Math.max(0, v));
              const total = vals.reduce((a, b) => a + b, 0) || 1;
              const cx = w / 2;
              const cy = h / 2;
              const rad = Math.max(10, Math.min(w, h) / 2 - 8);
              let angle = -Math.PI / 2;
              return vals.map((v, i) => {
                const slice = (v / total) * Math.PI * 2;
                const a0 = angle;
                angle += slice;
                if (slice >= Math.PI * 2 - 1e-6) return <circle key={i} cx={cx} cy={cy} r={rad} className={`chart-s${i % SERIES}`} />;
                const large = slice > Math.PI ? 1 : 0;
                return (
                  <path
                    key={i}
                    className={`chart-s${i % SERIES}`}
                    d={`M${cx} ${cy}L${cx + rad * Math.cos(a0)} ${cy + rad * Math.sin(a0)}A${rad} ${rad} 0 ${large} 1 ${cx + rad * Math.cos(angle)} ${cy + rad * Math.sin(angle)}Z`}
                  />
                );
              });
            })()
          ) : (
            <>
              {tk.map((t) => (
                <g key={t}>
                  <line x1={padL} x2={padL + plotW} y1={yOf(t)} y2={yOf(t)} className={t === 0 ? "chart-zero" : "chart-grid"} />
                  <text x={padL - 6} y={yOf(t) + 3.5} textAnchor="end" className="chart-axis">
                    {fmt(t)}
                  </text>
                </g>
              ))}
              {labels.map((l, i) =>
                i % every === 0 ? (
                  <text key={i} x={xOf(i)} y={6 + plotH + 15} textAnchor="middle" className="chart-axis">
                    {l.length > 12 ? `${l.slice(0, 11)}…` : l}
                  </text>
                ) : null,
              )}
              {chart.type === "bar" &&
                labels.map((_, i) => {
                  const group = plotW / Math.max(1, labels.length);
                  const bw = Math.max(2, (group * 0.72) / series.length);
                  const x0 = padL + i * group + (group - bw * series.length) / 2;
                  return series.map((s, si) => {
                    const y0 = yOf(0);
                    const y1 = yOf(s.values[i] ?? 0);
                    return <rect key={`${i}-${si}`} x={x0 + si * bw} y={Math.min(y0, y1)} width={Math.max(1, bw - 2)} height={Math.max(1, Math.abs(y0 - y1))} rx={2} className={`chart-s${si % SERIES}`} />;
                  });
                })}
              {(chart.type === "line" || chart.type === "area") &&
                series.map((s, si) => {
                  const pts = s.values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
                  return (
                    <g key={si} className={`chart-s${si % SERIES}`}>
                      {chart.type === "area" && <polygon points={`${xOf(0)},${yOf(0)} ${pts} ${xOf(s.values.length - 1)},${yOf(0)}`} className="chart-area" />}
                      <polyline points={pts} className="chart-line" />
                      {s.values.length <= 40 && s.values.map((v, i) => <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2.5} />)}
                    </g>
                  );
                })}
            </>
          )}
        </svg>
      )}
      {legend > 0 && series.length > 0 && (
        <div className="chart-legend">
          {(chart.type === "pie" ? labels : series.map((s) => s.name)).slice(0, 12).map((name, i) => (
            <span key={i} className="chart-key">
              <span className={`chart-dot chart-s${i % SERIES}`} />
              {name}
            </span>
          ))}
        </div>
      )}
      {selected && <span className="chart-resize" onMouseDown={(e) => startDrag(e, "resize")} aria-hidden />}
    </div>
  );
}

export function ChartLayer({ sheet, values, zoom, origin }: { sheet: SheetData; values: Map<string, EvalValue>; zoom: number; origin: { x: number; y: number } }) {
  return (
    <>
      {sheet.charts.map((c) => (
        <Chart key={c.id} chart={c} sheet={sheet} values={values} zoom={zoom} origin={origin} />
      ))}
    </>
  );
}
