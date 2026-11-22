// End to end: real Crew, a real CLI brain, the fake Meet page.
//
//   node scripts/meet-e2e.mjs --work D:\some\empty\folder [--cli claude] [--model haiku]
//
// Makes a bot named Scout in a Crew folder of its own under --work, serves
// apps/crew/test/fixtures/fake-meet on 127.0.0.1, and starts Crew with that
// page allowed as a call (OPENDECK_MEET_ORIGINS) and a DevTools port. Then it
// tells Scout, as the person, to join the call and take notes. The fake call
// says "Scout, can you write up the action items as a doc and share your
// screen?" and asks in its chat "Scout what's our deadline?".
//
// It checks, from the call's page and from the bot's folder: the bot joined
// and posted its hello, the transcript holds the call, it answered in the
// call's chat, a doc was made, frames of a shared screen reached the call,
// no run took a screenshot or read the call with snapshot, and leaving ends
// the call. Prints one REPORT line; exits 0 only when every check held.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const fixtureDir = path.join(repo, "apps", "crew", "test", "fixtures", "fake-meet");
const electronExe = createRequire(path.join(repo, "apps", "crew", "package.json"))("electron");
const PORT = 9339;
const TIMEOUT_MS = 8 * 60_000;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const work = arg("work", "");
if (!work) {
  process.stderr.write("meet-e2e: give --work <an empty folder> (Crew's data for this run goes there)\n");
  process.exit(2);
}
const cli = arg("cli", "claude");
const shots = arg("shots", "");
const model = arg("model", "haiku");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = path.join(work, "Crew");
const botDir = path.join(root, "bots", "scout");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(botDir, { recursive: true });
fs.writeFileSync(
  path.join(botDir, "bot.md"),
  `---\nname: Scout\njob: Joins the person's calls, takes notes and writes up action items\nschedule: manual\nbrain:\n  cli: ${cli}\n  model: ${model}\nconnectors:\n  - fenna-docs\naskBefore: []\n---\nKeep notes short. Write action items as a Fenna doc.\n`,
  "utf8",
);

// Crew looks for the CLIs it installed in its own data folder: bring the person's copies along.
const ownBins = path.join(process.env.APPDATA || "", "Fenna Crew", "assistant", "bin");
if (fs.existsSync(ownBins)) fs.cpSync(ownBins, path.join(work, "ud", "assistant", "bin"), { recursive: true });

/** What the fake call last reported about itself (it posts window.__fakeMeet to /state). */
let reported = null;
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/state") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        reported = JSON.parse(body);
      } catch {
        /* a half-written report: the next one comes in half a second */
      }
      res.writeHead(204).end();
    });
    return;
  }
  const file = path.join(fixtureDir, "index.html");
  if (new URL(req.url, "http://x").pathname !== "/index.html") return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const callUrl = `${origin}/index.html?guest=1&admit=2000&script=standup&code=e2e-call&report=1`;

const env = { ...process.env, OPENDECK_CREW_ROOT: root, OPENDECK_MEET_ORIGINS: origin };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExe, [path.join(repo, "apps", "crew"), `--user-data-dir=${path.join(work, "ud")}`, `--remote-debugging-port=${PORT}`], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

