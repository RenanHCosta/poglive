import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import electron from 'electron';
import { buildDesktop } from './build.mjs';

await buildDesktop();
const nonce = randomBytes(24).toString('base64');
const server = await createServer({ html: { cspNonce: nonce } });
await server.listen();
const env = {
  ...process.env,
  VOICE_SHARE_DEV: '1',
  VOICE_SHARE_CSP_NONCE: nonce,
};
delete env.ELECTRON_RUN_AS_NODE;
const args = process.argv.includes('--smoke-test')
  ? ['.', '--smoke-test']
  : ['.'];
const profile = process.argv.find((arg) => arg.startsWith('--profile='));
if (profile) args.push(profile);
const child = spawn(electron, args, { stdio: 'inherit', env });
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exitCode = code;
}
child.once('exit', (code) => {
  void close(code ?? 1);
});
server.watcher.on('error', () => {
  console.error('[App] File watcher failed. Feche e execute novamente.');
  void close(1);
});
child.once('error', (error) => {
  console.error('[App] Não foi possível abrir o Electron:', error.message);
  void close(1);
});
process.once('SIGINT', () => {
  void close(0);
});
process.once('SIGTERM', () => {
  void close(0);
});
console.info('[App] Development ready. Reinicie após alterar main/preload.');
