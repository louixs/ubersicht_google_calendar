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
    platform: 'neutral',
    // MUST stay 'esm'. The widget runs inside Übersicht's WKWebView, which
    // Übersicht's server rebundles with browserify+babelify and maps `fs`
    // (and every other node builtin) to an EMPTY STUB — there is no real
    // filesystem access in this runtime, full stop. Widget code must never
    // import 'fs'/'path'/'os' (proven by the abandoned drag-reposition
    // port; see docs/handoff notes). Position now comes from config.json
    // via the CLI command's JSON output instead. 'esm' is kept here only
    // because it's the proven-working shape through Übersicht's pipeline —
    // emitting cjs would transpile the remaining `import 'uebersicht'` into
    // a `require()` before Übersicht's babel pass ever sees it.
    format: 'esm',
    jsx: 'preserve',
    // Left unbundled so the import statement survives to Übersicht's own
    // babel+browserify pass: 'uebersicht' is its runtime helper, injected
    // at widget-load time.
    external: ['uebersicht'],
    outfile: 'calendar.widget/index.jsx',
    // NOTE: a `logOverride` silencing 'commonjs-variable-in-esm' used to sit
    // here, on the claim that the warning was a false positive. It was not —
    // it was correctly flagging `module.exports` in an esm bundle, and
    // silencing it hid a real breakage. Don't re-add it.
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
