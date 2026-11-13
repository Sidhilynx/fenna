// Inspector view when exactly one element is selected.

import {
  type ElementNode,
  type Theme,
  PROPERTIES,
  addTableColumn,
  addTableRow,
  elementChildren,
  getStyle,
  removeTableColumn,
  removeTableRow,
  resolvedStyle,
  setAttr,
  setHeaderRow,
  setStyle,
  setStyles,
} from "@opendeck/format";
import { anchorToTopLeft, isPinned, setPinned } from "../../editor/commands.ts";
import { editSlide } from "../../editor/store.ts";
import { Icon, MenuButton } from "@opendeck/shell";
import { ColorControl } from "./ColorControl.tsx";
import {
  Checkbox,
  Counter,
  IconGroup,
  InspectorRow,
  InspectorSection,
  NumberField,
  OpacityControl,
  Segmented,
  TextField,
} from "./Fields.tsx";
import { computedOf, domBox, parseBorder, parsePx, rgbToHex } from "./utils.tsx";

export { parseBorder, parsePx } from "./utils.tsx";

const WEIGHT_OPTIONS = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

const CASE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Capitalize" },
];

const ALIGN_OPTIONS = [
  { value: "left", icon: "alignLeft" as const, title: "Left" },
  { value: "center", icon: "alignCenter" as const, title: "Center" },
  { value: "right", icon: "alignRight" as const, title: "Right" },
  { value: "justify", icon: "alignJustify" as const, title: "Justify" },
];

const BORDER_STYLE_OPTIONS = [
  { value: "none" as const, label: "None" },
  { value: "solid" as const, label: "Solid" },
  { value: "dashed" as const, label: "Dash" },
  { value: "dotted" as const, label: "Dot" },
];

