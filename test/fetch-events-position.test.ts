import { describe, expect, it, vi, afterEach } from 'vitest';

// fetch-events.ts runs main() as a side effect of being imported (its
// output is a single stdout JSON line, per its own module comment) — so
// these tests mock its collaborators and capture the stdout write rather
// than calling an exported function. Only loadConfig is exercised for
// real; auth is forced to fail so the test never touches the network,
// which also exercises the "position survives even when the rest of the
// request fails" contract described in fetch-events.ts's WidgetPayload
// comment.

const mockConfig: { value: Record<string, unknown> } = { value: {} };

vi.mock('../src/cli/config.js', () => ({
  loadConfig: () => mockConfig.value,
}));

vi.mock('../src/cli/auth.js', () => ({
  createAuthorizedClient: () => {
    throw new Error('network disabled in test');
  },
}));

afterEach(() => {
  vi.resetModules();
});

async function runAndCaptureStdout(): Promise<unknown> {
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await import('../src/cli/fetch-events.js');
    await vi.waitFor(() => expect(writeSpy).toHaveBeenCalled());
    const written = writeSpy.mock.calls[0]?.[0];
    return JSON.parse(String(written));
  } finally {
    writeSpy.mockRestore();
  }
}

describe('fetch-events.ts stdout payload — position pass-through', () => {
  it('includes position in the payload when config.json has one set', async () => {
    mockConfig.value = {
      calendarNames: ['primary'],
      hour12: true,
      position: { left: '10%', top: '20%' },
    };

    const payload = (await runAndCaptureStdout()) as { position?: unknown };
    expect(payload.position).toEqual({ left: '10%', top: '20%' });
  });

  it('omits position from the payload when config.json has none set', async () => {
    mockConfig.value = {
      calendarNames: ['primary'],
      hour12: true,
    };

    const payload = (await runAndCaptureStdout()) as { position?: unknown };
    expect(payload.position).toBeUndefined();
  });
});
