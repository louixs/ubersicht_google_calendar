/**
 * Übersicht widget entry point. Built by esbuild (jsx: 'preserve',
 * platform: 'browser') into calendar.widget/index.jsx, then re-bundled
 * by Übersicht's own browserify+babel pass, which is what actually turns
 * the literal JSX below into calls against the ambient `html()` global
 * (see architecture note §0 fact #6 / src/widget/jsx.d.ts) — there is no
 * `react` import here, deliberately.
 *
 * `command` shells out to the compiled CLI bundle at lib/fetch-events.js
 * (cwd = this file's directory at runtime, per architecture note §0
 * fact #5 — no PWD-depth arithmetic needed). Übersicht's own
 * `runShellCommand` captures stdout on success and dispatches
 * `UB/COMMAND_RAN` with `{output}`; `updateState` below parses that
 * single JSON line against the WidgetPayload contract fetch-events.ts
 * writes (see src/cli/types.ts / fetch-events.ts).
 */
import { run } from 'uebersicht';

// Matches the original calendar.coffee's `refreshFrequency: '30m'`.
const REFRESH_MS = 30 * 60 * 1000;

type CalendarEvent = {
  id: string;
  displayTime: string;
  summary: string;
  startEpoch: number;
};

type WidgetEventGroups = {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
};

type WidgetError = {
  kind: 'auth' | 'network' | 'config' | 'unknown';
  message: string;
};

type WidgetPayload = { ok: true; data: WidgetEventGroups } | { ok: false; error: WidgetError };

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: WidgetEventGroups }
  | { status: 'error'; message: string };

type CommandEvent = { output?: string; error?: unknown };

const refreshFrequency = REFRESH_MS;

const command = () => run('node lib/fetch-events.js');

const initialState: State = { status: 'loading' };

function updateState(event: CommandEvent, prevState: State): State {
  if (event.error) {
    return { status: 'error', message: String(event.error) };
  }

  let payload: WidgetPayload;
  try {
    payload = JSON.parse(event.output ?? '');
  } catch {
    return { status: 'error', message: 'Malformed output from fetch-events.js' };
  }

  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    return { status: 'error', message: 'Malformed output from fetch-events.js' };
  }

  return payload.ok
    ? { status: 'ok', data: payload.data }
    : { status: 'error', message: payload.error.message };
}

function renderDay(title: string, events: CalendarEvent[]) {
  return (
    <div className="cal-day">
      <div className="cal-title">{title}</div>
      {events.length === 0 ? (
        <div className="cal-empty">No events</div>
      ) : (
        events.map((e) => (
          <div key={e.id} className="cal-row">
            <span className="cal-time">{e.displayTime}</span>
            <span className="cal-name">{e.summary}</span>
          </div>
        ))
      )}
    </div>
  );
}

function render(state: State) {
  if (state.status === 'loading') {
    return <div className="cal">Loading…</div>;
  }
  if (state.status === 'error') {
    return <div className="cal cal-error">⚠ {state.message}</div>;
  }
  return (
    <div className="cal">
      {renderDay('-- Today -----', state.data.today)}
      {renderDay('-- Tomorrow --', state.data.tomorrow)}
    </div>
  );
}

// Visual styling mirrors the original calendar.coffee's Stylus block
// (font-family "hack", accent color #df740c, title color #ffe64d).
const className = `
  font-family: Hack, "Andale Mono", Menlo, Monaco, Courier, "Helvetica Neue", Osaka, monospace;
  color: #df740c;
  font-weight: 100;
  font-size: 11px;
  top: 15%;
  left: 2%;
  line-height: 1.5;

  .cal-title {
    color: #ffe64d;
    text-shadow: 0 0 1px rgba(0, 0, 0, 0.5);
    margin-top: 8px;
  }

  .cal-error {
    color: #ff6b6b;
  }

  .cal-row {
    display: flex;
  }

  .cal-time {
    min-width: 70px;
    display: inline-block;
  }
`;

module.exports = {
  refreshFrequency,
  command,
  initialState,
  updateState,
  render,
  className,
};
