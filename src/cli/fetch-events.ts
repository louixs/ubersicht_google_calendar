/**
 * Entry point invoked by the Übersicht widget's `command` (see
 * src/widget/index.tsx). Wires config -> auth -> calendar-client ->
 * format into a single stdout JSON line, matching the WidgetPayload
 * contract in types.ts.
 *
 * Deliberately never lets an error escape as a non-zero exit / stderr
 * write when it's something we can classify (config/auth/network) —
 * Übersicht's `runShellCommand` only captures stdout on success, so a
 * classified failure is printed as a well-formed `{ok:false, ...}`
 * payload on stdout and the process exits 0. This lets
 * src/widget/index.tsx branch on `payload.ok` instead of on shell exit
 * codes / magic numbers (fixes the "no error handling around curl"
 * review item by construction).
 *
 * Only a truly unexpected crash (a bug in this script itself) should
 * ever hit the catch-all in main()'s caller and surface as Übersicht's
 * own `UB/COMMAND_RAN` error path.
 */
import { DateTime } from 'luxon';

import { loadConfig } from './config.js';
import { createAuthorizedClient } from './auth.js';
import { CalendarClient, fetchTodayAndTomorrowEvents } from './calendar-client.js';
import { formatEvents } from './format.js';
import { AuthError, ConfigError, type WidgetPayload } from './types.js';

async function main(): Promise<WidgetPayload> {
  const config = loadConfig();

  const client = createAuthorizedClient(config);
  const calendarClient = new CalendarClient(client);

  const now = DateTime.local();
  const zone = config.timezoneOverride ?? now.zoneName ?? 'local';

  const rawEvents = await fetchTodayAndTomorrowEvents(calendarClient, config, now);
  const data = formatEvents(rawEvents, zone, config.hour12, now);

  return { ok: true, data };
}

function toPayload(err: unknown): WidgetPayload {
  if (err instanceof ConfigError) {
    return { ok: false, error: { kind: 'config', message: err.message } };
  }
  if (err instanceof AuthError) {
    return { ok: false, error: { kind: 'auth', message: err.message } };
  }
  if (isNetworkError(err)) {
    return { ok: false, error: { kind: 'network', message: errorMessage(err) } };
  }
  return { ok: false, error: { kind: 'unknown', message: errorMessage(err) } };
}

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  if (typeof code === 'string' && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) {
    return true;
  }
  // googleapis errors carry an HTTP-ish shape; treat 5xx/network-adjacent
  // failures as "network" rather than "unknown" so the widget can show a
  // more actionable message.
  const status = (err as { response?: { status?: number }; status?: number } | undefined);
  const httpStatus = status?.response?.status ?? status?.status;
  return typeof httpStatus === 'number' && httpStatus >= 500;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main()
  .then((payload) => {
    process.stdout.write(JSON.stringify(payload));
  })
  .catch((err) => {
    process.stdout.write(JSON.stringify(toPayload(err)));
  });
