// A bot in a Google Meet call (docs/plans/crew-meetings.md). The bot asks to
// join with one `meeting` tool call; Crew does every step in the call itself
// over the DevTools protocol (meet-scripts.cjs): it joins as a guest with a
// silent microphone and a name card for a camera, turns Meet's captions on,
// and reads them, with the meeting chat, into a transcript in the bot's
// Files. Nothing in the call reaches the model until someone says the bot's
// name: then the engine (meeting-engine.cjs) wakes it with only the lines
// since it last looked, and its final reply is posted to the meeting chat.
// Sharing the screen shows a library document live (stage.cjs). One meeting
// per bot.

const fs = require("node:fs");
const path = require("node:path");
const { createMeetingEngine, replyText } = require("./meeting-engine.cjs");
const S = require("./meet-scripts.cjs");

const MEET_ORIGIN = "https://meet.google.com";
const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const LISTEN_BINDING = "__fennaMeetListen";
const LISTEN_WORLD = "fenna-meet";
const POLL_MS = 2000;
const JOIN_WAIT_MS = 30_000;
const ANSWER_WAIT_MS = 12_000;
const JOIN_ENABLE_MS = 8000;
const ADMIT_WAIT_MS = 10 * 60_000;
const ALONE_MS = 5 * 60_000;
const LONGEST_MS = 4 * 3_600_000;
const PRESENT_WAIT_MS = 8000;
const CAPTIONS_RETRY_MS = 15_000;
/** How long the bot's own chat message is recognized when Meet shows it back. */
const SAID_MS = 2 * 60_000;

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
const NAME_MAX = 60;
const NOTE_MAX = 500;
/** How each state reads in what the model is told. */
const STATE_WORDS = {
  joining: "joining",
  waiting: "asked to join, waiting for someone in the call to let you in",
  stuck: "stopped at Meet's join screen until the person takes control of your browser and gets past it",
  incall: "in the call",
  ended: "ended",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The call a link names: Meet's own links, and in tests the extra origins Crew was started with. */
function meetingLink(raw, extraOrigins = []) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return { error: 'Give the call\'s link, like "https://meet.google.com/abc-defg-hij".' };
  }
  if (extraOrigins.includes(u.origin)) return { url: u.href, code: (u.searchParams.get("code") || "test-call").slice(0, 40), origin: u.origin };
  const code = u.pathname.replace(/^\//, "").split("/")[0].toLowerCase();
  if (u.origin !== MEET_ORIGIN || !CODE_RE.test(code)) return { error: `Only Google Meet calls can be joined for now, with a link like "https://meet.google.com/abc-defg-hij". "${String(raw).slice(0, 200)}" isn't one.` };
  return { url: `${MEET_ORIGIN}/${code}${u.search}`, code, origin: MEET_ORIGIN };
}

/** "2026-11-21 14.05 abc-defg-hij.md", a file name for a transcript. */
function transcriptName(at, code) {
  const p = (n) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())} ${code.replace(/[^\w-]/g, "")}.md`;
}

/** Why a bot with an account of its own can't join yet, and what to do. */
function accountBlocker(a) {
  if (a.state === "signed_out") return `Your Google account (${a.email}) is signed out. Call account with {action: "sign_in"}: it opens the window where the person signs you in. Join again once they have.`;
  if (a.state === "signing_in") return `The person is signing your Google account (${a.email}) in right now. Join again once they have closed that window.`;
  if (a.state === "no_chrome") return "Google Chrome isn't installed on this computer, and your Google account and calls run in it. Ask the person to install it from google.com/chrome.";
  if (a.state === "other_account") return `Your browser is signed in to Google as ${a.signedInAs || "someone else"}, not your own account ${a.email}. Ask the person to sign it out in your Details, then join again.`;
  if (a.state === "missing") return `Your Google account's login isn't in the vault on this computer. Ask the person to add it, then join again.`;
  return `Crew couldn't tell whether your Google account (${a.email}) is signed in. Ask the person to press Check in your Details, then join again.`;
}

/** What a bot posts in the chat when it is let in. */
function consentText(botName) {
  return `Hi, I'm ${botName}, an AI assistant in Fenna Crew. I keep a transcript from the captions. Say "${botName}" to ask me something.`;
}

