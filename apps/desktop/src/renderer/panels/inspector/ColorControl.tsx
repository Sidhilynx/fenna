// The Color control: swatch + text field + theme palette popover.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeHex, resolveColorHex, themeColorName, themeNameForHex } from "./utils.tsx";

export { isValidHex, normalizeHex, resolveColorHex, themeColorName } from "./utils.tsx";

export function ColorControl({
  value,
  onChange,
  themeColors = {},
  allowNone = false,
  ariaLabel = "Color",
  dimmed = false,
  inherited,
}: {
  value: string | null | undefined;
  onChange: (val: string | null) => void;
  themeColors?: Record<string, string>;
  allowNone?: boolean;
  ariaLabel?: string;
  dimmed?: boolean;
  /** The color the element shows when it sets none itself (inherited), as #hex. */
  inherited?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Field text: show name for theme colors (e.g. "accent" for var(--accent))
  const themeName = themeColorName(value);
  const inheritedName = !value && inherited ? (themeNameForHex(inherited, themeColors) ?? inherited) : null;
  const displayVal = themeName ? themeName : value ? value : inheritedName ? inheritedName : allowNone ? "None" : "";
  const [fieldText, setFieldText] = useState(displayVal);
  const [fieldFocused, setFieldFocused] = useState(false);

  useEffect(() => {
    if (!fieldFocused) setFieldText(displayVal);
  }, [displayVal, fieldFocused]);

  // Position popover
  useLayoutEffect(() => {
    if (!open || !swatchRef.current) return;
    const r = swatchRef.current.getBoundingClientRect();
    const popW = 236;
    let left = r.left - popW + r.width;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    let top = r.bottom + 6;
    if (top + 220 > window.innerHeight - 8) top = Math.max(8, r.top - 220 - 6);
    setPopPos({ left, top });
  }, [open]);

  // Outside click and Esc close popover
  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        swatchRef.current &&
        !swatchRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleDown, true);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("mousedown", handleDown, true);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [open]);

  const commitField = () => {
    const t = fieldText.trim();
    if (!t) {
      if (allowNone) onChange(null);
      else setFieldText(displayVal);
      return;
    }
    if (allowNone && /^(none|null|transparent)$/i.test(t)) {
      onChange(null);
      return;
    }
    if (themeColors[t]) {
      onChange(`var(--${t})`);
      return;
    }
    if (t.startsWith("--") && themeColors[t.slice(2)]) {
      onChange(`var(${t})`);
      return;
    }
    if (t.startsWith("var(--") && t.endsWith(")")) {
      onChange(t);
      return;
    }
    const hex = normalizeHex(t);
    if (hex) {
      onChange(hex);
      return;
    }
    onChange(t);
  };

  const swatchColor = resolveColorHex(value, themeColors) || (inherited ?? "");
  const isNone = (!value && !inherited) || value === "none" || value === "transparent";

  // Local hex in popover
  const initialHex = normalizeHex(swatchColor) ?? (swatchColor.startsWith("#") ? swatchColor : "");
  const [popHex, setPopHex] = useState(initialHex);

  useEffect(() => {
    if (open) {
      setPopHex(normalizeHex(swatchColor) ?? "");
    }
  }, [open, swatchColor]);

  const commitPopHex = () => {
    const hex = normalizeHex(popHex);
    if (hex) {
      onChange(hex);
      setOpen(false);
    }
  };

  return (
    <div className="inspector-color-wrap">
      <button
        ref={swatchRef}
        type="button"
        className="inspector-swatch-btn"
        aria-label={`${ariaLabel} swatch`}
        title={`Pick color (${displayVal || "None"})`}
        onClick={() => setOpen(!open)}
      >
        {isNone && allowNone ? (
          <div className="inspector-swatch-none" />
        ) : (
          <div className="inspector-swatch-fill" style={{ background: swatchColor || "var(--text)" }} />
        )}
      </button>

      <input
        type="text"
        className={`inspector-input${dimmed || inheritedName ? " dimmed" : ""}`}
        value={fieldFocused ? fieldText : displayVal}
        aria-label={ariaLabel}
        onFocus={() => {
          setFieldFocused(true);
          setFieldText(displayVal);
        }}
        onChange={(e) => setFieldText(e.target.value)}
        onBlur={() => {
          setFieldFocused(false);
          commitField();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitField();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setFieldText(displayVal);
            setFieldFocused(false);
            e.currentTarget.blur();
          }
        }}
      />

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="inspector-color-popover"
            style={popPos ? { left: popPos.left, top: popPos.top } : { visibility: "hidden", left: 0, top: 0 }}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                swatchRef.current?.focus();
              }
            }}
          >
            <div className="inspector-popover-title">Theme colors</div>
            <div className="inspector-popover-grid" role="group" aria-label="Theme colors">
              {allowNone && (
                <button
                  type="button"
                  className={`inspector-popover-swatch${isNone ? " active" : ""}`}
                  title="None"
                  aria-label="None"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <div className="inspector-swatch-none" />
                </button>
              )}
              {Object.entries(themeColors).map(([name, hex]) => {
                const isSelected = value === `var(--${name})` || value === hex;
                return (
                  <button
                    key={name}
                    type="button"
                    className={`inspector-popover-swatch${isSelected ? " active" : ""}`}
                    title={name}
                    aria-label={name}
                    style={{ background: hex }}
                    onClick={() => {
                      onChange(`var(--${name})`);
                      setOpen(false);
                    }}
                  />
                );
              })}
            </div>

            <div className="inspector-popover-hex">
              <span className="inspector-popover-hex-label">Hex</span>
              <input
                type="text"
                className="inspector-input"
                placeholder="#000000"
                value={popHex}
                onChange={(e) => setPopHex(e.target.value)}
                onBlur={commitPopHex}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitPopHex();
                  }
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
