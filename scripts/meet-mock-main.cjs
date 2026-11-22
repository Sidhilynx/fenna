'use strict';

// Electron main for scripts/meet-mock.mjs. Opens the fake Meet page offscreen,
// installs the Meet scripts through the DevTools protocol, runs the scenario
// step by step and prints one `REPORT {json}` line.

const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
const meet = require(path.join(__dirname, '..', 'apps', 'crew', 'src', 'main', 'meet-scripts.cjs'));

const URL_ = process.env.MEET_MOCK_URL;
const ORIGIN = process.env.MEET_MOCK_ORIGIN;
const BOT = 'Scout (Fenna)';
const BINDING = '__fennaMeetListen';
const OVERALL_MS = 75000;
const STEP_MS = 30000;
const FRAME_COUNT = 5;
const CHAT_TEXT = 'Hi, I\'m Scout. The deadline is Friday.';

const report = { ok: false, steps: [], states: [], captions: [], chats: [], sent: [], frames: 0, events: [] };
const captionLatest = new Map();
const chatEvents = [];
let dbg = null;
let isoContextId = null;
let finished = false;

function send(method, params) {
  return dbg.sendCommand(method, params || {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeException(details) {
  return (details.exception && details.exception.description) || details.text || 'page threw';
}

// Main-world JavaScript (no context: the page's own world).
async function evalMain(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(describeException(r.exceptionDetails));
  return r.result.value;
}

async function isolatedContext() {
  if (isoContextId === null) {
    const tree = await send('Page.getFrameTree');
    const world = await send('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'fenna-meet-act',
      grantUniversalAccess: true,
    });
    isoContextId = world.executionContextId;
  }
  return isoContextId;
}

// A Meet page function from meet-scripts.cjs, run in the acting world.
async function act(fn, arg) {
  const expression = `(${fn.toString()})(${JSON.stringify(arg || {})})`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const contextId = await isolatedContext();
    const r = await send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
    if (!r.exceptionDetails) return r.result.value;
    const text = describeException(r.exceptionDetails);
    if (attempt === 0 && /context/i.test(text)) {
      isoContextId = null;
      continue;
    }
    throw new Error(`${fn.name} threw: ${text}`);
  }
  throw new Error(`${fn.name}: no execution context`);
}

async function pollUntil(label, ms, check) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last.done) return last.value;
    await sleep(100);
  }
  throw new Error(`${label} not reached in ${ms} ms; last: ${JSON.stringify(last && last.value)}`);
}

async function pollState(target, ms) {
  return pollUntil(`state ${target}`, ms, async () => {
    const s = await act(meet.meetState);
    if (report.states[report.states.length - 1] !== s.state) report.states.push(s.state);
    return { done: s.state === target, value: s };
  });
}

async function pollMain(label, ms, expression, want) {
  return pollUntil(label, ms, async () => {
    const v = await evalMain(expression);
    return { done: v === want, value: v };
  });
}

function jpegFrame(index) {
  const width = 640;
  const height = 360;
  const colors = [
    [0x20, 0x60, 0xc0],
    [0x30, 0xa0, 0x50],
    [0xc0, 0x60, 0x20],
    [0x80, 0x40, 0xc0],
    [0x40, 0x90, 0x90],
  ];
  const [r, g, b] = colors[index % colors.length];
  const buf = Buffer.alloc(width * height * 4);
  for (let p = 0; p < buf.length; p += 4) {
    buf[p] = b;
    buf[p + 1] = g;
    buf[p + 2] = r;
    buf[p + 3] = 255;
  }
  const image = nativeImage.createFromBitmap(buf, { width, height });
  return `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`;
}

function latestCaptions() {
  return [...captionLatest.values()].sort((a, b) => a.block - b.block);
}

function hasCaption(speaker, fragment) {
  return latestCaptions().some((c) => c.speaker === speaker && c.text.includes(fragment));
}

