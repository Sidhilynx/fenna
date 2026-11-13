// Pure helper functions for the inspector panel.

export function parsePx(val: string | undefined): number | null {
  if (!val) return null;
  const m = /^(-?\d+(\.\d+)?)px$/.exec(val.trim());
  return m ? parseFloat(m[1]!) : null;
}

export function parseBorder(val: string | undefined, fallbackColor = "var(--line)"): {
  style: "none" | "solid" | "dashed" | "dotted";
  width: number;
  color: string;
} {
  if (!val || val === "none" || val === "0") {
    return { style: "none", width: 1, color: fallbackColor };
  }
  const parts = val.trim().split(/\s+/);
  let style: "none" | "solid" | "dashed" | "dotted" = "solid";
  let width = 1;
  let color = fallbackColor;
  for (const p of parts) {
    if (["none", "solid", "dashed", "dotted"].includes(p)) {
      style = p as "none" | "solid" | "dashed" | "dotted";
    } else if (/^\d+(\.\d+)?px$/.test(p)) {
      width = parseFloat(p);
    } else if (p.startsWith("#") || p.startsWith("var(") || p.startsWith("rgb") || p.startsWith("hsl")) {
      color = p;
    }
  }
  return { style, width, color };
}

export function themeColorName(val: string | null | undefined): string | null {
  if (!val) return null;
  const m = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(val.trim());
  return m ? m[1]! : null;
}

export function isValidHex(str: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(str);
}

export function normalizeHex(str: string): string | null {
  const t = str.trim();
  const withHash = t.startsWith("#") ? t : `#${t}`;
  return isValidHex(withHash) ? withHash.toLowerCase() : null;
}

export function resolveColorHex(val: string | null | undefined, themeColors: Record<string, string>): string {
  if (!val) return "";
  const name = themeColorName(val);
  if (name && themeColors[name]) return themeColors[name];
  if (val.startsWith("#")) return val;
  return val;
}

/** What an element actually renders with (inherited values included), read from the canvas. */
export function computedOf(address: string, prop: "color" | "fontFamily" | "fontSize" | "lineHeight"): string {
  const el = document.querySelector<HTMLElement>(`.stage .od-slide [data-od="${address}"]`);
  return el ? getComputedStyle(el)[prop] : "";
}

/** "rgb(21, 21, 21)" → "#151515" (null for transparent or unparsable). */
export function rgbToHex(css: string): string | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}

/** The theme color with this hex, if any. */
export function themeNameForHex(hex: string, themeColors: Record<string, string>): string | null {
  const h = hex.toLowerCase();
  return Object.entries(themeColors).find(([, v]) => v.toLowerCase() === h)?.[0] ?? null;
}

/** An element's box relative to where left/top apply (its offset parent), in slide px. */
export function domBox(address: string): { left: number; top: number; width: number; height: number } | null {
  const el = document.querySelector<HTMLElement>(`.stage .od-slide [data-od="${address}"]`);
  return el ? { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : null;
}
