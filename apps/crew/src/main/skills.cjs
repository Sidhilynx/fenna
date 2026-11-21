// Skills installed on this computer: one folder each, <userData>/Crew/skills/<name>/,
// holding SKILL.md (packages/crew, skill.ts) and any files beside it. A bot is
// granted some by name in bot.md. Before each run the granted ones that are
// installed are copied onto the bot's disk at Files/Skills/<name>/, where its
// read_file can read them, and prompt.cjs names each one with its description.
//
// Nothing is added unseen. A source (a folder, a .md or .zip file, or an
// address) is read into a preview the page shows in full; only commit writes it.
// Limits: SKILL.md 100 KB; a skill 5 MB and 200 files; no links; no path that
// leaves the skill's folder. Addresses are https only: a raw SKILL.md, or a
// GitHub folder (https://github.com/<owner>/<repo>/tree/<branch>/<path>) read
// through the GitHub contents API.

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const F = require("./format.cjs");
const zip = require("./ziplite.cjs");
const { sizeText } = require("./disk.cjs");

const SKILL = F.SKILL_FILE;
const { LIMITS } = F;
/** In a bot's Files/Skills: the names of the skill folders Crew put there. */
const MARKER = ".crew-skills.json";
const PENDING_MS = 10 * 60_000;
const PENDING_MAX = 8;
const FETCH_MS = 20_000;
const REDIRECTS = 3;
const ZIP_ENTRIES_MAX = 1000;
const GITHUB_FOLDER = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/tree\/([^/\s]+)(?:\/(.+?))?\/?$/;
const TOO_BIG_FILE = `SKILL.md is bigger than ${sizeText(LIMITS.skillFile)}. Ask for a shorter one, or move reference material into other files.`;

/** A skill name from a file or folder name: lowercase letters, digits and dashes, at most 32. "" when nothing is left. */
function nameFrom(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** The files of a folder on this computer as { path, data }, checked: no links, the count and size limits. */
function readFolder(dir) {
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error("This folder is a link. Pick the folder itself.");
  if (!st.isDirectory()) throw new Error("Pick a folder with a SKILL.md in it.");
  const found = [];
  let bytes = 0;
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const f = fs.lstatSync(full);
      if (f.isSymbolicLink()) throw new Error(`${r} is a link. A skill can't contain links; copy the file it points to instead.`);
      if (f.isDirectory()) {
        walk(full, r);
        continue;
      }
      if (!f.isFile()) continue;
      found.push({ path: r, abs: full });
      bytes += f.size;
      if (found.length > LIMITS.skillFiles) throw new Error(`The skill has more than ${LIMITS.skillFiles} files. The most is ${LIMITS.skillFiles}.`);
      if (bytes > LIMITS.skillFolder) throw new Error(`The skill is bigger than ${sizeText(LIMITS.skillFolder)}. Remove what it doesn't need.`);
    }
  };
  walk(dir, "");
  return found.map((f) => ({ path: f.path, data: fs.readFileSync(f.abs) }));
}

/** The entries of a .zip as { path, data }, checked before anything is inflated. */
function readArchive(file) {
  const size = fs.statSync(file).size;
  if (size > LIMITS.skillFolder) throw new Error(`The zip is bigger than ${sizeText(LIMITS.skillFolder)}. Remove what the skill doesn't need.`);
  const buf = fs.readFileSync(file);
  const { entries } = zip.readZip(buf, { maxEntries: ZIP_ENTRIES_MAX, maxTotal: LIMITS.skillFolder });
  const files = [];
  for (const e of entries) {
    if (e.dir) continue;
    if (files.length >= LIMITS.skillFiles) throw new Error(`The skill has more than ${LIMITS.skillFiles} files. The most is ${LIMITS.skillFiles}.`);
    files.push({ path: e.segs.join("/"), data: zip.inflateEntry(buf, e) });
  }
  return files;
}

/**
 * One skill's files, checked and made: a single folder inside (as a zip of
 * a folder, or a folder of one) is the skill; SKILL.md must be there and
 * its front matter must pass. Throws with what to fix.
 */
