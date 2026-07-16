# Scoping: shared OAuth client (skip per-user Google Cloud Console setup)

Status: scoping only — no implementation yet. This is the "dedicated pass"
plan referenced from the OAuth security discussion; implement as its own
branch/PR, not bundled with unrelated changes.

## Goal

A non-technical user should go from `pnpm install` to seeing real calendar
events without ever visiting Google Cloud Console. Today they must: create
a GCP project, enable the Calendar API, configure an OAuth consent screen,
create a Desktop-app OAuth client, and copy a client ID/secret into a
terminal prompt. That's the barrier this plan removes.

## Why this is safe (not just easy)

Google's own docs for "installed application" OAuth clients (RFC 8252)
state the client secret for this client type is **not confidential** —
these are public clients by design. Security comes from the loopback
redirect (`http://127.0.0.1:<port>`) plus (after this change) PKCE, not
from keeping the secret hidden. Tools like `rclone` and `gcloud` ship one
baked-in client ID/secret for exactly this reason. This is not a novel
risk we'd be introducing — it's the documented, standard shape for a
CLI/desktop tool talking to Google APIs.

What does *not* change: each user's own **token** (`token.json`,
0600/0700 per current `config.ts`) stays local and per-user. Only the
client ID/secret — which identifies the *application*, not the *user* —
becomes shared.

## Current flow (baseline, for comparison)

`src/setup/authorize.ts`:
- `loadOrCreateBaseConfig()` (lines 48-66) prompts for `clientId` +
  `clientSecret` via `promptForClientCredentials()` (lines 17-29) and
  writes them into `~/.config/ubersicht-google-calendar/config.json`.
- `main()` (lines 115-160) builds an `OAuth2Client` from that config,
  runs a loopback consent flow, exchanges the code for tokens, no PKCE.
- README "Setup" step 1 (18-31) walks the user through GCP Console.

Manual steps required today: **5** (GCP project, enable API, consent
screen, create credentials, copy-paste ID/secret) before the interactive
prompt even starts.

## Proposed flow

1. **Bake a maintainer-owned client ID/secret into the build**, not into
   user-facing prompts:
   - New source: `src/setup/shared-client.ts` exporting `SHARED_CLIENT_ID`
     / `SHARED_CLIENT_SECRET`, populated via `esbuild.config.mjs`'s
     `define` at build time from env vars
     (`UBERSICHT_GCAL_CLIENT_ID`/`_SECRET`) that only the maintainer sets
     locally when cutting a release/zip. Values are **not** committed in
     plaintext to git (keep them out of the repo the same way secrets are
     kept out today — see `.gitignore`), but they **do** end up embedded
     in the distributed `calendar.widget/lib/authorize.js` bundle. That's
     expected and fine per the "not confidential" point above.
   - `Config` (`src/cli/types.ts`) drops `clientId`/`clientSecret` as
     *required* fields; they become optional overrides.
2. **`loadOrCreateBaseConfig()` no longer prompts for credentials.** It
   uses `SHARED_CLIENT_ID`/`SHARED_CLIENT_SECRET` unless the user's
   existing `config.json` already has its own (back-compat: anyone who
   already ran the old flow keeps working, untouched, forever — no
   migration needed, just a fallback check).
3. **Add PKCE** to `runLoopbackFlow`/`main()` (`authorize.ts` 73-160):
   generate a `code_verifier`/`code_challenge` pair
   (`google-auth-library` supports this;
   `oAuth2Client.generateCodeVerifierAsync()`), pass `code_challenge` in
   `generateAuthUrl`, pass `code_verifier` in `getToken`. Defense in
   depth now that the client secret is shared across all installs.
4. **README rewrite**: delete "1. Get a Google OAuth client ID/secret"
   entirely. Setup becomes: install → `pnpm run auth` (browser consent,
   nothing to paste) → `pnpm run install-widget`. Keep a new
   "Advanced: use your own OAuth client" appendix documenting the old
   flow (env vars to override `SHARED_CLIENT_ID`), for people who want
   isolated API quota or don't want to trust the maintainer's shared app.
5. **Google Cloud Console work (maintainer-side, one-time, not code)**:
   - Register one OAuth consent screen for this project.
   - Scope requested: `calendar.readonly` — Google classifies this as a
     **sensitive scope**. In "Testing" mode it's capped at 100 explicitly
     -listed test users; going wider requires **Google's verification
     review** (their turnaround has historically run 2-6+ weeks, may
     require a privacy policy URL and a demo video). Scope this
     verification lead time into the dedicated pass's timeline — it's
     the single biggest unknown, not the code change.
   - Single shared project also means a single shared Calendar API quota
     across every user of the widget. Low risk at current adoption
     (personal widget, small user base) but worth a one-line note in
     README so a future maintainer isn't surprised.

## Files touched (implementation pass)

- `src/setup/authorize.ts` — remove credential prompt, add PKCE
- `src/setup/shared-client.ts` — new, build-time-injected constants
- `src/cli/types.ts` — `clientId`/`clientSecret` become optional in
  `ConfigSchema`
- `src/cli/config.ts` / `src/cli/auth.ts` — resolve effective
  clientId/secret (user override → shared default)
- `esbuild.config.mjs` — `define` injection for the setup bundle
- `README.md` — rewrite Setup section, add "bring your own client"
  appendix
- `test/` — new coverage for the override-fallback logic in config
  resolution (pure function, easy to unit test without touching OAuth)

## Rollback / opt-out path

Kept permanently, not just during migration: setting
`UBERSICHT_GCAL_CLIENT_ID`/`UBERSICHT_GCAL_CLIENT_SECRET` env vars (or
manually editing `config.json`) always overrides the shared client. No
one is forced onto the shared app.

## Non-goals for this pass

- No change to token storage/permissions (already 0600/0700, already fine).
- No OS keychain integration (separate, larger scoping question if we
  ever want it — plaintext `config.json` is unaffected by this change
  either way, since it never held anything more sensitive than a
  non-confidential client ID after this change).
- No change to the `calendar.readonly` scope itself.

## Measurement

This is a solo-maintainer, no-CI, local-desktop-widget project — there's
no server/pipeline to wire an automatic regression check into, so treat
the following as a manual gate the dedicated pass must pass before
merging, not an automated one:

- **Metric**: number of manual steps + elapsed wall-clock time for a
  fresh (no prior GCP project) user to go from `pnpm install` to a
  rendering widget with real events.
- **Baseline (today, recorded before this change)**: 5 manual GCP-console
  steps + terminal copy/paste; realistically 10-15 minutes for someone
  who's never used GCP console.
- **Target (after this change)**: 0 GCP-console steps; `pnpm run auth`
  → browser click "Allow" → done. Re-time the same walkthrough after
  implementation and record the new number in this doc.
- **Regression check**: manual — re-run the timed walkthrough whenever
  `authorize.ts` or the README Setup section changes; if GCP-console
  steps creep back in for the common case, that's a regression.
- **Cadence**: once at merge time, then re-check opportunistically on
  any future change to `src/setup/` or Google's own OAuth verification
  requirements (they change these periodically).
