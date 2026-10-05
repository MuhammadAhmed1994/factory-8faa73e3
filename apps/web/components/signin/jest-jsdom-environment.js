"use strict";

/**
 * A minimal jsdom test environment.
 *
 * Why this exists: `jest.config.js` (protected, shared with every task in this
 * package) defensively falls back to the `node` test environment when
 * `jest-environment-jsdom` cannot be resolved — and in this workspace it cannot:
 * only `jsdom` itself is installed. Component specs need a real DOM.
 *
 * Jest lets a suite pick its environment with a docblock pragma that resolves a
 * path relative to the package `rootDir`, so `signin.spec.tsx` declares
 * `@jest-environment ./components/signin/jest-jsdom-environment` and this file
 * supplies the DOM. Nothing about the shared config has to change, and suites
 * that do not ask for it keep the default environment.
 *
 * The file is plain JavaScript and sits outside `__tests__` on purpose: jest's
 * default `testMatch` would otherwise treat it as a test suite of its own, and
 * `tsconfig.json` only includes `*.ts`/`*.tsx` so it stays out of type-checking.
 */

const { TestEnvironment } = require("jest-environment-node");
const { JSDOM } = require("jsdom");

/**
 * Exposes one JSDOM window as the suite's global.
 *
 * Only what React and Testing Library actually touch is copied over; anything a
 * future spec needs can be added to the same list.
 */
module.exports = class JSDOMTestEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);

    this.dom = new JSDOM(
      "<!DOCTYPE html><html lang=\"en\"><head></head><body></body></html>",
      {
        pretendToBeVisual: true,
        runScripts: "dangerously",
        url: "http://localhost/",
      },
    );
  }

  async setup() {
    await super.setup();

    const { window } = this.dom;

    // The window itself, plus the constructors and helpers the DOM assertions
    // and React's event system reach for.
    this.global.window = window;
    this.global.document = window.document;
    this.global.navigator = window.navigator;
    this.global.location = window.location;
    this.global.history = window.history;
    this.global.CustomEvent = window.CustomEvent;
    this.global.Event = window.Event;
    this.global.KeyboardEvent = window.KeyboardEvent;
    this.global.MouseEvent = window.MouseEvent;
    this.global.Node = window.Node;
    this.global.Element = window.Element;
    this.global.HTMLElement = window.HTMLElement;
    this.global.HTMLInputElement = window.HTMLInputElement;
    this.global.HTMLFormElement = window.HTMLFormElement;
    this.global.SVGElement = window.SVGElement;
    this.global.getComputedStyle = window.getComputedStyle.bind(window);
    this.global.requestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    this.global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

    // `HTMLElement.prototype.focus` reads `document.activeElement`, which lives
    // on the jsdom document; `window.focus`/`window.blur` need rebinding.
    this.global.focus = window.focus.bind(window);
    this.global.blur = window.blur.bind(window);
  }

  async teardown() {
    if (this.dom) {
      this.dom.window.close();
      this.dom = null;
    }
    await super.teardown();
  }

  getVmContext() {
    return super.getVmContext();
  }
};
