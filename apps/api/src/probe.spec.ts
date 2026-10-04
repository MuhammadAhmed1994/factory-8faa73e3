/**
 * Scaffold smoke test.
 *
 * `test/setup-e2e.ts` is registered as a jest `setupFiles` entry for this
 * package, which means it must have executed *before* this module was
 * imported. Asserting the environment defaults here guards that wiring: a
 * regression (setup file removed from jest.config.ts, or the file itself
 * renamed) would leave DATABASE_URL unset and break every later e2e spec
 * that boots Prisma.
 *
 * Values are asserted by shape, not exact literal, so an operator-provided
 * override (e.g. an external DATABASE_URL) does not fail the scaffold.
 */
describe("test/setup-e2e.ts is wired as a jest setupFiles entry", () => {
  it("applies the environment defaults before any spec runs", () => {
    expect(process.env.DATABASE_URL).toMatch(/^postgresql:\/\//);
    expect(process.env.PORT).toMatch(/^\d+$/);
    expect(process.env.NODE_ENV).toBeTruthy();
  });
});
