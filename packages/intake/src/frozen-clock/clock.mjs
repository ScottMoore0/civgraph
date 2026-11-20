// Loaded with --import by `intake parity` only: every Node step of both runs (the old command line
// and the plugin) sees the same wall clock, so a generatedAt stamp cannot make two otherwise
// identical outputs differ. Arguments to Date and durations (performance.now) are untouched.
const FIXED = Date.parse(process.env['INTAKE_FROZEN_CLOCK'] || '2026-01-01T00:00:00.000Z');
const RealDate = Date;
class FrozenDate extends RealDate {
  /** @param {...(string | number | Date)} args */
  constructor(...args) {
    if (args.length === 0) super(FIXED);
    else super(.../** @type {[string | number | Date]} Date's one-value form; its other forms pass through as given */ (args));
  }

  /** @override */
  static now() {
    return FIXED;
  }
}
globalThis.Date = /** @type {DateConstructor} a Date that answers every call the same, but now */ (FrozenDate);
