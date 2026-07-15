import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';

const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];

const targets = {
  setup: {
    entryPoints: ['src/setup/authorize.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'calendar.widget/lib/authorize.js',
    banner: { js: '#!/usr/bin/env node' },
  },
  cli: {
    entryPoints: ['src/cli/fetch-events.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'calendar.widget/lib/fetch-events.js',
    banner: { js: '#!/usr/bin/env node' },
  },
  widget: {
    entryPoints: ['src/widget/index.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    jsx: 'preserve',
    external: ['uebersicht'],
    outfile: 'calendar.widget/index.jsx',
    // The output is genuine CommonJS (Übersicht's own browserify pass
    // `require()`s it as such — see architecture note §0 fact #2). The
    // "module" global warning below is a false positive caused by the
    // root package.json's "type": "module" leaking into esbuild's static
    // analysis of the *input* file's package scope; it doesn't reflect
    // how the *output* file is actually loaded (calendar.widget/ has its
    // own package.json with "type": "commonjs").
    logOverride: { 'commonjs-variable-in-esm': 'silent' },
  },
};

const selected = only ? [only] : Object.keys(targets);

for (const name of selected) {
  const config = targets[name];
  if (!config) {
    console.error(`Unknown build target: ${name}`);
    process.exitCode = 1;
    continue;
  }
  const entry = config.entryPoints[0];
  if (!existsSync(entry)) {
    console.log(`Skipping "${name}" build — ${entry} does not exist yet.`);
    continue;
  }
  await esbuild.build(config);
  console.log(`Built "${name}" -> ${config.outfile}`);
}
