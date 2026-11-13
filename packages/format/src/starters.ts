// Starting points for a new deck: a theme (colors, fonts, text styles) and
// an opening slide. Every starter uses the same color and style NAMES, so
// layouts and the AI can rely on them: colors ink (text), paper (slide),
// card, line, muted, body, accent; text styles display, title, card-title,
// eyebrow, body. darkCover reverses ink and paper on the cover only.

import { type DeckIndex, FORMAT } from "./deck.ts";

export interface Starter {
  key: string;
  label: string;
  description: string;
  theme: DeckIndex["theme"];
  /** Whether the opening slide is dark (ink background) or light. */
  darkCover: boolean;
}

const styles = (display: string, text: string, displayWeight = 400) => ({
  display: `font-family:${display};font-size:120px;font-weight:${displayWeight};line-height:1.05`,
  title: `font-family:${display};font-size:72px;font-weight:${displayWeight};line-height:1.1`,
  "card-title": `font-family:${display};font-size:44px;font-weight:${displayWeight};line-height:1.2`,
  eyebrow: `font-family:${text};font-size:24px;font-weight:600;letter-spacing:4px;text-transform:uppercase`,
  body: `font-family:${text};font-size:32px;line-height:1.4`,
});

export const STARTERS: Starter[] = [
  {
    key: "editorial",
    label: "Editorial",
    description: "Serif headlines, warm paper, one orange accent",
    darkCover: true,
    theme: {
      colors: { ink: "#151515", paper: "#f3f1ec", card: "#fbfaf7", line: "#ddd8cf", muted: "#6b675f", body: "#4a4741", accent: "#ff6b35" },
      fonts: [
        { family: "Instrument Serif", source: "google" },
        { family: "Inter", source: "google", weights: [400, 600] },
      ],
      textStyles: styles("'Instrument Serif', Georgia, serif", "Inter, Arial, sans-serif"),
    },
  },
  {
    key: "studio",
    label: "Studio",
    description: "Clean sans, cool white, a deep blue accent",
    darkCover: false,
    theme: {
      colors: { ink: "#0f172a", paper: "#f8fafc", card: "#ffffff", line: "#e2e8f0", muted: "#64748b", body: "#334155", accent: "#2747d8" },
      fonts: [{ family: "Inter", source: "google", weights: [400, 600, 700] }],
      textStyles: styles("Inter, Arial, sans-serif", "Inter, Arial, sans-serif", 700),
    },
  },
  {
    key: "night",
    label: "Night",
    description: "Dark slides, bright type, a lime accent",
    // Roles, not shades: ink is the text color and paper the slide color, so on a dark theme ink is light.
    darkCover: false,
    theme: {
      colors: { ink: "#eef2ef", paper: "#121514", card: "#1c201e", line: "#2b302d", muted: "#8a938e", body: "#c7cfca", accent: "#c6f432" },
      fonts: [
        { family: "Space Grotesk", source: "google", weights: [500, 700] },
        { family: "Inter", source: "google", weights: [400, 600] },
      ],
      textStyles: styles("'Space Grotesk', Arial, sans-serif", "Inter, Arial, sans-serif", 500),
    },
  },
  {
    key: "plain",
    label: "Plain",
    description: "Black on white, system fonts, works offline",
    darkCover: false,
    theme: {
      colors: { ink: "#111111", paper: "#ffffff", card: "#f5f5f5", line: "#e5e5e5", muted: "#737373", body: "#404040", accent: "#111111" },
      fonts: [],
      textStyles: styles("Georgia, serif", "Arial, sans-serif"),
    },
  },
];

/** A new deck's files: deck.json and its cover slide. On a dark-cover theme the cover is ink on paper reversed. */
export function newDeckFiles(title: string, starterKey = "editorial"): { index: DeckIndex; slides: Record<string, string> } {
  const s = STARTERS.find((x) => x.key === starterKey) ?? STARTERS[0]!;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [bg, fg] = s.darkCover ? ["ink", "paper"] : ["paper", "ink"];
  const cover = `<section id="cover" data-transition="fade" style="background:var(--${bg});color:var(--${fg});padding:128px;justify-content:center;gap:40px">
  <p data-style="eyebrow" style="color:var(--accent)">[Eyebrow]</p>
  <h1 data-style="display" style="width:1500px">${esc(title)}</h1>
  <p data-style="body" style="color:var(--muted);width:960px">[A one-line subtitle]</p>
</section>
`;
  return {
    index: { format: FORMAT, title, slides: ["cover"], sections: [], theme: s.theme },
    slides: { cover },
  };
}