function assemble(files, sourceName) {
  let list = files.map((f) => ({ path: zip.safeSegments(f.path).join("/"), data: f.data }));
  let fallback = sourceName;
  if (!list.some((f) => f.path === SKILL)) {
    const hits = list.filter((f) => f.path.endsWith(`/${SKILL}`) && f.path.split("/").length === 2);
    if (hits.length === 1) {
      const folder = hits[0].path.slice(0, -SKILL.length - 1);
      list = list.filter((f) => f.path.startsWith(`${folder}/`)).map((f) => ({ ...f, path: f.path.slice(folder.length + 1) }));
      fallback = folder;
    }
  }
  const skill = list.find((f) => f.path === SKILL);
  if (!skill) throw new Error(`There is no ${SKILL} in it. A skill is a folder with a ${SKILL} file in it.`);
  if (skill.data.length > LIMITS.skillFile) throw new Error(TOO_BIG_FILE);
  const doc = F.parseSkill(skill.data.toString("utf8"), nameFrom(fallback));
  const errors = doc.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) throw new Error(errors.map((d) => d.message).join(" "));
  return {
    name: doc.name,
    description: doc.description,
    body: doc.body,
    files: list.map((f) => ({ segs: f.path.split("/"), path: f.path, data: f.data })),
  };
}

/** What the page shows of a skill before it is added: the same for a preview and an installed skill. */
const previewOf = (skill) => ({
  name: skill.name,
  description: skill.description,
  body: skill.body,
  files: skill.files.map((f) => ({ path: f.path, size: f.data.length })),
  size: skill.files.reduce((n, f) => n + f.data.length, 0),
});

/** Reads a response body of an https address, at most max bytes. Redirects only to https. */
function getBytes(url, { max = LIMITS.skillFolder, accept = "*/*" } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const req = https.get(url, { headers: { "User-Agent": "Fenna-Crew", Accept: accept }, timeout: FETCH_MS }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= REDIRECTS) return reject(new Error("The address redirects too many times."));
        let next;
        try {
          next = new URL(res.headers.location, url);
        } catch {
          return reject(new Error("The address redirects to one that can't be read."));
        }
        if (next.protocol !== "https:") return reject(new Error("The address moves to a page that isn't https. Use the https address."));
        return getBytes(next.href, { max, accept }, hops + 1).then(resolve, reject);
      }
      if (status === 404) {
        res.resume();
        return reject(new Error("Nothing is at that address. Check the link."));
      }
      if (status === 403 || status === 429) {
        res.resume();
        return reject(new Error("GitHub didn't answer; it may be rate-limited. Try again later."));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`The address answered ${status || "with no status"}.`));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > max) {
          res.destroy();
          reject(new Error(`It is bigger than ${sizeText(max)}.`));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => reject(new Error("The address stopped answering. Try again.")));
    });
    req.on("timeout", () => {
      timedOut = true;
      req.destroy();
    });
    req.on("error", () =>
      reject(new Error(timedOut ? "The address took too long to answer. Try again." : "Couldn't reach the address. Check the connection, then try again.")),
    );
  });
}

/** A skill from an https address: a raw SKILL.md (or any .md), or a GitHub folder. */
async function fromAddress(text, fetchBytes) {
  let u;
  try {
    u = new URL(String(text).trim());
  } catch {
    throw new Error("That isn't a web address. Use https://, like https://github.com/owner/repo/tree/main/skills/weekly-report.");
  }
  if (u.protocol !== "https:") throw new Error("The address should start with https://.");
  const folder = GITHUB_FOLDER.exec(String(text).trim());
  if (folder) return fromGithub(folder[1], folder[2], folder[3], folder[4] || "", fetchBytes);
  if (u.hostname === "github.com") throw new Error("For a GitHub skill, use its folder's address: https://github.com/owner/repo/tree/branch/folder.");
  const segs = u.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "";
  if (!/\.md$/i.test(last)) throw new Error("The address should be a SKILL.md file or a GitHub folder (…/tree/…).");
  const data = await fetchBytes(u.href, { max: LIMITS.skillFile + 1, accept: "text/markdown, text/plain, */*" });
  const base = last.replace(/\.md$/i, "");
  const fallback = base.toUpperCase() === "SKILL" ? segs[segs.length - 2] || "" : base;
  return assemble([{ path: SKILL, data }], fallback);
}

