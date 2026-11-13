/**
 * The design-system stylesheets under assets/ui/ hold together:
 * - the two dark-mode blocks in tokens.css (explicit choice, system preference) are equal;
 * - every dark override names a token the light block defines;
 * - every legacy alias and every var() in base.css and the components resolves to a token;
 * - the raw palette (colours moved unchanged out of app stylesheets and served JS, rf8-styling)
 *   holds one literal colour per token, named by its value, and no theme block overrides it;
 * - components.css imports every file under components/ and nothing else.
 * - a form control's edge (--border-input) is at least 3:1 on the page surfaces in both themes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'ui', 'assets'); // served at /assets/ui/
const read = (rel) => readFileSync(path.join(UI, rel), 'utf8');
const declarations = (text) => new Map([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

function block(text, opener) {
  const start = text.indexOf(opener);
  assert.notEqual(start, -1, `missing ${opener}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (!depth) return text.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${opener}`);
}

const tokens = read('tokens.css');
const light = declarations(block(tokens, ':root {'));
const darkExplicit = declarations(block(tokens, ':root[data-theme="dark"]'));
const darkSystem = declarations(block(tokens, '@media (prefers-color-scheme: dark)'));
const raw = declarations(block(tokens, '/* Raw palette'));
const roles = declarations(block(tokens, '/* Roles'));
const legacy = declarations(read('tokens-legacy.css'));
const defined = new Set([...light.keys(), ...raw.keys(), ...roles.keys(), ...legacy.keys()]);

test('the two dark-mode blocks declare the same values', () => {
  assert.deepEqual([...darkSystem], [...darkExplicit]);
});

test('every dark override is a token the light block defines', () => {
  for (const name of darkExplicit.keys()) assert.ok(light.has(name), name);
});

test('the raw palette: one literal colour per token, named by its value, never overridden', () => {
  assert.ok(raw.size > 100, `only ${raw.size} raw tokens found`);
  const seen = new Map();
  for (const [name, value] of raw) {
    assert.match(name, /^--raw-[0-9a-f]{6}(-a\d+)?(-\d+)?$/, name);
    assert.match(value, /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\))$/, `${name}: ${value} is not one literal colour`);
    assert.ok(!light.has(name) && !darkExplicit.has(name) && !darkSystem.has(name) && !legacy.has(name), `${name} is defined twice`);
    if (value.startsWith('#') && value.length === 7) assert.equal(name.slice(6, 12), value.slice(1), `${name} is named by its value`);
    assert.ok(!seen.has(value), `${name} repeats ${seen.get(value)}`);
    seen.set(value, name);
  }
});

// The app stylesheets that read colours through the role block (rf9-ui, acceptance test A4), and
// the part of the site each one's roles are named for.
const ROLE_SHEETS = {
  'site/assets/css/main.css': 'map',
  'site/browse/browse.css': 'browse',
  'site/apps/proni-search/app.css': 'proni',
  'site/assets/site/site-chrome.css': 'chrome',
  'site/assets/pages/css/shared.css': 'pages',
  'site/assets/pages/css/status.css': 'pages',
  'site/assets/pages/css/about.css': 'pages',
  'packages/ui/assets/components/party-chip.css': 'chip',
  'packages/ui/assets/components/dialog.css': 'dialog',
};
const ROOT = path.join(UI, '..', '..', '..');

test('the role tokens: one raw colour each, by part, kind and theme, never overridden', () => {
  assert.ok(roles.size > 100, `only ${roles.size} role tokens found`);
  const seen = new Map();
  for (const [name, value] of roles) {
    const m = name.match(/^--(map|browse|proni|chrome|pages|chip|dialog)-(ink|bg|line|shade|fill|stroke)(-dark)?-(\d+)$/);
    assert.ok(m, `${name}: --<part>-<kind>[-dark]-<n>`);
    const ref = value.match(/^var\((--raw-[0-9a-f]{6}(?:-a\d+)?)\)$/);
    assert.ok(ref && raw.has(ref[1]), `${name}: ${value} must read one raw palette colour`);
    const role = name.replace(/-\d+$/, '');
    assert.ok(!seen.has(`${role} ${value}`), `${name} repeats ${seen.get(`${role} ${value}`)}`);
    seen.set(`${role} ${value}`, name);
    assert.ok(!light.has(name) && !darkExplicit.has(name) && !darkSystem.has(name) && !raw.has(name) && !legacy.has(name), `${name} is defined twice`);
  }
});

test('the app stylesheets paint with role tokens, not the raw palette', () => {
  const used = new Set();
  for (const [file, part] of Object.entries(ROLE_SHEETS)) {
    const text = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const decl of text.matchAll(/(^|[;{\s])(-?-?[a-z][\w-]*)\s*:([^;{}]*)/g)) {
      const [, , property, value] = decl;
      for (const m of value.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        const token = m[1];
        if (token.startsWith('--raw-')) assert.ok(property.startsWith('--'), `${file}: ${property} reads ${token}; read a role token (tokens.css Roles) instead`);
        if (roles.has(token)) {
          assert.ok(token.startsWith(`--${part}-`), `${file} reads ${token}, another part's role`);
          used.add(token);
        }
      }
    }
  }
  assert.deepEqual([...roles.keys()].filter((t) => !used.has(t)), [], 'role tokens nothing reads');
});

test('every legacy alias points at a token and redefines none', () => {
  for (const [name, value] of legacy) {
    assert.ok(!light.has(name), `${name} is a token, not an alias`);
    const refs = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    assert.ok(refs.length, `${name} must alias a token, not a literal (${value})`);
    for (const ref of refs) assert.ok(light.has(ref), `${name} -> ${ref} is not a token`);
  }
});

test('every var() in base.css and the components is defined', () => {
  const files = ['base.css', ...readdirSync(path.join(UI, 'components')).map((f) => `components/${f}`)];
  for (const file of files) {
    for (const m of read(file).matchAll(/var\((--[a-z0-9-]+)(\s*,)?/g)) {
      // A var() with a fallback reads a property set inline by a template (--party-colour).
      if (!m[2]) assert.ok(defined.has(m[1]), `${file}: ${m[1]} is not defined`);
    }
  }
});

test('components.css imports exactly the files in components/', () => {
  const imported = [...read('components.css').matchAll(/@import url\('components\/([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(imported, readdirSync(path.join(UI, 'components')).filter((f) => f.endsWith('.css')).sort());
});

// WCAG 2.x relative luminance and contrast of two #rrggbb colours.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("a form control's edge (--border-input) is at least 3:1 on the page surfaces, in both themes (WCAG 1.4.11)", () => {
  for (const [theme, set] of [['light', light], ['dark', darkExplicit]]) {
    const edge = set.get('--border-input');
    assert.match(edge ?? '', /^#[0-9a-f]{6}$/, `${theme}: --border-input is one literal colour`);
    for (const surface of ['--surface', '--surface-sunken']) {
      const ratio = contrast(edge, set.get(surface));
      assert.ok(ratio >= 3, `${theme}: --border-input ${edge} on ${surface} ${set.get(surface)} is ${ratio.toFixed(2)}:1`);
    }
  }
});
