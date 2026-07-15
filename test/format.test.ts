import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { formatEventTime, sortEventsByStart } from '../src/cli/format.js';
import type { RawCalendarEvent } from '../src/cli/calendar-client.js';

const ZONE = 'America/Los_Angeles';

// Builds an epoch for a given "YYYY-MM-DDTHH:mm" wall-clock string
// interpreted in ZONE, independently of the format.ts code under test.
function epochInZone(isoLocal: string): number {
  return DateTime.fromISO(isoLocal, { zone: ZONE }).toMillis();
}

function timedEvent(id: string, isoLocal: string): RawCalendarEvent {
  return { id, summary: id, startEpoch: epochInZone(isoLocal), isAllDay: false };
}

describe('sortEventsByStart', () => {
  it('sorts by real epoch value, not lexicographic time-string order', () => {
    // Regression test for issue #6: the old bash pipeline sorted the
    // "H:MM" text column as strings, so "10:00" < "9:00" lexicographically
    // even though 9:00 comes first chronologically.
    const events = [
      timedEvent('ten', '2024-06-10T10:00'),
      timedEvent('nine', '2024-06-10T09:00'),
      timedEvent('nine-thirty', '2024-06-10T09:30'),
    ];

    const sorted = sortEventsByStart(events);

    expect(sorted.map((e) => e.id)).toEqual(['nine', 'nine-thirty', 'ten']);
  });

  it('does not mutate the input array', () => {
    const events = [timedEvent('b', '2024-06-10T10:00'), timedEvent('a', '2024-06-10T09:00')];
    const original = [...events];
    sortEventsByStart(events);
    expect(events).toEqual(original);
  });
});

describe('formatEventTime', () => {
  it('formats 12-hour times with AM/PM, including noon and midnight', () => {
    expect(formatEventTime(timedEvent('e', '2024-06-10T09:00'), ZONE, true)).toBe('9:00 AM');
    expect(formatEventTime(timedEvent('e', '2024-06-10T21:00'), ZONE, true)).toBe('9:00 PM');
    expect(formatEventTime(timedEvent('e', '2024-06-10T12:00'), ZONE, true)).toBe('12:00 PM');
    expect(formatEventTime(timedEvent('e', '2024-06-10T00:00'), ZONE, true)).toBe('12:00 AM');
  });

  it('formats 24-hour times with zero-padded hours', () => {
    expect(formatEventTime(timedEvent('e', '2024-06-10T09:00'), ZONE, false)).toBe('09:00');
    expect(formatEventTime(timedEvent('e', '2024-06-10T21:00'), ZONE, false)).toBe('21:00');
    expect(formatEventTime(timedEvent('e', '2024-06-10T00:00'), ZONE, false)).toBe('00:00');
  });

  it('renders all-day events as "All day" regardless of hour12', () => {
    const allDay: RawCalendarEvent = {
      id: 'ad',
      summary: 'All-day event',
      startEpoch: epochInZone('2024-06-10T00:00'),
      isAllDay: true,
    };
    expect(formatEventTime(allDay, ZONE, true)).toBe('All day');
    expect(formatEventTime(allDay, ZONE, false)).toBe('All day');
  });
});
