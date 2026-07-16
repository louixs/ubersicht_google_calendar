import { describe, expect, it, vi } from 'vitest';

// The widget module imports the 'uebersicht' runtime helper, which only
// exists as an ambient type declaration (src/widget/jsx.d.ts) — Übersicht
// injects the real thing at widget-load time and esbuild marks it
// `external`. Mock it so the module can be imported under vitest/node.
vi.mock('uebersicht', () => ({ run: () => Promise.resolve('') }));

const { initialState, updateState, className, positionStyle } = await import(
  '../src/widget/index.js'
);

const DEFAULT_POSITION = { top: '15%', left: '2%' };
const CONFIGURED_POSITION = { left: '10%', top: '20%' };

function okOutput(position?: unknown): string {
  return JSON.stringify({ ok: true, data: { today: [], tomorrow: [] }, position });
}

describe('widget updateState — position', () => {
  it('starts at the default position before any tick has run', () => {
    expect(initialState.position).toEqual(DEFAULT_POSITION);
  });

  it('adopts a valid configured position from a successful tick', () => {
    const next = updateState({ output: okOutput(CONFIGURED_POSITION) }, initialState);
    expect(next.position).toEqual(CONFIGURED_POSITION);
  });

  it('falls back to the previous position when the payload has none', () => {
    const withConfigured = updateState({ output: okOutput(CONFIGURED_POSITION) }, initialState);
    const next = updateState({ output: okOutput(undefined) }, withConfigured);
    expect(next.position).toEqual(CONFIGURED_POSITION);
  });

  it('falls back to the previous position when the payload position is malformed', () => {
    const withConfigured = updateState({ output: okOutput(CONFIGURED_POSITION) }, initialState);
    const next = updateState(
      { output: okOutput({ left: 5, top: 5 }) },
      withConfigured,
    );
    expect(next.position).toEqual(CONFIGURED_POSITION);
  });

  it('keeps the last-known position across a command error tick', () => {
    const withConfigured = updateState({ output: okOutput(CONFIGURED_POSITION) }, initialState);
    const next = updateState({ error: new Error('boom') }, withConfigured);
    expect(next.position).toEqual(CONFIGURED_POSITION);
    expect(next.status).toBe('error');
  });

  it('keeps the last-known position across malformed JSON output', () => {
    const withConfigured = updateState({ output: okOutput(CONFIGURED_POSITION) }, initialState);
    const next = updateState({ output: 'not json' }, withConfigured);
    expect(next.position).toEqual(CONFIGURED_POSITION);
    expect(next.status).toBe('error');
  });
});

describe('widget positionStyle', () => {
  // Regression test: top/left alone have no effect in CSS unless `position`
  // is also set to something other than the default `static`. See
  // positionStyle() in src/widget/index.tsx for why `fixed` specifically
  // (not `absolute`) is required.
  it('sets position: fixed alongside the configured top/left', () => {
    const state = { ...initialState, position: CONFIGURED_POSITION };
    expect(positionStyle(state)).toEqual({
      position: 'fixed',
      top: CONFIGURED_POSITION.top,
      left: CONFIGURED_POSITION.left,
    });
  });
});

describe('widget className', () => {
  // Regression test: Übersicht's client calls `css(implementation.className)`
  // exactly once (at widget creation and on api.update) and never re-invokes
  // it with per-tick state. If className is a function, emotion stringifies
  // its source instead of executing it, producing an invalid class and a
  // blank-rendering widget. Position must instead be applied per-render via
  // an inline style (see render()/positionStyle() in src/widget/index.tsx).
  it('is exported as a static string, not a function', () => {
    expect(typeof className).toBe('string');
  });
});
