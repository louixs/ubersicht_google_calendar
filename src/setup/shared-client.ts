/**
 * Maintainer-owned OAuth client, baked in at build time.
 *
 * `process.env.UBERSICHT_GCAL_CLIENT_ID` / `_SECRET` are replaced by
 * esbuild's `define` (see esbuild.config.mjs, "setup" target) with
 * whatever is in the maintainer's local shell env when they cut a
 * release build. Neither value is hardcoded here, and both are
 * `undefined` in ordinary dev builds where those env vars aren't set —
 * that's the expected default state until the maintainer actually
 * registers a Google Cloud OAuth client and sets these env vars locally.
 *
 * Per Google's "installed application" OAuth guidance (RFC 8252), this
 * client type's secret is not confidential — security comes from the
 * loopback redirect + PKCE, not from keeping the secret hidden. See the
 * README's "Escape hatch: baking in a shared client (for forks)" section
 * for the full rationale and tradeoffs.
 */
export const SHARED_CLIENT_ID: string | undefined =
  process.env.UBERSICHT_GCAL_CLIENT_ID || undefined;

export const SHARED_CLIENT_SECRET: string | undefined =
  process.env.UBERSICHT_GCAL_CLIENT_SECRET || undefined;
