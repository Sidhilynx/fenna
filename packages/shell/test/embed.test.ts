import { describe, expect, it } from "vitest";
import { createEmbedCheck, EMBED_FLAG } from "../renderer/embed.ts";

/** A page's location and sessionStorage, as the check reads them. */
function page(hash: string, flag: string | null = null, opts: { storageThrows?: boolean } = {}) {
  const store = new Map<string, string>();
  if (flag !== null) store.set(EMBED_FLAG, flag);
  let current = hash;
  const storage = {
    getItem(k: string) {
      if (opts.storageThrows) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (opts.storageThrows) throw new Error("blocked");
      store.set(k, v);
    },
  };
  return {
    setHash(h: string) {
      current = h;
    },
    check: () => createEmbedCheck(() => current, storage)(),
    store,
  };
}

describe("embedded mode: decided at load", () => {
  it("is on for a page loaded with #embed, and off for a plain page", () => {
    expect(page("#embed").check()).toBe(true);
    expect(page("#embed&tab=abc").check()).toBe(true);
    expect(page("#tab=abc&embed").check()).toBe(true);
    expect(page("").check()).toBe(false);
    expect(page("#tab=abc").check()).toBe(false);
    expect(page("#embedded").check()).toBe(false);
  });

  it("keeps its answer when the editor later changes the hash", () => {
    let hash = "#embed";
    const check = createEmbedCheck(() => hash, null);
    expect(check()).toBe(true);
    // The editor moves to another tab: the marker is gone from the hash.
    hash = "#tab=other";
    expect(check()).toBe(true);
  });

  it("stays on after the hash lost the marker, when the session remembers it", () => {
    const p = page("#embed");
    expect(p.check()).toBe(true);
    expect(p.store.get(EMBED_FLAG)).toBe("1");
    p.setHash("#slide=3");
    expect(p.check()).toBe(true);
  });

  it("uses the session flag on a load whose hash has no marker", () => {
    expect(page("#slide=3", "1").check()).toBe(true);
    expect(page("#slide=3", "0").check()).toBe(false);
  });

  it("still decides from the hash when storage is blocked", () => {
    expect(page("#embed", null, { storageThrows: true }).check()).toBe(true);
    expect(page("#tab=x", null, { storageThrows: true }).check()).toBe(false);
  });

  it("reads the hash only once", () => {
    let reads = 0;
    const check = createEmbedCheck(() => (++reads, "#embed"), null);
    check();
    check();
    expect(reads).toBe(1);
  });
});
