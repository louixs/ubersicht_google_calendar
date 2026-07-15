import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import { ConfigError, ConfigSchema, type Config } from './types.js';

/**
 * Fixed, home-relative storage directory. Deliberately NOT derived from
 * __dirname/PWD/widget-install depth (see architecture note on issue #4) —
 * this must work identically regardless of where calendar.widget/ is
 * installed or symlinked, and regardless of what cwd Übersicht happens to
 * invoke `command` from.
 */
export function getConfigDir(): string {
  return `${homedir()}/.config/ubersicht-google-calendar`;
}

export function getConfigPath(): string {
  return `${getConfigDir()}/config.json`;
}

export function getTokenPath(): string {
  return `${getConfigDir()}/token.json`;
}

/** Ensures the config directory exists with private (0700) permissions. */
export function ensureConfigDir(): string {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * Loads and validates config.json. Throws ConfigError with a readable
 * message on any failure — missing file, invalid JSON, or a schema
 * violation — never a raw parse/Zod stack trace (fixes issue #7).
 */
export function loadConfig(path: string = getConfigPath()): Config {
  if (!existsSync(path)) {
    throw new ConfigError(
      `Config file not found at ${path}. Run \`pnpm run auth\` to set it up.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Could not read config file at ${path}: ${errorMessage(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Config file at ${path} is not valid JSON: ${errorMessage(err)}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Config file at ${path} is invalid:\n${issues}`);
  }

  return result.data;
}

/** Persists config.json, creating the directory and hardening permissions. */
export function saveConfig(config: Config, path: string = getConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