/**
 * @param {object} o
 * @param {object} o.store
 * @param {{ enqueue: Function, running: (slug: string) => boolean, isQueued: (slug: string) => boolean }} o.runner
 * @param {{ openMeeting: Function }} o.browsers  the built-in browser: calls run there only when Google Chrome isn't installed
 * @param {{ available(): boolean, openTab: Function, show(slug: string): Promise<boolean> } | null} [o.chrome]  the bot's own Chrome (chrome.cjs), where calls run
 * @param {{ ensure(slug: string): Promise<object | null> } | null} [o.accounts]  the bot's own Google account (accounts.cjs): signed in before it joins
 * @param {{ start: Function } | null} o.stage
 * @param {(channel: string, payload: unknown) => void} o.broadcast
 * @param {() => void} [o.onChange]
 * @param {string[]} [o.extraOrigins]  test pages that count as calls (OPENDECK_MEET_ORIGINS)
 */
function createMeetings({ store, runner, browsers, chrome = null, accounts = null, stage, broadcast, onChange = () => {}, extraOrigins = [], now = () => new Date() }) {
  /** slug → its meeting */
  const all = new Map();

  const view = (m) => ({
    slug: m.slug,
    code: m.code,
    url: m.url,
    state: m.state,
    people: m.people,
    captions: m.captions,
    sharing: m.sharing ? m.sharing.title : null,
    transcript: `Files/Meetings/${m.file}`,
    chat: m.chat,
    startedAt: m.startedAt,
    inChrome: m.inChrome,
  });

  function tell(m) {
    broadcast("crew:meeting", { slug: m.slug, meeting: all.get(m.slug) === m ? view(m) : null });
    onChange();
  }

  function append(m, line) {
    try {
      fs.appendFileSync(m.path, `${line}\n`, "utf8");
    } catch {
      /* the folder went away: the call goes on */
    }
  }

  function setState(m, state) {
    if (m.state === state) return;
    m.state = state;
    tell(m);
  }

  /** One page function, in the meeting's world. */
  const run = (m, fn, arg) => m.tab.evaluate(fn, arg);

  /** Posts one message to the meeting chat (in order, one at a time). */
  function say(m, text) {
    const next = m.saying.then(async () => {
      if (!m.tab.alive()) throw new Error("The meeting has ended.");
      await m.tab.waitForControl();
      // Meet opens its chat panel a moment after the click.
      let r = null;
      for (let i = 0; i < 6 && !(r && r.ok); i++) {
        if (i) await sleep(300);
        r = await run(m, S.meetChatFocus).catch(() => null);
      }
      if (!r || !r.ok) throw new Error("Couldn't open the meeting chat.");
      await m.tab.cdp("Input.insertText", { text });
      await m.tab.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await m.tab.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      m.said.set(oneLine(text), now().getTime());
      append(m, `[${clock(now())}] ${m.botName} (chat): ${text}`);
    });
    m.saying = next.catch(() => {});
    return next;
  }

  function clock(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** Someone said the bot's name: a run in the meeting's chat with what was said since it last looked; its reply goes to the call. */
  function wake(m, text) {
    if (all.get(m.slug) !== m) return;
    const body = `${m.note ? `What the person asked you to do in this call: ${m.note}\n` : ""}Transcript so far: Files/Meetings/${m.file}\nNew in the call:\n${text}`;
    let queued;
    try {
      queued = runner.enqueue({ slug: m.slug, trigger: "meeting", text: body, chat: m.chat });
    } catch {
      return;
    }
    void queued.done.then(async (r) => {
      if (r.outcome !== "done" || all.get(m.slug) !== m) return;
      for (const part of replyText(r.text) || []) {
        try {
          await say(m, part);
        } catch {
          return;
        }
      }
    });
  }

  function onListen(m, payload) {
    let e;
    try {
      e = JSON.parse(payload);
    } catch {
      return;
    }
    if (!e || typeof e !== "object") return;
    if (e.kind === "caption" && typeof e.text === "string") m.engine.caption({ block: Number(e.block) || 0, speaker: String(e.speaker || ""), text: e.text });
    else if (e.kind === "chat" && typeof e.text === "string" && !saidByBot(m, e.text)) m.engine.chat({ sender: String(e.sender || ""), text: e.text });
  }

  /** The bot's own chat messages come back through the listener, often with no sender; they are already in the transcript. */
  function saidByBot(m, text) {
    const t = now().getTime();
    for (const [said, at] of m.said) if (t - at > SAID_MS) m.said.delete(said);
    return m.said.has(oneLine(text));
  }

  /** The call is over for the bot: everything stops, the tab closes, the transcript ends. */
  function finish(m, why, afterwards = true) {
    if (m.done) return;
    m.done = true;
    clearTimeout(m.poll);
    m.engine.stop();
    if (m.sharing) m.sharing.stop();
    m.sharing = null;
    append(m, `\n[${clock(now())}] ${why}`);
    if (all.get(m.slug) === m) all.delete(m.slug);
    const wasIn = m.state === "incall";
    m.state = "ended";
    m.tab.close();
    tell(m);
    // One last wake, so the bot can finish what the person asked of it there (notes, action items).
    if (wasIn && m.note && afterwards) {
      try {
        runner.enqueue({ slug: m.slug, trigger: "meeting_end", chat: m.chat, text: `${why}
What the person asked you to do in this call: ${m.note}
The whole transcript: Files/Meetings/${m.file}` });
      } catch {
        /* the bot is gone */
      }
    }
  }

  /** Turns Meet's captions on: the toggle when it shows, else Meet's "c" shortcut. True when they are on. */
  async function captionsOn(m) {
    const r = await run(m, S.meetCaptionsOn).catch(() => null);
    if (r && r.on) return true;
    if (!r || !r.key) return false;
    await m.tab.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, text: "c" }).catch(() => {});
    await m.tab.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 }).catch(() => {});
    await sleep(1000);
    const s = await run(m, S.meetState).catch(() => null);
    return !!(s && s.captions);
  }

  async function admitted(m) {
    for (let i = 0; i < 5 && !m.captions; i++) {
      m.captions = await captionsOn(m);
      if (!m.captions) await sleep(1000);
    }
    m.captionsTried = now().getTime();
    if (!m.captions) {
      m.captionsMissing = true;
      append(m, `[${clock(now())}] Meet's captions could not be turned on, so spoken words are not in this transcript yet; chat is.`);
    }
    await say(m, consentText(m.botName)).catch(() => {});
    tell(m);
  }

  /** Every 2 seconds: where the call is, and what that means for the bot. */
  async function check(m) {
    if (m.done) return;
    let s = null;
    try {
      s = m.tab.alive() ? await run(m, S.meetState) : null;
    } catch {
      s = null;
    }
    if (m.done) return;
    if (!m.tab.alive()) return finish(m, "The meeting's tab was closed.");
    const t = now().getTime();
    if (s) {
      m.people = typeof s.people === "number" ? s.people : m.people;
      if (s.state === "incall" && m.state !== "incall") {
        setState(m, "incall");
        m.inSince = t;
        append(m, `[${clock(now())}] Joined the call.`);
        void admitted(m);
      } else if (s.state === "waiting") setState(m, "waiting");
      else if (s.state === "denied") return finish(m, "Not let in to the call.");
      else if (s.state === "signin") m.signIn = true;
      else if (s.state === "prejoin" && m.signIn && !m.pressing) {
        // The person signed in for the bot: Meet is back at its join screen, and Crew presses join itself.
        m.signIn = false;
        m.pressing = true;
        void pressJoin(m).finally(() => (m.pressing = false));
      }
      else if (s.state === "ended" && m.state === "incall") return finish(m, "The call ended.");
      if (m.state === "incall") {
        if (s.captions) {
          m.captions = true;
          if (m.captionsMissing) {
            m.captionsMissing = false;
            append(m, `[${clock(now())}] Meet's captions are on; spoken words are in the transcript from here.`);
          }
        } else if (s.captions === false && m.captionsTried && t - m.captionsTried >= CAPTIONS_RETRY_MS) {
          // Off, or never came on: try again now and then, never every check (the toggle must not flip back and forth).
          m.captions = false;
          m.captionsTried = t;
          void captionsOn(m).then((on) => (m.captions = on), () => {});
        }
        if (m.sharing && s.presenting === false && t - m.sharing.since > PRESENT_WAIT_MS) {
          m.sharing.stop();
          m.sharing = null;
          tell(m);
        }
        m.aloneSince = m.people !== null && m.people <= 1 ? m.aloneSince || t : 0;
        if (m.aloneSince && t - m.aloneSince > ALONE_MS) return leave(m, "Left: everyone else had gone.");
      }
    }
    if (m.state !== "incall" && t - m.startedMs > ADMIT_WAIT_MS) return leave(m, m.state === "stuck" ? "Left: nobody got the bot past Meet's join screen in 10 minutes." : "Left: nobody let the bot in for 10 minutes.");
    if (t - m.startedMs > LONGEST_MS) return leave(m, "Left after 4 hours, the longest a bot stays in a call.");
    tell(m);
    m.poll = setTimeout(() => void check(m), POLL_MS);
  }

  async function leave(m, why, afterwards = true) {
    if (m.sharing) {
      await run(m, S.meetStopPresenting).catch(() => {});
      m.sharing.stop();
      m.sharing = null;
    }
    await run(m, S.meetLeave).catch(() => {});
    await sleep(500);
    finish(m, why, afterwards);
  }

  async function join(slug, { url, name, note }) {
    const was = all.get(slug);
    if (was) {
      if (was.state === "incall") throw new Error(`You are already in the call ${was.code}. Leave it first with {action: "leave"}.`);
      throw new Error(`You are already joining ${was.code} (${STATE_WORDS[was.state] || was.state}); Crew carries on by itself. Don't join again: check with {action: "status"}, or {action: "leave"} to give up.`);
    }
    const link = meetingLink(url, extraOrigins);
    if (link.error) throw new Error(link.error);
    // Meet lets a signed-in account ask to join; a bot with an account of its own joins as it.
    const account = accounts && link.origin === MEET_ORIGIN ? await accounts.ensure(slug) : null;
    if (account && account.state !== "signed_in") throw new Error(accountBlocker(account));
    const loaded = store.readBot(slug);
    const botName = (loaded && loaded.bot && loaded.bot.name) || slug;
    const shown = String(name || "").trim().slice(0, NAME_MAX) || `${botName} (Fenna)`;
    const at = now();
    const dir = path.join(store.botDir(slug), "workspace", "Meetings");
    fs.mkdirSync(dir, { recursive: true });
    const file = transcriptName(at, link.code);
    let chat = "";
    store.patchState(slug, (s) => {
      chat = require("./format.cjs").newChatId(at, s.chats.map((c) => c.id));
      const c = require("./format.cjs").chatIn(s, chat);
      c.title = `Call ${link.code}`;
      c.startedAt = at.toISOString();
    });
    const m = {
      slug,
      code: link.code,
      url: link.url,
      botName,
      shown,
      note: String(note || "").trim().slice(0, NOTE_MAX),
      file,
      path: path.join(dir, file),
      chat,
      state: "joining",
      people: null,
      captions: false,
      captionsTried: 0,
      captionsMissing: false,
      said: new Map(),
      sharing: null,
      startedAt: at.toISOString(),
      startedMs: at.getTime(),
      aloneSince: 0,
      signIn: false,
      pressing: false,
      saying: Promise.resolve(),
      done: false,
      poll: null,
      tab: null,
      engine: null,
      // Google lets a call in from real Chrome, not from the built-in browser.
      inChrome: !!(chrome && chrome.available()),
    };
    fs.writeFileSync(m.path, `# Call ${link.code}\n\n${link.url}\nStarted ${at.toLocaleString()}\n\n`, "utf8");
    m.engine = createMeetingEngine({
      botName,
      aliases: shown !== `${botName} (Fenna)` ? [shown] : [],
      now,
      onLine: (line) => append(m, line),
      onWake: (text) => wake(m, text),
      busy: () => runner.running(slug) || runner.isQueued(slug),
    });
    all.set(slug, m);
    try {
      const open = m.inChrome ? (s, o) => chrome.openTab(s, o) : (s, o) => browsers.openMeeting(s, o);
      m.tab = await open(slug, {
        url: link.url,
        bindings: [{ name: LISTEN_BINDING, executionContextName: LISTEN_WORLD }],
        scripts: [{ source: S.meetMediaSource({ hosts: [link.origin], name: shown }) }, { source: S.meetListenSource({ binding: LISTEN_BINDING }), worldName: LISTEN_WORLD }],
        onBinding: (_name, payload) => onListen(m, payload),
        onGone: () => finish(m, "The meeting's tab was closed."),
      });
    } catch (e) {
      all.delete(slug);
      m.engine.stop();
      throw e;
    }
    tell(m);
    const where = `The transcript goes to Files/Meetings/${file}. When someone says your name, Crew wakes you in the chat "Call ${link.code}" with what was said.`;
    // The person can finish what Crew couldn't (a sign-in, the Join button) in this same tab: the poll takes the call from there.
    const handOver = (why) => {
      setState(m, "stuck");
      m.poll = setTimeout(() => void check(m), POLL_MS);
      return {
        text: `${why} Crew keeps the call's tab open for 10 minutes and joins by itself once the person gets it past that: ask them with ask_human to ${m.inChrome ? "press Show call in your chat with them and do it in that Chrome window" : "take control of your browser and do it in the call's tab"}. Don't call join again, and don't use the browser tools on that tab. ${where}`,
      };
    };

    // The page before the call: the name, the microphone off, then Join now or Ask to join.
    const until = Date.now() + JOIN_WAIT_MS;
    let first = null;
    while (Date.now() < until && !m.done) {
      first = await run(m, S.meetState).catch(() => null);
      if (first && first.state !== "unknown") break;
      await sleep(500);
    }
    if (m.done) throw new Error("The meeting's tab was closed.");
    if (!first || first.state === "unknown") return handOver(`Meet didn't show its join screen for ${link.code} in 30 seconds.`);
    if (first.state === "signin") {
      m.signIn = true;
      return handOver(`Meet wants a Google sign-in before it lets anyone into ${link.code}.`);
    }
    if (first.state === "denied") {
      finish(m, "Not let in to the call.");
      if (!account) return { text: `Meet refused your browser before anyone could let you in to ${link.code}: it doesn't take guests without a Google account from it. Tell the person; they can give you a Google account of your own in your Details, under Google account, and then you can join.` };
      return { text: `Meet says you can't join ${link.code}. Tell the person; the host may have to invite or admit you.` };
    }
    if (first.state === "prejoin") {
      const r = await pressJoin(m);
      if (m.done) throw new Error("The meeting's tab was closed.");
      if (!r || !r.clicked) return handOver(`Crew couldn't press Meet's join button for ${link.code} (${!r ? "the page didn't answer" : r.disabled ? "the button stayed disabled" : "no Join now or Ask to join button"}).`);
    }
    // Wait a little for the answer, then let the poll carry on without the model.
    const answerBy = Date.now() + ANSWER_WAIT_MS;
    let s = first;
    while (Date.now() < answerBy && !m.done) {
      s = await run(m, S.meetState).catch(() => null);
      if (s && (s.state === "incall" || s.state === "denied" || s.state === "waiting")) break;
      await sleep(700);
    }
    if (m.done) throw new Error("The meeting's tab was closed.");
    if (s && s.state === "denied") {
      finish(m, "Not let in to the call.");
      return { text: `Meet didn't let you in to ${link.code}.` };
    }
    if (s && s.state === "prejoin") return handOver(`Crew pressed join for ${link.code}, but Meet still shows its join screen.`);
    m.poll = setTimeout(() => void check(m), 0);
    if (s && s.state === "incall") return { text: `Joined ${link.code} as "${shown}". ${where}` };
    return { text: `Asked to join ${link.code} as "${shown}"; someone in the call has to let you in. Crew joins when they do, and leaves after 10 minutes if nobody does. ${where} Don't call join again; end your turn now.` };
  }

  /** Types the bot's name for real (Meet ignores a name set from script), then presses Join now or Ask to join once it is enabled. */
  async function pressJoin(m) {
    const f = await run(m, S.meetNameFocus).catch(() => null);
    if (f && f.found && f.value !== m.shown) await m.tab.cdp("Input.insertText", { text: m.shown }).catch(() => {});
    let r = null;
    for (const by = Date.now() + JOIN_ENABLE_MS; Date.now() < by && !m.done; ) {
      r = await run(m, S.meetPrejoin, { name: m.shown }).catch(() => null);
      if (r && r.clicked) break;
      await sleep(500);
    }
    return r;
  }

  async function share(m, item) {
    if (m.state !== "incall") throw new Error("You aren't in the call yet. Wait until someone lets you in.");
    if (!stage) throw new Error("Screen sharing isn't available here.");
    if (m.sharing) {
      m.sharing.stop();
      m.sharing = null;
    }
    const shown = stage.start(m.slug, item, (dataUrl) => m.tab.main(`globalThis.__fennaStage && globalThis.__fennaStage.draw(${JSON.stringify(dataUrl)})`));
    m.sharing = { ...shown, item, since: Date.now() };
    const r = await run(m, S.meetPresent).catch(() => null);
    let on = false;
    for (const until = Date.now() + PRESENT_WAIT_MS; Date.now() < until && !on; ) {
      on = !!(await m.tab.main("!!(globalThis.__fennaStage && globalThis.__fennaStage.active())").catch(() => false));
      if (!on) await sleep(300);
    }
    if (!r || !r.clicked || !on) {
      shown.stop();
      m.sharing = null;
      tell(m);
      throw new Error("Meet didn't start presenting. Someone else may be presenting, or the host turned sharing off. Say so in your reply.");
    }
    shown.refresh();
    tell(m);
    return { text: `Sharing "${shown.title}" in the call. It shows your changes as you make them; edit it with the fenna tools. Stop with {action: "stop_sharing"}.` };
  }

  return {
    /** The `meeting` tool. */
    async act(ctx, p) {
      const action = p && p.action;
      if (action === "join") return join(ctx.slug, { url: p.url, name: p.name, note: p.note });
      const m = all.get(ctx.slug);
      if (action === "status") {
        if (!m) return { text: "You aren't in a call." };
        return { text: `Call ${m.code}: ${STATE_WORDS[m.state] || m.state}${m.people !== null ? `, ${m.people} people` : ""}${m.sharing ? `, sharing "${m.sharing.title}"` : ""}. Transcript: Files/Meetings/${m.file} (${m.engine.lines().length} lines).` };
      }
      if (!m) throw new Error('You aren\'t in a call. Join one with {action: "join", url}.');
      if (action === "say") {
        const text = String(p.text || "").trim();
        if (!text) throw new Error("Say what to post in text.");
        const parts = replyText(text) || [];
        for (const part of parts) await say(m, part);
        return { text: `Posted to the meeting chat.` };
      }
      if (action === "share") return share(m, String(p.document || "").trim());
      if (action === "stop_sharing") {
        if (!m.sharing) return { text: "You aren't sharing anything." };
        await run(m, S.meetStopPresenting).catch(() => {});
        m.sharing.stop();
        m.sharing = null;
        tell(m);
        return { text: "Stopped sharing." };
      }
      if (action === "leave") {
        // The bot chose to leave in a run of its own: it needs no wake to finish up.
        await leave(m, "Left the call.", false);
        return { text: `Left ${m.code}. The transcript is in Files/Meetings/${m.file}.` };
      }
      throw new Error('action is one of "join", "say", "share", "stop_sharing", "leave", "status".');
    },

    /** The person's buttons: leave, stop sharing. */
    async person(slug, action) {
      const m = all.get(slug);
      if (!m) return null;
      if (action === "leave") await leave(m, "The person took the bot out of the call.");
      else if (action === "show" && m.inChrome) await chrome.show(slug).catch(() => false);
      else if (action === "stop_sharing" && m.sharing) {
        await run(m, S.meetStopPresenting).catch(() => {});
        m.sharing.stop();
        m.sharing = null;
        tell(m);
      }
      return all.has(slug) ? view(all.get(slug)) : null;
    },

    list: () => [...all.values()].map(view),
    /** Called while the ended run still counts as running, so the waiting wakes go out a moment later. */
    runEnded() {
      setTimeout(() => {
        for (const m of all.values()) m.engine.runEnded();
      }, 0);
    },
    forget(slug) {
      const m = all.get(slug);
      if (m) finish(m, "The bot was deleted.", false);
    },
    stopAll() {
      for (const m of [...all.values()]) finish(m, "Crew quit.", false);
    },
  };
}

module.exports = { createMeetings, meetingLink, transcriptName, consentText, LISTEN_BINDING };
