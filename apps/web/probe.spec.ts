/**
 * jsdom test-environment probe for the web package.
 *
 * Confirms the environment jest runs these specs in really is a DOM realm with
 * the globals React/testing-library need — the contract `jest.config.js` relies
 * on when it selects `jest-environment-jsdom` (or the local equivalent in
 * `jest/jsdom-environment.cjs`).
 *
 * Assertions are deliberately realm-safe: jsdom's generated constructors live in
 * the window's realm, so they are checked via `typeof`/`nodeType` on created
 * elements rather than `instanceof` against the outer realm's classes.
 */
describe("jsdom test environment", () => {
  it("provides a browser-like realm with window and document", () => {
    expect(typeof window).toBe("object");
    expect(window).toBeDefined();
    expect(document).toBeDefined();
    expect(typeof document.createElement).toBe("function");
  });

  it("exposes the DOM constructors components and matchers rely on", () => {
    expect(typeof HTMLElement).toBe("function");
    expect(typeof Event).toBe("function");
    expect(typeof MutationObserver).toBe("function");
    expect(document.createElement("div").nodeType).toBe(1);
  });

  it("lets jsdom parse and query markup", () => {
    document.body.innerHTML =
      '<main><h1 class="type-display">Team Kudos</h1></main>';
    const heading = document.querySelector("h1");
    expect(heading?.textContent).toBe("Team Kudos");
    expect(heading?.className).toBe("type-display");
  });
});
