// A small ZIP reader and writer for the bot's terminal (zip, unzip), on Node's
// zlib and nothing else. It writes standard archives: stored (0) or deflated
// (8) entries, UTF-8 names, a central directory. It reads the same two methods.
//
// Reading checks every header before any data is inflated: the entry count, the
// total size the headers declare, names that would leave the folder, links,
// encryption and zip64. Each entry inflates to at most the size its header
// declares, and its checksum is checked.

const zlib = require("node:zlib");

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const ENTRIES_MAX = 10_000;
const S_IFLNK = 0o120000;
const S_IFMT = 0o170000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosStamp(d) {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Entries { name, data } (a name ending in "/" is a folder). Returns the archive as a Buffer. */
function createZip(entries, { now = new Date() } = {}) {
  if (entries.length > 0xfffe) throw new Error("There are too many entries for one zip.");
  const { time, date } = dosStamp(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const dir = e.name.endsWith("/");
    const data = dir ? Buffer.alloc(0) : e.data;
    const crc = crc32(data);
    const deflated = data.length ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const method = data.length && deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;

    const head = Buffer.alloc(30);
    head.writeUInt32LE(SIG_LOCAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(SIG_CENTRAL, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(dir ? 0x10 : 0, 38);
    cen.writeUInt32LE(offset, 42);

    parts.push(head, name, body);
    central.push(cen, name);
    offset += head.length + name.length + body.length;
    if (offset > 0xfffffffe) throw new Error("The files are too big for one zip.");
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const damaged = (name) => new Error(`${name} is damaged`);

/**
 * The parts of an entry name that stay inside the archive's folder, as a list
 * of names. Backslashes count as slashes. Empty and "." parts are dropped;
 * "..", absolute and drive names throw.
 */
function safeSegments(name) {
  const fixed = String(name).replace(/\\/g, "/");
  const shown = fixed.length > 120 ? `${fixed.slice(0, 120)}...` : fixed;
  if (fixed.startsWith("/") || /^[A-Za-z]:/.test(fixed) || /[\x00-\x1f]/.test(fixed)) {
    throw new Error(`"${shown}" is an unsafe name: it starts outside the folder.`);
  }
  const segs = [];
  for (const s of fixed.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === ".." || s.includes(":")) throw new Error(`"${shown}" is an unsafe name: it leads outside the folder.`);
    segs.push(s);
  }
  return segs;
}

function findEnd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_END) return i;
  return -1;
}

function limitError(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

/**
 * The entries of an archive, checked, before any of them is inflated.
 * maxTotal bounds the sum of the sizes the headers declare (throws code TOO_BIG).
 * Returns { entries: [{ name, segs, dir, method, flags, csize, size, crc, offset }], total }.
 */
function readZip(buf, { maxEntries = ENTRIES_MAX, maxTotal = Infinity } = {}) {
  const end = findEnd(buf);
  if (end < 0) throw new Error("It isn't a zip archive.");
  if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0) throw new Error("It spans several disks, which isn't supported.");
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("It is a zip64 archive, which isn't supported.");
  if (count > maxEntries) throw limitError("TOO_MANY", `It has ${count} entries; unzip takes at most ${maxEntries}.`, { count, limit: maxEntries });
  if (cdOffset + cdSize > buf.length) throw new Error("Its list of files is damaged.");

  const entries = [];
  const seen = new Set();
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("Its list of files is damaged.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const attr = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen > buf.length) throw new Error("Its list of files is damaged.");
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;

    if (flags & 1) throw new Error(`${name} is encrypted; unzip can't open it.`);
    if (method !== 0 && method !== 8) throw new Error(`${name} uses compression method ${method}; only stored and deflated entries are supported.`);
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error("It is a zip64 archive, which isn't supported.");
    if (((attr >>> 16) & S_IFMT) === S_IFLNK) throw new Error(`${name} is a link; unzip doesn't make links.`);

    // The declared sizes are summed before any entry is read: a header that claims a huge total stops here.
    total += size;
    if (total > maxTotal) throw limitError("TOO_BIG", `It would unzip to more than ${maxTotal} bytes.`, { total, limit: maxTotal });

    const dir = name.endsWith("/");
    const segs = safeSegments(name);
    if (!segs.length) continue;
    const key = segs.join("/");
    if (seen.has(key)) throw new Error(`${name} is in the archive more than once.`);
    seen.add(key);
    entries.push({ name, segs, dir, method, flags, csize, size, crc, offset });
  }

  const files = new Set(entries.filter((e) => !e.dir).map((e) => e.segs.join("/")));
  for (const e of entries) {
    for (let k = 1; k < e.segs.length; k++) {
      const above = e.segs.slice(0, k).join("/");
      if (files.has(above)) throw new Error(`${e.name} is inside ${above}, which is also a file in the archive.`);
    }
  }
  return { entries, total };
}

/** The bytes of one entry, read from its local header. Inflation stops at the size its header declares. */
function inflateEntry(buf, e) {
  const h = e.offset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== SIG_LOCAL) throw damaged(e.name);
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const end = start + e.csize;
  if (end > buf.length) throw damaged(e.name);
  const raw = buf.subarray(start, end);
  let data;
  if (e.method === 0) {
    if (raw.length !== e.size) throw damaged(e.name);
    data = raw;
  } else {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    } catch (err) {
      if (err.code === "ERR_BUFFER_TOO_LARGE") throw new Error(`${e.name} unpacks to more than its header says (${e.size} bytes); unzip stopped.`);
      throw damaged(e.name);
    }
  }
  if (data.length !== e.size) throw damaged(e.name);
  if (crc32(data) !== e.crc) throw new Error(`${e.name} fails its checksum.`);
  return data;
}

module.exports = { crc32, createZip, readZip, inflateEntry, safeSegments };
