import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { URL } from 'node:url';
import * as readline from 'node:readline/promises';

import { CodeChallengeMethod } from 'google-auth-library';

import { createOAuth2Client, saveToken, CALENDAR_READONLY_SCOPE } from '../cli/auth.js';
import { getConfigPath, getTokenPath, loadConfig, saveConfig } from '../cli/config.js';
import { ConfigError, type Config, type TokenSet } from '../cli/types.js';
import { resolveSetupClientCredentials } from './resolve-setup-credentials.js';

/**
 * One-time interactive OAuth loopback flow. Never invoked by Übersicht
 * itself — this is a `pnpm run auth` command a human runs from a terminal.
 * Replaces the old oauth.sh OOB flow (issue #13: OOB is dead/deprecated
 * by Google).
 */

/**
 * Fallback for local dev/testing (or maintainers/users who want an
 * isolated OAuth client): only reached when resolveSetupClientCredentials()
 * can't find a shared client baked into this build.
 */
async function promptForClientCredentials(): Promise<Pick<Config, 'clientId' | 'clientSecret'>> {
  console.log(
    'This build has no OAuth client baked in, so you need your own — that\'s the ' +
      'normal, primary way to use this widget (each user registers their own free ' +
      'Google Cloud OAuth client). Full step-by-step instructions, including the ' +
      '"Publish app" step that keeps your refresh token from expiring every 7 ' +
      'days, are in the README\'s "2. Create your own Google OAuth client" section.\n',
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const clientId = (await rl.question('Google OAuth client ID: ')).trim();
    const clientSecret = (await rl.question('Google OAuth client secret: ')).trim();
    if (!clientId || !clientSecret) {
      throw new ConfigError('Client ID and client secret are both required.');
    }
    return { clientId, clientSecret };
  } finally {
    rl.close();
  }
}

async function promptForCalendarNames(): Promise<string[]> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question('Calendar name(s) to show, comma-separated (default: primary calendar name): ')
    ).trim();
    const names = answer
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return names;
  } finally {
    rl.close();
  }
}

/**
 * Loads existing config if present, otherwise prompts for user-specific
 * data (calendars, formatting) and creates one. Does NOT prompt for
 * clientId/clientSecret unless the shared client baked into this build is
 * unavailable — see resolveSetupClientCredentials() in
 * setup/resolve-setup-credentials.ts.
 *
 * Whatever credentials get resolved (from an existing config, the
 * baked-in shared client, or an interactive prompt) are always persisted
 * into config.json before returning: the cli/widget runtime
 * (resolveClientCredentials() in cli/config.ts) reads config.json only,
 * so a successful `pnpm run auth` must always leave both clientId and
 * clientSecret there, regardless of where they came from.
 */
async function loadOrCreateBaseConfig(): Promise<Config> {
  let config: Config;
  let isNew = false;

  try {
    config = loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.log('No existing config found — let\'s set one up.\n');
    isNew = true;

    const calendarNames = await promptForCalendarNames();
    config = {
      calendarNames: calendarNames.length > 0 ? calendarNames : ['primary'],
      hour12: true,
    };
  }

  if (!config.clientId || !config.clientSecret) {
    let credentials: Pick<Config, 'clientId' | 'clientSecret'>;
    try {
      credentials = resolveSetupClientCredentials(config);
    } catch {
      // No shared client baked into this build — fall back to prompting.
      credentials = await promptForClientCredentials();
    }
    config = { ...config, ...credentials };
    saveConfig(config);
    console.log(isNew ? `\nSaved config to ${getConfigPath()}\n` : `\nUpdated config at ${getConfigPath()}\n`);
  }

  return config;
}

/**
 * Starts a local HTTP server on an OS-assigned free port, opens the
 * Google consent screen, and resolves with the `code` query param once
 * Google redirects back. Rejects on consent denial or server error.
 */
function runLoopbackFlow(authUrl: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authorization denied</h1><p>${error}</p></body></html>`);
        server.close();
        reject(new Error(`OAuth consent denied: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing authorization code</h1></body></html>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authorization complete — you can close this tab.</h1></body></html>');
      server.close();
      resolve(code);
    });

    server.on('error', reject);

    server.listen(port, '127.0.0.1', () => {
      console.log('Opening browser for Google consent...');
      console.log(`If it does not open automatically, visit:\n${authUrl}\n`);
      exec(`open ${JSON.stringify(authUrl)}`, (err) => {
        if (err) {
          console.warn(`Could not auto-open browser (${err.message}); open the URL above manually.`);
        }
      });
    });
  });
}

async function main(): Promise<void> {
  const config = await loadOrCreateBaseConfig();

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine loopback server port.');
  }
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const redirectUri = `http://127.0.0.1:${port}`;
  const oAuth2Client = createOAuth2Client(config, redirectUri);

  // PKCE (RFC 7636): defense in depth now that the client secret is
  // shared across every install of this widget. google-auth-library
  // generates the verifier/challenge pair for us.
  const { codeVerifier, codeChallenge } = await oAuth2Client.generateCodeVerifierAsync();

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_READONLY_SCOPE],
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  const code = await runLoopbackFlow(authUrl, port);

  const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: redirectUri, codeVerifier });
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke access at ' +
        'https://myaccount.google.com/permissions and re-run `pnpm run auth` ' +
        '(this can happen on re-authorization without `prompt: consent`).',
    );
  }

  const tokenSet: TokenSet = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
  };

  saveToken(tokenSet, getTokenPath());
  console.log(`\nSuccess. Token saved to ${getTokenPath()}`);
}

main().catch((err) => {
  console.error(`\nAuthorization failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
