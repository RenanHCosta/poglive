import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const entries = (await readdir('tests'))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`);
await build({
  entryPoints: entries,
  outdir: '.artifacts/tests',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const outputs = entries.map((entry) =>
  entry.replace(/^tests\//, '.artifacts/tests/').replace(/\.ts$/, '.cjs'),
);
const child = spawn(process.execPath, ['--test', ...outputs], {
  stdio: 'inherit',
});
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
