// The small line icons Crew's mockup uses, on one 16px grid. Functional
// only: the fennec is the one decorative mark (Avatar.tsx).

const sq = (x: number, y: number) => `M${x + 1} ${y}h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z`;

const PATHS = {
  grid: [sq(2, 2), sq(9, 2), sq(2, 9), sq(9, 9)].join(""),
  search: "M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.5 10.5 14 14",
  plus: "M8 3v10M3 8h10",
  back: "M10 3 5 8l5 5",
  check: "M3 8.5 6.5 12 13 4.5",
  send: "M8 13V3M4 7l4-4 4 4",
  close: "M4 4l8 8M12 4l-8 8",
  chevron: "M4 6l4 4 4-4",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  hand: "M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V2.8a1 1 0 0 1 2 0V7M9.5 7V3.8a1 1 0 0 1 2 0V8M11.5 8V5.8a1 1 0 0 1 2 0V9.5a4.5 4.5 0 0 1-4.5 4.5H8.4a4 4 0 0 1-3.3-1.8L3.2 9.4a1 1 0 0 1 1.6-1.1l.7.9",
  activity: "M2 8h3l2-4 2 8 2-4h3",
  browser: "M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM1 6h14M3.5 4.5h.01M5.5 4.5h.01M7.5 4.5h.01",
  settings: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM2.5 8a5.5 5.5 0 0 1 .15-1.28l-1.42-.92 1.4-2.42 1.63.48a5.5 5.5 0 0 1 1.1-.64L5.6 1.5h2.8l.24 1.72c.4.17.77.38 1.1.64l1.63-.48 1.4 2.42-1.42.92c.1.42.15.85.15 1.28s-.05.86-.15 1.28l1.42.92-1.4 2.42-1.63-.48a5.5 5.5 0 0 1-1.1.64L8.4 14.5H5.6l-.24-1.72a5.5 5.5 0 0 1-1.1-.64l-1.63.48-1.4-2.42 1.42-.92A5.5 5.5 0 0 1 2.5 8Z",
  doc: "M4 2h5l3 3v9H4zM9 2v3h3",
  expand: "M10 2h4v4M14 2 9 7M6 14H2v-4M2 14l5-5",
  minimize: "M3 8h10",
  panel: "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM10 2.5v11",
  sidebar: "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM6 2.5v11",
  share: "M8 10V2.5M5 5l3-3 3 3M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4",
  trash:"M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5",
  forward: "M6 3l5 5-5 5",
  reload: "M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3",
  stop: "M5 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
  warn: "M8 2.5 14 13H2zM8 6.5v3M8 11.5v.01",
  sound: "M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9",
  muted: "M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 6l3.5 4M14.5 6 11 10",
  copy: "M5.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM2.5 10.5v-7a1 1 0 0 1 1-1h7",
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 16, solid = false }: { name: GlyphName; size?: number; solid?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={solid ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
