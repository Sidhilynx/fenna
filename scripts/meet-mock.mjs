// Runs the Crew Meet scripts against the fake Meet page in Electron, offscreen.
//
//   node scripts/meet-mock.mjs
//
// Serves apps/crew/test/fixtures/fake-meet on 127.0.0.1, starts Electron with
// scripts/meet-mock-main.cjs, and passes its output through. The child prints
// one `REPORT {json}` line; this process exits with the child's code (0 only
// when every step held). Killed after 90 s.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const fixtureDir = path.join(repo, 'apps', 'crew', 'test', 'fixtures', 'fake-meet');
const mainScript = path.join(here, 'meet-mock-main.cjs');
const electronExe = createRequire(path.join(repo, 'apps', 'crew', 'package.json'))('electron');
const TIMEOUT_MS = 90000;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  const file = path.join(fixtureDir, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(fixtureDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const env = { ...process.env, MEET_MOCK_URL: `${origin}/index.html?guest=1&admit=1500&script=standup`, MEET_MOCK_ORIGIN: origin };
delete env.ELECTRON_RUN_AS_NODE;
const userData = path.join(os.tmpdir(), `fenna-meet-mock-${process.pid}`);

const child = spawn(electronExe, [mainScript, `--user-data-dir=${userData}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

let killed = false;
const killTimer = setTimeout(() => {
  killed = true;
  process.stderr.write(`meet-mock: no result after ${TIMEOUT_MS / 1000} s; stopping Electron\n`);
  child.kill();
}, TIMEOUT_MS);

child.on('close', (code) => {
  clearTimeout(killTimer);
  server.close();
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch (err) {
    process.stderr.write(`meet-mock: could not remove ${userData}: ${err.message}\n`);
  }
  if (killed) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code === 0 ? 0 : 1;
});
