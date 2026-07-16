import { z } from 'zod';

/**
 * Widget screen position, as CSS length strings (e.g. "60%", "20px").
 * User-editable in config.json; consumed by the widget to place its root
 * element. The widget runs in a WKWebView with no filesystem access (see
 * esbuild.config.mjs widget target comment), so this is the only channel
 * for a user-configured position — it travels through config.json ->
 * fetch-events.ts's stdout JSON -> the widget's render.
 */
const PositionSchema = z.object({
  left: z.string().min(1),
  top: z.string().min(1),
});

export type Position = z.infer<typeof PositionSchema>;

/**
 * User-editable configuration, stored at
 * ~/.config/ubersicht-google-calendar/config.json
 */
export const ConfigSchema = z.object({
  // Your Google OAuth client. Populated either directly by you (the
  // primary, bring-your-own-client path — README "2. Create your own
  // Google OAuth client") or by `pnpm run auth` seeding it from a shared
  // client baked into this build, if one exists (a fork-only escape
  // hatch). Optional here only because authorize.ts writes calendarNames/
  // hour12 to config.json before these are resolved — the cli/widget
  // runtime (resolveClientCredentials() in cli/config.ts) requires both
  // to be present and throws an actionable error otherwise.
  clientId: z.string().min(1, 'clientId, if present, must not be empty').optional(),
  clientSecret: z.string().min(1, 'clientSecret, if present, must not be empty').optional(),
  calendarNames: z
    .array(z.string().min(1))
    .min(1, 'calendarNames must contain at least one calendar name'),
  hour12: z.boolean().default(true),
  timezoneOverride: z.string().optional(),
  // Lenient by design: a missing OR malformed `position` must never fail
  // config validation or break the widget (users hand-edit config.json to
  // set this). `.catch(undefined)` swallows a shape violation for just
  // this field and degrades to "absent" — same as not having set it at
  // all — instead of rejecting the whole config over one bad field.
  position: PositionSchema.optional().catch(undefined),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * OAuth2 token set, stored at
 * ~/.config/ubersicht-google-calendar/token.json
 *
 * Written only by `pnpm run auth` (initial grant) and by the automatic
 * refresh listener in auth.ts (re-persisted on rotation).
 */
export const TokenSetSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  expiry_date: z.number().optional(),
});

export type TokenSet = z.infer<typeof TokenSetSchema>;

export interface CalendarEvent {
  id: string;
  displayTime: string;
  summary: string;
  startEpoch: number;
}

export type WidgetErrorKind = 'auth' | 'network' | 'config' | 'unknown';

export interface WidgetError {
  kind: WidgetErrorKind;
  message: string;
}

export interface WidgetEventGroups {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
}

export type WidgetPayload = (
  | { ok: true; data: WidgetEventGroups }
  | { ok: false; error: WidgetError }
) & {
  // Present whenever config.json loaded successfully and had a position
  // set, regardless of whether the rest of the request (auth/network)
  // succeeded — so a configured position still applies while e.g. a
  // network error is being displayed. Absent on first run, when position
  // was never set, or when config.json itself failed to load.
  position?: Position;
};

/**
 * Thrown by config.ts when config.json is missing, malformed, or fails
 * schema validation. Carries a human-readable message so callers can
 * surface it directly instead of a raw Zod stack trace.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Thrown by auth.ts when token.json is missing or invalid. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
