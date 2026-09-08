import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(
  await readFile(join(root, 'package-lock.json'), 'utf8'),
);
const packages = Object.entries(lock.packages ?? {})
  .filter(([path, metadata]) => path && metadata.dev !== true)
  .sort(([left], [right]) => left.localeCompare(right));

const sections = [];
const mitFallback = (author) => `MIT License

Copyright (c) ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

for (const [packagePath] of packages) {
  const directory = join(root, packagePath);
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(directory, 'package.json'), 'utf8'),
    );
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
    throw error;
  }
  const files = await readdir(directory);
  const licenseFile = files.find((file) =>
    /^(licen[cs]e|copying|notice)(\..*)?$/i.test(file),
  );
  const declared =
    typeof manifest.license === 'string'
      ? manifest.license
      : JSON.stringify(manifest.licenses ?? 'not declared');
  let license;
  if (licenseFile)
    license = await readFile(join(directory, licenseFile), 'utf8');
  else if (declared === 'MIT' && typeof manifest.author === 'string')
    license = mitFallback(manifest.author);
  else
    throw new Error(
      `A dependencia ${manifest.name}@${manifest.version} nao inclui o texto da licenca.`,
    );
  sections.push(
    [
      `${manifest.name}@${manifest.version}`,
      `Declared license: ${declared}`,
      `Source package: ${basename(dirname(packagePath)) === 'node_modules' ? manifest.name : packagePath}`,
      '',
      license.trim(),
    ].join('\n'),
  );
}

const header = [
  'POGLIVE THIRD-PARTY SOFTWARE NOTICES',
  '',
  'Generated from package-lock.json and the packages installed by npm ci.',
  'Each component remains subject to its own license.',
  '',
].join('\n');
await writeFile(
  join(root, 'build', 'THIRD_PARTY_NOTICES.txt'),
  `${header}${sections.join('\n\n${' - '.repeat(78)}\n\n')}\n`,
  'utf8',
);
