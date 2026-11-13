// Two people (the user and the AI) changing one tab at the same moment.
// The user's unsaved typing and the AI's saved edit started from the same
// tab (`base`); merging block by block keeps both: blocks the user changed
// keep the user's words, every other block takes the AI's version, the
// user's new blocks stay where the user put them, and a block either side
// deleted (that the other didn't change) goes.

import { type ElementNode, serializeNode } from "./tab.ts";

const byId = (blocks: ElementNode[]) => new Map(blocks.map((b) => [b.attrs.id ?? "", b] as const));

export function mergeBlocks(base: ElementNode[], mine: ElementNode[], theirs: ElementNode[]): ElementNode[] {
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const changedByMe = (id: string) => {
    const mb = m.get(id);
    const bb = b.get(id);
    return !!mb && (!bb || serializeNode(mb) !== serializeNode(bb));
  };
  const changedByThem = (id: string) => {
    const tb = t.get(id);
    const bb = b.get(id);
    return !tb || !bb || serializeNode(tb) !== serializeNode(bb);
  };
  const out: ElementNode[] = [];
  for (const block of theirs) {
    const id = block.attrs.id ?? "";
    // Deleted by me, untouched by them: stays deleted.
    if (b.has(id) && !m.has(id) && !changedByThem(id)) continue;
    out.push(changedByMe(id) ? m.get(id)! : block);
  }
  // Blocks I added (or deleted-by-them blocks I changed): after the block before them in my version.
  for (let i = 0; i < mine.length; i++) {
    const block = mine[i]!;
    const id = block.attrs.id ?? "";
    if (t.has(id)) continue;
    if (b.has(id) && !changedByMe(id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.attrs.id === mine[j]!.attrs.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, block);
  }
  return out;
}
