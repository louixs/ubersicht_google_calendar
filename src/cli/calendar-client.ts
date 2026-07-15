import type { calendar_v3 } from 'googleapis';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { DateTime } from 'luxon';

import { AuthError, type Config } from './types.js';

/**
 * Intermediate event shape produced by this module. Deliberately does NOT
 * include a rendered `displayTime` — that's format.ts's job (it needs the
 * `hour12` config toggle, which this module has no business knowing
 * about). fetch-events.ts is responsible for turning this into the final
 * `CalendarEvent` (types.ts) via format.ts before printing.
 */
export interface RawCalendarEvent {
  id: string;
  summary: string;
  startEpoch: number;
  isAllDay: boolean;
}

/**
 * Thin wrapper over googleapis' calendar('v3') client. Replaces the
 * hand-rolled curl + parsej.sh grep/sed JSON extraction entirely — every
 * lookup here is an exact typed field access against the real API
 * response shape, not a text-search heuristic.
 */
export class CalendarClient {
  private readonly api: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.api = google.calendar({ version: 'v3', auth });
  }

  /**
   * Resolves configured calendar names to calendar IDs via
   * calendarList.list(), matching by exact (case-sensitive) `summary`
   * equality — replaces calIdByName's `parsej.sh list.db | grep -B1`
   * fragility, which matched on substring and was case-insensitive by
   * accident of grep's default behavior.
   */
  async resolveCalendarIds(calendarNames: string[]): Promise<Map<string, string>> {
    const entries: calendar_v3.Schema$CalendarListEntry[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.api.calendarList.list({
        showHidden: true,
        pageToken,
      });
      entries.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const byName = new Map<string, string>();
    for (const entry of entries) {
      if (entry.summary && entry.id) {
        byName.set(entry.summary, entry.id);
      }
    }

    const ids = new Map<string, string>();
    const missing: string[] = [];
    for (const name of calendarNames) {
      const id = byName.get(name);
      if (id) {
        ids.set(name, id);
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      throw new AuthError(
        `Calendar(s) not found (case-sensitive exact match on name): ${missing.join(', ')}. ` +
          `Available calendars: ${[...byName.keys()].join(', ') || '(none)'}`,
      );
    }

    return ids;
  }

  /**
   * Lists single-instance-expanded events for one calendar within
   * [timeMin, timeMax), ordered by start time — mirrors makeCalUrl's
   * `singleEvents=true&orderBy=startTime` query, but via the typed client
   * instead of a hand-built query string.
   */
  async listEvents(
    calendarId: string,
    timeMin: DateTime,
    timeMax: DateTime,
  ): Promise<calendar_v3.Schema$Event[]> {
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;

    const timeMinIso = timeMin.toUTC().toISO();
    const timeMaxIso = timeMax.toUTC().toISO();
    if (!timeMinIso || !timeMaxIso) {
      throw new Error(`Invalid date range passed to listEvents: ${timeMin} .. ${timeMax}`);
    }

    do {
      const res = await this.api.events.list({
        calendarId,
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken,
      });
      events.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }
}

/**
 * Fetches events for today and tomorrow across every configured calendar
 * name, in the calendar's local timezone (or config.timezoneOverride if
 * set). Day boundaries are computed with luxon's startOf/endOf('day'),
 * which fixes the timezone.sh sign/offset bugs by construction (issue
 * #8/#12) — no manual hour arithmetic anywhere in this path.
 */
export async function fetchTodayAndTomorrowEvents(
  client: CalendarClient,
  config: Pick<Config, 'calendarNames' | 'timezoneOverride'>,
  now: DateTime = DateTime.local(),
): Promise<RawCalendarEvent[]> {
  const zone = config.timezoneOverride ?? now.zoneName ?? 'local';
  const today = now.setZone(zone).startOf('day');
  const tomorrow = today.plus({ days: 1 });
  const windowStart = today.startOf('day');
  const windowEnd = tomorrow.endOf('day');

  const calendarIds = await client.resolveCalendarIds(config.calendarNames);

  const eventsByCalendar = await Promise.all(
    [...calendarIds.values()].map((id) => client.listEvents(id, windowStart, windowEnd)),
  );

  const events: RawCalendarEvent[] = [];
  for (const raw of eventsByCalendar.flat()) {
    const mapped = mapEvent(raw, zone);
    if (mapped) {
      events.push(mapped);
    }
  }

  return events;
}

/**
 * Converts a raw googleapis event into our typed RawCalendarEvent shape.
 * Returns null for events with no resolvable start time (shouldn't
 * happen for singleEvents=true results, but keeps this defensive rather
 * than throwing on a malformed API response).
 *
 * `zone` matters only for all-day events: `start.date` is a bare
 * calendar date with no attached offset (e.g. "2024-03-10"), so which
 * instant it maps to is ambiguous unless we pin it to the *calendar's*
 * timezone explicitly. Anchoring all-day dates to the system's local
 * zone instead (the previous behavior, and luxon's default when no zone
 * is passed) is exactly the class of bug behind issue #8/#12: a widget
 * running in one zone with `timezoneOverride` set to another would
 * bucket all-day events into the wrong day, or duplicate/drop them at
 * the boundary. Timed events (`start.dateTime`) are unaffected — their
 * ISO string already carries an explicit offset, so `DateTime.fromISO`
 * resolves them to the correct instant regardless of `zone`.
 */
function mapEvent(event: calendar_v3.Schema$Event, zone: string): RawCalendarEvent | null {
  if (!event.id) return null;

  const startDateTime = event.start?.dateTime;
  const startDate = event.start?.date;

  let startEpoch: number;
  let isAllDay = false;

  if (startDateTime) {
    const dt = DateTime.fromISO(startDateTime);
    if (!dt.isValid) return null;
    startEpoch = dt.toMillis();
  } else if (startDate) {
    const dt = DateTime.fromISO(startDate, { zone });
    if (!dt.isValid) return null;
    startEpoch = dt.toMillis();
    isAllDay = true;
  } else {
    return null;
  }

  return {
    id: event.id,
    summary: event.summary ?? '(No title)',
    startEpoch,
    isAllDay,
  };
}
