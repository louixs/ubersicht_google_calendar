import { DateTime } from 'luxon';

import type { RawCalendarEvent } from './calendar-client.js';
import type { CalendarEvent } from './types.js';

export type DayBucket = 'today' | 'tomorrow';

/**
 * A RawCalendarEvent (calendar-client.ts's output) tagged with which
 * calendar day it falls on, in the target zone. This is the bucketing
 * step referenced by the architecture — computed here, not in
 * calendar-client.ts, because "today" vs "tomorrow" is meaningless
 * without a reference instant (`now`) and this module owns that
 * decision independently of the API-fetch layer.
 */
export interface BucketedEvent extends RawCalendarEvent {
  day: DayBucket;
}

/**
 * Sorts events by their real epoch millisecond timestamp, ascending.
 *
 * This is the direct fix for issue #6: the old bash pipeline sorted
 * event rows as *strings* (`sort` on a "H:MM" text column), which is
 * lexicographic, not numeric — "10:00" sorts before "9:00" because "1"
 * < "9" as characters. Comparing `startEpoch` numbers sidesteps that
 * whole class of bug by construction; there is no string comparison
 * anywhere in the sort path.
 *
 * Returns a new array; does not mutate the input.
 */
export function sortEventsByStart<T extends { startEpoch: number }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.startEpoch - b.startEpoch);
}

/**
 * Computes the "today" window `[start, end)` for the given instant in
 * the given zone: midnight of `now`'s calendar date in `zone`, through
 * (but not including) midnight the following day.
 *
 * All day-boundary math routes through this single function — and its
 * sibling `tomorrowWindow` — so there is exactly one place in the
 * codebase that decides "where does today start," which is what
 * `date-boundary.test.ts` pins down directly. This replaces
 * `timezone.sh`'s hand-rolled `TZ=... date -v` / sed offset arithmetic,
 * which was empirically confirmed to produce UTC day boundaries off by
 * hours in the wrong direction for at least one zone (issue #8/#12).
 */
export function todayWindow(now: DateTime, zone: string): { start: DateTime; end: DateTime } {
  const start = now.setZone(zone).startOf('day');
  return { start, end: start.plus({ days: 1 }) };
}

/** The day immediately following `todayWindow`'s day, same zone. */
export function tomorrowWindow(now: DateTime, zone: string): { start: DateTime; end: DateTime } {
  const { end } = todayWindow(now, zone);
  return { start: end, end: end.plus({ days: 1 }) };
}

/**
 * Buckets events into "today" / "tomorrow" (relative to `now`, in
 * `zone`) and drops anything outside that two-day window. Events are
 * bucketed on the *instant* `startEpoch` represents, reinterpreted in
 * `zone` — this is well-defined for both timed events (their epoch is
 * an unambiguous instant) and all-day events (calendar-client.ts
 * already anchors their epoch to midnight *in this same zone*, so no
 * further zone juggling happens here; see calendar-client.ts's mapEvent
 * doc comment for why that anchoring matters).
 *
 * Uses closed-open interval semantics (`start <= t < end`) consistently
 * for both buckets, so an event landing exactly on a day boundary is
 * assigned to exactly one bucket, never both and never neither — this
 * is the fix for issue #8/#12's "events from yesterday showing as
 * today" / all-day event duplication at the boundary.
 */
export function bucketEventsByDay(
  events: RawCalendarEvent[],
  zone: string,
  now: DateTime = DateTime.local(),
): BucketedEvent[] {
  const today = todayWindow(now, zone);
  const tomorrow = tomorrowWindow(now, zone);

  const bucketed: BucketedEvent[] = [];
  for (const event of events) {
    const instant = DateTime.fromMillis(event.startEpoch, { zone });
    if (instant >= today.start && instant < today.end) {
      bucketed.push({ ...event, day: 'today' });
    } else if (instant >= tomorrow.start && instant < tomorrow.end) {
      bucketed.push({ ...event, day: 'tomorrow' });
    }
    // else: outside the today/tomorrow window — silently dropped. The
    // caller (fetch-events.ts) is expected to have already scoped its
    // Calendar API query to roughly this window, so this branch is a
    // defensive backstop, not the primary filter.
  }
  return bucketed;
}

/**
 * Formats a single event's display time.
 *
 * - All-day events render as the literal string `'All day'` — they have
 *   no meaningful clock time (`start.date` is a bare calendar date, not
 *   an instant), so formatting their midnight-anchored epoch as "12:00
 *   AM" would be actively misleading.
 * - Timed events render via luxon in `zone`, honoring `hour12`:
 *   `'h:mm a'` (e.g. "9:00 AM") when true, `'HH:mm'` (e.g. "09:00" /
 *   "21:00", zero-padded) when false. This is issue #6's other half —
 *   the old CoffeeScript had no 12-hour/24-hour toggle at all.
 */
export function formatEventTime(
  event: Pick<RawCalendarEvent, 'startEpoch' | 'isAllDay'>,
  zone: string,
  hour12: boolean,
): string {
  if (event.isAllDay) return 'All day';
  const dt = DateTime.fromMillis(event.startEpoch, { zone });
  return dt.toFormat(hour12 ? 'h:mm a' : 'HH:mm');
}

/**
 * End-to-end formatting pipeline: bucket into today/tomorrow, sort each
 * bucket by real start time, and render each event into the final
 * `CalendarEvent` shape fetch-events.ts prints as part of the
 * `WidgetPayload`.
 */
export function formatEvents(
  events: RawCalendarEvent[],
  zone: string,
  hour12: boolean,
  now: DateTime = DateTime.local(),
): { today: CalendarEvent[]; tomorrow: CalendarEvent[] } {
  const bucketed = bucketEventsByDay(events, zone, now);
  const sorted = sortEventsByStart(bucketed);

  const today: CalendarEvent[] = [];
  const tomorrow: CalendarEvent[] = [];
  for (const event of sorted) {
    const formatted: CalendarEvent = {
      id: event.id,
      displayTime: formatEventTime(event, zone, hour12),
      summary: event.summary,
      startEpoch: event.startEpoch,
    };
    (event.day === 'today' ? today : tomorrow).push(formatted);
  }

  return { today, tomorrow };
}