export function ElementInspector({
  element,
  address,
  theme,
}: {
  element: ElementNode;
  address: string;
  theme: Theme;
}) {
  const tag = element.tag;

  // Resolved styles for Text section
  const resolved = resolvedStyle(element, theme);
  const resolvedMap = new Map(resolved.map((d) => [d.name, d.value]));
  const inlineMap = new Map(element.style.map((d) => [d.name, d.value]));
  const isFromTextStyle = (prop: string) => !inlineMap.has(prop) && resolvedMap.has(prop);

  // Position applicability
  const hasPosition = PROPERTIES.position?.on.includes(tag);
  const pinned = isPinned(element);
  const hasWidth = PROPERTIES.width?.on.includes(tag);
  const hasHeight = PROPERTIES.height?.on.includes(tag);

  // Text applicability
  const hasText = PROPERTIES["font-size"]?.on.includes(tag);

  // Appearance applicability
  const hasBackground = PROPERTIES.background?.on.includes(tag);
  const hasOpacity = PROPERTIES.opacity?.on.includes(tag);
  const hasRadius = PROPERTIES["border-radius"]?.on.includes(tag);
  const hasBorder = PROPERTIES.border?.on.includes(tag);
  const showAppearance = hasBackground || hasOpacity || hasRadius || hasBorder;

  // Table applicability
  const isTable = tag === "table";

  // Image applicability
  const isImg = tag === "img";

  return (
    <>
      {/* 1. POSITION */}
      {hasPosition && (
        <InspectorSection heading="Position">
          <InspectorRow label="Placement">
            <Segmented
              options={[
                { value: "layout", label: "In layout" },
                { value: "pinned", label: "Pinned" },
              ]}
              value={pinned ? "pinned" : "layout"}
              ariaLabel="Placement"
              onChange={(val) => {
                void setPinned(val === "pinned");
              }}
            />
          </InspectorRow>

          {pinned ? (
            <>
              <InspectorRow label="X">
                <NumberField
                  value={parsePx(getStyle(element, "left")) ?? domBox(address)?.left}
                  unit="px"
                  ariaLabel="X"
                  onChange={(val) => {
                    const dom = document.querySelector<HTMLElement>(`.stage .od-slide [data-od="${address}"]`);
                    void editSlide("Move", (s, ctx) =>
                      setStyles(s, address, { ...(dom ? anchorToTopLeft(element, dom) : { right: null }), left: val != null ? `${val}px` : null }, ctx),
                    );
                  }}
                />
              </InspectorRow>

              <InspectorRow label="Y">
                <NumberField
                  value={parsePx(getStyle(element, "top")) ?? domBox(address)?.top}
                  unit="px"
                  ariaLabel="Y"
                  onChange={(val) => {
                    const dom = document.querySelector<HTMLElement>(`.stage .od-slide [data-od="${address}"]`);
                    void editSlide("Move", (s, ctx) =>
                      setStyles(s, address, { ...(dom ? anchorToTopLeft(element, dom) : { bottom: null }), top: val != null ? `${val}px` : null }, ctx),
                    );
                  }}
                />
              </InspectorRow>

              {hasWidth && (
                <InspectorRow label="Width">
                  <NumberField
                    value={parsePx(getStyle(element, "width"))}
                    unit="px"
                    ariaLabel="Width"
                    min={0}
                    onChange={(val) => {
                      void editSlide("Width", (s, ctx) =>
                        setStyle(s, address, "width", val != null ? `${val}px` : null, ctx),
                      );
                    }}
                  />
                </InspectorRow>
              )}

              {hasHeight && (
                <InspectorRow label="Height">
                  <NumberField
                    value={parsePx(getStyle(element, "height"))}
                    unit="px"
                    ariaLabel="Height"
                    min={0}
                    onChange={(val) => {
                      void editSlide("Height", (s, ctx) =>
                        setStyle(s, address, "height", val != null ? `${val}px` : null, ctx),
                      );
                    }}
                  />
                </InspectorRow>
              )}
            </>
          ) : (
            <>
              {hasWidth && (
                <InspectorRow label="Width">
                  <NumberField
                    value={parsePx(getStyle(element, "width"))}
                    unit="px"
                    ariaLabel="Width"
                    placeholder="auto"
                    allowBlank
                    min={0}
                    onChange={(val) => {
                      void editSlide("Width", (s, ctx) =>
                        setStyle(s, address, "width", val != null ? `${val}px` : null, ctx),
                      );
                    }}
                  />
                </InspectorRow>
              )}

              {hasHeight && (
                <InspectorRow label="Height">
                  <NumberField
                    value={parsePx(getStyle(element, "height"))}
                    unit="px"
                    ariaLabel="Height"
                    placeholder="auto"
                    allowBlank
                    min={0}
                    onChange={(val) => {
                      void editSlide("Height", (s, ctx) =>
                        setStyle(s, address, "height", val != null ? `${val}px` : null, ctx),
                      );
                    }}
                  />
                </InspectorRow>
              )}
            </>
          )}
        </InspectorSection>
      )}

      {/* 2. TEXT */}
      {hasText && (
        <InspectorSection heading="Text">
          {/* Text style */}
          <InspectorRow label="Text style">
            <MenuButton
              className="inspector-dropdown"
              label="Text style"
              entries={[
                {
                  label: "None",
                  checked: !element.attrs["data-style"],
                  onSelect: () => {
                    void editSlide("Text style", (s, ctx) => setAttr(s, address, "data-style", null, ctx));
                  },
                },
                ...Object.keys(theme.textStyles).map((name) => ({
                  label: name,
                  checked: element.attrs["data-style"] === name,
                  onSelect: () => {
                    void editSlide("Text style", (s, ctx) => setAttr(s, address, "data-style", name, ctx));
                  },
                })),
              ]}
            >
              <span className="inspector-dropdown-label">{element.attrs["data-style"] ?? "None"}</span>
              <span className="inspector-dropdown-icon">
                <Icon name="chevronDown" size={12} />
              </span>
            </MenuButton>
          </InspectorRow>

          {/* Font */}
          {(() => {
            const fontDimmed = isFromTextStyle("font-family");
            const rawFont = resolvedMap.get("font-family");
            const activeFamily =
              theme.fonts.find((f) => rawFont && rawFont.includes(f.family))?.family ??
              (rawFont && !inlineMap.has("font-family") ? rawFont : inlineMap.has("font-family") ? rawFont! : null);
            const shownFont = activeFamily ?? (computedOf(address, "fontFamily").split(",")[0] ?? "").replace(/["']/g, "").trim();

            return (
              <InspectorRow label="Font">
                <MenuButton
                  className={`inspector-dropdown${fontDimmed ? " dimmed" : ""}`}
                  label="Font family"
                  entries={[
                    {
                      label: "Default",
                      checked: !inlineMap.has("font-family"),
                      onSelect: () => {
                        void editSlide("Font family", (s, ctx) => setStyle(s, address, "font-family", null, ctx));
                      },
                    },
                    ...theme.fonts.map((f) => ({
                      label: f.family,
                      checked: activeFamily === f.family,
                      onSelect: () => {
                        void editSlide("Font family", (s, ctx) => setStyle(s, address, "font-family", f.family, ctx));
                      },
                    })),
                  ]}
                >
                  <span className={`inspector-dropdown-label${activeFamily ? "" : " inherited"}`}>{shownFont || "Default"}</span>
                  <span className="inspector-dropdown-icon">
                    <Icon name="chevronDown" size={12} />
                  </span>
                </MenuButton>
              </InspectorRow>
            );
          })()}

          {/* Weight */}
          {(() => {
            const weightDimmed = isFromTextStyle("font-weight");
            const currentWeight = resolvedMap.get("font-weight") ?? "400";
            const opt = WEIGHT_OPTIONS.find((w) => w.value === currentWeight);
            const weightLabel = opt ? opt.label : currentWeight;

            return (
              <InspectorRow label="Weight">
                <MenuButton
                  className={`inspector-dropdown${weightDimmed ? " dimmed" : ""}`}
                  label="Font weight"
                  entries={WEIGHT_OPTIONS.map((w) => ({
                    label: w.label,
                    checked: currentWeight === w.value,
                    onSelect: () => {
                      void editSlide("Font weight", (s, ctx) => setStyle(s, address, "font-weight", w.value, ctx));
                    },
                  }))}
                >
                  <span className="inspector-dropdown-label">{weightLabel}</span>
                  <span className="inspector-dropdown-icon">
                    <Icon name="chevronDown" size={12} />
                  </span>
                </MenuButton>
              </InspectorRow>
            );
          })()}

          {/* Size */}
          {(() => {
            const sizeDimmed = isFromTextStyle("font-size");
            const sizePx = parsePx(resolvedMap.get("font-size"));

            return (
              <InspectorRow label="Size">
                <NumberField
                  value={sizePx}
                  unit="px"
                  dimmed={sizeDimmed}
                  ariaLabel="Font size"
                  min={8}
                  max={400}
                  onChange={(val) => {
                    void editSlide("Font size", (s, ctx) =>
                      setStyle(s, address, "font-size", val != null ? `${val}px` : null, ctx),
                    );
                  }}
                />
              </InspectorRow>
            );
          })()}

          {/* Line height and Letter spacing side by side */}
          {(() => {
            const lhDimmed = isFromTextStyle("line-height");
            const rawLh = resolvedMap.get("line-height");
            const lhVal = rawLh ? parseFloat(rawLh) : null;

            const lsDimmed = isFromTextStyle("letter-spacing");
            const lsVal = parsePx(resolvedMap.get("letter-spacing"));

            return (
              <InspectorRow label="Spacing">
                <div className="inspector-dual-inputs">
                  <NumberField
                    value={lhVal}
                    unit=""
                    step={0.1}
                    dimmed={lhDimmed}
                    placeholder="Auto"
                    ariaLabel="Line height"
                    allowBlank
                    onChange={(val) => {
                      void editSlide("Line height", (s, ctx) =>
                        setStyle(s, address, "line-height", val != null ? String(val) : null, ctx),
                      );
                    }}
                  />
                  <NumberField
                    value={lsVal}
                    unit="px"
                    step={1}
                    dimmed={lsDimmed}
                    placeholder="0"
                    ariaLabel="Letter spacing"
                    allowBlank
                    onChange={(val) => {
                      void editSlide("Letter spacing", (s, ctx) =>
                        setStyle(s, address, "letter-spacing", val != null ? `${val}px` : null, ctx),
                      );
                    }}
                  />
                </div>
              </InspectorRow>
            );
          })()}

          {/* Color */}
          {(() => {
            const colorDimmed = isFromTextStyle("color");
            const currentColor = resolvedMap.get("color");

            return (
              <InspectorRow label="Color">
                <ColorControl
                  value={currentColor}
                  themeColors={theme.colors}
                  allowNone={false}
                  dimmed={colorDimmed}
                  inherited={currentColor ? null : rgbToHex(computedOf(address, "color"))}
                  ariaLabel="Text color"
                  onChange={(val) => {
                    void editSlide("Color", (s, ctx) => setStyle(s, address, "color", val, ctx));
                  }}
                />
              </InspectorRow>
            );
          })()}

          {/* Align */}
          {(() => {
            const currentAlign = (resolvedMap.get("text-align") ?? "left") as "left" | "center" | "right" | "justify";

            return (
              <InspectorRow label="Align">
                <IconGroup
                  options={ALIGN_OPTIONS}
                  value={currentAlign}
                  ariaLabel="Text alignment"
                  onChange={(val) => {
                    void editSlide("Text align", (s, ctx) => setStyle(s, address, "text-align", val, ctx));
                  }}
                />
              </InspectorRow>
            );
          })()}

          {/* Case */}
          {(() => {
            const caseDimmed = isFromTextStyle("text-transform");
            const currentCase = resolvedMap.get("text-transform") ?? "none";
            const opt = CASE_OPTIONS.find((c) => c.value === currentCase);
            const caseLabel = opt ? opt.label : "None";

            return (
              <InspectorRow label="Case">
                <MenuButton
                  className={`inspector-dropdown${caseDimmed ? " dimmed" : ""}`}
                  label="Text case"
                  entries={CASE_OPTIONS.map((c) => ({
                    label: c.label,
                    checked: currentCase === c.value,
                    onSelect: () => {
                      void editSlide("Text transform", (s, ctx) =>
                        setStyle(s, address, "text-transform", c.value === "none" ? null : c.value, ctx),
                      );
                    },
                  }))}
                >
                  <span className="inspector-dropdown-label">{caseLabel}</span>
                  <span className="inspector-dropdown-icon">
                    <Icon name="chevronDown" size={12} />
                  </span>
                </MenuButton>
              </InspectorRow>
            );
          })()}
        </InspectorSection>
      )}

      {/* 3. APPEARANCE */}
      {showAppearance && (
        <InspectorSection heading="Appearance">
          {hasBackground && (
            <InspectorRow label="Background">
              <ColorControl
                value={getStyle(element, "background")}
                themeColors={theme.colors}
                allowNone
                ariaLabel="Background color"
                onChange={(val) => {
                  void editSlide("Background", (s, ctx) => setStyle(s, address, "background", val, ctx));
                }}
              />
            </InspectorRow>
          )}

          {hasOpacity && (
            <InspectorRow label="Opacity">
              <OpacityControl
                value={getStyle(element, "opacity") != null ? parseFloat(getStyle(element, "opacity")!) : 1}
                ariaLabel="Opacity"
                onChange={(val) => {
                  void editSlide("Opacity", (s, ctx) =>
                    setStyle(s, address, "opacity", val === 1 ? null : String(val), ctx),
                  );
                }}
              />
            </InspectorRow>
          )}

          {hasRadius && (
            <InspectorRow label="Radius">
              <NumberField
                value={parsePx(getStyle(element, "border-radius"))}
                unit="px"
                min={0}
                allowBlank
                ariaLabel="Border radius"
                onChange={(val) => {
                  void editSlide("Corner radius", (s, ctx) =>
                    setStyle(s, address, "border-radius", val != null ? `${val}px` : null, ctx),
                  );
                }}
              />
            </InspectorRow>
          )}

          {hasBorder &&
            (() => {
              const borderParsed = parseBorder(getStyle(element, "border"), theme.colors.line ? "var(--line)" : "#d4d4d1");
              return (
                <>
                  <InspectorRow label="Border">
                    <Segmented
                      options={BORDER_STYLE_OPTIONS}
                      value={borderParsed.style}
                      ariaLabel="Border style"
                      onChange={(newStyle) => {
                        void editSlide("Border style", (s, ctx) => {
                          if (newStyle === "none") return setStyle(s, address, "border", null, ctx);
                          return setStyle(
                            s,
                            address,
                            "border",
                            `${borderParsed.width}px ${newStyle} ${borderParsed.color}`,
                            ctx,
                          );
                        });
                      }}
                    />
                  </InspectorRow>

                  {borderParsed.style !== "none" && (
                    <>
                      <InspectorRow label="Width">
                        <NumberField
                          value={borderParsed.width}
                          unit="px"
                          min={0}
                          max={32}
                          ariaLabel="Border width"
                          onChange={(w) => {
                            void editSlide("Border width", (s, ctx) =>
                              setStyle(
                                s,
                                address,
                                "border",
                                `${w != null ? w : 1}px ${borderParsed.style} ${borderParsed.color}`,
                                ctx,
                              ),
                            );
                          }}
                        />
                      </InspectorRow>

                      <InspectorRow label="Color">
                        <ColorControl
                          value={borderParsed.color}
                          themeColors={theme.colors}
                          allowNone={false}
                          ariaLabel="Border color"
                          onChange={(c) => {
                            void editSlide("Border color", (s, ctx) =>
                              setStyle(
                                s,
                                address,
                                "border",
                                `${borderParsed.width}px ${borderParsed.style} ${c || borderParsed.color}`,
                                ctx,
                              ),
                            );
                          }}
                        />
                      </InspectorRow>
                    </>
                  )}
                </>
              );
            })()}
        </InspectorSection>
      )}

      {/* 4. TABLE */}
      {isTable &&
        (() => {
          const rows = elementChildren(element).filter((r) => r.tag === "tr");
          const rowCount = rows.length;
          const firstRow = rows[0];
          const colCount = firstRow ? elementChildren(firstRow).length : 1;
          const isHeader =
            firstRow && elementChildren(firstRow).length > 0 && elementChildren(firstRow).every((c) => c.tag === "th");

          return (
            <InspectorSection heading="Table">
              <InspectorRow label="Rows">
                <Counter
                  value={rowCount}
                  min={1}
                  ariaLabel="Rows count"
                  onDecrement={() => {
                    void editSlide("Remove table row", (s, ctx) => removeTableRow(s, address, rowCount - 1, ctx));
                  }}
                  onIncrement={() => {
                    void editSlide("Add table row", (s, ctx) => addTableRow(s, address, rowCount - 1, ctx));
                  }}
                />
              </InspectorRow>

              <InspectorRow label="Columns">
                <Counter
                  value={colCount}
                  min={1}
                  ariaLabel="Columns count"
                  onDecrement={() => {
                    void editSlide("Remove table column", (s, ctx) =>
                      removeTableColumn(s, address, colCount - 1, ctx),
                    );
                  }}
                  onIncrement={() => {
                    void editSlide("Add table column", (s, ctx) => addTableColumn(s, address, colCount - 1, ctx));
                  }}
                />
              </InspectorRow>

              <InspectorRow label="Header row">
                <Checkbox
                  checked={!!isHeader}
                  ariaLabel="Header row"
                  onChange={(checked) => {
                    void editSlide(checked ? "Add header row" : "Remove header row", (s, ctx) =>
                      setHeaderRow(s, address, checked, ctx),
                    );
                  }}
                />
              </InspectorRow>
            </InspectorSection>
          );
        })()}

      {/* 5. IMAGE */}
      {isImg && (
        <InspectorSection heading="Image">
          <InspectorRow label="Fit">
            <Segmented
              options={[
                { value: "cover", label: "Cover" },
                { value: "contain", label: "Contain" },
              ]}
              value={(getStyle(element, "object-fit") ?? "cover") as "cover" | "contain"}
              ariaLabel="Image fit"
              onChange={(val) => {
                void editSlide("Image fit", (s, ctx) => setStyle(s, address, "object-fit", val, ctx));
              }}
            />
          </InspectorRow>

          <InspectorRow label="Description">
            <TextField
              value={element.attrs.alt ?? ""}
              placeholder="Image description (alt)"
              ariaLabel="Image description"
              onChange={(val) => {
                void editSlide("Image description", (s, ctx) => setAttr(s, address, "alt", val || null, ctx));
              }}
            />
          </InspectorRow>
        </InspectorSection>
      )}
    </>
  );
}
