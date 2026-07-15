import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';

import { AuthError, TokenSetSchema, type Config, type TokenSet } from './types.js';
import { getTokenPath } from './config.js';

export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Reads and validates token.json. Throws AuthError if missing/invalid. */
export function loadToken(path: string = getTokenPath()): TokenSet {
  if (!existsSync(path)) {
    throw new AuthError(
      `Token file not found at ${path}. Run \`pnpm run auth\` to authorize this app.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new AuthError(`Could not read token file at ${path}: ${errorMessage(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AuthError(`Token file at ${path} is not valid JSON: ${errorMessage(err)}`);
  }

  const result = TokenSetSchema.safeParse(parsed);
  if (!result.success) {
    throw new AuthError(
      `Token file at ${path} is invalid. Re-run \`pnpm run auth\` to re-authorize.`,
    );
  }

  return result.data;
}

/**
 * Persists token.json with 0600 permissions. Called both by the initial
 * `pnpm run auth` grant and by the automatic refresh listener below — every
 * write is hardened, not just the first one.
 */
export function saveToken(token: TokenSet, path: string = getTokenPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Builds a bare OAuth2Client from config, with no credentials attached. */
export function createOAuth2Client(
  config: Pick<Config, 'clientId' | 'clientSecret'>,
  redirectUri?: string,
): OAuth2Client {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);
}

/**
 * Builds an OAuth2Client pre-loaded with the persisted token and wired to
 * transparently persist rotated tokens. This is what fetch-events.ts uses
 * on every normal (non-interactive) widget run: it never hand-rolls a
 * refresh request, it relies on googleapis' built-in automatic refresh,
 * which fires the `tokens` event whenever it refreshes in the background.
 */
export function createAuthorizedClient(
  config: Pick<Config, 'clientId' | 'clientSecret'>,
  tokenPath: string = getTokenPath(),
): OAuth2Client {
  const token = loadToken(tokenPath);
  const client = createOAuth2Client(config);
  client.setCredentials(token);

  client.on('tokens', (newTokens: Credentials) => {
    // Google may omit refresh_token on refresh responses (it's only sent
    // on the very first grant) — preserve the existing one in that case.
    const merged: TokenSet = {
      access_token: newTokens.access_token ?? token.access_token,
      refresh_token: newTokens.refresh_token ?? token.refresh_token,
      scope: newTokens.scope ?? token.scope,
      token_type: newTokens.token_type ?? token.token_type,
      expiry_date: newTokens.expiry_date ?? token.expiry_date,
    };
    saveToken(merged, tokenPath);
  });

  return client;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
