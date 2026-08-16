import globals from 'globals';

// Deliberately minimal. This gate exists to catch typos and dead bindings —
// the two classes of bug a bundler will happily ship. Everything is a WARNING
// so it never blocks a commit; `npm run lint:strict` is the opt-in hard gate.
//
// SCOPE IS NARROWER THAN IT LOOKS, AND NARROWER THAN IT SHOULD BE.
//
// Only the two globs listed below are covered. That leaves three live,
// hand-written trees with no rules applied at all:
//
//   src/         36,028 lines — imported and driven by app/src/app.js
//   browse/       5,481 lines — the Browse page
//   functions/    2,438 lines — auth, D1, R2, every API route
//
// src/ui-controller.js alone is 11,620 lines, the largest hand-written file in
// the repository. It was excluded on the belief that src/ was the dead Leaflet
// stack; it is neither dead nor Leaflet (zero Leaflet references, called
// throughout app/src/app.js). See docs/review/CODE-REVIEW.md, finding 2.
//
// Build output and the genuinely dead trees are excluded on purpose below.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '.claude/**',
      'app/build/**',
      'test/build/**',
      'archive/**',                        // dead Leaflet stack, genuinely
      'election-viewer-package/**',
      'app/election-viewer-package/**',
      'electionsni-reference/**',
      'synth-osm/**',
      'tmp/**',
      'test-results/**',
    ],
  },
  {
    files: ['test/src/**/*.js', 'app/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      // `args: 'none'` — unused params are common and harmless in callback-heavy
      // map/event code; unused *variables* are the real signal.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
    },
  },
];
