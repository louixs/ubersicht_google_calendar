// Ambient JSX typing for Übersicht's `.jsx` widget runtime.
//
// Übersicht's own babel pass (preset-react, `pragma: 'html'`) transforms
// literal JSX syntax into calls against an ambient `window.html` global
// that VirtualDomWidget.js sets up at widget-bundle time — there is no
// `react` module to import or require here (see architecture note §2).
// This file exists purely to keep `tsc --noEmit` happy without pulling
// in `@types/react`.
declare namespace JSX {
  interface Element {
    [key: string]: unknown;
  }
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

// `uebersicht` is a runtime-only helper module Übersicht injects and
// marks `external` at widget-bundle time (see architecture note §0 fact
// #2) — it has no published types, so this ambient declaration covers
// just the bits src/widget/index.tsx actually uses.
declare module 'uebersicht' {
  export function run(command: string): Promise<string>;
}
