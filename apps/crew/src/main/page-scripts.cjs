// Functions that run inside a bot's web page, in an isolated world (the
// page's own scripts can't see them or their refs). Each must be
// self-contained: it is sent as source text through the DevTools protocol.
// Refs (e1, e2, …) are kept per element for as long as the document lives.

function pageSnapshot(opts) {
  const S = (globalThis.__fennaCrew = globalThis.__fennaCrew || { next: 1, byRef: new Map(), byEl: new WeakMap() });
  const lines = [];
  let size = 0;
  let dropped = 0;
  let above = 0;
  const fromView = window.scrollY > 0;
  const push = (s) => {
    if (size + s.length + 1 > opts.maxChars) {
      dropped++;
      return;
    }
    lines.push(s);
    size += s.length + 1;
  };
  const clean = (t, n) => {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const quote = (s) => `"${s.replace(/"/g, "'")}"`;
  const refOf = (el) => {
    let r = S.byEl.get(el);
    if (!r) {
      r = "e" + S.next++;
      S.byEl.set(el, r);
      S.byRef.set(r, new WeakRef(el));
    }
    return r;
  };
  const ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton", "treeitem"]);
  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true],' + [...ROLES].map((r) => `[role=${r}]`).join(",");
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg", "SVG", "CANVAS", "HEAD", "META", "LINK", "OBJECT", "EMBED"]);
  const BLOCKS = "p,div,section,article,ul,ol,li,table,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,dl,form,header,footer,nav,main,aside,figure";
  const TEXT_BLOCK = new Set(["P", "LI", "TD", "TH", "DT", "DD", "BLOCKQUOTE", "PRE", "FIGCAPTION", "CAPTION", "LABEL", "LEGEND"]);

  const hidden = (el) => {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const st = getComputedStyle(el);
    return st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse" || st.opacity === "0";
  };
  const roleOf = (el) => {
    const r = (el.getAttribute("role") || "").toLowerCase();
    if (ROLES.has(r)) return r;
    const tag = el.tagName;
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "select";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "hidden") return null;
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox" || t === "radio") return t;
      if (t === "range") return "slider";
      if (t === "file") return "file";
      if (t === "search") return "searchbox";
      if (t === "password") return "password";
      return "textbox";
    }
    if (el.isContentEditable && el.hasAttribute("contenteditable")) return "textbox";
    return null;
  };
  const nameOf = (el, role) => {
    const by = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => n.innerText)
      .join(" ");
    const label = el.labels && el.labels.length ? el.labels[0].innerText : "";
    const isField = ["textbox", "searchbox", "password", "select", "slider", "file", "combobox", "spinbutton"].includes(role);
    const own = isField ? "" : el.innerText || (el.tagName === "INPUT" ? el.value : "") || (el.querySelector("img[alt]") || {}).alt || "";
    return clean(el.getAttribute("aria-label") || by || label || own || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("name") || "", 100);
  };
  // Passwords, sign-in codes and fields Crew filled from the vault never show their text: only whether they are filled.
  const secretField = (el) => (S.secret && S.secret.has(el)) || /one-time-code/.test((el.getAttribute("autocomplete") || "").toLowerCase());
  const fieldLine = (el, role) => {
    const parts = [`${role} ${quote(nameOf(el, role))}`];
    if (role === "password" || ((role === "textbox" || role === "spinbutton") && secretField(el))) {
      parts.push(el.value ? "filled" : "empty");
      if (role === "password" && !el.value) parts.push("(a password: sign in with a login from logins, or ask the person)");
    } else if (role === "textbox" || role === "searchbox" || role === "spinbutton") {
      const v = el.isContentEditable ? el.innerText : el.value;
      if (v) parts.push(`value=${quote(clean(v, 120))}`);
    } else if (role === "select") {
      const opts = [...el.options].map((o) => clean(o.text, 40));
      parts.push(`value=${quote(clean(el.selectedOptions[0] ? el.selectedOptions[0].text : "", 60))}`);
      parts.push(`options: ${opts.slice(0, 12).join(" | ")}${opts.length > 12 ? ` | …${opts.length - 12} more` : ""}`);
    }
    if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox") {
      if (el.checked || el.getAttribute("aria-checked") === "true") parts.push("checked");
    }
    if (el.getAttribute("aria-expanded") === "true") parts.push("expanded");
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    if (role === "link") {
      const href = el.getAttribute("href") || "";
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const u = new URL(href, location.href);
          parts.push(`→ ${clean(u.host === location.host ? u.pathname + u.search : u.host + u.pathname, 80)}`);
        } catch {
          /* not a URL */
        }
      }
    }
    parts.push(`[${refOf(el)}]`);
    return "- " + parts.join(" ");
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (dropped) return;
      if (child.nodeType === 3) {
        const t = clean(child.textContent, 300);
        if (t) push(t);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      if (SKIP.has(el.tagName)) continue;
      if (el.tagName === "IFRAME") {
        push("[an embedded frame, not read]");
        continue;
      }
      if (hidden(el)) continue;
      if (fromView && el.getBoundingClientRect().bottom < -20) {
        above++;
        continue;
      }
      const role = roleOf(el);
      if (role) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) push(fieldLine(el, role));
        continue;
      }
      const interactive = el.querySelector(INTERACTIVE);
      const h = /^H([1-6])$/.exec(el.tagName);
      if (h && !interactive) {
        const t = clean(el.innerText, 200);
        if (t) push("#".repeat(Number(h[1])) + " " + t);
        continue;
      }
      if (el.tagName === "IMG") {
        const alt = clean(el.getAttribute("alt"), 100);
        if (alt) push(`image ${quote(alt)}`);
        continue;
      }
      if (el.tagName === "TR" && !interactive) {
        const cells = [...el.children].map((c) => clean(c.innerText, 80));
        if (cells.some(Boolean)) push("| " + cells.join(" | ") + " |");
        continue;
      }
      if (!interactive && (TEXT_BLOCK.has(el.tagName) || !el.querySelector(BLOCKS))) {
        const t = clean(el.innerText, 600);
        if (t) push((el.tagName === "LI" ? "- " : "") + t);
        continue;
      }
      walk(el);
    }
  };
  if (document.body) walk(document.body);
  const doc = document.documentElement;
  return {
    title: document.title,
    url: location.href,
    text: lines.join("\n"),
    dropped,
    above,
    scrollY: Math.round(window.scrollY),
    height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0),
    view: window.innerHeight,
  };
}

