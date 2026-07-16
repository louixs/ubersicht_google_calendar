import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../src/cli/types.js';

const BASE = { calendarNames: ['primary'], hour12: true };

describe('ConfigSchema — position field', () => {
  it('accepts a valid position', () => {
    const result = ConfigSchema.safeParse({ ...BASE, position: { left: '2%', top: '15%' } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toEqual({ left: '2%', top: '15%' });
    }
  });

  it('parses fine with no position set at all', () => {
    const result = ConfigSchema.safeParse({ ...BASE });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBeUndefined();
    }
  });

  it.each([
    ['wrong types', { left: 2, top: 15 }],
    ['missing top', { left: '2%' }],
    ['missing left', { top: '15%' }],
    ['empty strings', { left: '', top: '' }],
    ['not an object', 'top-left'],
    ['null', null],
    ['array', ['2%', '15%']],
  ])('degrades a malformed position (%s) to absent, without failing the whole config', (_label, badPosition) => {
    const result = ConfigSchema.safeParse({ ...BASE, position: badPosition });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBeUndefined();
    }
  });
});