const steps = [
  {
    name: 'prejoin',
    run: async () => {
      await pollState('prejoin', STEP_MS);
      // A name set from script leaves Ask to join disabled, as on Meet.
      const untyped = await act(meet.meetPrejoin, { name: BOT });
      if (untyped.clicked !== null || !untyped.disabled) throw new Error(`expected a disabled join button before typing, got ${JSON.stringify(untyped)}`);
      const f = await act(meet.meetNameFocus);
      if (!f.found || !f.focused) throw new Error(`name field not focused: ${JSON.stringify(f)}`);
      await send('Input.insertText', { text: BOT });
      const r = await act(meet.meetPrejoin, { name: BOT });
      if (r.clicked !== 'ask') throw new Error(`expected clicked "ask", got ${JSON.stringify(r)}`);
      return r;
    },
  },
  {
    name: 'admitted',
    run: async () => {
      await pollState('incall', STEP_MS);
      if (!report.states.includes('waiting')) {
        throw new Error(`waiting never seen; states ${JSON.stringify(report.states)}`);
      }
      return { states: report.states };
    },
  },
  {
    name: 'self-camera',
    run: async () => {
      const value = await pollUntil('self-camera event', 10000, async () => {
        const events = await evalMain('window.__fakeMeet.events');
        const hit = events.find((e) => e.startsWith('self-camera-'));
        return { done: Boolean(hit), value: hit };
      });
      if (value !== 'self-camera-ok') throw new Error(`got ${value}`);
      return value;
    },
  },
  {
    name: 'captions-on',
    run: async () => {
      const r = await act(meet.meetCaptionsOn);
      if (r.on !== true) throw new Error(`expected on true, got ${JSON.stringify(r)}`);
      return r;
    },
  },
  {
    name: 'standup-captions-and-chat',
    run: async () => {
      await pollMain('scriptDone', STEP_MS, 'window.__fakeMeet.scriptDone', true);
      await sleep(2000);
      const missing = [];
      if (!hasCaption('Sam', 'Morning everyone, quick standup today')) missing.push('Sam morning line');
      if (!hasCaption('Priya', 'login page')) missing.push('Priya login line');
      if (!hasCaption('Sam', 'share your screen')) missing.push('Sam action items line');
      if (!chatEvents.some((c) => c.sender === 'Priya' && c.text.includes('deadline'))) missing.push('Priya chat deadline');
      if (missing.length) {
        throw new Error(`missing ${missing.join(', ')}; captions ${JSON.stringify(latestCaptions())}; chats ${JSON.stringify(chatEvents)}`);
      }
      return { captions: latestCaptions().length, chats: chatEvents.length };
    },
  },
  {
    name: 'chat-send',
    run: async () => {
      const focused = await act(meet.meetChatFocus);
      if (!focused.ok) throw new Error(`meetChatFocus returned ${JSON.stringify(focused)}`);
      await send('Input.insertText', { text: CHAT_TEXT });
      const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...enter });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
      await pollUntil('sent', 5000, async () => {
        const sent = await evalMain('window.__fakeMeet.sent');
        return { done: sent.includes(CHAT_TEXT), value: sent };
      });
      await sleep(500);
      const youChats = chatEvents.filter((c) => c.sender === 'You').length;
      return { youChats };
    },
  },
  {
    name: 'present',
    run: async () => {
      const r = await act(meet.meetPresent);
      if (!r.clicked) throw new Error('Share screen not clicked');
      await pollMain('stage active', 10000, 'window.__fennaStage.active()', true);
      for (let i = 0; i < FRAME_COUNT; i++) {
        await evalMain(`window.__fennaStage.draw(${JSON.stringify(jpegFrame(i))})`);
        await sleep(300);
      }
      const frames = await pollUntil('frames', 5000, async () => {
        const n = await evalMain('window.__fakeMeet.frames');
        return { done: n > 0, value: n };
      });
      return { frames };
    },
  },
  {
    name: 'stop-presenting',
    run: async () => {
      const r = await act(meet.meetStopPresenting);
      if (!r.clicked) throw new Error('Stop presenting not clicked');
      await pollMain('stage inactive', 5000, 'window.__fennaStage.active()', false);
      return r;
    },
  },
  {
    name: 'leave',
    run: async () => {
      const r = await act(meet.meetLeave);
      if (!r.clicked) throw new Error('Leave call not clicked');
      await pollState('ended', 10000);
      return r;
    },
  },
];

async function runSteps() {
  for (const step of steps) {
    try {
      const detail = await step.run();
      report.steps.push({ name: step.name, ok: true, detail });
    } catch (err) {
      report.steps.push({ name: step.name, ok: false, detail: err.message });
      return false;
    }
  }
  return true;
}

function finish(extra) {
  if (finished) return;
  finished = true;
  const final = { ...report, ...extra };
  final.captions = latestCaptions();
  final.chats = chatEvents;
  final.ok = Boolean(extra && extra.ok) && final.steps.length === steps.length && final.steps.every((s) => s.ok);
  process.stdout.write(`REPORT ${JSON.stringify(final)}\n`);
  app.exit(final.ok ? 0 : 1);
}

async function readFinalState() {
  const fake = await evalMain('window.__fakeMeet');
  report.events = fake.events;
  report.sent = fake.sent;
  report.frames = fake.frames;
}

async function setup(win) {
  dbg = win.webContents.debugger;
  dbg.attach('1.3');
  dbg.on('message', (_event, method, params) => {
    if (method === 'Runtime.bindingCalled' && params.name === BINDING) {
      let ev;
      try {
        ev = JSON.parse(params.payload);
      } catch (err) {
        return;
      }
      if (ev.kind === 'caption') {
        captionLatest.set(ev.block, { block: ev.block, speaker: ev.speaker, text: ev.text });
      } else if (ev.kind === 'chat') {
        chatEvents.push(ev);
      }
    } else if (method === 'Runtime.executionContextDestroyed' && params.executionContextId === isoContextId) {
      isoContextId = null;
    } else if (method === 'Runtime.executionContextsCleared') {
      isoContextId = null;
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Runtime.addBinding', { name: BINDING, executionContextName: 'fenna-meet' });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: meet.meetMediaSource({ hosts: [ORIGIN], name: BOT }),
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: meet.meetListenSource({ binding: BINDING }),
    worldName: 'fenna-meet',
  });
}

app.whenReady().then(async () => {
  const overall = setTimeout(() => finish({ ok: false, error: `overall timeout ${OVERALL_MS} ms` }), OVERALL_MS);
  try {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { offscreen: true, contextIsolation: true, sandbox: true },
    });
    await win.loadURL('about:blank');
    await setup(win);
    await win.loadURL(URL_);
    const ok = await runSteps();
    await readFinalState();
    clearTimeout(overall);
    finish({ ok });
  } catch (err) {
    clearTimeout(overall);
    finish({ ok: false, error: err.message });
  }
});
