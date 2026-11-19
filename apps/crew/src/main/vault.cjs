// The vault: the person's site logins, once per computer, in its own file
// <userData>/Crew/vault.dat. The whole file is encrypted with the system's
// secure storage (safeStorage), and each password and 2-factor setup key is
// sealed again inside it, so the list kept in memory holds no secret in
// plain text. A secret is opened only to fill it into a bot's page, to copy
// it, or to show it after the person clicks Reveal. Nothing here ever goes
// to a bot folder, a run log or a model; the page gets masked values only.
// The format is packages/crew, vault.ts.

const fs = require("node:fs");
const path = require("node:path");
const F = require("./format.cjs");

const NO_SECURE_STORAGE =
  "This computer has no secure storage, so Crew can't keep logins. On Linux, install and unlock a keyring (such as GNOME Keyring or KWallet), then try again.";
const UNREADABLE =
  "The vault on this computer can't be opened (it was saved by another user or computer, or the system's key changed). Crew leaves the file as it is; remove vault.dat from Crew's folder to start an empty vault.";

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
 * @param {string} o.file  the vault file
 * @param {{ available(): Promise<boolean>, encrypt(text: string): Promise<string>, decrypt(data: string): Promise<string> }} o.secrets  the system's secure storage
 * @param {() => void} [o.onChange]
 * @param {() => Date} [o.now]
 */
function createVault({ file, secrets, onChange = () => {}, now = () => new Date() }) {
  /** Items as stored: password and totp sealed. Null until loaded. */
  let items = null;
  /** Why the vault can't be opened, or "". While set, nothing is written. */
  let broken = "";
  /** Writes one at a time, in order. */
  let chain = Promise.resolve();

  async function load() {
    if (items) return items;
    let data;
    try {
      data = fs.readFileSync(file, "utf8").trim();
    } catch {
      items = [];
      return items;
    }
    if (!data) {
      items = [];
      return items;
    }
    try {
      items = F.parseVault(await secrets.decrypt(data)).items;
    } catch {
      broken = UNREADABLE;
      items = [];
    }
    return items;
  }

  function persist(next) {
    const run = chain.then(async () => {
      if (broken) throw new Error(broken);
      if (!(await secrets.available())) throw new Error(NO_SECURE_STORAGE);
      writeAtomic(file, `${await secrets.encrypt(F.serializeVault(next))}\n`);
      items = next;
      onChange();
    });
    chain = run.catch(() => undefined);
    return run;
  }

  const find = (name) => (items || []).find((i) => i.name === name) || null;

  async function open(sealed) {
    if (!sealed) return "";
    try {
      return await secrets.decrypt(sealed);
    } catch {
      throw new Error("A saved secret of this login can't be read on this computer. Edit the login and type it again.");
    }
  }

  const vault = {
    file,
    load,

    /** Why the vault can't be opened ("" when it can). */
    problem: () => broken,

    /** The logins, secrets still sealed. Loaded at start; [] before. */
    list: () => [...(items || [])],

    get: (name) => find(name),

    has: (name) => !!find(name),

    /**
     * Add a login, or change one (replace: its name). Secrets typed are
     * sealed; keepPassword and keepTotp keep the saved ones. Throws with what
     * to fix. Returns the item as stored.
     */
    async save(input, { replace = null } = {}) {
      await load();
      if (broken) throw new Error(broken);
      const old = replace !== null ? find(replace) : null;
      if (replace !== null && !old) throw new Error(`There is no login "${String(replace).slice(0, 40)}" to change.`);
      const taken = (items || []).map((i) => i.name).filter((n) => n !== replace);
      const r = F.checkVaultItem({ ...input, ...(old ? { name: old.name } : {}) }, { taken });
      if (r.keepPassword && !old) r.diagnostics.push({ severity: "error", message: "Type the password. Crew keeps it encrypted on this computer and fills it in for your bots." });
      const errors = errorsOf(r.diagnostics);
      if (errors) throw new Error(errors);
      if (!old && taken.includes(r.item.name)) throw new Error(`There is already a login named "${r.item.name}". Give this one another label.`);
      if (!old && (items || []).length >= F.LIMITS.vaultItems) throw new Error(`The vault holds at most ${F.LIMITS.vaultItems} logins. Remove one you no longer use first.`);
      if (!(await secrets.available())) throw new Error(NO_SECURE_STORAGE);
      const password = r.keepPassword ? old.password : await secrets.encrypt(r.password);
      const totp = r.keepTotp ? (old ? old.totp : "") : r.totp ? await secrets.encrypt(JSON.stringify(r.totp)) : "";
      const at = now().toISOString();
      const item = { ...r.item, password, totp, createdAt: old ? old.createdAt : at, updatedAt: at, lastUsedAt: old ? old.lastUsedAt : null };
      const next = old ? items.map((i) => (i.name === old.name ? item : i)) : [...items, item];
      await persist(next);
      return item;
    },

    async remove(name) {
      await load();
      if (!find(name)) throw new Error(`There is no login "${String(name).slice(0, 40)}".`);
      await persist(items.filter((i) => i.name !== name));
    },

    /** The login's secrets in plain text: only to fill them into a page, copy or reveal them. */
    async secrets(name) {
      const i = find(name);
      if (!i) throw new Error(`There is no login "${String(name).slice(0, 40)}".`);
      const totpJson = await open(i.totp);
      return { password: await open(i.password), totp: totpJson ? F.readTotp(totpJson) : null };
    },

    /** The login's sign-in code now, and how many seconds it lasts. */
    async code(name, at = Date.now()) {
      const { totp } = await vault.secrets(name);
      if (!totp) throw new Error("This login has no 2-factor setup key. Edit it to add one.");
      return { code: await F.totpCode(totp, at), secondsLeft: F.totpSecondsLeft(totp, at) };
    },

    /** Note that a bot just used it (shown on the Vault page). */
    async markUsed(name) {
      await load();
      const i = find(name);
      if (!i || broken) return;
      const at = now().toISOString();
      await persist(items.map((x) => (x.name === name ? { ...x, lastUsedAt: at } : x))).catch(() => undefined);
    },

    /** A login for this origin and username, to update instead of adding a second one. */
    match(origin, username) {
      return (items || []).find((i) => i.origins.includes(origin) && i.username === username) || null;
    },

    /** What the page may see: no secret, only whether there is one. */
    view(i, usedBy = []) {
      return {
        name: i.name,
        label: i.label,
        origins: [...i.origins],
        username: i.username,
        password: i.password ? F.MASK : "",
        hasPassword: !!i.password,
        hasTotp: !!i.totp,
        notes: i.notes,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        lastUsedAt: i.lastUsedAt,
        usedBy,
      };
    },
  };
  return vault;
}

module.exports = { createVault };
