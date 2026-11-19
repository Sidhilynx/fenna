// A bot using the person's logins: the browser tools logins, sign_in and
// fill_code. A bot sees only the vault logins its bot.md grants, and of
// those only the label, username and whether it has 2-factor codes. Crew
// fills the secrets into the page itself, only on an origin the login
// names exactly (look-alike sites get nothing), after the person approves
// when the grant is "ask". The password and codes never reach the bot: not
// in a tool result, a snapshot, a screenshot or a run log. Every use is
// logged in the run (bot, login, origin, outcome).

const F = require("./format.cjs");

/** How long one approval of an "ask" login covers its sign-in (its code step included), in the same run and on the same origin. */
const APPROVAL_COVERS_MS = 5 * 60_000;
/** A code this close to running out waits for the next one. */
const CODE_MIN_SECONDS = 3;

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Refusal extends Error {}

/**
 * @param {object} o
 * @param {ReturnType<import("./store.cjs").createStore>} o.store
 * @param {ReturnType<import("./vault.cjs").createVault>} o.vault
 * @param {{ page(slug: string): Promise<{ url: string, title: string }>, fillLogin(slug: string, p: object): Promise<object>, fillCode(slug: string, p: object): Promise<object> }} o.browsers
 * @param {(ctx: object, a: { action: string, details: string, source: string, tool: string|null }) => Promise<{ allowed: boolean, always: boolean, by: string }>} o.approve
 * @param {{ record(runId: string, event: object): void }} o.runner
 * @param {() => void} o.onChange
 * @param {() => Date} [o.now]
 * @param {() => number} [o.clock]  ms, for codes
 */
