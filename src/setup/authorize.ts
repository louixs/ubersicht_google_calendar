import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { URL } from 'node:url';
import * as readline from 'node:readline/promises';

import { createOAuth2Client, saveToken, CALENDAR_READONLY_SCOPE } from '../cli/auth.js';
import { getConfigPath, getTokenPath, loadConfig, saveConfig } from '../cli/config.js';
import { ConfigError, type Config, type TokenSet } from '../cli/types.js';

/**
 * One-time interactive OAuth loopback flow. Never invoked by Übersicht
 * itself — this is a `npm run auth` command a human runs from a terminal.
 * Replaces the old oauth.sh OOB flow (issue #13: OOB is dead/deprecated
 * by Google).
 */

async function promptForClientCredentials(): Promise<Pick<Config, 'clientId' | 'clientSecret'>> {
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

/** Loads existing config if present, otherwise prompts and creates one. */
async function loadOrCreateBaseConfig(): Promise<Config> {
  try {
    return loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.log('No existing config found — let\'s set one up.\n');
    const { clientId, clientSecret } = await promptForClientCredentials();
    const calendarNames = await promptForCalendarNames();
    const config: Config = {
      clientId,
      clientSecret,
      calendarNames: calendarNames.length > 0 ? calendarNames : ['primary'],
      hour12: true,
    };
    saveConfig(config);
    console.log(`\nSaved config to ${getConfigPath()}\n`);
    return config;
  }
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
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_READONLY_SCOPE],
    redirect_uri: redirectUri,
  });

  const code = await runLoopbackFlow(authUrl, port);

  const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: redirectUri });
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke access at ' +
        'https://myaccount.google.com/permissions and re-run `npm run auth` ' +
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
