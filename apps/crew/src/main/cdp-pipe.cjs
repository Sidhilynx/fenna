// The DevTools protocol over Chrome's remote-debugging pipe (chrome.cjs).
// Chrome reads commands from fd 3 and writes replies and events to fd 4; each
// message is one JSON object ended by a NUL byte, both ways. This file frames
// those messages, pairs each reply with the send that asked for it, and hands
// events to listeners. It knows nothing about pages or Google.

const { StringDecoder } = require("node:string_decoder");

/**
 * A DevTools connection over a pair of streams.
 *
 * @param {NodeJS.WritableStream} out the stream Chrome reads (child stdio 3)
 * @param {NodeJS.ReadableStream} inn the stream Chrome writes (child stdio 4)
 * @returns {{
 *   send: (method: string, params?: object, sessionId?: string) => Promise<any>,
 *   on: (fn: (event: { method: string, params: any, sessionId?: string }) => void) => () => void,
 *   closed: Promise<void>,
 *   close: () => void,
 * }}
 */
function createPipeConnection(out, inn) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let gone = false;
  let ended = false;
  let markClosed;
  const closed = new Promise((resolve) => {
    markClosed = resolve;
  });

  // Chrome is gone: nothing more can arrive, so every waiting send fails.
  function finish() {
    if (gone) return;
    gone = true;
    for (const call of pending.values()) call.reject(new Error("Chrome closed."));
    pending.clear();
    markClosed();
  }

  function handle(frame) {
    let msg;
    try {
      msg = JSON.parse(frame);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.id === undefined) {
      const event = { method: msg.method, params: msg.params, sessionId: msg.sessionId };
      for (const fn of [...listeners]) {
        // One listener that throws must not keep the others from hearing the event.
        try {
          fn(event);
        } catch {}
      }
      return;
    }
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
    else call.resolve(msg.result);
  }

  // A chunk can end inside a message or inside a UTF-8 character, so keep
  // what is left over until the next chunk completes it.
  function onData(chunk) {
    buffer += decoder.write(chunk);
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      handle(frame);
    }
  }

  inn.on("data", onData);
  inn.on("end", finish);
  inn.on("error", finish);
  inn.on("close", finish);
  // A write that fails (Chrome exited) must not crash the app; the close shows up through `closed`.
  out.on("error", finish);

  function send(method, params = {}, sessionId = undefined) {
    if (gone) return Promise.reject(new Error("Chrome closed."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      const message = { id, method, params };
      if (sessionId !== undefined) message.sessionId = sessionId;
      out.write(JSON.stringify(message) + "\0");
    });
  }

  function on(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  function close() {
    // Stop reading first, so no reply lands after the pending sends are failed.
    inn.removeListener("data", onData);
    finish();
    if (!ended) {
      ended = true;
      out.end();
    }
  }

  return { send, on, closed, close };
}

module.exports = { createPipeConnection };
