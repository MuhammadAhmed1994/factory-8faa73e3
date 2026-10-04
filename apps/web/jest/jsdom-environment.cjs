'use strict';

/**
 * Custom jsdom test environment for the web package.
 *
 * The toolchain this repo is built in provisions `jsdom` (and the
 * testing-library packages) at the workspace root but does not provision the
 * thin `jest-environment-jsdom` wrapper package, and Jest resolves
 * `testEnvironment` relative to the config file — it never walks up to the
 * workspace root. This module is that wrapper: it mirrors what the upstream
 * package does (a `jest-environment-node` subclass whose realm *is* the jsdom
 * window). `apps/web/jest.config.js` prefers the real
 * `jest-environment-jsdom` whenever it resolves and only falls back to this
 * file, so nothing changes once the package is present.
 */

const nodeEnvironmentModule = require('jest-environment-node');
const jsdomModule = require('jsdom');
const { installCommonGlobals } = require('jest-util');

const NodeEnvironment =
  nodeEnvironmentModule.TestEnvironment ??
  nodeEnvironmentModule.default ??
  nodeEnvironmentModule;

const { JSDOM, VirtualConsole } = jsdomModule;

class JSDOMTestEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);

    const { testEnvironmentOptions } = config;

    this.dom = new JSDOM('<!DOCTYPE html>', {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: 'http://localhost/',
      virtualConsole: new VirtualConsole().sendTo(console),
      ...testEnvironmentOptions,
    });

    // The jsdom window *is* the test realm: every DOM global (document,
    // HTMLElement, Event, MutationObserver, ...) is natively present, so no
    // property-by-property copying (and no cross-realm `instanceof` surprises).
    const global = (this.global = this.dom.window);
    this.global.global = this.global;

    global.Error.stackTraceLimit = 100;
    installCommonGlobals(global, global.DOMException);

    // Jest asserts a DOM-ish realm; keep `window` reachable under both names.
    global.window = this.global;
    global.self = this.global;
  }

  async setup() {
    await super.setup();
  }

  async teardown() {
    if (this.dom) {
      this.dom.window.close();
      this.dom = undefined;
    }
    await super.teardown();
  }

  getVmContext() {
    return this.dom ? this.dom.getInternalVMContext() : super.getVmContext();
  }
}

module.exports = JSDOMTestEnvironment;
module.exports.default = JSDOMTestEnvironment;
module.exports.TestEnvironment = JSDOMTestEnvironment;