function createLogins({ store, vault, browsers, approve, runner, onChange, now = () => new Date(), clock = () => Date.now() }) {
  /** slug → secrets filled into that bot's browser since Crew started, to blank out of anything the bot reads. */
  const filled = new Map();
  /** runId → login name → { origin, until }: an approved "ask" sign-in. */
  const approved = new Map();
  /** runId → login names the person denied in that run. */
  const denied = new Map();

  const botOf = (slug) => {
    const r = store.readBot(slug);
    return r && r.bot ? r.bot : null;
  };

  /** The bot's grants of logins that are in the vault, read now (the person may change them mid-run). */
  function granted(slug) {
    const bot = botOf(slug);
    if (!bot) return [];
    return (bot.logins || []).map((g) => ({ grant: g, item: vault.get(g.name) })).filter((x) => x.item);
  }

  const remember = (slug, secret) => {
    if (!secret) return;
    if (!filled.has(slug)) filled.set(slug, new Set());
    filled.get(slug).add(secret);
  };

  function log(ctx, { item, name, origin, action, level, outcome, message = null }) {
    runner.record(ctx.runId, { type: "login", at: now().toISOString(), bot: ctx.slug, login: item ? item.name : String(name || "").slice(0, 40), label: item ? item.label : "", origin: origin || "", action, level: level || null, outcome, message });
  }

  function setLevel(slug, name, level) {
    const bot = botOf(slug);
    if (!bot) return;
    store.updateBot(slug, { logins: (bot.logins || []).map((g) => (g.name === name ? { ...g, level } : g)) });
    onChange();
  }

  const yours = (list) => (list.length ? list.map(({ item }) => `${item.name} (${item.origins.join(", ")})`).join("; ") : "none");

  /** The granted login named in a call, or a refusal that doesn't say whether other logins exist. */
  function pick(ctx, name, action, list = granted(ctx.slug)) {
    const hit = list.find((x) => x.item.name === name);
    if (hit) return hit;
    log(ctx, { item: null, name, origin: "", action, level: null, outcome: "refused", message: "Not one of its logins." });
    const near = F.closest(String(name || ""), list.map((x) => x.item.name));
    throw new Refusal(`You have no login "${String(name || "").slice(0, 40)}".${near ? ` Did you mean "${near}"?` : ""} Yours: ${yours(list)}. Call logins to see which fit this page.`);
  }

  /** The page's origin, checked against the login's: a page elsewhere gets nothing. */
  async function onItsSite(ctx, hit, action) {
    const page = await browsers.page(ctx.slug);
    const origin = F.originOf(page.url);
    if (!origin || !hit.item.origins.includes(origin)) {
      const here = origin || (page.url ? page.url.slice(0, 80) : "an empty tab");
      log(ctx, { item: hit.item, origin: origin || "", action, level: hit.grant.level, outcome: "refused", message: `The page is on ${here}.` });
      throw new Refusal(`Crew won't fill "${hit.item.label}" here: this page is on ${here}, and that login is only for ${hit.item.origins.join(", ")}. Open the sign-in page on that origin, then call ${action} again. Crew never fills a login on any other site, so look-alike pages get nothing.`);
    }
    return origin;
  }

  /** Ask the person first when the grant is "ask" (once covers this sign-in for a few minutes). */
  async function permit(ctx, hit, origin, action) {
    const name = hit.item.name;
    if ((denied.get(ctx.runId) || new Set()).has(name)) {
      log(ctx, { item: hit.item, origin, action, level: hit.grant.level, outcome: "denied", message: "Denied earlier in this run." });
      throw new Refusal(`The person denied signing in with "${hit.item.label}" in this run. Don't try again or another way; say in your reply that the sign-in was not approved.`);
    }
    if (hit.grant.level === "allow") return;
    const ok = (approved.get(ctx.runId) || new Map()).get(name);
    if (ok && ok.origin === origin && ok.until > clock()) return;
    const bot = botOf(ctx.slug);
    const who = hit.item.username ? ` as ${hit.item.username}` : "";
    const r = await approve(ctx, {
      action: action === "fill_code" ? `Fill a sign-in code for ${hostOf(origin)}${who}` : `Sign in to ${hostOf(origin)}${who}`,
      details: `Login: ${hit.item.label}\nSite: ${origin}\nCrew fills it into the page itself. ${bot ? bot.name : "The bot"} never sees the password${hit.item.totp ? " or the codes" : ""}.`,
      source: "login",
      tool: name,
    });
    if (!r.allowed) {
      const outcome = r.by === "timeout" ? "timeout" : r.by === "stopped" ? "stopped" : "denied";
      log(ctx, { item: hit.item, origin, action, level: "ask", outcome });
      if (outcome === "denied") {
        if (!denied.has(ctx.runId)) denied.set(ctx.runId, new Set());
        denied.get(ctx.runId).add(name);
        throw new Refusal(`Denied by the person: Crew did not sign in with "${hit.item.label}". Don't try again or another way; say in your reply that the sign-in was not approved.`);
      }
      if (outcome === "timeout") throw new Refusal(`The person didn't answer in time, so Crew did not sign in with "${hit.item.label}". Don't try another way; say in your reply that the sign-in waits for their approval.`);
      throw new Refusal("The run was stopped before the person answered.");
    }
    if (r.always) setLevel(ctx.slug, name, "allow");
    if (!approved.has(ctx.runId)) approved.set(ctx.runId, new Map());
    approved.get(ctx.runId).set(name, { origin, until: clock() + APPROVAL_COVERS_MS });
  }

  const pageLine = async (slug) => {
    try {
      const p = await browsers.page(slug);
      return `The page is now ${p.title || "(no title)"} (${p.url}).`;
    } catch {
      return "";
    }
  };

  /** A failure while filling, logged without anything secret, said so the bot can act on it. */
  function failed(ctx, hit, origin, action, e) {
    if (e && e.code === "origin") {
      log(ctx, { item: hit.item, origin: e.actual || "", action, level: hit.grant.level, outcome: "refused", message: `The page moved to ${e.actual}.` });
      return new Refusal(`The page left ${origin} (it is on ${e.actual} now), so Crew filled nothing. Open the sign-in page on ${hit.item.origins.join(", ")} and call ${action} again.`);
    }
    const message = F.scrubSecrets((e && e.message) || String(e), filled.get(ctx.slug) || []);
    log(ctx, { item: hit.item, origin, action, level: hit.grant.level, outcome: "failed", message: message.slice(0, 300) });
    return new Error(message);
  }

  const tools = {
    async logins(ctx) {
      const list = granted(ctx.slug);
      if (!list.length) return { text: "You have no logins from the vault. If a page asks you to sign in, call ask_human so the person takes control of your browser and signs in, then snapshot again." };
      const page = await browsers.page(ctx.slug);
      const origin = F.originOf(page.url);
      const here = list.filter((x) => origin && x.item.origins.includes(origin));
      if (!here.length) {
        return { text: `None of your logins is for ${origin || "this tab"}. Yours: ${yours(list)}. Open the sign-in page of one of those, then call logins again. If this site needs a login you don't have, call ask_human so the person takes control and signs in.` };
      }
      const lines = here.map(({ item, grant }) => `- ${item.name}: ${item.label}${item.username ? `, username ${item.username}` : ""}${item.totp ? ", 2-factor codes (fill_code)" : ""}${grant.level === "ask" ? ", the person approves each sign-in" : ""}`);
      return { text: `Logins for ${origin}:\n${lines.join("\n")}\nCall sign_in {login: "${here[0].item.name}", submit: true} on the sign-in form. Crew fills the username and password itself; you never see the password.` };
    },

    async sign_in(ctx, p) {
      const hit = pick(ctx, String(p.login || ""), "sign_in");
      const origin = await onItsSite(ctx, hit, "sign_in");
      await permit(ctx, hit, origin, "sign_in");
      // The approval may have taken minutes: check the page again before filling.
      await onItsSite(ctx, hit, "sign_in");
      let r;
      try {
        const { password } = await vault.secrets(hit.item.name);
        remember(ctx.slug, password);
        r = await browsers.fillLogin(ctx.slug, { origin, username: hit.item.username, password, usernameRef: p.username_ref || null, passwordRef: p.password_ref || null, submit: !!p.submit });
      } catch (e) {
        throw failed(ctx, hit, origin, "sign_in", e);
      }
      const what = r.filledUser && r.filledPassword ? "the username and password" : r.filledPassword ? "the password" : "the username";
      const next = !r.filledPassword ? " This page had no password field yet: if it asks for the password next, call sign_in again there." : hit.item.totp ? ` If the site asks for a sign-in code, call fill_code {login: "${hit.item.name}", submit: true}.` : "";
      log(ctx, { item: hit.item, origin, action: "sign_in", level: hit.grant.level, outcome: "done", message: `Filled ${what}${r.submitted ? " and submitted" : ""}.` });
      void vault.markUsed(hit.item.name);
      const sent = r.submitted ? ` and ${r.button ? `pressed “${r.button}”` : "pressed Enter"}.${r.changed}` : ". Nothing was submitted; click the form's button when ready.";
      return { text: `Crew filled ${what} of "${hit.item.label}" on ${origin}${sent}${next} ${r.submitted && !r.changed ? await pageLine(ctx.slug) : ""}`.replace(/\s+$/, "") };
    },

    async fill_code(ctx, p) {
      const hit = pick(ctx, String(p.login || ""), "fill_code");
      if (!hit.item.totp) {
        log(ctx, { item: hit.item, origin: "", action: "fill_code", level: hit.grant.level, outcome: "refused", message: "It has no 2-factor setup key." });
        throw new Refusal(`"${hit.item.label}" has no 2-factor codes in the vault. Call ask_human so the person takes control and types the code.`);
      }
      const origin = await onItsSite(ctx, hit, "fill_code");
      await permit(ctx, hit, origin, "fill_code");
      await onItsSite(ctx, hit, "fill_code");
      let r;
      try {
        let c = await vault.code(hit.item.name, clock());
        if (c.secondsLeft < CODE_MIN_SECONDS) {
          await sleep(c.secondsLeft * 1000 + 300);
          c = await vault.code(hit.item.name, clock());
        }
        remember(ctx.slug, c.code);
        r = await browsers.fillCode(ctx.slug, { origin, code: c.code, ref: p.ref || null, submit: !!p.submit });
      } catch (e) {
        throw failed(ctx, hit, origin, "fill_code", e);
      }
      log(ctx, { item: hit.item, origin, action: "fill_code", level: hit.grant.level, outcome: "done", message: `Filled a code${r.submitted ? " and submitted" : ""}.` });
      void vault.markUsed(hit.item.name);
      return { text: `Crew filled the current sign-in code of "${hit.item.label}"${r.submitted ? ` and submitted.${r.changed}` : ". Nothing was submitted; click the form's button when ready."} ${r.submitted && !r.changed ? await pageLine(ctx.slug) : ""}`.replace(/\s+$/, "") };
    },
  };

  return {
    /** The browser server's logins, sign_in and fill_code. */
    async handle(ctx, method, params) {
      const fn = Object.prototype.hasOwnProperty.call(tools, method) ? tools[method] : null;
      if (!fn) throw new Error(`Unknown browser action "${method}".`);
      return fn(ctx, params || {});
    },

    has: (method) => Object.prototype.hasOwnProperty.call(tools, method),

    /** A browser tool's result with every secret this bot's browser was filled with blanked out. */
    scrub(slug, result) {
      const secrets = filled.get(slug);
      if (!secrets || !secrets.size || !result || typeof result.text !== "string") return result;
      return { ...result, text: F.scrubSecrets(result.text, secrets) };
    },

    /** A run ended: its approvals and denials end with it. */
    endRun(runId) {
      approved.delete(runId);
      denied.delete(runId);
    },

    /** The bot was deleted or the login removed: forget what was filled. */
    forget(slug) {
      filled.delete(slug);
    },
  };
}

module.exports = { createLogins, APPROVAL_COVERS_MS };
