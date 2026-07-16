import { getConfigPath } from '../cli/config.js';
import { ConfigError, type Config } from '../cli/types.js';
import { SHARED_CLIENT_ID, SHARED_CLIENT_SECRET } from './shared-client.js';

/**
 * Setup-only credential resolution, used exclusively by `pnpm run auth`
 * (src/setup/authorize.ts) to decide what to seed config.json with:
 * the user's own config values if present (the primary, bring-your-own-
 * client path — README "2. Create your own Google OAuth client"),
 * otherwise a shared client baked into this build at build time (a
 * fork-only escape hatch — README "Escape hatch: baking in a shared
 * client"). Throws ConfigError if neither is available, so the caller can
 * fall back to prompting the user interactively.
 *
 * This is deliberately NOT what the cli/widget runtime uses — see
 * resolveClientCredentials() in cli/config.ts, which only ever reads
 * config.json. authorize.ts persists whatever this function resolves back
 * into config.json, so the runtime path never needs the shared client.
 */
export function resolveSetupClientCredentials(
  config: Pick<Config, 'clientId' | 'clientSecret'>,
): { clientId: string; clientSecret: string } {
  if (config.clientId && config.clientSecret) {
    return { clientId: config.clientId, clientSecret: config.clientSecret };
  }

  if (SHARED_CLIENT_ID && SHARED_CLIENT_SECRET) {
    return { clientId: SHARED_CLIENT_ID, clientSecret: SHARED_CLIENT_SECRET };
  }

  throw new ConfigError(
    'No Google OAuth client is configured. This build has no shared client ' +
      'baked in yet, and no clientId/clientSecret were found in your config.json.\n' +
      'To use your own OAuth client, either:\n' +
      '  - set UBERSICHT_GCAL_CLIENT_ID and UBERSICHT_GCAL_CLIENT_SECRET in your ' +
      'shell environment before running `pnpm run auth`, or\n' +
      '  - add "clientId" and "clientSecret" fields directly to ' +
      `${getConfigPath()}.\n` +
      'See the README\'s "2. Create your own Google OAuth client" section for how ' +
      'to obtain one from https://console.cloud.google.com.',
  );
}
