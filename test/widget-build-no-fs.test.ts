import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The widget runs in Übersicht's WKWebView, which maps `fs` (and every
// other Node builtin) to an EMPTY STUB — there is no real filesystem
// access there (see esbuild.config.mjs widget target comment; an earlier,
// abandoned attempt to use `fs` from this exact bundle — a drag/reposition
// port — ran into this and was replaced by the config.json-based
// `position` field documented in the README's "Widget position" section).
// Any `fs` import in the built widget bundle is either a hard failure or a
// silent no-op, so this asserts the invariant directly on freshly built
// output — in the same spirit as the credential-wiring checks around the
// cli/setup build targets — rather than trusting that no one re-introduces
// it.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = resolve(repoRoot, 'calendar.widget/index.jsx');

describe('widget build output — no fs access', () => {
  it('contains no import of fs in any form', () => {
    execFileSync('node', ['esbuild.config.mjs', '--only=widget'], { cwd: repoRoot, stdio: 'pipe' });

    const built = readFileSync(outfile, 'utf8');

    expect(built).not.toMatch(/require\(\s*["']fs["']\s*\)/);
    expect(built).not.toMatch(/from\s*["']fs["']/);
    expect(built).not.toMatch(/from\s*["']node:fs["']/);
    expect(built).not.toMatch(/require\(\s*["']node:fs["']\s*\)/);
  });
});
