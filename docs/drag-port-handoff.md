# Handoff: drag/reposition port (unfinished)

Written 2026-07-16. Branch `fix-issues`. Auth work is committed (`8d90e1a`);
everything described below is **uncommitted working-tree state**.

## Goal

Port the drag/reposition feature from `~/src/js/tsushin` into this widget, so
the calendar can be dragged around the desktop and the position persists.

Decision already made (don't relitigate): **copy the code, don't build a shared
library.** Both projects are standalone Übersicht widgets, there's no monorepo
or workspace anywhere in `~/src/js/`, and the source is ~139 dependency-free
lines. Extract at the third consumer, when the real seam is known.

## Status

The port itself is **done**. The blocker is filesystem access from the
widget's webview. Current state is **untested** — the most recent build has not
been installed or exercised in Übersicht.

Uncommitted files:

| File | What |
|---|---|
| `src/widget/draggable.ts` | new — ported `attachDragHandle`, `pxToPercent`, `clampPercent` |
| `src/widget/position.ts` | new — `getPositionPath()`, `loadPosition()` (never throws) |
| `src/widget/index.tsx` | modified — drag wiring, ESM exports (+ a pre-existing `$PWD` cwd fix unrelated to drag) |
| `test/draggable.test.ts` | new — px→percent, clamping |
| `test/position.test.ts` | new — missing / malformed / valid position file |
| `esbuild.config.mjs` | modified — widget target `platform: 'neutral'`, `format: 'esm'`, externals |

37 tests pass, typecheck is clean, the build succeeds. None of that exercises
the runtime, which is where the problem lives.

## The core problem

The widget has **two execution contexts**, and this matters more than anything
else in this document:

1. `calendar.widget/lib/fetch-events.js` — a real Node process, spawned by
   Übersicht via the widget's `command`. Has genuine `fs`. Reads config.json
   this way today and always has.
2. `calendar.widget/index.jsx` — runs in Übersicht's Electron **webview**,
   which passes the code through its own babel/browserify re-bundle pass.

Position persistence was implemented in context (2). Getting real `fs` there is
the entire fight. Nothing about the drag maths or the React wiring is in doubt.

## Error sequence (each fix exposed the next bug)

**1. `Can't walk dependency graph: Cannot find module 'node:fs'`**

Übersicht's dependency walker predates the `node:` protocol. Fixed by importing
builtins bare (`from 'fs'`, not `from 'node:fs'`) and setting
`external: ['uebersicht', 'fs', 'path', 'os']`. This was a real bug, but
fixing it only revealed:

**2. `TypeError: (0, import_fs2.existsSync) is not a function`**

`require("fs")` resolves to browserify's **empty `fs` stub**. Root cause:
esbuild's `format: 'cjs'` transpiled the ESM `import` into `require("fs")`
*before* Übersicht's babel pass ever saw it. Übersicht resolves an ESM
`import ... from "fs"` to the real builtin; it does **not** do so for a bare
`require("fs")`.

**3. Current, untested state**

Widget target switched to `platform: 'neutral'` + `format: 'esm'`, and
`src/widget/index.tsx` converted from `module.exports = {...}` to ESM
`export {...}` — mandatory, since `module` doesn't exist in ESM output.

The emitted bundle now has ESM `import { existsSync, readFileSync } from "fs"`
and ESM `export { className, command, initialState, refreshFrequency, render,
updateState }`, with zero `require(` or `module.exports`. That matches
tsushin's working shape. **Whether it actually works is unknown — start here.**

## Known-good reference: tsushin

`tsushin.widget` **provably works**. Its `config.json` was written at
2026-07-16 18:30:45 by a live drag, confirming Übersicht does hand widgets real
Node `fs`. Do not theorise about whether it's possible — it demonstrably is.

Differences from this project:

| | tsushin (works) | here (broken) |
|---|---|---|
| Build | **no esbuild bundling at all** — tsc emits, Übersicht bundles | single esbuild-bundled `index.jsx` |
| Files | separate unbundled modules (`src/draggable.js`) | everything inlined into one file |
| Widget dir `package.json` | **none** | `{"type": "commonjs"}` |
| fs import | `import { writeFileSync } from "fs"` at line 1 | was `require("fs")`, now ESM |

## Leads not ruled out

1. **`calendar.widget/package.json` containing `{"type":"commonjs"}`** while
   `index.jsx` is now ESM. tsushin has no package.json at all. This could make
   Übersicht/babel treat the bundle as CJS and undo the fix. **It cannot simply
   be deleted** — it exists to stop the root `package.json`'s `"type": "module"`
   from breaking `lib/fetch-events.js` and `lib/authorize.js`, which are
   genuinely CJS Node scripts (`format: 'cjs'`, `#!/usr/bin/env node` banner).
   Check whether Übersicht's `.jsx` handling consults it at all.
2. **Stop bundling the widget entirely** — mirror tsushin (tsc emit, separate
   files, no esbuild widget target). Bigger change, but it's the configuration
   that is known to work.
3. **Abandon `fs` in the webview.** Use `run()` from the `uebersicht` module to
   shell out for read/write, or fold the position read into the existing
   `command` output the way calendar events already flow. Sanctioned API,
   sidesteps the whole class of problem. This was nearly pursued before the
   module-format cause was found — it remains the safest fallback.

## Design constraints to preserve

- **Position persists to `~/.config/ubersicht-google-calendar/position.json`**,
  NOT inside the widget dir. `install-widget` does
  `rm -rf ".../widgets/calendar.widget"` on every install, which would destroy
  it. (tsushin has this latent bug — it stores position in its widget dir — but
  has no reinstall step to trigger it.)
- **position.json is deliberately separate from config.json.**
  `src/setup/authorize.ts` merges-and-rewrites config.json wholesale, so a drag
  write landing there would race with / be clobbered by an auth run. It also
  keeps transient UI state out of the validated config schema.
- **`src/widget/position.ts` must not import from `src/cli/config.ts`** — that
  would drag zod and the config schema into the webview bundle.
- **A malformed position file must never break the widget.** `loadPosition()`
  returns `null` on missing/malformed/wrong-shape and the caller falls back to
  `DEFAULT_POSITION`.
- Position is read **once at module load**, not per render — Übersicht keeps the
  module resident across `refreshFrequency` ticks.

## What the previous agent got wrong (so you don't repeat it)

- **Asserted twice that Übersicht resolves externalised builtins to real Node at
  runtime.** It resolves ESM `import`; it does not resolve `require`. Both fixes
  built on that claim sounded correct and were wrong. The lesson: this
  environment's behaviour was only ever settled by *looking at the working
  reference* (tsushin's installed files), never by reasoning about what
  browserify/esbuild "should" do. Do that first.
- **Read a changed error message as progress toward a working design** rather
  than as evidence the design was unsound. Two genuine defects were stacked; the
  first fix was real but only unmasked the second.
- **A `logOverride: { 'commonjs-variable-in-esm': 'silent' }` on the widget
  target was suppressing a true warning**, with a comment confidently explaining
  why it was a false positive. It was correctly flagging `module.exports` in an
  ESM bundle. It has been removed with a note. Don't re-add it.
- This is the **second** confidently-wrong comment found in this file today. The
  other claimed the cli target didn't need the credential defines, which was the
  root cause of the bug fixed in `8d90e1a`. Treat comments in
  `esbuild.config.mjs` as unverified claims.

## Worth adding once it works

The widget target now carries real, undocumented-outside-comments constraints:
`format` must stay `esm`, and builtins must be imported bare. Both are exactly
the kind of thing a future "modernise the build" pass silently reverts. A
build-level test asserting the emitted bundle contains ESM `import ... from
"fs"` (and no `require("fs")`) would catch that, in the same spirit as the
credential-wiring test added in `8d90e1a`.

## Unrelated loose ends found along the way

None of these are triggered by the drag work; they're separate, real, and
currently untouched.

1. **No `state` parameter in the OAuth loopback flow**
   (`src/setup/authorize.ts`). No CSRF token is generated or validated, so any
   callback reaching the loopback port is accepted — including one from a stale
   consent tab belonging to a different client. Low severity, genuine gap.
2. **TOCTOU port race** in `main()`: it binds port 0 to let the OS pick a free
   port, **closes that server**, then hands the number to `runLoopbackFlow()`
   which binds a *new* server to it. Anything can take the port in between.
3. **One unexplained `invalid_client`.** A single `pnpm run auth:release` run
   failed at token exchange; an immediate retry with identical credentials and
   nothing changed succeeded. Investigated properly and **not solved** — the
   stale-tab theory was killed (machine had been restarted), the config.json
   precedence theory was killed (config had no clientId; both runs used the
   baked-in tier), and the credential-propagation-delay theory was falsified by
   a direct test (freshly rotated credentials worked immediately). No mechanism
   currently fits. Logged as a one-off; if it recurs there's a second data point.
   Do not attach it to whichever story sounds tidiest.

## Security note

An earlier exploration agent leaked the OAuth client ID and secret into a
transcript by reading them out of the built bundle at `calendar.widget/lib/`
(the instruction it was given only forbade `.env.local` and `config.json`). The
secret was rotated the same day. **Treat `calendar.widget/lib/*.js` and
`calendar.widget/index.jsx` as credential-bearing when a shared client is baked
in**, and say so explicitly in any agent instructions. Build output is
gitignored and no credential has ever been committed (verified with
`git log --all -S`).

