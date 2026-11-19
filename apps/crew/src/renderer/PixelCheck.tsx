// A checkbox drawn in pixels: a real input (visually hidden, still focusable and
// announced) with a 16 by 16 notched frame. Checked adds a --sel-soft fill and a
// --sel check mark. Styles are in styles.css under "Pixel icons and checkbox".

import type { ReactNode } from "react";
import { gridRuns } from "./PixelIcon.tsx";

// 'b' frame pixels (corners notched), 'c' check pixels. The fill is the 14 by 14 inside.
const FRAME: readonly string[] = [
  ".bbbbbbbbbbbbbb.",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  "b..............b",
  ".bbbbbbbbbbbbbb.",
];

const CHECK: readonly string[] = [
  "................",
  "................",
  "................",
  "................",
  "...........cc...",
  "..........cc....",
  "...cc....cc.....",
  "....cc..cc......",
  ".....cccc.......",
  "......cc........",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
];

const FRAME_RUNS = gridRuns(FRAME, "b");
const CHECK_RUNS = gridRuns(CHECK, "c");

interface PixelCheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export function PixelCheck({ checked, onChange, label, disabled = false, id }: PixelCheckProps) {
  return (
    <label className={disabled ? "pcheck-wrap is-disabled" : "pcheck-wrap"}>
      <input
        className="pcheck-input"
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <svg className={checked ? "pcheck-box on" : "pcheck-box"} width={16} height={16} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden focusable="false">
        {checked && <rect className="pcheck-fill" x={1} y={1} width={14} height={14} />}
        <g className="pcheck-frame">
          {FRAME_RUNS.map((r) => (
            <rect key={`b${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
          ))}
        </g>
        {checked && (
          <g className="pcheck-mark">
            {CHECK_RUNS.map((r) => (
              <rect key={`c${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} />
            ))}
          </g>
        )}
      </svg>
      {label !== undefined && <span className="pcheck-label">{label}</span>}
    </label>
  );
}
