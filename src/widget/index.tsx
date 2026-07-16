/**
 * Übersicht widget entry point. Built by esbuild (jsx: 'preserve',
 * platform: 'neutral', format: 'esm' — see esbuild.config.mjs widget
 * target comment for why) into calendar.widget/index.jsx, then re-bundled
 * by Übersicht's own browserify+babel pass, which is what actually turns
 * the literal JSX below into calls against the ambient `html()` global
 * (see architecture note §0 fact #6 / src/widget/jsx.d.ts) — there is no
 * `react` import here, deliberately.
 *
 * `command` shells out to the compiled CLI bundle at
 * calendar.widget/lib/fetch-events.js. Übersicht always runs `command`
 * with cwd = the widgets ROOT folder
 * (`~/Library/Application Support/Übersicht/widgets/`), never this
 * widget's own subfolder — confirmed via live smoke test against a
 * second widget (tsushin.widget) on this machine. That's why the path
 * below is built as `$PWD/calendar.widget/...` rather than a bare
 * relative path. Übersicht's own `runShellCommand` captures stdout on
 * success and dispatches
 * `UB/COMMAND_RAN` with `{output}`; `updateState` below parses that
 * single JSON line against the WidgetPayload contract fetch-events.ts
 * writes (see src/cli/types.ts / fetch-events.ts).
 */
import { run } from 'uebersicht';

// Matches the original calendar.coffee's `refreshFrequency: '30m'`.
const REFRESH_MS = 30 * 60 * 1000;

// Original hardcoded position. The widget runs in a WKWebView with no
// filesystem access (Übersicht maps `fs` to an empty stub there — see
// esbuild.config.mjs widget target comment), so this is the fallback used
// whenever config.json has no (or an invalid) `position` set, not
// something read from disk by the widget itself.
const DEFAULT_POSITION: Position = { top: '15%', left: '2%' };

type Position = { left: string; top: string };

function isValidPosition(value: unknown): value is Position {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Position).left === 'string' &&
    typeof (value as Position).top === 'string'
  );
}

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

type WidgetPayload = (
  | { ok: true; data: WidgetEventGroups }
  | { ok: false; error: WidgetError }
) & { position?: Position };

type State = (
  | { status: 'loading' }
  | { status: 'ok'; data: WidgetEventGroups }
  | { status: 'error'; message: string }
) & { position: Position };

type CommandEvent = { output?: string; error?: unknown };

const refreshFrequency = REFRESH_MS;

const command = () => run('node --no-warnings "$PWD/calendar.widget/lib/fetch-events.js"');

const initialState: State = { status: 'loading', position: DEFAULT_POSITION };

function updateState(event: CommandEvent, prevState: State): State {
  // Config-derived position carries forward across ticks: a tick with no
  // (or an invalid) position — command error, malformed output, or a
  // config that never set one — keeps whatever was last known instead of
  // snapping back to DEFAULT_POSITION.
  const position = prevState.position;

  if (event.error) {
    return { status: 'error', message: String(event.error), position };
  }

  let payload: WidgetPayload;
  try {
    payload = JSON.parse(event.output ?? '');
  } catch {
    return { status: 'error', message: 'Malformed output from fetch-events.js', position };
  }

  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    return { status: 'error', message: 'Malformed output from fetch-events.js', position };
  }

  const nextPosition = isValidPosition(payload.position) ? payload.position : position;

  return payload.ok
    ? { status: 'ok', data: payload.data, position: nextPosition }
    : { status: 'error', message: payload.error.message, position: nextPosition };
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

// Position (config.json's `position`, falling back to DEFAULT_POSITION) is
// applied per-render as an inline style rather than baked into `className`.
// Übersicht's client calls `css(implementation.className)` exactly once at
// widget creation/update, passing the export straight into emotion's css()
// — it never invokes it as a function with the current state. `render`,
// however, genuinely is re-invoked every tick, so per-tick position must
// live here.
// `top`/`left` alone have no effect in CSS — they only apply once an
// element's `position` is taken out of the default `static` flow. That's
// why configuring an extreme position (e.g. { left: '20%', top: '30%' })
// previously rendered fine but never visibly moved: nothing here ever set
// `position`.
//
// Use `fixed`, not `absolute`. Übersicht's own wrapper (`contentEl`,
// class="widget") is `position: absolute` (from main.css) but has no
// explicit width/height, so it collapses to zero size. An `absolute` child
// would resolve percentage top/left against that zero-size box and
// effectively never move. `fixed` instead resolves against the viewport
// (`#uebersicht`/`body`/`html` are explicitly 100% width/height in
// main.css), so percentage offsets work regardless of the zero-size
// ancestor chain. Do not "simplify" this back to `absolute`.
function positionStyle(state: State) {
  return {
    position: 'fixed' as const,
    top: state.position.top,
    left: state.position.left,
  };
}

function render(state: State) {
  if (state.status === 'loading') {
    return (
      <div className="cal" style={positionStyle(state)}>
        Loading…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="cal cal-error" style={positionStyle(state)}>
        ⚠ {state.message}
      </div>
    );
  }
  return (
    <div className="cal" style={positionStyle(state)}>
      {renderDay('-- Today -----', state.data.today)}
      {renderDay('-- Tomorrow --', state.data.tomorrow)}
    </div>
  );
}

// Visual styling mirrors the original calendar.coffee's Stylus block
// (font-family "hack", accent color #df740c, title color #ffe64d).
// A plain string, not a function: Übersicht's client calls
// `css(implementation.className)` exactly once, at widget creation and on
// each `api.update`, and passes the export straight into emotion's `css()`
// — it is never invoked with the current state. A function here gets its
// source stringified by emotion instead of executed, producing an invalid
// class and a blank-rendering widget ("Functions that are interpolated in
// css calls will be stringified"). top/left are NOT baked in here because
// they're config-driven and per-tick — see positionStyle()/render() above.
const className = `
  font-family: Hack, "Andale Mono", Menlo, Monaco, Courier, "Helvetica Neue", Osaka, monospace;
  color: #df740c;
  font-weight: 100;
  font-size: 11px;
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

// ESM named exports, not `module.exports`: the widget bundle is emitted as
// esm (see esbuild.config.mjs widget target comment) and `module` does not
// exist in that output.
export {
  refreshFrequency,
  command,
  initialState,
  updateState,
  render,
  positionStyle,
  className,
};
