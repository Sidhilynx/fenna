// The site icon of a vault login: the icon a site declares in its page
// (<link rel="icon">, "shortcut icon" or "apple-touch-icon"), else its
// /favicon.ico. Fetched from the site itself only, with no cookies, never
// from a private address, and kept on disk for 7 days (misses too) under
// <userData>/Crew/siteicons/<host>.json. The page shows it as an <img> only.

const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 7 * DAY_MS;
const MAX_HTML = 256 * 1024;
const MAX_ICON = 100 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_ACTIVE = 4;
const MAX_HOPS = 3;
const ICON_TYPES = new Set(["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/webp", "image/jpeg"]);

/** "loopback", "private" (refused) or "public" for an IP address. */
function addressKind(ip) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    const c = Number(v4[3]);
    if (a === 127) return "loopback";
    if (a === 0 || a === 10 || a >= 224) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private";
    if (a === 169 && b === 254) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && (b === 168 || (b === 0 && c === 0))) return "private";
    if (a === 198 && (b === 18 || b === 19)) return "private";
    return "public";
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1") return "loopback";
  if (v6.startsWith("::ffff:")) return addressKind(v6.slice(7));
  return v6.startsWith("2") || v6.startsWith("3") ? "public" : "private";
}

const isLocalName = (h) => h === "localhost" || h.endsWith(".localhost");

/** The host without the brackets an IPv6 URL puts around it. */
const bare = (hostname) => hostname.replace(/^\[|\]$/g, "");

/** An http or https address with no credentials, to a public site or to localhost. */
function isAllowedOrigin(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const h = bare(u.hostname);
  if (!h) return false;
  if (isLocalName(h)) return true;
  if (net.isIP(h)) return addressKind(h) !== "private";
  return h.includes(".");
}

/** The origin of an address that is a bare site ("https://a.example/"), or null. */
function originOf(input) {
  if (typeof input !== "string" || !isAllowedOrigin(input)) return null;
  const u = new URL(input);
  return u.pathname === "/" && !u.search && !u.hash ? u.origin : null;
}

/** True when `host` is `site` itself or a subdomain of it. */
const sameSite = (host, site) => host === site || host.endsWith(`.${site}`);

const ATTR = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * The icon a page declares, as an absolute URL on the origin's own site, or null.
 * "icon" links win over "apple-touch-icon"; the first in the page wins among equals.
 */
function pickIconHref(html, origin) {
  const base = new URL("/", origin);
  let best = null;
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
    const rank = rel.includes("icon") ? 0 : rel.some((r) => r === "apple-touch-icon" || r === "apple-touch-icon-precomposed") ? 1 : -1;
    if (rank < 0 || !attrs.href) continue;
    let url;
    try {
      url = new URL(attrs.href.replace(/&amp;/g, "&").trim(), base);
    } catch {
      continue;
    }
    if (!isAllowedOrigin(url.href) || !sameSite(bare(url.hostname), bare(base.hostname))) continue;
    if (best === null || rank < best.rank) best = { rank, href: url.href };
  }
  return best ? best.href : null;
}

/** At most `max` jobs at once; a finished slot passes straight to the next waiter. */
function limiter(max) {
  let active = 0;
  const waiting = [];
  return async (fn) => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Refuses a host that is, or resolves to, a private address (localhost is the one exception). */
async function isPublicHost(hostname, lookup) {
  const h = bare(hostname);
  if (isLocalName(h)) return true;
  if (net.isIP(h)) return addressKind(h) !== "private";
  try {
    const addresses = await lookup(h, { all: true });
    return addresses.length > 0 && addresses.every((a) => addressKind(a.address) === "public");
  } catch {
    return false;
  }
}

/**
 * The site-icon service. `fetch` and `lookup` are injectable for tests; the
 * default is the global fetch (no cookie jar) and the system resolver.
 */
function createSiteIcons({ dir, fetch = globalThis.fetch, lookup = dns.lookup, now = () => Date.now() }) {
  const memory = new Map();
  const inflight = new Map();
  const runLimited = limiter(MAX_ACTIVE);
  const fresh = (entry) => !!entry && typeof entry.at === "number" && now() - entry.at < TTL_MS;

  /** GET one address, following redirects only within the site; null when anything is refused. */
  async function safeGet(start, site, accept, maxBytes) {
    let url = start;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const u = new URL(url);
      if (!isAllowedOrigin(u.href) || !sameSite(bare(u.hostname), site)) return null;
      if (!(await isPublicHost(u.hostname, lookup))) return null;
      const res = await fetch(u.href, { redirect: "manual", credentials: "omit", headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return null;
        url = new URL(location, u).href;
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel();
        return null;
      }
      if (Number(res.headers.get("content-length")) > maxBytes) {
        await res.body.cancel();
        return null;
      }
      const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      return { type, bytes: Buffer.concat(chunks) };
    }
    return null;
  }

  async function loadIcon(site, href) {
    const found = await safeGet(href, site, "image/*", MAX_ICON);
    if (!found || !ICON_TYPES.has(found.type) || !found.bytes.length) return null;
    return `data:${found.type};base64,${found.bytes.toString("base64")}`;
  }

  /** The icon for an origin: the one the page declares, else /favicon.ico. */
  async function load(origin) {
    const site = bare(new URL(origin).hostname);
    let declared = null;
    try {
      const page = await safeGet(new URL("/", origin).href, site, "text/html", MAX_HTML);
      if (page) declared = pickIconHref(page.bytes.toString("utf8"), origin);
    } catch {
      declared = null;
    }
    const candidates = [...new Set([declared, new URL("/favicon.ico", origin).href].filter(Boolean))];
    for (const href of candidates) {
      const data = await loadIcon(site, href).catch(() => null);
      if (data) return data;
    }
    return null;
  }

  const fileOf = (host) => path.join(dir, `${host.replace(/[^a-z0-9.-]/gi, "_")}.json`);

  function readDisk(host) {
    try {
      const entry = JSON.parse(fs.readFileSync(fileOf(host), "utf8"));
      const ok = entry && (entry.dataUrl === null || (typeof entry.dataUrl === "string" && entry.dataUrl.startsWith("data:image/")));
      return ok ? entry : null;
    } catch {
      return null;
    }
  }

  function writeDisk(host, entry) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileOf(host), JSON.stringify(entry), "utf8");
    } catch {
      /* the memory copy still serves this run */
    }
  }

  /** The data URL of a bare origin's icon ("https://a.example"), or null when it has none. */
  function get(origin) {
    const host = new URL(origin).host;
    const hit = memory.get(host);
    if (fresh(hit)) return Promise.resolve(hit.dataUrl);
    if (inflight.has(host)) return inflight.get(host);
    const job = (async () => {
      const disk = readDisk(host);
      if (fresh(disk)) {
        memory.set(host, disk);
        return disk.dataUrl;
      }
      const dataUrl = await runLimited(() => load(origin)).catch(() => null);
      const entry = { at: now(), dataUrl };
      memory.set(host, entry);
      writeDisk(host, entry);
      return dataUrl;
    })().finally(() => inflight.delete(host));
    inflight.set(host, job);
    return job;
  }

  return { get };
}

module.exports = { createSiteIcons, isAllowedOrigin, originOf, pickIconHref };
