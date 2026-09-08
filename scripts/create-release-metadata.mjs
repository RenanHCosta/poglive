import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildBlockMap,
} = require('app-builder-lib/out/targets/blockmap/blockmap.js');

const version = process.argv[2];
const directory = resolve(process.argv[3] ?? 'release');
if (!version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('Informe uma versao estavel, como 1.2.3.');

const installer = resolve(directory, `Poglive-${version}-win-x64-setup.exe`);
const portable = resolve(directory, `Poglive-${version}-win-x64-portable.exe`);
const blockmap = `${installer}.blockmap`;
await rm(blockmap, { force: true });
const updateInfo = await buildBlockMap(installer, 'gzip', blockmap);
const installerSize = (await stat(installer)).size;
const installerName = basename(installer);
const latest = [
  `version: ${version}`,
  'files:',
  `  - url: ${installerName}`,
  `    sha512: ${updateInfo.sha512}`,
  `    size: ${installerSize}`,
  `path: ${installerName}`,
  `sha512: ${updateInfo.sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');
await writeFile(resolve(directory, 'latest.yml'), latest, 'utf8');

const checksums = [];
for (const file of [installer, portable]) {
  const digest = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  checksums.push(`${digest}  ${basename(file)}`);
}
await writeFile(
  resolve(directory, `Poglive-${version}-SHA256.txt`),
  `${checksums.join('\n')}\n`,
  'utf8',
);
