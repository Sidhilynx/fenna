// The connectors installed on this computer, one file each:
// <userData>/Crew/connectors/<name>.json (the format is packages/crew,
// connector.ts). Secret values (environment values and headers marked
// secret) are encrypted with the system's secure storage before they are
// written, and decrypted only to start the connector. The page sees them
// only as "set" or "not set", never their text.
//
// A web connector the person signed in to keeps its sign-in (tokens, the
// client Crew registered) in <name>.auth beside it, encrypted as a whole.
// The .json says only that it signs in, whether someone is, and as whom.

const fs = require("node:fs");
const path = require("node:path");
const F = require("./format.cjs");

const NO_SECURE_STORAGE =
  "This computer has no secure storage for secret values, so Crew can't keep them. On Linux, install and unlock a keyring (such as GNOME Keyring or KWallet), then try again. Values that aren't secret can be saved unmarked.";

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const errorsOf = (diagnostics) =>
  diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.message)
    .join(" ");

/**
 * @param {object} o
 * @param {string} o.dir  where connector files live
 * @param {{ available(): Promise<boolean>, encrypt(text: string): Promise<string>, decrypt(data: string): Promise<string>, availableSync(): boolean, encryptSync(text: string): string }} o.secrets
 *   the system's secure storage; the Sync pair only moves connectors out of an older bot.md, which happens while bot.md is read
 * @param {() => Date} [o.now]
 */
