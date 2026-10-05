/**
 * DOM bootstrap for Jest runs in the `node` test environment.
 *
 * `apps/web/jest.config.js` resolves `testEnvironment` defensively: it uses
 * `jest-environment-jsdom` whenever that package is installed, and otherwise
 * falls back to `node` rather than failing. In a checkout where only the
 * workspace's hoisted dependencies are present, `jsdom` itself resolves while
 * `jest-environment-jsdom` does not — so a DOM-dependent component spec would
 * otherwise die with `ReferenceError: document is not defined`.
 *
 * This module closes that gap. Imported as the **first** import of a spec, it
 * installs a jsdom `window`/`document` onto `globalThis` when (and only when)
 * no DOM is present yet. Under a real `jest-environment-jsdom` run it is a
 * no-op, so the same spec works in both environments.
 *
 * Two rules keep it safe:
 *
 * 1. Jest/Node keep their own globals (`console`, `process`, `fetch`, the
 *    timers…) so test output, fake timers and the mock registry are untouched.
 * 2. An existing global is **never overwritten**. Overwriting is what breaks a
 *    node env: jsdom's `Performance#now` implementation calls the *global*
 *    `performance`, so replacing Node's with jsdom's recurses forever. Adding
 *    only what is missing (`document`, `navigator`, `HTMLElement`,
 *    `getComputedStyle`, …) gives React and Testing Library a real DOM without
 *    that trap.
 */

/** Shape of the `jsdom` module we need, declared locally to avoid needing @types/jsdom. */
interface JSDOMModule {
  readonly JSDOM?: new (
    html?: string,
    options?: Record<string, unknown>,
  ) => { readonly window: Record<string, unknown> };
}

/** Globals Jest and Node own outright — never redefined by the DOM. */
const NODE_OWNED = new Set([
  "console",
  "process",
  "Buffer",
  "global",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "fetch",
  "jest",
  "performance",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "structuredClone",
  "MessageChannel",
  "MessagePort",
  "MessageEvent",
  "AbortController",
  "AbortSignal",
]);

/**
 * Window-only bookkeeping that has no business on a test global (indexed frame
 * self-references, `window.length`, `window.name`, …).
 */
const WINDOW_ONLY = new Set([
  "closed",
  "frames",
  "length",
  "name",
  "opener",
  "origin",
  "status",
  "top",
  "parent",
  "self",
  "window",
]);

/** True when a DOM is already installed (real jsdom test environment). */
function hasDom(): boolean {
  return (
    typeof globalThis.window !== "undefined" &&
    typeof globalThis.document !== "undefined"
  );
}

/** Loads `jsdom` if it is resolvable, without letting a miss throw at import time. */
function loadJSDOM(): JSDOMModule["JSDOM"] | null {
  try {
    const mod = require("jsdom") as JSDOMModule;
    return mod.JSDOM ?? null;
  } catch {
    return null;
  }
}

/** True when `key` is a pure index (jsdom exposes `window[0]` → itself). */
function isIndexKey(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key);
}

/** Installs the jsdom window onto `globalThis`. Safe to call more than once. */
export function installJSDomGlobal(): void {
  if (hasDom()) return;

  const JSDOM = loadJSDOM();
  if (JSDOM === null) return;

  const dom = new JSDOM(
    "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>",
    { url: "http://localhost/", pretendToBeVisual: true, userAgent: "jsdom" },
  );

  const window = dom.window;
  const target = globalThis as unknown as Record<string, unknown>;

  for (const key of Object.getOwnPropertyNames(window)) {
    if (NODE_OWNED.has(key) || WINDOW_ONLY.has(key) || isIndexKey(key)) continue;

    // Never shadow an existing global: see the note on `performance` above.
    if (typeof target[key] !== "undefined") continue;

    try {
      const value = window[key];
      if (typeof value === "undefined") continue;
      target[key] = value;
    } catch {
      // Some window properties are accessors that throw on read; skip them.
    }
  }

  // `window`, `self`, `top` and `parent` all reference the jsdom window itself.
  target.window = window;
  target.self = window;
  target.top = window;
  target.parent = window;
}

installJSDomGlobal();

export default installJSDomGlobal;
