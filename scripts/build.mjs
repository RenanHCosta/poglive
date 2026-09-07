import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';

export async function buildDesktop() {
  await bundle({
    entryPoints: {
      'main/index': 'src/main/index.ts',
      'preload/index': 'src/preload/index.ts',
    },
    outdir: 'dist',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: true,
  });
}

if (process.argv[1]?.endsWith('build.mjs')) {
  await buildDesktop();
  await buildRenderer();
}