function createConnectorStore({ dir, secrets, now = () => new Date() }) {
  const fileOf = (name, ext = "json") => {
    if (F.connectorNameProblem(name)) throw new Error(`There is no connector "${String(name).slice(0, 40)}".`);
    return path.join(dir, `${name}.${ext}`);
  };
  /** name → the plain secret values last opened for it, to blank out of anything shown or logged. */
  const opened = new Map();

  function read(name) {
    let text;
    try {
      text = fs.readFileSync(fileOf(name), "utf8");
    } catch {
      return null;
    }
    const r = F.parseConnectorFile(text);
    if (!r.connector) return { name, type: "command", command: "", args: [], env: [], url: "", headers: [], oauth: null, origin: "", tools: [], status: "error", error: r.diagnostics[0].message, checkedAt: null };
    const errors = errorsOf(r.diagnostics);
    return errors ? { ...r.connector, name, status: "error", error: `Its file has a problem: ${errors} Edit it to fix it.` } : r.connector;
  }

  function write(c) {
    writeAtomic(fileOf(c.name), F.serializeConnectorFile(c));
  }

  /**
   * Seal what the person typed: secret values encrypted, keep: true takes the
   * value already stored under that key. encrypt is sync or async.
   */
  function sealWith(list, old, encrypt) {
    return list.map((v) => {
      if (!v.secret) return { key: v.key, value: v.value, secret: false };
      if (v.keep) {
        const prev = old.find((o) => o.key === v.key && o.secret);
        if (!prev) throw new Error(`${v.key} has no saved value to keep. Type its value.`);
        return { key: v.key, value: prev.value, secret: true };
      }
      if (!v.value) return { key: v.key, value: "", secret: true };
      return { key: v.key, value: encrypt(v.value), secret: true };
    });
  }
  const needsSealing = (list) => list.some((v) => v.secret && !v.keep && v.value);

  async function sealValues(list, old) {
    if (needsSealing(list) && !(await secrets.available())) throw new Error(NO_SECURE_STORAGE);
    const sealed = sealWith(list, old, (plain) => secrets.encrypt(plain));
    return Promise.all(sealed.map(async (v) => ({ ...v, value: await v.value })));
  }

  async function openValues(list, name) {
    const out = {};
    const plain = [];
    for (const v of list) {
      if (!v.secret || !v.value) {
        out[v.key] = v.value;
        continue;
      }
      try {
        out[v.key] = await secrets.decrypt(v.value);
      } catch {
        throw new Error(`The saved value of ${v.key} for "${name}" can't be read on this computer (it was saved by another user or computer). Edit the connector and type it again.`);
      }
      if (out[v.key].length >= 4) plain.push(out[v.key]);
    }
    opened.set(name, [...new Set([...(opened.get(name) || []), ...plain])]);
    return out;
  }

  /** Check input and turn it into a connector with its secrets still to seal. Throws with what to fix. */
  function check(input, replace) {
    const r = F.checkConnector(input);
    const errors = errorsOf(r.diagnostics);
    if (errors) throw new Error(errors);
    const c = r.connector;
    if (replace !== null && c.name !== replace) throw new Error("A connector's name can't be changed. Remove it and add it again under the new name.");
    if (replace === null && store.has(c.name)) throw new Error(`There is already a connector named "${c.name}". Pick another name, or edit that one.`);
    const old = replace !== null ? read(replace) : null;
    if (replace !== null && !old) throw new Error(`There is no connector "${replace}" to change.`);
    // Signing in is the app's to record; the page may only give a client id.
    const keepAuth = old && old.oauth && old.url === c.url;
    const oauth = c.type !== "url" ? null : keepAuth ? { ...old.oauth, clientId: c.oauth ? c.oauth.clientId : old.oauth.clientId } : c.oauth ? { clientId: c.oauth.clientId, signedIn: false, account: "" } : null;
    return { c: { ...c, oauth, origin: c.origin || (old ? old.origin : c.type), tools: old ? old.tools : [], status: "untested", error: "", checkedAt: null }, old, signedOut: !!(old && old.oauth && !keepAuth) };
  }

  /** The encrypted sign-in file of one connector, as the OAuth client keeps it. */
  function authStore(name) {
    const file = fileOf(name, "auth");
    return {
      async load() {
        let data;
        try {
          data = fs.readFileSync(file, "utf8").trim();
        } catch {
          return null;
        }
        try {
          return JSON.parse(await secrets.decrypt(data));
        } catch {
          return null;
        }
      },
      async save(data) {
        if (!data) {
          fs.rmSync(file, { force: true });
          return;
        }
        if (!(await secrets.available())) throw new Error(NO_SECURE_STORAGE);
        writeAtomic(file, `${await secrets.encrypt(JSON.stringify(data))}\n`);
      },
    };
  }

  const store = {
    dir,

    names() {
      let files = [];
      try {
        files = fs.readdirSync(dir);
      } catch {
        return [];
      }
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .filter((n) => !F.connectorNameProblem(n))
        .sort();
    },

    list() {
      return store.names().map(read).filter(Boolean);
    },

    get: read,

    has(name) {
      return !F.connectorNameProblem(name) && fs.existsSync(fileOf(name));
    },

    /**
     * Check what the person typed and turn it into a connector, secrets
     * sealed. replace: the name of the connector being edited (its secrets
     * can be kept; a changed address signs it out). Throws with what to fix.
     */
    async prepare(input, { replace = null } = {}) {
      const { c, old, signedOut } = check(input, replace);
      if (signedOut) await authStore(c.name).save(null);
      return { ...c, env: await sealValues(c.env, old ? old.env : []), headers: await sealValues(c.headers, old ? old.headers : []) };
    },

    save(c) {
      write(c);
      return c;
    },

    /** Record the outcome of starting or testing it. */
    setChecked(name, { status, error = "", tools }) {
      const c = read(name);
      if (!c) return null;
      const next = { ...c, status, error: String(error).slice(0, 2000), checkedAt: now().toISOString(), ...(tools ? { tools } : {}) };
      write(next);
      return next;
    },

    /** Record its sign-in state (signedIn, account, clientId); a connector that doesn't sign in yet starts to. */
    setOAuth(name, patch) {
      const c = read(name);
      if (!c || c.type !== "url") return null;
      const next = { ...c, oauth: { clientId: "", signedIn: false, account: "", ...(c.oauth || {}), ...patch } };
      write(next);
      return next;
    },

    authStore,

    remove(name) {
      fs.rmSync(fileOf(name), { force: true });
      fs.rmSync(fileOf(name, "auth"), { force: true });
      opened.delete(name);
    },

    /** How to reach it, secrets decrypted: only for starting it. A signed-in web connector brings its sign-in store. */
    async spec(c) {
      if (c.type === "url") return { name: c.name, url: c.url, headers: await openValues(c.headers, c.name), ...(c.oauth && c.oauth.signedIn ? { auth: authStore(c.name) } : {}) };
      return { name: c.name, command: c.command, args: c.args, env: await openValues(c.env, c.name) };
    },

    /** Its secret values opened so far, to blank out of anything shown or logged. */
    secretsOf(name) {
      return opened.get(name) || [];
    },

    /**
     * Move connectors written in an older bot.md onto this computer. One
     * with the same name and the same command (or address) is shared;
     * another under the same name gets "-2", "-3"… Returns old name → name.
     * Values from bot.md are kept secret (they may be tokens).
     */
    migrate(slug, legacy) {
      const names = {};
      for (const l of legacy) {
        const same = (c) => c.type === l.type && (l.type === "url" ? c.url === l.url : c.command === l.command && JSON.stringify(c.args) === JSON.stringify(l.args));
        let name = l.name;
        let existing = read(name);
        for (let i = 2; existing && !same(existing) && i < 100; i++) {
          name = `${l.name.slice(0, 28)}-${i}`;
          existing = read(name);
        }
        if (!existing) {
          // bot.md is being read: this one step can't wait for the system's async storage.
          const env = l.type === "command" ? Object.entries(l.env).map(([key, value]) => ({ key, value, secret: value !== "" })) : [];
          const { c } = check({ name, type: l.type, command: l.type === "command" ? l.command : "", args: l.type === "command" ? l.args : [], env, url: l.type === "url" ? l.url : "", headers: [], origin: `bot ${slug}` }, null);
          if (needsSealing(c.env) && !secrets.availableSync()) throw new Error(NO_SECURE_STORAGE);
          write({ ...c, env: sealWith(c.env, [], (plain) => secrets.encryptSync(plain)) });
        }
        names[l.name] = name;
      }
      return names;
    },

    /** What the page may see: secret values never leave this process. */
    view(c, { usedBy = [], running = false, starting = false, signingIn = false } = {}) {
      const values = (list) => list.map((v) => ({ key: v.key, value: v.secret ? "" : v.value, secret: v.secret, set: v.value !== "" }));
      return {
        name: c.name,
        type: c.type,
        command: c.command,
        args: c.args,
        url: c.url,
        env: values(c.env),
        headers: values(c.headers),
        auth: { oauth: !!c.oauth, signedIn: !!(c.oauth && c.oauth.signedIn), account: c.oauth ? c.oauth.account : "", clientId: c.oauth ? c.oauth.clientId : "", signingIn },
        origin: c.origin,
        tools: c.tools,
        status: starting ? "starting" : c.status,
        error: c.error,
        checkedAt: c.checkedAt,
        running,
        usedBy,
      };
    },
  };
  return store;
}

module.exports = { createConnectorStore };
