// Inspector view when no element is selected: slide-level settings.

import { TRANSITIONS, getStyle, setAttr, setSection, setStyle } from "@opendeck/format";
import { currentSlide, editIndex, editSlide, useEditor } from "../../editor/store.ts";
import { Icon, MenuButton } from "@opendeck/shell";
import { ColorControl } from "./ColorControl.tsx";
import { Checkbox, InspectorRow, InspectorSection, TextField } from "./Fields.tsx";
import { ThemeSection } from "./ThemeSection.tsx";

export function SlideInspector() {
  const slideItem = useEditor((s) => currentSlide(s));
  const deck = useEditor((s) => s.deck);

  if (!slideItem?.slide || !deck) return null;
  const slide = slideItem.slide;
  const slideId = slideItem.id;
  const themeColors = deck.index.theme.colors;

  // Background
  const bg = getStyle(slide, "background") ?? "";

  // Transition
  const currentTransition = slide.attrs["data-transition"] ?? "none";

  // Section
  const sectionObj = deck.index.sections.find((s) => s.start === slideId);
  const sectionTitle = sectionObj?.title ?? "";

  // Skip
  const isHidden = slide.attrs.hidden !== undefined;

  return (
    <>
      <InspectorSection heading="Slide">
        <InspectorRow label="Background">
          <ColorControl
            value={bg}
            themeColors={themeColors}
            allowNone={false}
            ariaLabel="Slide background"
            onChange={(val) => {
              void editSlide("Slide background", (s, ctx) => setStyle(s, "", "background", val, ctx));
            }}
          />
        </InspectorRow>

        <InspectorRow label="Transition">
          <MenuButton
            className="inspector-dropdown"
            label="Transition"
            entries={TRANSITIONS.map((t) => ({
              label: t.charAt(0).toUpperCase() + t.slice(1),
              checked: currentTransition === t,
              onSelect: () => {
                void editSlide("Slide transition", (s, ctx) =>
                  setAttr(s, "", "data-transition", t === "none" ? null : t, ctx),
                );
              },
            }))}
          >
            <span className="inspector-dropdown-label">
              {currentTransition.charAt(0).toUpperCase() + currentTransition.slice(1)}
            </span>
            <span className="inspector-dropdown-icon">
              <Icon name="chevronDown" size={12} />
            </span>
          </MenuButton>
        </InspectorRow>

        <InspectorRow label="Section">
          <TextField
            value={sectionTitle}
            placeholder="Section name"
            ariaLabel="Section"
            onChange={(val) => {
              void editIndex("Section", (index) => setSection(index, slideId, val));
            }}
          />
        </InspectorRow>

        <InspectorRow label="Skip in show">
          <Checkbox
            checked={isHidden}
            ariaLabel="Skip in show"
            onChange={(checked) => {
              void editSlide(checked ? "Skip slide" : "Show slide", (s, ctx) =>
                setAttr(s, "", "hidden", checked ? "" : null, ctx),
              );
            }}
          />
        </InspectorRow>
      </InspectorSection>

      <ThemeSection />
    </>
  );
}
