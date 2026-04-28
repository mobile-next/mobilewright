/**
 * Playwright globalTeardown entry point. The setup function returns its own
 * teardown, which Playwright runs automatically — so this file exists only as
 * a safety net for unusual config wiring. It is a no-op.
 */
export default async function teardown(): Promise<void> {
  // intentionally empty — setup() returns its own teardown.
}