/** A GitHub folder, read through the contents API: its files, each by its download address. */
async function fromGithub(owner, repo, branch, at, fetchBytes) {
  const base = at.replace(/^\/+|\/+$/g, "");
  const api = (rel) => {
    const seg = rel ? `/${rel.split("/").map(encodeURIComponent).join("/")}` : "";
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${seg}?ref=${encodeURIComponent(branch)}`;
  };
  const files = [];
  let bytes = 0;
  const walk = async (rel, depth) => {
    if (depth > 4) throw new Error("The skill folder is nested too deep.");
    const raw = await fetchBytes(api(rel), { max: 2 * 1024 * 1024, accept: "application/vnd.github+json" });
    const list = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(list)) throw new Error("That address is a file. Use the folder's address, or a SKILL.md address.");
    for (const e of list) {
      if (e.type === "dir") {
        await walk(e.path, depth + 1);
        continue;
      }
      if (e.type !== "file") throw new Error(`${e.path} is a link. A skill can't contain links.`);
      if (files.length + 1 > LIMITS.skillFiles) throw new Error(`The skill has more than ${LIMITS.skillFiles} files. The most is ${LIMITS.skillFiles}.`);
      bytes += Number(e.size) || 0;
      if (bytes > LIMITS.skillFolder) throw new Error(`The skill is bigger than ${sizeText(LIMITS.skillFolder)}.`);
      const data = await fetchBytes(e.download_url, { max: LIMITS.skillFolder });
      const inside = base ? e.path.slice(base.length + 1) : e.path;
      files.push({ path: inside, data });
    }
  };
  await walk(base, 0);
  const folder = base ? base.split("/").pop() : repo;
  return assemble(files, folder);
}

/**
 * @param {object} o
 * @param {string} o.dir  where installed skills live (<userData>/Crew/skills)
 * @param {(url: string, o: { max: number, accept?: string }) => Promise<Buffer>} [o.fetchBytes]  reads an https address (getBytes)
 * @param {() => number} [o.now]
 */