/** Find a ref's element, bring it into view, and say where its middle is. */
function pageTarget(ref) {
  const S = globalThis.__fennaCrew;
  const w = S && S.byRef.get(ref);
  const el = w && w.deref();
  if (!el || !el.isConnected) return { error: "stale" };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return { error: "hidden" };
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  const top = document.elementFromPoint(x, y);
  const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  const label = el.labels && el.labels.length ? el.labels[0].innerText : "";
  const name = String(el.getAttribute("aria-label") || label || (isField ? el.getAttribute("placeholder") : el.innerText || el.value) || el.getAttribute("title") || el.getAttribute("name") || el.tagName.toLowerCase())
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const type = (el.getAttribute("type") || "").toLowerCase();
  const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
  return {
    x,
    y,
    tag: el.tagName.toLowerCase(),
    name,
    password: type === "password" || /current-password|new-password|one-time-code/.test(auto),
    payment: /^cc-/.test(auto),
    field: el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable,
    select: el.tagName === "SELECT",
    disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
    covered: top && top !== el && !el.contains(top) && !top.contains(el) ? String(top.innerText || top.tagName).replace(/\s+/g, " ").trim().slice(0, 40) : null,
  };
}

/** Select everything in a field so typing replaces it. */
function pageSelectAll(ref) {
  const el = globalThis.__fennaCrew.byRef.get(ref).deref();
  el.focus();
  if (typeof el.select === "function") el.select();
  else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

/** Choose an option in a <select> by its text or value. */
function pageChoose(arg) {
  const el = globalThis.__fennaCrew.byRef.get(arg.ref).deref();
  const want = String(arg.text).trim().toLowerCase();
  const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) || [...el.options].find((o) => o.text.trim().toLowerCase().includes(want));
  if (!opt) return { error: [...el.options].map((o) => o.text.trim()).slice(0, 30) };
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { chose: opt.text.trim() };
}

function pageScroll() {
  const doc = document.documentElement;
  return { scrollY: Math.round(window.scrollY), height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0), view: window.innerHeight };
}

