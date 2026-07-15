import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { bucketEventsByDay, todayWindow, tomorrowWindow } from '../src/cli/format.js';
import type { RawCalendarEvent } from '../src/cli/calendar-client.js';

function timed(id: string, zone: string, isoLocal: string): RawCalendarEvent {
  return {
    id,
    summary: id,
    startEpoch: DateTime.fromISO(isoLocal, { zone }).toMillis(),
    isAllDay: false,
  };
}

function allDay(id: string, zone: string, isoDate: string): RawCalendarEvent {
  return {
    id,
    summary: id,
    startEpoch: DateTime.fromISO(isoDate, { zone }).toMillis(),
    isAllDay: true,
  };
}

describe('todayWindow / tomorrowWindow', () => {
  const zones = ['America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Chatham'];

  it.each(zones)('produces a contiguous, non-overlapping [today, tomorrow) pair in %s', (zone) => {
    const now = DateTime.fromISO('2024-06-10T15:30:00', { zone: 'utc' });

    const today = todayWindow(now, zone);
    const tomorrow = tomorrowWindow(now, zone);

    // today.start is exactly midnight in `zone`.
    expect(today.start.setZone(zone).hour).toBe(0);
    expect(today.start.setZone(zone).minute).toBe(0);

    // today's window is exactly one day-plus-of-clock-time wide (24h,
    // or 23h/25h across a DST jump — asserted separately below).
    expect(today.end.toMillis()).toBe(today.start.plus({ days: 1 }).toMillis());

    // tomorrow starts exactly where today ends: no gap, no overlap.
    expect(tomorrow.start.toMillis()).toBe(today.end.toMillis());
    expect(tomorrow.end.toMillis()).toBe(tomorrow.start.plus({ days: 1 }).toMillis());
  });

  it('handles a half-hour UTC offset zone (Asia/Kolkata, UTC+5:30)', () => {
    const now = DateTime.fromISO('2024-06-10T15:30:00', { zone: 'utc' });
    const { start } = todayWindow(now, 'Asia/Kolkata');
    // Midnight IST on 2024-06-10 is 2024-06-09T18:30:00Z.
    expect(start.toUTC().toISO()).toBe('2024-06-09T18:30:00.000Z');
  });

  it('handles a 45-minute UTC offset zone (Pacific/Chatham)', () => {
    const now = DateTime.fromISO('2024-06-10T15:30:00', { zone: 'utc' });
    const { start } = todayWindow(now, 'Pacific/Chatham');
    expect(start.setZone('Pacific/Chatham').hour).toBe(0);
    expect(start.setZone('Pacific/Chatham').minute).toBe(0);
  });

  it('produces a 23-hour "today" window across a DST spring-forward transition', () => {
    // In America/Los_Angeles, DST began 2024-03-10 at 2:00 AM (clocks
    // jump to 3:00 AM), so the calendar day 2024-03-10 is only 23 hours
    // of real elapsed time. This is the exact class of bug the original
    // timezone.sh's `date -v`/sed arithmetic was empirically observed to
    // get wrong (issue #8/#12) — luxon's startOf('day')/plus({days:1})
    // gets it right by construction because it operates on wall-clock
    // calendar days, not fixed 24h durations.
    const now = DateTime.fromISO('2024-03-10T20:00:00', { zone: 'utc' });
    const { start, end } = todayWindow(now, 'America/Los_Angeles');

    expect(end.diff(start, 'hours').hours).toBe(23);
    expect(start.setZone('America/Los_Angeles').toFormat('yyyy-MM-dd HH:mm')).toBe(
      '2024-03-10 00:00',
    );
    expect(end.setZone('America/Los_Angeles').toFormat('yyyy-MM-dd HH:mm')).toBe(
      '2024-03-11 00:00',
    );
  });
});

describe('bucketEventsByDay', () => {
  const zone = 'America/Los_Angeles';
  // "now" is 2024-06-10 14:00 PDT.
  const now = DateTime.fromISO('2024-06-10T14:00:00', { zone });

  it('buckets an event just after midnight as today, not yesterday', () => {
    // Regression case for issue #8/#12: "events from yesterday showing
    // as today" was traced to UTC day-boundary math being off by hours.
    // 00:05 local on 2024-06-10 must land in today's bucket, not
    // tomorrow's and not get silently dropped as "yesterday".
    const event = timed('midnight-plus-5', zone, '2024-06-10T00:05:00');
    const bucketed = bucketEventsByDay([event], zone, now);
    expect(bucketed).toEqual([{ ...event, day: 'today' }]);
  });

  it('buckets an event one minute before midnight as today, and the next as tomorrow', () => {
    const lastMinuteToday = timed('23:59', zone, '2024-06-10T23:59:00');
    const firstMinuteTomorrow = timed('00:00', zone, '2024-06-11T00:00:00');

    const bucketed = bucketEventsByDay([lastMinuteToday, firstMinuteTomorrow], zone, now);

    expect(bucketed.find((e) => e.id === '23:59')?.day).toBe('today');
    expect(bucketed.find((e) => e.id === '00:00')?.day).toBe('tomorrow');
  });

  it('drops events outside the today/tomorrow window', () => {
    const yesterday = timed('yesterday', zone, '2024-06-09T23:00:00');
    const dayAfterTomorrow = timed('day-after-tomorrow', zone, '2024-06-12T00:30:00');

    const bucketed = bucketEventsByDay([yesterday, dayAfterTomorrow], zone, now);

    expect(bucketed).toEqual([]);
  });

  it('buckets an all-day event on the correct day without duplicating it', () => {
    // Regression case for the all-day-event-duplicates part of #8/#12.
    // An all-day event for 2024-06-10 must appear exactly once, in
    // today's bucket — not in both today's and tomorrow's buckets, and
    // not dropped entirely.
    const event = allDay('all-day-today', zone, '2024-06-10');
    const bucketed = bucketEventsByDay([event], zone, now);

    expect(bucketed).toHaveLength(1);
    expect(bucketed[0]).toEqual({ ...event, day: 'today' });
  });

  it('buckets an all-day tomorrow event into tomorrow, not today', () => {
    const event = allDay('all-day-tomorrow', zone, '2024-06-11');
    const bucketed = bucketEventsByDay([event], zone, now);

    expect(bucketed).toEqual([{ ...event, day: 'tomorrow' }]);
  });

  it('buckets correctly across a DST spring-forward day', () => {
    // "now" during the DST-transition day itself (2024-03-10 in
    // America/Los_Angeles, a 23-hour day). An event at 1:30 AM local
    // (before the 2:00 AM jump) must still land in "today".
    const dstNow = DateTime.fromISO('2024-03-10T20:00:00', { zone: 'utc' }); // noon-ish PST/PDT
    const beforeJump = timed('before-jump', zone, '2024-03-10T01:30:00');
    const afterJump = timed('after-jump', zone, '2024-03-10T10:00:00');

    const bucketed = bucketEventsByDay([beforeJump, afterJump], zone, dstNow);

    expect(bucketed.find((e) => e.id === 'before-jump')?.day).toBe('today');
    expect(bucketed.find((e) => e.id === 'after-jump')?.day).toBe('today');
  });
});
