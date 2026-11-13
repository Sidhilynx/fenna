// Inspector view when several elements are selected.

import { type ElementNode, getAt, getStyle, setStyle } from "@opendeck/format";
import { isPinned, setPinned } from "../../editor/commands.ts";
import { editSlide } from "../../editor/store.ts";
import { InspectorRow, InspectorSection, OpacityControl, Segmented } from "./Fields.tsx";

export function MultiInspector({
  slide,
  selection,
}: {
  slide: ElementNode;
  selection: string[];
}) {
  const elements = selection.map((a) => getAt(slide, a)).filter((e): e is ElementNode => !!e);
  const allPinned = elements.length > 0 && elements.every((e) => isPinned(e));
  const allInLayout = elements.length > 0 && elements.every((e) => !isPinned(e));

  const firstOpacity = elements[0] ? getStyle(elements[0], "opacity") : null;
  const currentOpacity = firstOpacity != null ? parseFloat(firstOpacity) : 1;

  return (
    <>
      <InspectorSection heading="Position">
        <InspectorRow label="Placement">
          <Segmented
            options={[
              { value: "layout", label: "In layout" },
              { value: "pinned", label: "Pinned" },
            ]}
            value={allPinned ? "pinned" : allInLayout ? "layout" : undefined}
            ariaLabel="Placement"
            onChange={(val) => {
              void setPinned(val === "pinned");
            }}
          />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection heading="Appearance">
        <InspectorRow label="Opacity">
          <OpacityControl
            value={currentOpacity}
            ariaLabel="Opacity"
            onChange={(val) => {
              void editSlide("Opacity", (s, ctx) => {
                let cur = s;
                for (const a of selection) {
                  cur = setStyle(cur, a, "opacity", val === 1 ? null : String(val), ctx);
                }
                return cur;
              });
            }}
          />
        </InspectorRow>
      </InspectorSection>
    </>
  );
}
