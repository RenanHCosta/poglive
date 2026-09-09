import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;

function execute(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture ? (result.stderr || result.stdout).trim() : '';
    throw new Error(
      `${command} ${args.join(' ')} falhou${details ? `: ${details}` : '.'}`,
    );
  }
  return capture ? result.stdout.trim() : '';
}

function optional(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function executeNpm(args) {
  if (!npmCli)
    throw new Error('Execute este script por meio de npm run release.');
  return execute(process.execPath, [npmCli, ...args]);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match)
    throw new Error(`Versão inválida: ${value}. Use uma versão estável 1.2.3.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(current, requested) {
  const version = parseVersion(current);
  if (requested === 'major') return `${version.major + 1}.0.0`;
  if (requested === 'minor') return `${version.major}.${version.minor + 1}.0`;
  if (requested === 'patch')
    return `${version.major}.${version.minor}.${version.patch + 1}`;
  parseVersion(requested);
  return requested;
}

if (process.platform !== 'win32')
  throw new Error('O executável do Poglive deve ser publicado no Windows.');

const requested = process.argv[2];
if (!requested)
  throw new Error(
    'Informe patch, minor, major ou uma versão. Exemplo: npm run release -- patch',
  );
if (!['patch', 'minor', 'major'].includes(requested)) parseVersion(requested);

const initialStatus = execute('git', ['status', '--porcelain'], true);
if (initialStatus)
  throw new Error(
    'A árvore Git precisa estar limpa antes de criar uma release.',
  );

const branch = execute('git', ['branch', '--show-current'], true);
if (!branch)
  throw new Error('Não é possível publicar a partir de detached HEAD.');
if (branch !== 'main')
  throw new Error(
    'Releases assinadas devem ser criadas a partir da branch main.',
  );

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const version = nextVersion(packageJson.version, requested);
const tag = `v${version}`;
if (optional('git', ['rev-parse', '--verify', '--quiet', tag]).status === 0)
  throw new Error(`A tag ${tag} já existe localmente.`);
const remoteTag = optional('git', [
  'ls-remote',
  '--exit-code',
  '--tags',
  'origin',
  `refs/tags/${tag}`,
]);
if (remoteTag.status === 0)
  throw new Error(`A tag ${tag} já existe no GitHub.`);
if (remoteTag.status !== 2)
  throw new Error(
    `Não foi possível consultar as tags no GitHub: ${remoteTag.stderr.trim()}`,
  );

console.log(`\nPreparando Poglive ${tag} a partir da branch ${branch}.\n`);
executeNpm(['version', version, '--no-git-tag-version']);
executeNpm(['run', 'check']);
executeNpm(['test']);

const unexpectedChanges = execute('git', ['diff', '--name-only'], true)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => file !== 'package.json' && file !== 'package-lock.json');
if (unexpectedChanges.length)
  throw new Error(
    `O build alterou arquivos inesperados: ${unexpectedChanges.join(', ')}`,
  );

execute('git', ['add', 'package.json', 'package-lock.json']);
execute('git', ['commit', '-m', `chore: release ${tag}`]);
execute('git', ['tag', '-a', tag, '-m', `Poglive ${tag}`]);
execute('git', ['push', '--atomic', 'origin', 'HEAD', `refs/tags/${tag}`]);

console.log(
  `\nTag ${tag} enviada. O GitHub Actions vai compilar e publicar conforme o modo de assinatura configurado no repositório.`,
);
