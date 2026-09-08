import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const resources = resolve(process.argv[2] ?? 'release/win-unpacked/resources');
await mkdir(resources, { recursive: true });
const configuration = [
  'owner: RenanHCosta',
  'repo: poglive',
  'provider: github',
  'releaseType: release',
  'updaterCacheDirName: poglive-updater',
  'publisherName:',
  '  - SignPath Foundation',
  '',
].join('\n');
await writeFile(resolve(resources, 'app-update.yml'), configuration, 'utf8');
