// Two-instance end-to-end test: room, chat, voice and screen share over real
// WebRTC on loopback. Requires `npm run build` first and a desktop session.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const directory = await mkdtemp(join(tmpdir(), 'poglive-e2e-'));
const keep = process.argv.includes('--keep');

function launch(role) {
  const child = spawn(
    electron,
    ['.', `--e2e=${role}`, `--e2e-dir=${directory}`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/))
      if (line.includes('[E2E')) console.log(`${role.padEnd(5)} │ ${line}`);
  });
  child.stderr.on('data', () => {});
  return new Promise((resolve) => child.once('exit', resolve));
}

const timeout = setTimeout(() => {
  console.error('E2E timed out');
  process.exit(1);
}, 150_000);
await Promise.all([launch('host'), launch('guest')]);
clearTimeout(timeout);

let failed = false;
for (const role of ['host', 'guest']) {
  try {
    const result = JSON.parse(
      await readFile(join(directory, `${role}.result.json`), 'utf8'),
    );
    console.log(
      `${role}: ${result.ok ? 'OK' : `FAILED (${result.error})`} · ${result.steps.join(' → ')}`,
    );
    if (!result.ok) failed = true;
  } catch {
    console.log(`${role}: no result`);
    failed = true;
  }
}
console.log(`Artifacts: ${directory}`);
if (!keep && !failed) await rm(directory, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