/**
 * Fill a login into the page, from the vault, in one step so the page can't
 * change origin in between: refuses unless the page is on arg.origin. Finds
 * the fields when no refs are given. Marks what it filled so snapshot never
 * shows it. Says where the form's submit button is.
 */
function pageFillLogin(arg) {
  if (location.origin !== arg.origin) return { error: "origin", origin: location.origin };
  const S = (globalThis.__fennaCrew = globalThis.__fennaCrew || { next: 1, byRef: new Map(), byEl: new WeakMap() });
  S.secret = S.secret || new WeakSet();
  S.filled = S.filled || new WeakSet();
  const shown = (el) => {
    if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const refOf = (el) => {
    let r = S.byEl.get(el);
    if (!r) {
      r = "e" + S.next++;
      S.byEl.set(el, r);
      S.byRef.set(r, new WeakRef(el));
    }
    return r;
  };
  const byRef = (ref) => {
    const w = S.byRef.get(ref);
    const el = w && w.deref();
    return el && el.isConnected ? el : null;
  };
  const typeOf = (el) => (el.getAttribute("type") || "text").toLowerCase();
  const textLike = (el) => el.tagName === "INPUT" && ["text", "email", "tel", ""].includes(typeOf(el));
  const auto = (el) => (el.getAttribute("autocomplete") || "").toLowerCase();

  let pw = null;
  if (arg.passwordRef) {
    pw = byRef(arg.passwordRef);
    if (!pw) return { error: "stale", ref: arg.passwordRef };
    if (pw.tagName !== "INPUT" || typeOf(pw) !== "password") return { error: "notPassword", ref: arg.passwordRef };
  } else {
    const all = [...document.querySelectorAll("input[type=password]")].filter(shown);
    pw = all.find((el) => /current-password/.test(auto(el))) || all.find((el) => !/new-password/.test(auto(el))) || all[0] || null;
  }
  let user = null;
  if (arg.usernameRef) {
    user = byRef(arg.usernameRef);
    if (!user) return { error: "stale", ref: arg.usernameRef };
    if (!textLike(user)) return { error: "notText", ref: arg.usernameRef };
  } else {
    const scope = (pw && pw.form) || document;
    let list = [...scope.querySelectorAll("input")].filter((el) => textLike(el) && shown(el) && !/one-time-code/.test(auto(el)));
    if (pw) list = list.filter((el) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    user =
      list.find((el) => /username|email/.test(auto(el))) ||
      list.find((el) => typeOf(el) === "email") ||
      list.find((el) => /user|email|login|account|identifier/i.test(`${el.name} ${el.id} ${el.getAttribute("aria-label") || ""} ${el.placeholder || ""}`)) ||
      (pw ? list[list.length - 1] : null) ||
      null;
  }
  if (!pw && !user) return { error: "none" };

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const put = (el, value) => {
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    S.filled.add(el);
  };
  const filledUser = !!(user && arg.username);
  if (filledUser) put(user, arg.username);
  if (pw) {
    put(pw, arg.password);
    S.secret.add(pw);
  }
  const last = pw || user;
  const form = last.form;
  const submit = form ? [...form.querySelectorAll("button, input[type=submit], input[type=image]")].filter(shown).find((b) => (b.getAttribute("type") || "submit").toLowerCase() === "submit") : null;
  let button = null;
  if (submit) {
    submit.scrollIntoView({ block: "center", behavior: "instant" });
    const r = submit.getBoundingClientRect();
    button = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: String(submit.innerText || submit.value || "Submit").replace(/\s+/g, " ").trim().slice(0, 40) };
  }
  last.focus();
  return { filledUser, filledPassword: !!pw, userRef: user ? refOf(user) : null, passwordRef: pw ? refOf(pw) : null, button };
}

/** Fill a sign-in code into a field (by ref, or the page's code field), refusing unless the page is on arg.origin. */
function pageFillCode(arg) {
  if (location.origin !== arg.origin) return { error: "origin", origin: location.origin };
  const S = (globalThis.__fennaCrew = globalThis.__fennaCrew || { next: 1, byRef: new Map(), byEl: new WeakMap() });
  S.secret = S.secret || new WeakSet();
  S.filled = S.filled || new WeakSet();
  const CODE_TYPES = ["text", "tel", "number", "password", ""];
  const shown = (el) => {
    if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const typeOf = (el) => (el.getAttribute("type") || "text").toLowerCase();
  let el = null;
  if (arg.ref) {
    const w = S.byRef.get(arg.ref);
    el = w && w.deref();
    if (!el || !el.isConnected) return { error: "stale", ref: arg.ref };
    if (el.tagName !== "INPUT" || !CODE_TYPES.includes(typeOf(el))) return { error: "notText", ref: arg.ref };
  } else {
    const inputs = [...document.querySelectorAll("input")].filter((x) => shown(x) && CODE_TYPES.includes(typeOf(x)));
    el =
      inputs.find((x) => /one-time-code/.test((x.getAttribute("autocomplete") || "").toLowerCase())) ||
      inputs.find((x) => /otp|totp|2fa|mfa|code|token|verif/i.test(`${x.name} ${x.id} ${x.getAttribute("aria-label") || ""} ${x.placeholder || ""}`)) ||
      (inputs.length === 1 ? inputs[0] : null);
    if (!el) return { error: "none" };
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  el.focus();
  setter.call(el, arg.code);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg.code }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  S.filled.add(el);
  S.secret.add(el);
  const form = el.form;
  const submit = form ? [...form.querySelectorAll("button, input[type=submit]")].find((b) => shown(b) && (b.getAttribute("type") || "submit").toLowerCase() === "submit") : null;
  let button = null;
  if (submit) {
    submit.scrollIntoView({ block: "center", behavior: "instant" });
    const r = submit.getBoundingClientRect();
    button = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: String(submit.innerText || submit.value || "Submit").replace(/\s+/g, " ").trim().slice(0, 40) };
  }
  return { button };
}

/** Whether a secret Crew filled shows as text on the page now (a "show password" switch, or a code field), so no screenshot is taken. */
function pageSecretShown() {
  const S = globalThis.__fennaCrew;
  if (!S || !S.secret) return false;
  for (const el of document.querySelectorAll("input")) {
    if (!S.secret.has(el) || !el.value) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (el.getAttribute("type") || "text").toLowerCase() !== "password") return true;
  }
  return false;
}

