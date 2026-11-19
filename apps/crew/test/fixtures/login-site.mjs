#!/usr/bin/env node
// A small sign-in site on 127.0.0.1 for trying Fenna Crew's vault: a login
// form, then a 2-factor code step (TOTP, RFC 6238), then a signed-in page.
// The same pages answer on a second port, a different origin, to check
// that Crew refuses to fill a login there.
//
//   node login-site.mjs --port=8765 --other=8766
//   (TEST_USER, TEST_PASSWORD and TEST_TOTP, a base32 key, in the environment)
//
// It never prints or stores a password; it says only whether a step passed.

import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const PORT = Number(arg("port", "8765"));
const OTHER = Number(arg("other", "8766"));
const USER = process.env.TEST_USER || "alice";
const PASSWORD = process.env.TEST_PASSWORD;
const TOTP = process.env.TEST_TOTP;
if (!PASSWORD || !TOTP) {
  process.stderr.write("Set TEST_PASSWORD and TEST_TOTP (a base32 key).\n");
  process.exit(2);
}

function base32(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function code(counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32(TOTP)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, "0");
}
const codeOk = (c) => {
  const now = Math.floor(Date.now() / 30000);
  return [now - 1, now, now + 1].some((n) => code(n) === String(c).trim());
};

/** session id → "code" (password passed) | "in" (signed in) */
const sessions = new Map();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font:15px system-ui,sans-serif;background:#f4f4f2;color:#1b1b1b;margin:0;display:grid;place-items:center;min-height:100vh}
  main{background:#fff;border:1px solid #ddd;border-radius:10px;padding:28px 32px;width:340px}
  h1{font-size:20px;margin:0 0 16px} label{display:block;margin:12px 0 4px;font-size:13px;color:#555}
  input{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;border:1px solid #bbb;border-radius:6px}
  button{margin-top:18px;width:100%;padding:9px;font:inherit;background:#1d3b8b;color:#fff;border:0;border-radius:6px}
  .err{color:#b3261e;font-size:13px;margin-top:10px}</style></head><body><main>${body}</main></body></html>`;

function loginPage(copy, error = "") {
  return page(copy ? "Test Site (copy) – Sign in" : "Test Site – Sign in", `<h1>${copy ? "Test Site (copy)" : "Test Site"}</h1>
  <form method="post" action="/login">
    <label for="u">Email or username</label><input id="u" name="username" autocomplete="username">
    <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">
    <button type="submit">Sign in</button>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
  </form>`);
}
const codePage = (error = "") =>
  page("Test Site – Enter your code", `<h1>Two-step check</h1><p>Enter the 6-digit code from your authenticator app.</p>
  <form method="post" action="/code">
    <label for="c">Code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
    <button type="submit">Verify</button>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
  </form>`);
const homePage = (user) => page(`Welcome ${user} – Test Site Dashboard`, `<h1>Signed in</h1><p>Welcome back, ${esc(user)}. You are signed in to Test Site.</p><p><a href="/logout">Sign out</a></p>`);

function body(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => {
      data += d;
      if (data.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

function serve(port, copy) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const sid = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
    const send = (status, html, headers = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers });
      res.end(html);
    };
    const go = (to, headers = {}) => {
      res.writeHead(303, { location: to, ...headers });
      res.end();
    };
    if (req.method === "GET" && url.pathname === "/") return go(sessions.get(sid) === "in" ? "/home" : "/login");
    if (req.method === "GET" && url.pathname === "/login") return send(200, loginPage(copy));
    if (req.method === "POST" && url.pathname === "/login") {
      const f = await body(req);
      if (copy) {
        process.stdout.write(`copy site ${port}: a sign-in was sent here (it should never be)\n`);
        return send(401, loginPage(copy, "This is a copy of the site."));
      }
      if (f.get("username") !== USER || f.get("password") !== PASSWORD) {
        process.stdout.write(`site ${port}: wrong username or password\n`);
        return send(401, loginPage(copy, "Wrong username or password."));
      }
      const id = randomBytes(12).toString("hex");
      sessions.set(id, "code");
      process.stdout.write(`site ${port}: password ok for ${USER}\n`);
      return go("/code", { "set-cookie": `sid=${id}; HttpOnly; Path=/; SameSite=Lax` });
    }
    if (url.pathname === "/code") {
      if (!sid || !sessions.has(sid)) return go("/login");
      if (req.method === "GET") return send(200, codePage());
      const f = await body(req);
      if (!codeOk(f.get("code") || "")) {
        process.stdout.write(`site ${port}: wrong code\n`);
        return send(401, codePage("That code is not right."));
      }
      sessions.set(sid, "in");
      process.stdout.write(`site ${port}: code ok, ${USER} signed in\n`);
      return go("/home");
    }
    if (url.pathname === "/home") return sessions.get(sid) === "in" ? send(200, homePage(USER)) : go("/login");
    if (url.pathname === "/logout") {
      sessions.delete(sid);
      return go("/login", { "set-cookie": "sid=; Max-Age=0; Path=/" });
    }
    send(404, page("Not found", "<h1>Not found</h1>"));
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`${copy ? "copy site" : "site"} on http://127.0.0.1:${port}\n`));
}

serve(PORT, false);
serve(OTHER, true);