function createSkillStore({ dir, fetchBytes = getBytes, now = () => Date.now() }) {
  /** id → { at, skill }: previews the person has been shown and may add. Kept in memory, for a few minutes. */
  const pending = new Map();

  const validName = (name) => {
    if (typeof name !== "string" || F.skillNameProblem(name)) throw new Error(`There is no skill "${String(name).slice(0, 40)}".`);
    return name;
  };

  /** The files under a skill's folder, as relative paths with sizes. Links and anything that isn't a file are left out. */
  function filesOf(base) {
    const out = [];
    const walk = (abs, rel) => {
      for (const name of fs.readdirSync(abs)) {
        const full = path.join(abs, name);
        const r = rel ? `${rel}/${name}` : name;
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) walk(full, r);
        else if (st.isFile()) out.push({ path: r, abs: full, size: st.size });
      }
    };
    walk(base, "");
    return out;
  }

  /** An installed skill: its name, description, instructions and files; null when it isn't there or can't be read. */
  function read(name) {
    if (F.skillNameProblem(name)) return null;
    const base = path.join(dir, name);
    let text;
    try {
      text = fs.readFileSync(path.join(base, SKILL), "utf8");
    } catch {
      return null;
    }
    const doc = F.parseSkill(text, name);
    const files = filesOf(base).map((f) => ({ path: f.path, size: f.size }));
    return { name, description: doc.description, body: doc.body, files, size: files.reduce((n, f) => n + f.size, 0) };
  }

  const store = {
    /** Installed skills: name, description, files and size (no instructions; read() has them). */
    list() {
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return [];
      }
      return names
        .filter((n) => !F.skillNameProblem(n))
        .sort()
        .map(read)
        .filter(Boolean)
        .map(({ body, ...rest }) => rest);
    },

    has(name) {
      return !F.skillNameProblem(name) && fs.existsSync(path.join(dir, name, SKILL));
    },

    /** One skill's full view: its instructions and its files. Throws when it isn't installed. */
    get(name) {
      const s = read(validName(name));
      if (!s) throw new Error(`There is no skill "${name}".`);
      return s;
    },

    /**
     * Read a source into a preview the page shows before anything is added.
     * source: { kind: "folder", path } | { kind: "file", path } | { kind: "address", url }.
     * Returns { id, name, description, body, files, size, replaces }; add it with commit(id).
     */
    async prepare(source) {
      const skill = await gather(source);
      purge();
      const id = crypto.randomUUID();
      pending.set(id, { at: now(), skill });
      while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
      return { id, ...previewOf(skill), replaces: store.has(skill.name) };
    },

    /** Add the previewed skill (replacing one of the same name). Throws when the preview has expired. */
    commit(id) {
      purge();
      const p = pending.get(id);
      if (!p) throw new Error("That skill has expired. Choose it again.");
      pending.delete(id);
      const { skill } = p;
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, skill.name);
      const tmp = path.join(dir, `.${skill.name}-${process.pid}-${now()}.tmp`);
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const f of skill.files) {
        const abs = path.join(tmp, ...f.segs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.data);
      }
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(tmp, target);
      return read(skill.name);
    },

    /** Take a skill away from this computer. Bots that had it are the caller's to tell. */
    remove(name) {
      fs.rmSync(path.join(dir, validName(name)), { recursive: true, force: true });
    },

    /**
     * Put the granted skills that are installed into a bot's workspace at
     * Skills/<name>/ (Files/Skills on its disk), replacing what was there, and
     * return them: name, description and the path of SKILL.md on the bot's disk.
     */
    syncInto(workspaceDir, granted) {
      // Files/Skills may also hold the person's or the bot's own folders: only the folders Crew
      // placed (named in the marker) are replaced, and a folder Crew didn't place is never touched.
      const root = path.join(workspaceDir, "Skills");
      const marker = path.join(root, MARKER);
      let placed = [];
      try {
        const list = JSON.parse(fs.readFileSync(marker, "utf8"));
        if (Array.isArray(list)) placed = list.filter((n) => typeof n === "string" && !F.skillNameProblem(n));
      } catch {
        placed = [];
      }
      for (const name of placed) fs.rmSync(path.join(root, name), { recursive: true, force: true });
      const out = [];
      const ours = [];
      for (const name of [...new Set(granted)]) {
        const s = read(name);
        if (!s || fs.existsSync(path.join(root, name))) continue;
        ours.push(name);
        for (const f of filesOf(path.join(dir, name))) {
          const to = path.join(root, name, f.path);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(f.abs, to);
        }
        out.push({ name, description: s.description, path: `Files/Skills/${name}/${SKILL}` });
      }
      if (ours.length) fs.writeFileSync(marker, JSON.stringify(ours));
      else {
        fs.rmSync(marker, { force: true });
        // Leave no empty Skills folder behind, but never remove one that holds anything else.
        try {
          fs.rmdirSync(root);
        } catch {
          /* missing, or not empty */
        }
      }
      return out;
    },
  };

  function purge() {
    for (const [id, p] of pending) if (now() - p.at > PENDING_MS) pending.delete(id);
  }

  async function gather(source) {
    if (source.kind === "folder") return assemble(readFolder(source.path), path.basename(source.path));
    if (source.kind === "file") {
      const file = source.path;
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error("This file is a link. Pick the file itself.");
      const ext = path.extname(file).toLowerCase();
      const base = path.basename(file, path.extname(file));
      if (ext === ".zip") return assemble(readArchive(file), base);
      if (ext !== ".md") throw new Error("Pick a SKILL.md file, or a .zip of a skill folder.");
      const size = fs.statSync(file).size;
      if (size > LIMITS.skillFile) throw new Error(TOO_BIG_FILE);
      const fallback = base.toUpperCase() === "SKILL" ? path.basename(path.dirname(file)) : base;
      return assemble([{ path: SKILL, data: fs.readFileSync(file) }], fallback);
    }
    if (source.kind === "address") return fromAddress(source.url, fetchBytes);
    throw new Error("Choose a folder, a file or an address.");
  }

  return store;
}

/** The bots granted each skill, from bot.md: name → [{ slug, name }]. */
function grantsOf(store) {
  const out = new Map();
  for (const slug of store.slugs()) {
    const r = store.readBot(slug);
    if (!r || !r.bot) continue;
    for (const name of r.bot.skills) out.set(name, [...(out.get(name) || []), { slug, name: r.bot.name }]);
  }
  return out;
}

/** Takes a skill out of every bot granted it, in bot.md. Returns those bots' names. */
function revokeAll(store, name) {
  const bots = grantsOf(store).get(name) || [];
  for (const b of bots) {
    const r = store.readBot(b.slug);
    store.updateBot(b.slug, { skills: r.bot.skills.filter((n) => n !== name) });
  }
  return bots.map((b) => b.name);
}

module.exports = { createSkillStore, nameFrom, grantsOf, revokeAll };