/**
 * Runs in its own world on every page while the person has control: when
 * they send a form with a password in it, the origin, the username and the
 * password go to Crew (the binding), so it can offer to save them to the
 * vault. Never armed while the bot drives the browser.
 */
const CAPTURE_SOURCE = `(() => {
  if (globalThis.__fennaCrewCapture) return;
  globalThis.__fennaCrewCapture = true;
  const send = globalThis.__fennaCrewSave;
  if (typeof send !== "function") return;
  let last = "";
  const typeOf = (el) => (el.getAttribute("type") || "text").toLowerCase();
  const grab = (scope) => {
    const root = scope && scope.querySelectorAll ? scope : document;
    let pws = [...root.querySelectorAll("input[type=password]")].filter((e) => e.value);
    if (!pws.length && root !== document) pws = [...document.querySelectorAll("input[type=password]")].filter((e) => e.value);
    if (!pws.length) return;
    const pw = pws.find((e) => !/new-password/.test(e.autocomplete || "")) || pws[0];
    const inputs = [...(pw.form || document).querySelectorAll("input")];
    const before = inputs.slice(0, inputs.indexOf(pw)).filter((e) => ["text", "email", "tel", ""].includes(typeOf(e)) && e.value);
    const user = before.find((e) => /username|email/.test(e.autocomplete || "")) || before.find((e) => typeOf(e) === "email") || before[before.length - 1];
    const payload = JSON.stringify({ origin: location.origin, username: user ? user.value : "", password: pw.value });
    if (payload === last) return;
    last = payload;
    send(payload);
  };
  document.addEventListener("submit", (e) => grab(e.target), true);
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("button, input[type=submit], input[type=image], [role=button]") : null;
    if (b) grab(b.form || document);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") grab(e.target.form || document);
  }, true);
})();`;

/**
 * Runs in the page's own world before any page script, on every page of a
 * bot's browser. It makes the page see notifications as granted, and reports
 * what the page tries to show through the binding (never shows anything).
 */
