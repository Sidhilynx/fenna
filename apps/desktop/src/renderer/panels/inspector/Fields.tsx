// Reusable inspector controls and row layouts.

import { type ReactNode, useEffect, useState } from "react";
import { Icon, type IconName } from "@opendeck/shell";

export function InspectorSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <div className="inspector-section-head">{heading}</div>
      {children}
    </div>
  );
}

export function InspectorRow({ label, children, id }: { label?: string; children: ReactNode; id?: string }) {
  return (
    <div className="inspector-row">
      {label && (
        <label className="inspector-label" htmlFor={id} title={label}>
          {label}
        </label>
      )}
      <div className="inspector-control">{children}</div>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  dimmed,
  id,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  dimmed?: boolean;
  id?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);

  const commit = () => {
    if (local !== value) onChange(local);
  };

  return (
    <input
      id={id}
      type="text"
      className={`inspector-input${dimmed ? " dimmed" : ""}`}
      value={focused ? local : value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => {
        setFocused(true);
        setLocal(value);
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setLocal(value);
          setFocused(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberField({
  value,
  onChange,
  unit = "px",
  min,
  max,
  step = 1,
  placeholder,
  ariaLabel,
  dimmed,
  allowBlank = false,
  id,
}: {
  value: number | null | undefined;
  onChange: (val: number | null) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  ariaLabel?: string;
  dimmed?: boolean;
  allowBlank?: boolean;
  id?: string;
}) {
  const [focused, setFocused] = useState(false);
  const strVal = value != null && !isNaN(value) ? String(value) : "";
  const [local, setLocal] = useState(strVal);

  useEffect(() => {
    if (!focused) setLocal(strVal);
  }, [strVal, focused]);

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === "") {
      if (allowBlank) onChange(null);
      else setLocal(strVal);
      return;
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
      const clampedMin = min !== undefined ? Math.max(min, num) : num;
      const finalNum = max !== undefined ? Math.min(max, clampedMin) : clampedMin;
      onChange(finalNum);
    } else {
      setLocal(strVal);
    }
  };

  const nudge = (dir: 1 | -1, shift: boolean) => {
    const mult = shift ? 10 : 1;
    const current = local !== "" ? parseFloat(local) : (value ?? 0);
    const base = isNaN(current) ? 0 : current;
    const next = Math.round((base + dir * step * mult) * 100) / 100;
    const clampedMin = min !== undefined ? Math.max(min, next) : next;
    const finalNum = max !== undefined ? Math.min(max, clampedMin) : clampedMin;
    setLocal(String(finalNum));
    onChange(finalNum);
  };

  return (
    <div className="inspector-number-wrap">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={`inspector-number-input${!unit ? " no-unit" : ""}${dimmed ? " dimmed" : ""}`}
        value={focused ? local : strVal}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => {
          setFocused(true);
          setLocal(strVal);
        }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setLocal(strVal);
            setFocused(false);
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            nudge(1, e.shiftKey);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-1, e.shiftKey);
          }
        }}
      />
      {unit && <span className="inspector-unit">{unit}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T | undefined;
  onChange: (val: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="inspector-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`inspector-segment${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
          title={opt.title ?? opt.label}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function IconGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; icon: IconName; title: string }[];
  value: T | undefined;
  onChange: (val: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="inspector-icon-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`inspector-icon-btn${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
          title={opt.title}
          aria-label={opt.title}
        >
          <Icon name={opt.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <label className="inspector-checkbox-wrap" htmlFor={id}>
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        className={`inspector-checkbox${checked ? " checked" : ""}`}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
      >
        {checked && <Icon name="check" size={12} />}
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Counter({
  value,
  onIncrement,
  onDecrement,
  min = 1,
  ariaLabel,
}: {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
  ariaLabel?: string;
}) {
  return (
    <div className="inspector-counter" aria-label={ariaLabel}>
      <button
        type="button"
        className="inspector-counter-btn"
        disabled={value <= min}
        onClick={onDecrement}
        aria-label="Decrease"
        title="Decrease"
      >
        −
      </button>
      <span className="inspector-counter-val">{value}</span>
      <button type="button" className="inspector-counter-btn" onClick={onIncrement} aria-label="Increase" title="Increase">
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}

export function OpacityControl({
  value,
  onChange,
  ariaLabel = "Opacity",
}: {
  value: number | null | undefined;
  onChange: (val: number) => void;
  ariaLabel?: string;
}) {
  const cur = value != null ? Math.max(0, Math.min(1, value)) : 1;
  const [local, setLocal] = useState(cur);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(cur);
  }, [cur, focused]);

  const commit = (num: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(num * 100) / 100));
    onChange(clamped);
  };

  return (
    <div className="inspector-slider-wrap">
      <input
        type="range"
        className="inspector-slider"
        min="0"
        max="1"
        step="0.05"
        value={local}
        aria-label={ariaLabel}
        onChange={(e) => {
          const val = parseFloat(e.target.value);
          setLocal(val);
          commit(val);
        }}
      />
      <div className="inspector-slider-num">
        <NumberField
          value={local}
          onChange={(v) => {
            const next = v != null ? v : 1;
            setLocal(next);
            commit(next);
          }}
          min={0}
          max={1}
          step={0.05}
          unit=""
          ariaLabel={ariaLabel}
        />
      </div>
    </div>
  );
}
