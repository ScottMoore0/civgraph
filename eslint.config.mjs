import globals from 'globals';

// Deliberately minimal. This gate exists to catch typos and dead bindings —
// the two classes of bug a bundler will happily ship. Everything is a WARNING
// so it never blocks a commit; `npm run lint:strict` is the opt-in hard gate.
//
// SCOPE, WIDENED 2026-08-16.
//
// This used to cover only the first two globs listed below, leaving three live
// hand-written trees with no rules at all — 43,947 lines including src/ui-controller.js,
// at 11,620 lines the largest hand-written file in the repository. src/ was
// excluded on the belief that it was the dead Leaflet stack. It is neither dead
// nor Leaflet: zero Leaflet references, and called throughout app/src/app.js.
// See docs/review/CODE-REVIEW.md, findings 2 and 3.
//
// Widening surfaced 41 warnings and ZERO errors, which is the number that
// mattered: no undefined bindings and no typos were hiding in any of it. All of
// them are unused variables.
//
// functions/ came back completely clean, so it gets a HARDER setting than the
// rest — see `lint:functions-strict` in package.json. It is the highest-risk
// code here (auth, D1, R2, every API route) and it is the one tree that can be
// held at zero today without first paying down a backlog. A ratchet that is
// available and not taken is just a baseline with no expiry, which is a
// criticism this project has already made of itself.
//
// Build output and the genuinely dead trees are excluded on purpose below.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '.claude/**',
      'app/build/**',
      'render/build/**',
      'archive/**',                        // dead Leaflet stack, genuinely
      'data/elections-source/**',
      'app/election-viewer-package/**',
      'electionsni-reference/**',
      'synth-osm/**',
      'tmp/**',
      'test-results/**',
      // Vendored third-party bundles. Minified, not ours to fix, and linting
      // them produces thousands of warnings that bury the ones that matter.
      'src/libs/**',
      'src/sql.js-httpvfs/**',
    ],
  },
  {
    files: [
      'render/src/**/*.js',
      'app/src/**/*.js',
      'src/**/*.js',
      'browse/**/*.js',
      'functions/**/*.js',
    ],
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
