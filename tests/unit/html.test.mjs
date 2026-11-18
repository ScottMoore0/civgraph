import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrs, escapeHtml, html, join, raw, SafeHtml, toHtmlString } from '@civgraph/core/html.js';

test('interpolations are escaped', () => {
  const name = `<script>alert("x")</script> & 'q'`;
  assert.equal(String(html`<p>${name}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
});

test('nested templates and raw() are not escaped twice', () => {
  const inner = html`<b>${'a&b'}</b>`;
  assert.equal(String(html`<p>${inner}${raw('<i>ok</i>')}</p>`), '<p><b>a&amp;b</b><i>ok</i></p>');
});

test('arrays join; null, undefined and false render as nothing; 0 renders', () => {
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
});

test('templates return SafeHtml and toHtmlString unwraps', () => {
  const out = html`<a>${'x'}</a>`;
  assert.ok(out instanceof SafeHtml);
  assert.equal(toHtmlString(out), '<a>x</a>');
  assert.equal(toHtmlString('<x>'), '&lt;x&gt;');
});

test('attrs drops empty values, writes booleans bare and escapes values', () => {
  assert.equal(String(attrs({ href: '/a?b=1&c="2"', hidden: true, 'aria-current': false, title: null })),
    ' href="/a?b=1&amp;c=&quot;2&quot;" hidden');
});

test('join skips empties and renders the separator', () => {
  assert.equal(String(join(['a', '', null, html`<b>b</b>`], html`<span>,</span> `)), 'a<span>,</span> <b>b</b>');
});

test('escapeHtml of nullish is empty', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
