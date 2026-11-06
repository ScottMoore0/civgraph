/**
 * The design-system stylesheets under assets/ui/ hold together:
 * - the two dark-mode blocks in tokens.css (explicit choice, system preference) are equal;
 * - every dark override names a token the light block defines;
 * - every legacy alias and every var() in base.css and the components resolves to a token;
 * - components.css imports every file under components/ and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'ui');
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
const legacy = declarations(read('tokens-legacy.css'));
const defined = new Set([...light.keys(), ...legacy.keys()]);

test('the two dark-mode blocks declare the same values', () => {
  assert.deepEqual([...darkSystem], [...darkExplicit]);
});

test('every dark override is a token the light block defines', () => {
  for (const name of darkExplicit.keys()) assert.ok(light.has(name), name);
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
