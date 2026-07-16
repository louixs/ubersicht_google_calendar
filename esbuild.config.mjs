import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';

const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];

const hasSharedClient = Boolean(
  process.env.UBERSICHT_GCAL_CLIENT_ID && process.env.UBERSICHT_GCAL_CLIENT_SECRET,
);

const targets = {
  setup: {
    entryPoints: ['src/setup/authorize.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: 'calendar.widget/lib/authorize.js',
    banner: { js: '#!/usr/bin/env node' },
    // Inlines the maintainer's local shell env at build time (or an empty
    // string if unset, e.g. in dev builds before a shared client exists).
    // Only the setup/authorize bundle needs this: it's the only place a
    // baked-in shared client can be used, and only to seed config.json
    // during `pnpm run auth`. The cli/widget bundles read credentials from
    // config.json only (resolveClientCredentials() in cli/config.ts) and
    // have no dependency on this define block at all.
    define: {
      'process.env.UBERSICHT_GCAL_CLIENT_ID': JSON.stringify(
        process.env.UBERSICHT_GCAL_CLIENT_ID ?? '',
      ),
      'process.env.UBERSICHT_GCAL_CLIENT_SECRET': JSON.stringify(
        process.env.UBERSICHT_GCAL_CLIENT_SECRET ?? '',
      ),
    },
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

if (selected.includes('setup')) {
  console.log(
    hasSharedClient
      ? 'Baked-in OAuth client: YES (shared client will be used; users are not prompted)'
      : 'Baked-in OAuth client: NO (bring-your-own-client; users will be prompted on first auth)',
  );
}

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
