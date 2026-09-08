import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag))
  throw new Error('A release precisa de uma tag estavel no formato v1.2.3.');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (tag !== `v${packageJson.version}`)
  throw new Error(
    `A tag ${tag} nao corresponde a package.json (${packageJson.version}).`,
  );
process.stdout.write(`${packageJson.version}\n`);
