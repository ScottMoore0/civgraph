import importlib.util
import re
import subprocess
from pathlib import Path


def test_viewer_animation_cache_js(tmp_path):
    templates_path = Path('ni_votes/web/templates.py')
    spec = importlib.util.spec_from_file_location('viewer_templates_module', templates_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[attr-defined]

    viewer_body = module.VIEWER_BODY  # type: ignore[attr-defined]
    scripts = re.findall(r"<script>(.*?)</script>", viewer_body, flags=re.S)
    assert scripts, "Expected viewer body script block"
    script = scripts[0]
    script = script.replace(
        "window.VIEWER_META = {{ viewer_meta_json | safe }};",
        "window.VIEWER_META = {};",
    )
    script = script.replace(
        "  const baseUrl = \"{{ url_for('api_search_elections') }}\";",
        "  const baseUrl = '/api/search/elections';",
    )
    script = script.replace("populateViewerFilters();", "// populateViewerFilters();")

    prefix = """
const assert = require('node:assert');
const window = globalThis;
function createStubElement() {
  return {
    style: {},
    value: '',
    innerHTML: '',
    textContent: '',
    options: [],
    selectedOptions: [],
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    dataset: {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }),
  };
}
const document = {
  getElementById: () => createStubElement(),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => createStubElement(),
  body: { appendChild() {} },
  addEventListener() {},
};
window.document = document;
window.addEventListener = () => {};
window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
window.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
window.navigator = { userAgent: 'node' };

function decodeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
"""

    suffix = """
const richElection = {
  counts: [1, 2],
  candidates: [
    {
      name: 'Alice Example',
      party: 'Alpha',
      votes_by_count: [100, 120],
      first_pref: 100,
      first_pref_pct_value: 50,
      status: 'Elected',
      is_elected: true,
      rank: 1,
      person_id: 1,
      last_active_index: 1,
      elected_count: 2,
    },
    {
      name: 'Bob Example',
      party: 'Beta',
      votes_by_count: [80, 60],
      first_pref: 80,
      first_pref_pct_value: 40,
      status: 'Eliminated',
      is_elected: false,
      rank: 2,
      person_id: 2,
      last_active_index: 1,
      eliminated_count: 2,
    },
  ],
  non_transferable_by_count: [0, 20],
  has_previous_candidates: false,
  valid: 200,
  quota: 100,
  electorate: 1000,
  turnout: 800,
  spoiled: 10,
  seats: 2,
  candidate_summary: { electorate: 1000, valid: 200, turnout: 800, spoiled: 10 },
  transfer_events: [],
  transfer_sources: {},
};

const minimalElection = {
  counts: [1],
  candidates: [],
  non_transferable_by_count: [],
};

const withAnimation = renderElectionCard(richElection, { index: 0 });
assert(withAnimation.includes('data-animation-available="1"'), 'animation flag should be present when data exists');
const cacheMatch = withAnimation.match(/data-animation-cache="([^"]+)"/);
assert(cacheMatch, 'expected animation cache attribute');
const cache = JSON.parse(decodeHtml(cacheMatch[1]));
assert.strictEqual(cache.available, true);
assert.strictEqual(cache.firstCount, 1);
assert.strictEqual(cache.maxVote, 120);
assert.strictEqual(cache.quota, 100);
const alice = cache.candidates.find(entry => entry && entry.label === 'Alice Example');
assert(alice, 'expected Alice candidate in cache');
assert.strictEqual(alice.firstCountVotes, 100);
assert.strictEqual(alice.elected, true);
const bob = cache.candidates.find(entry => entry && entry.label === 'Bob Example');
assert(bob, 'expected Bob candidate in cache');
assert.strictEqual(bob.eliminated, true);

const withoutAnimation = renderElectionCard(minimalElection, { index: 0 });
assert(withoutAnimation.includes('data-animation-available="0"'), 'missing animation flag should be explicit');
assert(!/data-animation-cache=/.test(withoutAnimation), 'no cache payload should be rendered when unavailable');
"""

    node_script = tmp_path / "viewer_animation_cache.test.js"
    node_script.write_text(prefix + "\n" + script + "\n" + suffix)

    result = subprocess.run(["node", str(node_script)], capture_output=True, text=True)
    assert result.returncode == 0, f"Node test failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
