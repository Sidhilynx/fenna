import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const zip = require("../src/main/ziplite.cjs");

const GB = 1024 ** 3;

/** Offset of the first central directory header in an archive. */
const centralAt = (buf: Buffer) => {
  for (let i = 0; i < buf.length - 4; i++) if (buf.readUInt32LE(i) === 0x02014b50) return i;
  throw new Error("no central header");
};
const endAt = (buf: Buffer) => buf.length - 22;

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(zip.crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(zip.crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe("createZip and readZip", () => {
  it("round trips stored and deflated entries, with folders", () => {
    const text = Buffer.from("hello ".repeat(500));
    const noise = randomBytes(300); // too random to deflate, so it is stored
    const buf = zip.createZip([{ name: "docs/" }, { name: "docs/a.txt", data: text }, { name: "docs/noise.bin", data: noise }, { name: "empty.txt", data: Buffer.alloc(0) }]);
    const { entries, total } = zip.readZip(buf);
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["docs/", "docs/a.txt", "docs/noise.bin", "empty.txt"]);
    expect(total).toBe(text.length + noise.length);
    const byName = Object.fromEntries(entries.map((e: { name: string }) => [e.name, e]));
    expect(byName["docs/a.txt"].method).toBe(8);
    expect(byName["docs/noise.bin"].method).toBe(0);
    expect(zip.inflateEntry(buf, byName["docs/a.txt"]).equals(text)).toBe(true);
    expect(zip.inflateEntry(buf, byName["docs/noise.bin"]).equals(noise)).toBe(true);
    expect(zip.inflateEntry(buf, byName["empty.txt"]).length).toBe(0);
  });

  it("refuses something that is not a zip", () => {
    expect(() => zip.readZip(Buffer.from("not a zip at all, nothing here to read"))).toThrow(/isn't a zip archive/);
  });

  it("refuses an archive whose headers declare more than the cap, before any data is read", () => {
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("small") }]);
    buf.writeUInt32LE(3 * GB, centralAt(buf) + 24);
    try {
      zip.readZip(buf, { maxTotal: 2 * GB });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as { code: string }).code).toBe("TOO_BIG");
      expect((e as { total: number }).total).toBe(3 * GB);
    }
  });

  it("refuses more entries than the cap, from the header", () => {
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("x") }]);
    buf.writeUInt16LE(10_001, endAt(buf) + 10);
    expect(() => zip.readZip(buf)).toThrow(/at most 10000/);
  });

  it("refuses names that leave the folder, and absolute or drive names", () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/Windows/x", "..\\evil.txt"]) {
      const buf = zip.createZip([{ name, data: Buffer.from("x") }]);
      expect(() => zip.readZip(buf), name).toThrow(/unsafe name/);
    }
  });

  it("drops empty and dot parts, and reads backslashes as folders", () => {
    expect(zip.safeSegments("./a//b/./c.txt")).toEqual(["a", "b", "c.txt"]);
    expect(zip.safeSegments("dir\\file.txt")).toEqual(["dir", "file.txt"]);
    expect(zip.safeSegments("./")).toEqual([]);
  });

  it("refuses encrypted entries, unknown methods and links", () => {
    const enc = zip.createZip([{ name: "a.txt", data: Buffer.from("x") }]);
    enc.writeUInt16LE(enc.readUInt16LE(centralAt(enc) + 8) | 1, centralAt(enc) + 8);
    expect(() => zip.readZip(enc)).toThrow(/encrypted/);

    const method = zip.createZip([{ name: "a.txt", data: Buffer.from("x") }]);
    method.writeUInt16LE(99, centralAt(method) + 10);
    expect(() => zip.readZip(method)).toThrow(/compression method 99/);

    const link = zip.createZip([{ name: "a.txt", data: Buffer.from("x") }]);
    link.writeUInt32LE((0o120777 << 16) >>> 0, centralAt(link) + 38);
    expect(() => zip.readZip(link)).toThrow(/is a link/);
  });

  it("refuses a file and a folder with the same path", () => {
    const buf = zip.createZip([{ name: "a", data: Buffer.from("x") }, { name: "a/b.txt", data: Buffer.from("y") }]);
    expect(() => zip.readZip(buf)).toThrow(/also a file/);
  });

  it("stops inflating at the size the header declares (zip bomb)", () => {
    const bomb = zip.createZip([{ name: "zeros.bin", data: Buffer.alloc(1024 * 1024) }]);
    const { entries } = zip.readZip(bomb);
    expect(entries[0].method).toBe(8);
    bomb.writeUInt32LE(10, centralAt(bomb) + 24);
    const tricked = zip.readZip(bomb).entries[0];
    expect(() => zip.inflateEntry(bomb, tricked)).toThrow(/unpacks to more than its header says/);
  });

  it("fails a wrong checksum", () => {
    const buf = zip.createZip([{ name: "a.txt", data: Buffer.from("abcdef") }]);
    const e = zip.readZip(buf).entries[0];
    e.crc = (e.crc + 1) >>> 0;
    expect(() => zip.inflateEntry(buf, e)).toThrow(/checksum/);
  });
});