/** One DevTools connection to a page whose URL passes `pick`. */
async function connect(pick) {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === "page" && pick(x.url));
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((ok, bad) => {
          ws.onopen = ok;
          ws.onerror = bad;
        });
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => {
          const msg = JSON.parse(String(m.data));
          if (msg.id && waiting.has(msg.id)) {
            waiting.get(msg.id)(msg);
            waiting.delete(msg.id);
          }
        };
        return {
          async send(method, params = {}) {
            const n = ++id;
            ws.send(JSON.stringify({ id: n, method, params }));
            return new Promise((ok) => waiting.set(n, ok));
          },
          async eval(expression) {
            const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
            return r.result && r.result.result ? r.result.result.value : undefined;
          },
          close: () => ws.close(),
        };
      }
    } catch {
      /* Crew is still starting */
    }
    await sleep(500);
  }
  throw new Error(`no page for ${pick}`);
}

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
const until = async (fn, ms, every = 1000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return null;
};
const readRuns = () => {
  const dir = path.join(botDir, "runs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
};

const killer = setTimeout(() => {
  process.stderr.write(`meet-e2e: timed out; the call reported ${reported ? JSON.stringify({ events: reported.events, sent: reported.sent.length, frames: reported.frames }) : "nothing"}; checks so far ${JSON.stringify(checks)}\n`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

let report = {};
try {
  const crew = await connect((u) => u.startsWith("file:") && u.includes("index.html") && !u.includes("editors"));
  await until(() => crew.eval("!!window.shell"), 30_000, 500);
  await crew.eval(`window.shell.invoke("crew:send", "scout", ${JSON.stringify(`Join this call and take notes: ${callUrl}`)})`);

  // The call runs in the bot's own Chrome when Chrome is installed, else in Crew's browser: follow it through its reports.
  const fake = (expr) => (reported ? new Function("f", `return ${expr};`)(reported) : null);
  check("joined the call", await until(() => fake("f.events.includes('joined')"), 120_000));
  check("posted its hello", await until(() => fake("f.sent.some((s) => /AI assistant/.test(s))"), 60_000));
  check("captions on and the scenario played", await until(() => fake("f.scriptDone"), 90_000));
  const answered = await until(() => fake("f.sent.filter((s) => !/AI assistant/.test(s)).length ? f.sent : null"), 180_000, 2000);
  check("answered in the call's chat", answered, JSON.stringify(answered || []).slice(0, 600));
  const shared = await until(() => fake("f.frames > 0 ? f.frames : null"), 240_000, 2000);
  check("shared its screen into the call", shared, `frames: ${shared}`);
  // --shots <dir>: the bot's chat with the call strip, at two sizes.
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await crew.eval(`[...document.querySelectorAll("button, a, [role=button], [role=option], li")].find((el) => el.textContent.trim().startsWith("Scout"))?.click()`);
    await sleep(2500);
    for (const [w, h] of [[1440, 900], [1000, 700]]) {
      await crew.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(1200);
      const shot = await crew.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(shots, `call-${process.env.OPENDECK_THEME || "system"}-${w}x${h}.png`), Buffer.from(shot.result.data, "base64"));
    }
    await crew.send("Emulation.clearDeviceMetricsOverride");
  }
  await until(async () => !readRuns().some((e) => e.type === "start") || readRuns().filter((e) => e.type === "start").length === readRuns().filter((e) => e.type === "end").length, 180_000, 2000);

  const meetingsDir = path.join(botDir, "workspace", "Meetings");
  const transcripts = fs.existsSync(meetingsDir) ? fs.readdirSync(meetingsDir) : [];
  const transcript = transcripts.length ? fs.readFileSync(path.join(meetingsDir, transcripts[0]), "utf8") : "";
  check("transcript holds the call", /Sam: .*standup/.test(transcript) && /Priya \(chat\): Scout what's our deadline/.test(transcript), transcripts[0] || "none");
  const lib = path.join(botDir, "library");
  const docs = fs.existsSync(lib) ? fs.readdirSync(lib).filter((d) => fs.existsSync(path.join(lib, d, "doc.json"))) : [];
  check("made a doc", docs.length > 0, docs.join(", "));
  const events = readRuns();
  const tools = events.filter((e) => e.type === "tool" && e.status !== "running").map((e) => `${e.server}.${e.tool}`);
  check("no screenshot or snapshot", !tools.some((t) => /screenshot|snapshot/.test(t)), tools.join(" "));
  const starts = events.filter((e) => e.type === "start");
  const usage = events.filter((e) => e.type === "usage");

  await crew.eval(`window.shell.invoke("crew:meeting", "scout", "leave")`);
  check("left the call", await until(async () => (await crew.eval(`window.shell.invoke("crew:meetings")`)).length === 0, 20_000));
  // With a note from the person, leaving wakes the bot once more to finish the work from the transcript.
  const ended = await until(() => {
    const dir = path.join(botDir, "runs");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    return files.some((f) => {
      const ev = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
      return ev.some((e) => e.type === "start" && e.trigger === "meeting_end") && ev.some((e) => e.type === "end" && e.outcome === "done");
    });
  }, 180_000, 2000);
  check("finished up after the call", ended, ended ? "meeting_end run done" : "no meeting_end run");
  report = { triggers: readRuns().filter((e) => e.type === "start").map((s) => s.trigger), tools, usage: usage.map((u) => u.used), sent: answered, transcript: transcript.split("\n").slice(0, 40) };
} catch (e) {
  check("ran", false, String(e && e.message));
}
clearTimeout(killer);
const ok = checks.length > 0 && checks.every((c) => c.ok);
process.stdout.write(`REPORT ${JSON.stringify({ ok, checks, ...report })}\n`);
if (!ok) process.stderr.write(log.slice(-4000));
child.kill();
server.close();
process.exit(ok ? 0 : 1);
