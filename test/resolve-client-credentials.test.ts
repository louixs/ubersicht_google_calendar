import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The setup path (pnpm run auth) may fall back to a shared client baked in
// at build time (src/setup/shared-client.ts) when the user's own
// config.json doesn't have clientId/clientSecret yet. Mock that module so
// each test can control whether a "shared client" is available without
// touching real env vars or an actual esbuild define.
vi.mock('../src/setup/shared-client.js', () => ({
  get SHARED_CLIENT_ID() {
    return mockShared.id;
  },
  get SHARED_CLIENT_SECRET() {
    return mockShared.secret;
  },
}));

const mockShared: { id: string | undefined; secret: string | undefined } = {
  id: undefined,
  secret: undefined,
};

describe('resolveClientCredentials (cli/config.ts — runtime, config.json only)', () => {
  beforeEach(() => {
    mockShared.id = undefined;
    mockShared.secret = undefined;
  });

  it('uses config.json credentials when present', async () => {
    const { resolveClientCredentials } = await import('../src/cli/config.js');

    const result = resolveClientCredentials({
      clientId: 'user-id',
      clientSecret: 'user-secret',
    });

    expect(result).toEqual({ clientId: 'user-id', clientSecret: 'user-secret' });
  });

  it('never falls back to a baked-in shared client, even when one exists', async () => {
    mockShared.id = 'shared-id';
    mockShared.secret = 'shared-secret';
    const { resolveClientCredentials } = await import('../src/cli/config.js');

    expect(() => resolveClientCredentials({})).toThrow();
  });

  it('throws an actionable ConfigError pointing at `pnpm run auth` when config.json has no credentials', async () => {
    const { resolveClientCredentials } = await import('../src/cli/config.js');
    const { ConfigError } = await import('../src/cli/types.js');

    try {
      resolveClientCredentials({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/pnpm run auth/);
    }
  });

  it('treats a partial config (only one of clientId/clientSecret) as absent', async () => {
    const { resolveClientCredentials } = await import('../src/cli/config.js');
    const { ConfigError } = await import('../src/cli/types.js');

    expect(() => resolveClientCredentials({ clientId: 'user-id' })).toThrow(ConfigError);
  });
});

describe('resolveSetupClientCredentials (setup path only — may seed from shared client)', () => {
  beforeEach(() => {
    mockShared.id = undefined;
    mockShared.secret = undefined;
  });

  it("uses the user's own config credentials when present", async () => {
    mockShared.id = 'shared-id';
    mockShared.secret = 'shared-secret';
    const { resolveSetupClientCredentials } = await import(
      '../src/setup/resolve-setup-credentials.js'
    );

    const result = resolveSetupClientCredentials({
      clientId: 'user-id',
      clientSecret: 'user-secret',
    });

    expect(result).toEqual({ clientId: 'user-id', clientSecret: 'user-secret' });
  });

  it('falls back to the baked-in shared client when the user has none configured', async () => {
    mockShared.id = 'shared-id';
    mockShared.secret = 'shared-secret';
    const { resolveSetupClientCredentials } = await import(
      '../src/setup/resolve-setup-credentials.js'
    );

    const result = resolveSetupClientCredentials({});

    expect(result).toEqual({ clientId: 'shared-id', clientSecret: 'shared-secret' });
  });

  it('throws a helpful ConfigError when neither user nor shared credentials exist', async () => {
    const { resolveSetupClientCredentials } = await import(
      '../src/setup/resolve-setup-credentials.js'
    );
    const { ConfigError } = await import('../src/cli/types.js');

    try {
      resolveSetupClientCredentials({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/No Google OAuth client is configured/);
    }
  });
});

describe('end-to-end: shared-client-sourced credentials survive into a credential-free runtime', () => {
  let dir: string;

  beforeEach(() => {
    mockShared.id = undefined;
    mockShared.secret = undefined;
    dir = mkdtempSync(join(tmpdir(), 'gcal-config-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    'persists resolved (baked-in) credentials to config.json, and a later ' +
      'runtime load can resolve credentials from that config alone, with no ' +
      'baked-in client present',
    async () => {
      // 1. Simulate the authorize flow: no clientId/clientSecret in config
      //    yet, but a shared client is baked into this build.
      mockShared.id = 'test-client-id';
      mockShared.secret = 'test-client-secret';
      const { resolveSetupClientCredentials } = await import(
        '../src/setup/resolve-setup-credentials.js'
      );
      const { saveConfig, loadConfig, resolveClientCredentials } = await import(
        '../src/cli/config.js'
      );

      const configPath = join(dir, 'config.json');
      const baseConfig = { calendarNames: ['primary'], hour12: true };
      const credentials = resolveSetupClientCredentials({});

      // The authorize flow must persist the resolved credentials, not just
      // use them in memory for the OAuth exchange.
      saveConfig({ ...baseConfig, ...credentials }, configPath);

      // 2. Simulate a later runtime invocation (the widget/cli) where the
      //    shared client is no longer available (e.g. a different build,
      //    or simply because the runtime path must never depend on it).
      mockShared.id = undefined;
      mockShared.secret = undefined;

      const persisted = loadConfig(configPath);
      const resolved = resolveClientCredentials(persisted);

      expect(resolved).toEqual({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });
    },
  );
});
