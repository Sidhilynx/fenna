// Theme section in the Design panel: deck colors, fonts and text styles.

import { useEffect, useRef, useState } from "react";
import {
  type Theme,
  PROPERTIES,
  parseStyle,
  serializeStyle,
} from "@opendeck/format";
import { editIndex, toast, useEditor } from "../../editor/store.ts";
import { Dialog, Icon, MenuButton } from "@opendeck/shell";
import { ColorControl } from "./ColorControl.tsx";
import { InspectorRow, InspectorSection, NumberField } from "./Fields.tsx";
import { normalizeHex, parsePx, resolveColorHex } from "./utils.tsx";

const WEIGHT_OPTIONS = [
  { value: "300", label: "300 – Light" },
  { value: "400", label: "400 – Regular" },
  { value: "500", label: "500 – Medium" },
  { value: "600", label: "600 – Semibold" },
  { value: "700", label: "700 – Bold" },
];

const CASE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Capitalize" },
];

const COLOR_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;

export function ThemeSection() {
  const deck = useEditor((s) => s.deck);
  const [addingColor, setAddingColor] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("");
  const newColorInputRef = useRef<HTMLInputElement>(null);

  const [showFontDialog, setShowFontDialog] = useState(false);
  const [newFontFamily, setNewFontFamily] = useState("");

  const [expandedStyle, setExpandedStyle] = useState<string | null>(null);

  // Focus the name input when adding a color
  useEffect(() => {
    if (addingColor) {
      newColorInputRef.current?.focus();
    }
  }, [addingColor]);

  // Temporary font preview link in the Add Font dialog
  useEffect(() => {
    if (!showFontDialog) return;
    const fam = newFontFamily.trim();
    if (!fam) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    const encoded = encodeURIComponent(fam).replace(/%20/g, "+");
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [showFontDialog, newFontFamily]);

  if (!deck) return null;
  const theme: Theme = deck.index.theme;

  // ── Color actions ───────────────────────────────────────────────────────

  const handleSaveColor = (name: string, hexVal: string | null) => {
    if (!hexVal) return;
    const normalized = normalizeHex(hexVal) ?? hexVal;
    void editIndex(`Change theme color ${name}`, (index) => ({
      ...index,
      theme: {
        ...index.theme,
        colors: {
          ...index.theme.colors,
          [name]: normalized,
        },
      },
    }));
  };

  const handleRemoveColor = (name: string) => {
    // editIndex refuses (with a message) if a slide or text style still uses the color.
    void editIndex(`Remove theme color ${name}`, (index) => {
      const { [name]: _, ...restColors } = index.theme.colors;
      return {
        ...index,
        theme: {
          ...index.theme,
          colors: restColors,
        },
      };
    });
  };

  const handleAddColorSubmit = () => {
    const cleanName = newColorName.trim().toLowerCase();
    if (!COLOR_NAME_RE.test(cleanName)) {
      toast("Color name must be lowercase letters, digits and -");
      return;
    }
    if (theme.colors[cleanName]) {
      toast(`Theme color “${cleanName}” already exists`);
      return;
    }
    const normalized = normalizeHex(newColorHex);
    if (!normalized) {
      toast("Color must be a valid hex code (e.g. #3b82f6)");
      return;
    }

    void editIndex(`Add theme color ${cleanName}`, (index) => ({
      ...index,
      theme: {
        ...index.theme,
        colors: {
          ...index.theme.colors,
          [cleanName]: normalized,
        },
      },
    }));

    setAddingColor(false);
    setNewColorName("");
    setNewColorHex("");
  };

  // ── Font actions ────────────────────────────────────────────────────────

  const handleRemoveFont = (family: string) => {
    void editIndex(`Remove font ${family}`, (index) => ({
      ...index,
      theme: {
        ...index.theme,
        fonts: index.theme.fonts.filter((f) => f.family !== family),
      },
    }));
  };

  const handleAddFontSubmit = () => {
    const fam = newFontFamily.trim();
    if (!fam) return;
    if (theme.fonts.length >= 6) {
      toast("A deck declares at most 6 font families");
      return;
    }
    if (theme.fonts.some((f) => f.family.toLowerCase() === fam.toLowerCase())) {
      toast(`Font family “${fam}” is already in the theme`);
      return;
    }

    void editIndex(`Add font ${fam}`, (index) => ({
      ...index,
      theme: {
        ...index.theme,
        fonts: [
          ...index.theme.fonts,
          { family: fam, source: "google", weights: [400, 600, 700] },
        ],
      },
    }));

    setShowFontDialog(false);
    setNewFontFamily("");
  };

  // ── Text style actions ──────────────────────────────────────────────────

  const updateTextStyleProp = (styleName: string, propName: string, propVal: string | null) => {
    // Only accept properties that the format allows on text elements
    const spec = PROPERTIES[propName];
    if (!spec || !spec.on.includes("p") || (spec.group !== "text" && spec.group !== "appearance")) {
      return;
    }

    const currentCss = theme.textStyles[styleName] ?? "";
    const { decls } = parseStyle(currentCss);
    const filtered = decls.filter((d) => d.name !== propName);
    if (propVal != null && propVal.trim() !== "") {
      filtered.push({ name: propName, value: propVal.trim() });
    }
    const newCss = serializeStyle(filtered);

    void editIndex(`Update text style ${styleName}`, (index) => ({
      ...index,
      theme: {
        ...index.theme,
        textStyles: {
          ...index.theme.textStyles,
          [styleName]: newCss,
        },
      },
    }));
  };

  return (
    <InspectorSection heading="Theme">
      {/* 1. COLORS */}
      <div className="theme-subhead">
        <span>Colors</span>
      </div>

      {Object.entries(theme.colors).map(([name, hex]) => (
        <InspectorRow key={name} label={name} id={`theme-color-${name}`}>
          <div className="theme-row-content">
            <ColorControl
              value={hex}
              themeColors={{}}
              allowNone={false}
              ariaLabel={`${name} color`}
              onChange={(newVal) => handleSaveColor(name, newVal)}
            />
            <button
              type="button"
              className="theme-remove-btn"
              title={`Remove ${name} color`}
              aria-label={`Remove ${name} color`}
              onClick={() => handleRemoveColor(name)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        </InspectorRow>
      ))}

      {Object.keys(theme.colors).length === 0 && (
        <div className="theme-empty-hint">No colors defined</div>
      )}

      {addingColor ? (
        <div className="inspector-row theme-add-color-row">
          <div className="inspector-dual-inputs">
            <input
              ref={newColorInputRef}
              type="text"
              className="inspector-input"
              placeholder="name"
              aria-label="Color name"
              value={newColorName}
              onChange={(e) => setNewColorName(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddColorSubmit();
                } else if (e.key === "Escape") {
                  setAddingColor(false);
                  setNewColorName("");
                  setNewColorHex("");
                }
              }}
            />
            <input
              type="text"
              className="inspector-input"
              placeholder="#000000"
              aria-label="Color hex"
              value={newColorHex}
              onChange={(e) => setNewColorHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddColorSubmit();
                } else if (e.key === "Escape") {
                  setAddingColor(false);
                  setNewColorName("");
                  setNewColorHex("");
                }
              }}
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            title="Save color"
            aria-label="Save color"
            onClick={handleAddColorSubmit}
          >
            <Icon name="check" size={12} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Cancel"
            aria-label="Cancel"
            onClick={() => {
              setAddingColor(false);
              setNewColorName("");
              setNewColorHex("");
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ) : (
        <div className="inspector-row">
          <button
            type="button"
            className="theme-add-btn"
            onClick={() => setAddingColor(true)}
          >
            <Icon name="plus" size={12} />
            <span>Add color</span>
          </button>
        </div>
      )}

      {/* 2. FONTS */}
      <div className="theme-subhead">
        <span>Fonts</span>
      </div>

      {theme.fonts.map((f) => (
        <div className="theme-font-row" key={f.family}>
          <span className="theme-font-name" style={{ fontFamily: f.family }}>
            {f.family}
          </span>
          <button
            type="button"
            className="theme-remove-btn"
            title={`Remove ${f.family} font`}
            aria-label={`Remove ${f.family} font`}
            onClick={() => handleRemoveFont(f.family)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}

      {theme.fonts.length === 0 && (
        <div className="theme-empty-hint">No fonts defined</div>
      )}

      <div className="inspector-row">
        <button
          type="button"
          className="theme-add-btn"
          disabled={theme.fonts.length >= 6}
          title={theme.fonts.length >= 6 ? "Maximum 6 fonts allowed" : "Add a font"}
          onClick={() => {
            setNewFontFamily("");
            setShowFontDialog(true);
          }}
        >
          <Icon name="plus" size={12} />
          <span>Add font{theme.fonts.length >= 6 ? " (max 6)" : ""}</span>
        </button>
      </div>

      {showFontDialog && (
        <Dialog
          title="Add Google Font"
          onClose={() => setShowFontDialog(false)}
          width={440}
        >
          <div className="theme-dialog-form">
            <div className="theme-dialog-field">
              <label className="theme-dialog-label" htmlFor="google-font-family">
                Google Fonts family name
              </label>
              <input
                id="google-font-family"
                data-autofocus
                type="text"
                className="inspector-input"
                placeholder="e.g. Playfair Display"
                value={newFontFamily}
                onChange={(e) => setNewFontFamily(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddFontSubmit();
                  }
                }}
              />
            </div>

            <div className="theme-dialog-field">
              <span className="theme-dialog-label">Preview</span>
              <div
                className="theme-font-preview"
                style={{ fontFamily: newFontFamily.trim() || "inherit" }}
              >
                The quick brown fox
              </div>
            </div>

            <div className="theme-dialog-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowFontDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!newFontFamily.trim()}
                onClick={handleAddFontSubmit}
              >
                Add font
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 3. TEXT STYLES */}
      <div className="theme-subhead">
        <span>Text styles</span>
      </div>

      {Object.entries(theme.textStyles).map(([name, css]) => {
        const isExpanded = expandedStyle === name;
        const { decls } = parseStyle(css);
        const declMap = new Map(decls.map((d) => [d.name, d.value]));

        // Font preview values (font-size capped at 20px)
        const rawSize = parsePx(declMap.get("font-size"));
        const previewFontSize = rawSize != null ? Math.min(20, Math.max(12, rawSize)) : 14;
        const previewStyle: React.CSSProperties = {
          fontFamily: declMap.get("font-family"),
          fontWeight: declMap.get("font-weight"),
          fontSize: `${previewFontSize}px`,
          letterSpacing: declMap.get("letter-spacing"),
          textTransform: (declMap.get("text-transform") as React.CSSProperties["textTransform"]) || "none",
          color: resolveColorHex(declMap.get("color"), theme.colors) || "var(--text)",
        };

        // Active values for fields
        const rawFont = declMap.get("font-family") ?? "";
        const matchedFont = theme.fonts.find(
          (f) => rawFont && rawFont.toLowerCase().includes(f.family.toLowerCase()),
        )?.family;
        const currentFont =
          matchedFont ?? (rawFont ? rawFont.split(",")[0]?.replace(/['"]/g, "").trim() : "") ?? "";

        const currentWeight = declMap.get("font-weight") ?? "400";
        const weightOpt = WEIGHT_OPTIONS.find((w) => w.value === currentWeight);
        const weightLabel = weightOpt ? weightOpt.label : currentWeight;

        const rawLh = declMap.get("line-height");
        const lhVal = rawLh ? parseFloat(rawLh) : null;

        const rawLs = parsePx(declMap.get("letter-spacing"));

        const currentCase = declMap.get("text-transform") ?? "none";
        const caseOpt = CASE_OPTIONS.find((c) => c.value === currentCase);
        const caseLabel = caseOpt ? caseOpt.label : "None";

        const currentColor = declMap.get("color");

        return (
          <div className="theme-style-item" key={name}>
            <div
              className={`theme-style-head${isExpanded ? " expanded" : ""}`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`Text style ${name}`}
              onClick={() => setExpandedStyle(isExpanded ? null : name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedStyle(isExpanded ? null : name);
                }
              }}
            >
              <span className="theme-style-icon">
                <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={12} />
              </span>
              <span className="theme-style-preview" style={previewStyle}>
                {name}
              </span>
              <span className="theme-style-size">
                {rawSize != null ? `${rawSize}px` : ""}
              </span>
            </div>

            {isExpanded && (
              <div className="theme-style-body">
                {/* Font */}
                <InspectorRow label="Font">
                  <MenuButton
                    className="inspector-dropdown"
                    label="Font family"
                    entries={[
                      {
                        label: "Default",
                        checked: !rawFont,
                        onSelect: () => updateTextStyleProp(name, "font-family", null),
                      },
                      ...theme.fonts.map((f) => ({
                        label: f.family,
                        checked: currentFont.toLowerCase() === f.family.toLowerCase(),
                        onSelect: () => updateTextStyleProp(name, "font-family", f.family),
                      })),
                    ]}
                  >
                    <span className="inspector-dropdown-label">{currentFont || "Default"}</span>
                    <span className="inspector-dropdown-icon">
                      <Icon name="chevronDown" size={12} />
                    </span>
                  </MenuButton>
                </InspectorRow>

                {/* Weight */}
                <InspectorRow label="Weight">
                  <MenuButton
                    className="inspector-dropdown"
                    label="Font weight"
                    entries={WEIGHT_OPTIONS.map((w) => ({
                      label: w.label,
                      checked: currentWeight === w.value,
                      onSelect: () => updateTextStyleProp(name, "font-weight", w.value),
                    }))}
                  >
                    <span className="inspector-dropdown-label">{weightLabel}</span>
                    <span className="inspector-dropdown-icon">
                      <Icon name="chevronDown" size={12} />
                    </span>
                  </MenuButton>
                </InspectorRow>

                {/* Size */}
                <InspectorRow label="Size">
                  <NumberField
                    value={rawSize}
                    unit="px"
                    min={8}
                    max={400}
                    ariaLabel="Font size"
                    onChange={(val) =>
                      updateTextStyleProp(name, "font-size", val != null ? `${val}px` : null)
                    }
                  />
                </InspectorRow>

                {/* Line height */}
                <InspectorRow label="Line height">
                  <NumberField
                    value={lhVal}
                    unit=""
                    step={0.05}
                    min={0.5}
                    max={4}
                    placeholder="Auto"
                    allowBlank
                    ariaLabel="Line height"
                    onChange={(val) =>
                      updateTextStyleProp(name, "line-height", val != null ? String(val) : null)
                    }
                  />
                </InspectorRow>

                {/* Letter spacing */}
                <InspectorRow label="Letter sp.">
                  <NumberField
                    value={rawLs}
                    unit="px"
                    step={1}
                    placeholder="0"
                    allowBlank
                    ariaLabel="Letter spacing"
                    onChange={(val) =>
                      updateTextStyleProp(name, "letter-spacing", val != null ? `${val}px` : null)
                    }
                  />
                </InspectorRow>

                {/* Case */}
                <InspectorRow label="Case">
                  <MenuButton
                    className="inspector-dropdown"
                    label="Case"
                    entries={CASE_OPTIONS.map((c) => ({
                      label: c.label,
                      checked: currentCase === c.value,
                      onSelect: () =>
                        updateTextStyleProp(name, "text-transform", c.value === "none" ? null : c.value),
                    }))}
                  >
                    <span className="inspector-dropdown-label">{caseLabel}</span>
                    <span className="inspector-dropdown-icon">
                      <Icon name="chevronDown" size={12} />
                    </span>
                  </MenuButton>
                </InspectorRow>

                {/* Color */}
                <InspectorRow label="Color">
                  <ColorControl
                    value={currentColor}
                    themeColors={theme.colors}
                    allowNone={true}
                    ariaLabel="Text color"
                    onChange={(val) => updateTextStyleProp(name, "color", val)}
                  />
                </InspectorRow>
              </div>
            )}
          </div>
        );
      })}

      {Object.keys(theme.textStyles).length === 0 && (
        <div className="theme-empty-hint">No text styles defined</div>
      )}
    </InspectorSection>
  );
}