const NOTIFY_SOURCE = `(() => {
  const report = (title, body) => {
    try {
      const send = window.__fennaCrewNotify;
      if (typeof send === "function") send(JSON.stringify({ title: String(title ?? ""), body: String(body ?? "") }));
    } catch (_) {}
  };
  class FennaNotification extends EventTarget {
    constructor(title, options) {
      super();
      const o = options && typeof options === "object" ? options : {};
      this.title = String(title ?? "");
      this.body = String(o.body ?? "");
      this.tag = String(o.tag ?? "");
      this.icon = String(o.icon ?? "");
      this.data = o.data ?? null;
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
      report(this.title, this.body);
    }
    close() {}
    static get permission() {
      return "granted";
    }
    static get maxActions() {
      return 0;
    }
    static requestPermission(callback) {
      const result = Promise.resolve("granted");
      if (typeof callback === "function") result.then(callback);
      return result;
    }
  }
  Object.defineProperty(window, "Notification", { value: FennaNotification, writable: true, configurable: true });
  if (navigator.permissions && navigator.permissions.query) {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) => {
      if (descriptor && descriptor.name === "notifications") {
        const status = new EventTarget();
        status.name = "notifications";
        status.state = "granted";
        status.onchange = null;
        return Promise.resolve(status);
      }
      return query(descriptor);
    };
  }
  if (window.ServiceWorkerRegistration) {
    Object.defineProperty(ServiceWorkerRegistration.prototype, "showNotification", {
      value: function showNotification(title, options) {
        report(title, options && options.body);
        return Promise.resolve();
      },
      writable: true,
      configurable: true,
    });
  }
})();`;

/**
 * The element a ref points to, as a CSS selector that finds it again (its
 * id if it has a unique one, else the path from the nearest such element),
 * with its text. Refuses when the selector wouldn't find it again.
 */
function pageWatchTarget(ref) {
  const S = globalThis.__fennaCrew;
  const w = S && S.byRef.get(ref);
  const el = w && w.deref();
  if (!el || !el.isConnected) return { error: "stale" };
  const parts = [];
  let node = el;
  for (;;) {
    if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
      parts.unshift("#" + CSS.escape(node.id));
      break;
    }
    if (node === document.documentElement) {
      parts.unshift("html");
      break;
    }
    const parent = node.parentElement;
    if (!parent) return { error: "unreachable" };
    const same = [...parent.children].filter((c) => c.tagName === node.tagName);
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`);
    node = parent;
  }
  const selector = parts.join(" > ");
  if (document.querySelector(selector) !== el) return { error: "unreachable" };
  return { selector, origin: location.origin, url: location.href, text: String(el.innerText || "").trim().slice(0, 4000) };
}

/**
 * Watch the element a selector finds (in the isolated watch world): after
 * each burst of changes, once it has been quiet for arg.debounce ms, report
 * its text through the binding if the text changed. Replaces any watch with
 * the same id. Returns { text } as the baseline, or { error: "missing" }.
 */
function pageWatchArm(arg) {
  const W = (globalThis.__fennaCrewWatches = globalThis.__fennaCrewWatches || new Map());
  const old = W.get(arg.id);
  if (old) {
    old.observer.disconnect();
    clearTimeout(old.timer);
    W.delete(arg.id);
  }
  const el = document.querySelector(arg.selector);
  if (!el) return { error: "missing" };
  const read = () => String(el.innerText || "").trim().slice(0, arg.cap);
  const w = { observer: null, timer: null, last: read() };
  w.observer = new MutationObserver(() => {
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.timer = null;
      const text = read();
      if (text === w.last) return;
      w.last = text;
      if (typeof globalThis.__fennaCrewWatch === "function") globalThis.__fennaCrewWatch(JSON.stringify({ id: arg.id, text }));
    }, arg.debounce);
  });
  w.observer.observe(el, { subtree: true, childList: true, characterData: true });
  W.set(arg.id, w);
  return { text: w.last };
}

/** Stop a watch started by pageWatchArm. */
function pageWatchStop(id) {
  const W = globalThis.__fennaCrewWatches;
  const w = W && W.get(id);
  if (!w) return false;
  w.observer.disconnect();
  clearTimeout(w.timer);
  W.delete(id);
  return true;
}

module.exports = { pageSnapshot, pageTarget, pageSelectAll, pageChoose, pageScroll, pageFillLogin, pageFillCode, pageSecretShown, CAPTURE_SOURCE, NOTIFY_SOURCE, pageWatchTarget, pageWatchArm, pageWatchStop };

