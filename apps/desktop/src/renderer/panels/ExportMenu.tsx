import { api } from "../api.ts";
import { deckToHtml } from "../export/html.ts";
import { getState, toast } from "../editor/store.ts";
import { Icon, MenuButton } from "@opendeck/shell";

async function run(label: string, fn: () => Promise<string | null>) {
  try {
    const file = await fn();
    if (file) toast(`${label} saved to ${file}`);
  } catch (e) {
    toast(`Couldn’t export: ${(e as Error).message}`);
  }
}

/** Download the deck: PDF, an image of this slide, a web page, or PowerPoint. */
export function ExportMenu() {
  return (
    <MenuButton
      className="icon-btn"
      label="Export"
      title="Export"
      align="end"
      entries={() => {
        const s = getState();
        const deck = s.deck!;
        const title = deck.index.title;
        return [
          { label: "PDF", hint: "For printing and sending", onSelect: () => void run("PDF", () => api().exports.pdf(title)) },
          { label: "This slide as an image", hint: "PNG, 1920×1080", onSelect: () => void run("Image", () => api().exports.png(title, s.current)) },
          { label: "Web page", hint: "One HTML file, works offline", onSelect: () => void run("Web page", async () => api().exports.save(title, "html", new TextEncoder().encode(await deckToHtml(deck, (r) => api().exports.assetData(r))))) },
          "separator",
          { label: "PowerPoint, deck fonts", hint: "Keeps your typefaces", onSelect: () => void run("PowerPoint", async () => api().exports.save(title, "pptx", await (await import("../export/pptx.ts")).deckToPptx(deck, { basicFonts: false }))) },
          { label: "PowerPoint, basic fonts", hint: "Opens the same on any computer", onSelect: () => void run("PowerPoint", async () => api().exports.save(title, "pptx", await (await import("../export/pptx.ts")).deckToPptx(deck, { basicFonts: true }))) },
        ];
      }}
    >
      <Icon name="download" />
    </MenuButton>
  );
}
