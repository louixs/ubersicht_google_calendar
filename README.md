# Google Calendar widget for Übersicht

Shows today's and tomorrow's events for one or more Google Calendars in
[Übersicht](http://tracesof.net/uebersicht/), sorted by real start time and
formatted in your calendar's own timezone.

![Google Calendar](screenshot.png "Google Calendar")

This is a TypeScript rewrite of the original CoffeeScript widget. It replaces
the old shell-script pipeline (`curl` + hand-rolled JSON parsing + `sed`/`awk`
timezone arithmetic + a dead "out of band" OAuth flow) with a typed Node CLI
that uses Google's official API client, a loopback OAuth flow, and a small
`.jsx` render layer that Übersicht bundles itself. See "How it works" below
if you're curious about the architecture; otherwise skip to Setup.

## Setup

### 1. Install dependencies

```sh
pnpm install
```

`pnpm install` also runs `pnpm run build` automatically (via `postinstall`),
producing the compiled widget files described in "How it works" below.

### 2. Create your own Google OAuth client (one-time)

This widget is **not** going through Google's app-verification process, so
there's no shared, ready-to-use client — every user registers their own
free Google Cloud OAuth client and points the widget at it. It takes about
five minutes and it's free:

1. Go to https://console.cloud.google.com and create (or pick) a project.
2. Under **APIs & Services > Library**, enable the **Google Calendar API**.
3. Under **APIs & Services > OAuth consent screen**, choose user type
   **External** and fill in the required fields (app name, your email as
   support/developer contact — these are just labels, nobody else sees
   this app).
4. Under **Data Access** (or **Scopes**), add the
   `.../auth/calendar.readonly` scope.
5. **Publish the app** (there's a "Publish App" button on the consent
   screen's summary page). **This step is mandatory, not optional:** a
   consent screen left in **Testing** mode caps refresh tokens at 7 days,
   so the widget will silently stop working every week and you'll have to
   re-run `pnpm run auth` on a timer to keep it alive. Publishing removes
   that expiry. Since this app has no sensitive/restricted scopes beyond
   `calendar.readonly` and you're the only user, publishing does **not**
   require Google's verification review — it's a self-service toggle.
6. Under **APIs & Services > Credentials**, create an **OAuth client ID**
   of type **Desktop app**. Give it any name you like.
7. Copy the generated **Client ID** and **Client secret** — you'll paste
   both into `pnpm run auth` in a moment.

**About the "Google hasn't verified this app" warning:** the first time
you authorize, Google will show this warning because your app hasn't gone
through Google's (lengthy, unnecessary-for-personal-use) verification
review. This is expected — you're both the developer and the only user of
your own client. Click **Advanced**, then **Go to \<your app name\>
(unsafe)**, then **Allow**. "Unsafe" here just means "unverified," not
that anything is actually wrong.

**About the client secret:** for a Desktop app OAuth client, Google does
not treat this value as confidential (see RFC 8252 / Google's
installed-app guidance) — the loopback redirect and PKCE are what
actually secure the flow, not secrecy of this string. It grants no direct
access to your calendar data by itself. Treat it as ordinary config, not
a high-value credential: no need to paste it into a password manager or
panic if it leaks, just don't casually paste it into a public GitHub
issue or commit it to a public repo. Worst case if it does leak is
someone else burning your API quota or triggering a consent screen that
shows your app's name — not access to your calendar.

### 3. Authorize (one-time)

```sh
pnpm run auth
```

This is an interactive command you run once from a terminal — it is never
invoked by Übersicht itself. On first run it prompts for:

- your **Google OAuth client ID** and **client secret** from step 2 above
  (skipped if this build has a shared client baked in — see "Escape
  hatch" below)
- the **names of the Google Calendars** you want to display, exactly as
  they appear in Google Calendar (case-sensitive; comma-separated if more
  than one)
- whether to display times in **12-hour** or **24-hour** format
- optionally, a **timezone override** (IANA name, e.g. `America/Chicago`)
  if you want the widget to use a timezone other than your calendar's own

It then opens a browser to Google's consent screen. Log in and click
**Allow** (see the verification-warning note in step 2 if you see one),
and the flow completes automatically — no authorization code to
copy/paste, thanks to a local loopback redirect plus PKCE. Config and
token are written to `~/.config/ubersicht-google-calendar/`
(`config.json`, `token.json`), with `token.json` permissioned `0600`.

You can re-run `pnpm run auth` at any time to change calendars, formatting,
or re-authorize from scratch.

### 4. Build and install the widget

```sh
pnpm run install-widget
```

This builds the widget and copies `calendar.widget/` into Übersicht's
widgets directory in one step (replacing any previously installed copy).

If you'd rather see what that does (or want more control), the
equivalent manual steps are:

```sh
pnpm run build
cp -R calendar.widget "$HOME/Library/Application Support/Übersicht/widgets/"
```

Open Übersicht's menu bar icon and choose **Refresh All Widgets** (or
restart Übersicht) if the calendar doesn't appear within a minute.

### 5. (Optional) Build a distributable zip

```sh
pnpm run package
```

Builds, runs the test suite, and produces `ubersicht-google-calendar.widget.zip`
containing just the compiled widget (`index.jsx`, `lib/`, `package.json`) —
useful for sharing a ready-to-install artifact without the source tree.

## Escape hatch: baking in a shared client (for forks)

The setup above (each user brings their own OAuth client) is the
supported, primary path. If you maintain a fork and want *your* users to
skip step 2 entirely — e.g. you're distributing the widget to a small
group and don't want everyone creating their own Google Cloud project —
you can bake your own client into the build instead, at build time:

1. In your fork, create `.env.local` (gitignored) with:
   ```
   UBERSICHT_GCAL_CLIENT_ID=your-client-id
   UBERSICHT_GCAL_CLIENT_SECRET=your-client-secret
   ```
2. Authorize with the `:release` variant, which sources `.env.local`
   before running:
   ```sh
   pnpm run auth:release
   ```
   This bakes the client ID/secret into `calendar.widget/lib/authorize.js`
   at build time (see `esbuild.config.mjs`); the build output tells you
   whether a client got baked in (`Baked-in OAuth client: YES` / `NO`).
   `pnpm run auth:release` resolves the baked-in client and immediately
   writes it to `config.json`, so it's only ever needed once per machine
   — after that, `config.json` is the sole source of credentials at
   runtime. Your users then run `pnpm run auth` (or just use the built
   widget) and are never prompted for a client ID/secret.
3. Build normally — plain `pnpm run build` (or `install-widget`) is
   enough. The compiled `cli`/`widget` bundles never touch the shared
   client at all; they only ever read `config.json`, so there's no
   `build:release` step to run for this.

**Tradeoffs, read before doing this:** an unverified Google OAuth app
(the state this project is in, deliberately) is capped at **100 users**
for sensitive scopes like `calendar.readonly` — once your fork crosses
that, new users will start hitting Google's app-cap error. Lifting the
cap requires going through Google's verification process (a real
homepage, a privacy policy, domain verification, a demo video, and a
review that can take weeks) — this project does not do that, and baking
in a shared client just moves that ceiling from "per Google Cloud
project" to "per fork." For anything beyond a small, trusted group, the
per-user BYO path in step 2 above is the only option that scales without
touching Google's verification process.

Your own `config.json` `clientId`/`clientSecret` (the BYO path, step 2)
always take precedence over any shared client baked into the build via
this escape hatch — `pnpm run auth`'s setup-only credential resolution
checks config.json first, so a baked-in client never silently overrides
a user's own. Either way, `pnpm run auth` persists whatever it resolves
into `config.json`: the shared client is only ever a seed for that one
command, never something the widget or cli read directly at runtime.

## Timezone behavior

Events are bucketed into "today" and "tomorrow" using your calendar's own
timezone (Google Calendar > Settings > **Calendar Time Zone**), or the
`timezoneOverride` you set during `pnpm run auth` if you'd rather pin it
explicitly. Day boundaries are computed with real timezone-aware date math
(via `luxon`), so this is correct across DST transitions and non-hour
UTC offsets (e.g. India's +5:30, Nepal's +5:45) — the old shell script's
`sed`-based offset arithmetic could get this wrong.

## Widget position

By default the widget appears near the top-left of the screen (`top: 15%`,
`left: 2%`, matching the original calendar.coffee). To move it, hand-edit
`~/.config/ubersicht-google-calendar/config.json` and add a `position`
object with CSS length strings:

```json
{
  "position": { "top": "60%", "left": "40%" }
}
```

`top`/`left` accept any CSS length (`%`, `px`, etc.). There's no in-app
drag-to-reposition — the widget runs in a webview with no filesystem
access, so config.json (edited by hand, read by the `command` process) is
the only way to set it. A missing or malformed `position` is silently
ignored and the widget falls back to the default position; it never
breaks config validation or the widget itself.

Changes take effect on the next widget refresh — choose **Refresh All
Widgets** from Übersicht's menu bar icon, or wait for the next scheduled
refresh (every 30 minutes).

## Troubleshooting

The widget prints structured errors instead of failing silently:

- **"Config file not found..."** — run `pnpm run auth`.
- **"Token file not found..."** — run `pnpm run auth`.
- **"Calendar(s) not found..."** — the name(s) in your config don't
  exactly match a calendar in your Google account (case-sensitive); the
  error lists the calendars actually available so you can fix a typo.
- Any other error is shown directly in the widget with a `⚠` prefix.

## How it works

This is a two-part build, mirroring the split between the old shell scripts
and the CoffeeScript render layer, except both halves are now TypeScript:

- **`src/cli/*.ts`** — a real Node CLI (`fetch-events.ts`) that loads
  config, refreshes the OAuth token if needed, calls the Calendar API via
  `googleapis`, sorts/formats events, and prints one JSON line to stdout.
  Bundled by esbuild into `calendar.widget/lib/fetch-events.js`.
- **`src/widget/index.tsx`** — the actual Übersicht widget entry
  (`command`/`render`/`updateState`/`className`). It shells out to
  `lib/fetch-events.js`, parses its JSON output, and renders the result.
  Bundled by esbuild (JSX left untouched — Übersicht's own babel pass
  transforms it at widget-load time) into `calendar.widget/index.jsx`.
- **`src/setup/authorize.ts`** — the one-time interactive OAuth loopback
  flow behind `pnpm run auth`. Bundled into `calendar.widget/lib/authorize.js`.

Compiled output under `calendar.widget/lib/` and `calendar.widget/index.jsx`
is build output, not committed to the repo (`.gitignore`d) — run
`pnpm install && pnpm run build` to produce it.

## Testing

```sh
pnpm run test        # vitest — sort/format logic, timezone day-boundary math, config validation
pnpm run typecheck    # tsc --noEmit
```

## Legacy files

This repo still contains the original CoffeeScript widget and its shell
scripts (`calendar.widget/calendar.coffee`, `calendar.widget/assets/*.sh`,
`clean.sh`, `gitPushOriginMaster.sh`, `calendar.widget.zip`, etc.) — they
are no longer used by the TypeScript rewrite above and are slated for
removal in a follow-up cleanup pass.

## License

MIT — see [LICENSE](LICENSE).
