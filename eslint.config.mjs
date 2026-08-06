import globals from 'globals';

// Deliberately minimal. This gate exists to catch typos and dead bindings —
// the two classes of bug a bundler will happily ship. Everything is a WARNING
// so it never blocks a commit; `npm run lint:strict` is the opt-in hard gate.
//
// Scope is the hand-written app source only. `scripts/` (~440 files), the dead
// `js/` Leaflet stack, and all build output are excluded on purpose; widen the
// `files` globs below once the current scope reads clean.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '.claude/**',
      'app/build/**',
      'test/build/**',
      'js/**',                        // dead Leaflet stack — see tech-debt item 10
      'election-viewer-package/**',
      'app/election-viewer-package/**',
      'electionsni-reference/**',
      'archive/**',
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
