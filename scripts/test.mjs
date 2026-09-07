import { build } from 'esbuild';
import { spawn } from 'node:child_process';

await build({
  entryPoints: ['tests/room.test.ts'],
  outfile: '.artifacts/room.test.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const child = spawn(process.execPath, ['--test', '.artifacts/room.test.cjs'], {
  stdio: 'inherit',
});
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
