#!/usr/bin/env node
/**
 * The Status page: how far each source, election series and map series has got.
 *
 * WHAT IT WRITES
 *
 *   data/database/status.json   every figure on the page, with what it counts and the
 *                               basis of each total, for anyone who wants the numbers
 *   pages/status.html           the page itself, between <!-- status:body --> markers,
 *                               prerendered so it needs no JavaScript and the numbers are
 *                               real text a screen reader and a search engine can read
 *
 * WHERE THE NUMBERS COME FROM
 *
 * Only committed files, because this runs in the site build on a clean checkout:
 *
 *   Sources    data/status/sources.config.json (hand-kept: names, totals' basis, stages)
 *              data/status/source-snapshots.json (counts from material held outside the
 *              repository, written by scripts/build/status-snapshots.mjs)
 *              plus committed site data for what the site itself cites or shows
 *   Elections  render/metadata/elections-test2/*.json (the results the site serves),
 *              data/database/election-provenance.json (which contests are verified),
 *              data/elections/{walker,gallagher}-*.json (independent lists of contests),
 *              data/status/elections.config.json (types, periods, calendars)
 *   Maps       data/catalogue/catalogue.json (series, their editions, maps to be added)
 *
 * A TOTAL IS ALWAYS STATED WITH ITS BASIS
 *
 * A progress bar is only as honest as its denominator, so every total says where it came
 * from in plain words ("of 786 contests listed in Walker's ..."). Where no independent list
 * is held, the total is the contests the site holds and the page says exactly that, rather
 * than implying a completeness nobody has measured. Where the site holds MORE than an
 * independent list (Walker's harvest skips some pages; the site adds contests from other
 * lists), the larger figure is the total, and both are given.
 *
 * Like build-site-stats.mjs, status.json is rewritten only when a figure moves, so its
 * date is the date the figures last changed rather than the date of the last build.
 *
 * Usage:
 *   node scripts/build/build-status.mjs           compute, write status.json and the page
 *   node scripts/build/build-status.mjs --check   fail if either is out of date
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatDisplayDate } from '../../src/date-format.mjs';
import { BROWSE_DIR, ELECTION_BUNDLE_DIR, PROVENANCE_FILE } from '@civgraph/loader/paths.mjs';

/**
 * A contest returned unopposed (state-machine catalogue PL-L, light): marked uncontested, or every
 * candidate's status says unopposed. Counted with full figures.
 * @param {{ contestStatus?: string, candidates?: Array<{ status?: string }> }} result
 */
export function isUnopposedContest(result) {
  const cands = result.candidates || [];
  return result.contestStatus === 'uncontested'
    || (cands.length > 0 && cands.every((c) => /unopposed/i.test(c.status || '')));
}

const ROOT = process.cwd();
const CHECK = process.argv.includes('--check');
const OUT = path.join(ROOT, 'data/database/status.json');
const PAGE = path.join(ROOT, 'pages/status.html');

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const readJson = (rel, { optional = false } = {}) => {
  const full = path.resolve(ROOT, rel);
  if (!existsSync(full)) {
    if (optional) return null;
    fail(`${rel} does not exist, so the Status page cannot be built.`);
  }
  return JSON.parse(readFileSync(full, 'utf8'));
};
const readText = (rel) => (existsSync(path.resolve(ROOT, rel)) ? readFileSync(path.resolve(ROOT, rel), 'utf8') : '');

// --- sources ------------------------------------------------------------------------

const sourcesConfig = readJson('data/status/sources.config.json');
const snapshots = readJson('data/status/source-snapshots.json').sources || {};

/** Committed text the site publishes, searched for what it cites. */
const citedText = [
  readText('data/database/maps.json'),
  readText('data/catalogue/descriptions.json'),
  readText(PROVENANCE_FILE),
].join('\n');

function gazetteCitedIssues() {
  const issues = new Set();
  for (const m of citedText.matchAll(/Belfast Gazette,?\s+(?:issue|no\.?)\s*(\d{1,4})\b/gi)) issues.add(Number(m[1]));
  for (const m of citedText.matchAll(/thegazette\.co\.uk\/Belfast\/issue\/(\d+)/gi)) issues.add(Number(m[1]));
  return issues;
}

function legislationCited() {
  const ids = new Set();
  for (const m of citedText.matchAll(/legislation\.gov\.uk\/(?:id\/)?(nia|apni|nisi|nisr|nisro|uksi|ukpga|ukla)\/(\d{4})\/(\d+)/g)) {
    ids.add(`${m[1]}/${m[2]}/${m[3]}`);
  }
  return ids;
}

const SOURCE_FIGURES = {
  'belfast-gazette'(cfg, snap) {
    const cited = gazetteCitedIssues();
    return {
      known: cfg.known.value,
      stages: { fetched: snap?.issuesFetched ?? null, parsed: snap?.issuesParsed ?? null, cited: cited.size },
      facts: [
        snap && `Downloaded so far: issues 1 to ${snap.lastIssueFetched?.toLocaleString('en-GB')}; ${snap.issuesNotOnline} of them have no copy online.`,
        snap?.noticesExtracted && `Notices found so far: ${snap.noticesExtracted.boundary ?? 0} boundary notices and ${snap.noticesExtracted.election ?? 0} election notices, in issues 1 to ${snap.lastIssueParsed}.`,
        'Cited on the site counts the different issues that map and election records cite.',
      ],
    };
  },
  'census-ni-reports'(cfg, snap) {
    const rows = cfg.known.years.map((year) => ({ year, ...(snap?.ni?.[year] || {}) }));
    return {
      known: rows.length,
      stages: {
        held: snap ? rows.filter((r) => r.held).length : null,
        converted: snap ? rows.filter((r) => r.convertedParts > 0).length : null,
        tables: snap ? rows.filter((r) => r.tables > 0).length : null,
        explorer: snap ? rows.filter((r) => r.explorer).length : null,
      },
      detail: snap && {
        columns: ['Census', 'Report held', 'Converted to text', 'Tables extracted', 'In the Census Explorer'],
        rows: rows.map((r) => [String(r.year), r.held ? 'Yes' : 'No',
          r.convertedParts ? `Yes (${r.convertedParts} ${r.convertedParts === 1 ? 'part' : 'parts'})` : 'No',
          (r.tables || 0).toLocaleString('en-GB'), r.explorer ? 'Yes' : 'No']),
      },
    };
  },
  'census-ireland-pre1921'(cfg, snap) {
    const rows = cfg.known.years.map((year) => ({ year, ...(snap?.pre1921?.[year] || {}) }));
    return {
      known: rows.length,
      stages: {
        held: snap ? rows.filter((r) => r.files > 0).length : null,
        converted: snap ? rows.filter((r) => r.read > 0).length : null,
        tables: snap ? rows.filter((r) => r.tables > 0).length : null,
        explorer: snap ? rows.filter((r) => r.explorer).length : null,
      },
      detail: snap && {
        columns: ['Census', 'Report files held', 'Files read', 'Tables extracted', 'In the Census Explorer'],
        rows: rows.map((r) => [String(r.year), (r.files || 0).toLocaleString('en-GB'), (r.read || 0).toLocaleString('en-GB'),
          (r.tables || 0).toLocaleString('en-GB'), r.explorer ? 'Yes' : 'No']),
      },
    };
  },
  opendatani(cfg, snap) {
    return {
      known: snap?.datasetsListed ?? null,
      stages: { mirrored: snap?.datasetsMirrored ?? null, used: snap?.datasetsUsed ?? null },
      facts: [
        snap?.linksToUnlistedDatasets && `The map catalogue also links to ${snap.linksToUnlistedDatasets} Open Data NI ${snap.linksToUnlistedDatasets === 1 ? 'dataset that is' : 'datasets that are'} no longer listed.`,
      ],
    };
  },
  legislation(cfg, snap) {
    const searched = new Set((snap?.items || []).map((i) => i.id));
    const cited = legislationCited();
    // Only NI legislation and UK instruments are in scope; a cited UK Act is counted too,
    // because the site citing it is what makes it relevant.
    const known = new Set([...searched, ...cited]);
    const extra = [...cited].filter((id) => !searched.has(id)).length;
    return {
      known: snap ? known.size : null,
      stages: { cited: cited.size },
      facts: [
        snap && `${searched.size.toLocaleString('en-GB')} found by the title search, and ${extra} more that the site cites.`,
      ],
    };
  },
  proni(cfg, snap) {
    const browse = readJson(path.join(BROWSE_DIR, 'index.json'), { optional: true });
    return {
      known: snap?.recordsCollected ?? null,
      stages: {
        collected: snap?.recordsCollected ?? null,
        published: browse?.counts?.proni ?? null,
        dated: snap?.recordsWithDate ?? null,
      },
      facts: ['A date is read from a record\'s own date field or description; records with no date at all stay undated.'],
    };
  },
  'niassembly-register'() {
    const reg = readJson('data/database/ni-register-interests.json');
    const src = readJson('data/database/ni-register-sources.json');
    // The Assembly's register documents, less the two landing pages that only list them.
    const docs = (src.sources || []).filter((s) => String(s.id).startsWith('ni-register:assembly:')
      && !/landing/i.test(String(s.subtitle || ''))).length;
    const s = reg.summary || {};
    return {
      known: docs,
      stages: { held: docs, extracted: Math.min(docs, s.assemblySourceRecords ?? 0), onSite: docs },
      facts: [
        `${(s.totalInterests || 0).toLocaleString('en-GB')} interest entries read from them, ${(s.totalCanonicalInterests || 0).toLocaleString('en-GB')} once repeated entries across editions are merged.`,
      ],
      asOf: reg.generatedAt?.slice(0, 10),
    };
  },
};

const sources = sourcesConfig.sources.map((cfg) => {
  const compute = SOURCE_FIGURES[cfg.id];
  if (!compute) fail(`sources.config.json lists "${cfg.id}", which build-status.mjs has no figures for.`);
  const snapKey = { 'census-ni-reports': 'census', 'census-ireland-pre1921': 'census' }[cfg.id] || cfg.id;
  const snap = snapshots[snapKey];
  const f = compute(cfg, snap);
  return {
    id: cfg.id,
    name: cfg.name,
    publisher: cfg.publisher,
    url: cfg.url,
    licence: cfg.licence,
    unit: cfg.unit,
    known: { value: f.known, approximate: Boolean(cfg.known.approximate), basis: cfg.known.basis },
    stages: cfg.stages.map((s) => ({ key: s.key, label: s.label, value: f.stages[s.key] ?? null })),
    facts: (f.facts || []).filter(Boolean),
    note: cfg.note || null,
    detail: f.detail || null,
    snapshotTakenAt: f.asOf || snap?.takenAt || null,
  };
});

// --- elections ------------------------------------------------------------------------

const electionsConfig = readJson('data/status/elections.config.json');
const provenance = readJson(PROVENANCE_FILE);
const provByFile = new Map(provenance.contests.map((c) => [c.file, c]));
const provByKey = new Map(provenance.contests.map((c) => [`${c.body}|${c.date}|${c.constituency}`, c]));

const ELECTION_DIR = ELECTION_BUNDLE_DIR;
const SOURCE_PREFIX = 'data/elections-source/data/elections/';
const contests = [];
const bodyNames = new Map();
for (const file of readdirSync(path.resolve(ROOT, ELECTION_DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const e = readJson(path.join(ELECTION_DIR, file));
  bodyNames.set(e.bodySlug, e.body);
  for (const r of e.results || []) {
    const cands = r.candidates || [];
    const unopposed = isUnopposedContest(r);
    const voted = cands.length > 0 && cands.every((c) => [c.firstPrefs, c.finalVotes, c.votes].some((v) => Number.isFinite(v)));
    const rel = String(r.sourceFile || '').replace(/\\/g, '/').replace(SOURCE_PREFIX, '');
    const prov = provByFile.get(rel) || provByKey.get(`${e.bodySlug}|${e.date}|${r.constituency}`);
    contests.push({
      body: e.bodySlug,
      date: e.date,
      byElection: Boolean(e.isByElection),
      full: unopposed || voted,
      verified: prov?.status === 'verified',
    });
  }
}
if (!contests.length) fail(`${ELECTION_DIR} holds no results.`);

const WALKER = 'B. M. Walker, Parliamentary Election Results in Ireland, 1801–1922 (Royal Irish Academy, 1978)';
const GALLAGHER = 'M. Gallagher, Irish Elections 1922–44: Results and Analysis (PSAI Press, 1993)';
const kindMatches = (seg, kind) => !seg.kind || (seg.kind === 'general' ? /general/.test(kind) : /by/.test(kind));
const CALENDARS = {
  'walker-1801-1831': (seg) => ({
    count: readJson('data/elections/walker-1801-1831-results.json').records.filter((r) => kindMatches(seg, r.kind)).length,
    source: WALKER,
  }),
  'walker-1832-1884': (seg) => ({
    count: readJson('data/elections/walker-pre1885-results.json').records
      .filter((r) => r.year >= 1832 && r.year <= 1884 && kindMatches(seg, r.kind)).length,
    source: WALKER,
  }),
  'walker-byelections-1885-1922': () => ({
    count: readJson('data/elections/walker-byelections-1885-1922.json').records.length,
    source: WALKER,
  }),
  'gallagher-1922-1944': (seg) => ({
    count: (seg.kind === 'by-election' ? 0 : readJson('data/elections/gallagher-general-elections-1922-44.json').records.length)
      + (seg.kind === 'general' ? 0 : readJson('data/elections/gallagher-byelections-1923-44.json').records.length),
    source: GALLAGHER,
  }),
};

const fmt = (n) => Number(n).toLocaleString('en-GB');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

function contestSegment(seg, unit) {
  const rows = contests.filter((c) => seg.bodies.includes(c.body)
    && (!seg.from || c.date >= seg.from) && (!seg.to || c.date <= seg.to)
    && (!seg.kind || (seg.kind === 'by-election') === c.byElection));
  const onSite = rows.length;
  const full = rows.filter((c) => c.full).length;
  const verified = rows.filter((c) => c.verified).length;
  let known = onSite;
  let basis = `No independent list of these contests is held yet, so the total is the ${unit} the site holds.`;
  if (seg.calendar) {
    const cal = CALENDARS[seg.calendar];
    if (!cal) fail(`elections.config.json names calendar "${seg.calendar}", which build-status.mjs does not define.`);
    const { count, source } = cal(seg);
    if (count >= onSite) {
      known = count;
      basis = `Of the ${plural(count, 'contest', 'contests')} listed in ${source}.`;
    } else {
      basis = `${source} lists ${fmt(count)}; the site holds ${fmt(onSite)}, drawing on further lists, so the larger figure is the total.`;
    }
  }
  return { label: seg.label, known, onSite, full, verified, basis };
}

function decadeSegments(seg, unit) {
  const years = contests.filter((c) => seg.bodies.includes(c.body)).map((c) => Number(c.date.slice(0, 4)));
  if (!years.length) return [];
  const out = [];
  for (let d = Math.floor(Math.min(...years) / 10) * 10; d <= Math.max(...years); d += 10) {
    const s = contestSegment({ ...seg, label: `${d}s`, from: `${d}-01-01`, to: `${d + 9}-12-31` }, unit);
    if (s.onSite) out.push(s);
  }
  return out;
}

// Bodies a group names, in its segments or (a rounds group such as the party-internal ballots)
// in its own list, are kept out of the 'rest' group (the pre-1973 councils).
const namedBodies = new Set([
  ...electionsConfig.groups.flatMap((g) => g.segments || []).flatMap((s) => s.bodies || []),
  ...electionsConfig.groups.flatMap((g) => (Array.isArray(g.bodies) ? g.bodies : [])),
]);

function roundSegments(group) {
  const bodies = group.bodies === 'rest'
    ? [...new Set(contests.map((c) => c.body))].filter((b) => !namedBodies.has(b)).sort()
    : group.bodies;
  return bodies.map((body) => {
    const byDate = new Map();
    for (const c of contests.filter((x) => x.body === body)) {
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(c);
    }
    const rounds = [...byDate.values()];
    const notHeld = (group.notHeld || {})[body] || [];
    const years = [...byDate.keys()].map((d) => Number(d.slice(0, 4)));
    return {
      label: bodyNames.get(body) || body,
      body,
      span: years.length ? [Math.min(...years), Math.max(...years)] : null,
      known: rounds.length + notHeld.length,
      onSite: rounds.length,
      full: rounds.filter((r) => r.every((c) => c.full)).length,
      verified: rounds.filter((r) => r.every((c) => c.verified)).length,
      notHeld: notHeld.length,
      basis: notHeld.length ? `Known rounds so far: ${plural(rounds.length, 'round', 'rounds')} on the site and ${fmt(notHeld.length)} documented as not held.` : null,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

const electionGroups = electionsConfig.groups.map((g) => {
  const unit = g.rounds ? 'rounds' : (g.unit || 'contests');
  const segments = g.rounds
    ? roundSegments(g)
    : g.segments.flatMap((seg) => (seg.byDecade ? decadeSegments(seg, unit) : [contestSegment(seg, unit)]));
  const total = (k) => segments.reduce((sum, s) => sum + s[k], 0);
  return {
    id: g.id,
    name: g.name,
    unit,
    about: g.about || null,
    totals: { known: total('known'), onSite: total('onSite'), full: total('full'), verified: total('verified') },
    segments,
  };
});

const electionsCovered = electionGroups.reduce((s, g) => s + (g.unit === 'rounds' ? 0 : g.totals.onSite), 0)
  + contests.filter((c) => !namedBodies.has(c.body)).length
  // A rounds group that lists its own bodies (the party-internal ballots) covers their contests.
  + contests.filter((c) => electionsConfig.groups.some((g) => g.rounds && Array.isArray(g.bodies) && g.bodies.includes(c.body))).length;
if (electionsCovered !== contests.length) {
  fail(`the election bars cover ${electionsCovered} contests but the site holds ${contests.length}: a period in elections.config.json has a gap or an overlap.`);
}

// --- maps -------------------------------------------------------------------------------

const catalogue = readJson('data/catalogue/catalogue.json');
const statusOf = (id) => catalogue.maps[id]?.status || 'placeholder';
const shelfName = new Map((catalogue.shelves || []).map((s) => [s.id, s.name]));
const seriesRows = catalogue.series.map((s) => {
  const editions = [...s.members.filter((m) => !m.of), ...(s.todo || [])].map((m) => m.id);
  const count = (st) => editions.filter((id) => statusOf(id) === st).length;
  return {
    id: s.id,
    name: s.name,
    scope: s.scope || '',
    shelf: s.shelf,
    years: s.years || null,
    known: editions.length,
    complete: count('ready'),
    partial: count('incomplete'),
    notDrawn: count('placeholder'),
    versions: s.members.filter((m) => m.of).length + (s.local || []).length,
  };
});
const shelfOrder = (catalogue.shelves || []).map((s) => s.id);
const mapShelves = shelfOrder.map((id) => {
  const rows = seriesRows.filter((r) => r.shelf === id);
  const total = (k) => rows.reduce((sum, r) => sum + r[k], 0);
  return {
    id,
    name: shelfName.get(id) || id,
    totals: { known: total('known'), complete: total('complete'), partial: total('partial'), notDrawn: total('notDrawn'), versions: total('versions') },
    series: rows.sort((a, b) => (b.known - a.known) || a.name.localeCompare(b.name)),
  };
}).filter((s) => s.series.length);

// --- the stamp ------------------------------------------------------------------------------

const figures = { sources, elections: electionGroups, maps: mapShelves };
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const unchanged = previous && JSON.stringify(previous.figures) === JSON.stringify(figures);
const generatedAt = unchanged ? previous.generatedAt : new Date().toISOString();
const stamp = {
  schemaVersion: 1,
  generatedAt,
  description: 'Progress of Civgraph\'s sources, elections and maps, as shown on /pages/status.html. '
    + 'Each total states its basis. Built by scripts/build/build-status.mjs; generatedAt is when a figure last changed.',
  figures,
};

// --- render -------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pctOf = (n, d) => (d > 0 ? (100 * n) / d : 0);
function pctText(n, d) {
  if (!d) return '';
  const p = pctOf(n, d);
  if (n > 0 && p < 0.1) return 'under 0.1%';
  if (p >= 99.95 && n < d) return 'over 99.9%';
  return `${p >= 10 || Number.isInteger(p) ? Math.round(p) : p.toFixed(1)}%`;
}
const widthOf = (n, d) => `${Math.max(0, Math.min(100, pctOf(n, d))).toFixed(2)}%`;

/**
 * One bar. `parts` are the nested stages, outermost first; each draws only the part not
 * covered by the next, so the bar reads left to right from the furthest-along stage. The
 * figures are always written out beside it; the bar's own label repeats them for screen
 * readers, so nothing is carried by colour alone.
 */
function bar(parts, known, { label, unit, approximate = false }) {
  const n = parts.length;
  const segs = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const v = parts[i].value;
    if (v == null) continue;
    const inner = parts.slice(i + 1).map((p) => p.value).filter((x) => x != null);
    const covered = inner.length ? Math.min(v, Math.max(...inner)) : 0;
    const own = Math.max(0, Math.min(v, known) - covered);
    if (own > 0) segs.push(`<span class="sbar__seg sbar__seg--l${4 - (n - 1 - i)}" style="width:${widthOf(own, known)}"></span>`);
  }
  const spoken = parts.filter((p) => p.value != null).map((p) => `${p.label} ${fmt(p.value)}`).join(', ');
  const of = `of ${approximate ? 'about ' : ''}${fmt(known)} ${unit}`;
  return `<div class="sbar" role="img" aria-label="${esc(`${label}: ${spoken}, ${of}`)}">${segs.join('')}</div>`;
}

function figureList(parts, known, { approximate = false } = {}) {
  const n = parts.length;
  return `<ul class="sfigs">${parts.map((p, i) => {
    const level = 4 - (n - 1 - i);
    const value = p.value == null
      ? '<span class="sfigs__n">not tracked yet</span>'
      : `<span class="sfigs__n">${fmt(p.value)}</span>${known ? ` <span class="sfigs__p">(${approximate ? 'about ' : ''}${pctText(p.value, known)})</span>` : ''}`;
    return `<li><span class="swatch swatch--l${level}" aria-hidden="true"></span>${esc(p.label)}: ${value}</li>`;
  }).join('')}</ul>`;
}

function renderSource(s) {
  const known = s.known.value;
  const head = `<h3 id="source-${esc(s.id)}">${esc(s.name)}</h3>
<p class="status-meta">${esc(s.publisher)} · ${esc(s.licence)} · <a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">source</a></p>`;
  if (known == null) {
    return `<article class="status-item">${head}<p class="status-basis">No snapshot has been taken for this source yet.</p></article>`;
  }
  const total = `<p class="status-total"><strong>${s.known.approximate ? 'About ' : ''}${fmt(known)}</strong> ${esc(s.unit)} known. ${esc(s.known.basis)}</p>`;
  const facts = s.facts.length ? `<ul class="status-facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  const note = s.note ? `<p class="status-note">${esc(s.note)}</p>` : '';
  const when = s.snapshotTakenAt ? `<p class="status-when">Counts from outside the site taken ${esc(formatDisplayDate(s.snapshotTakenAt))}.</p>` : '';
  const detail = s.detail ? `<div class="status-table-wrap"><table class="status-table">
<thead><tr>${s.detail.columns.map((c, i) => `<th scope="col"${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${s.detail.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="num">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('\n')}</tbody>
</table></div>` : '';
  return `<article class="status-item">
${head}
${total}
${bar(s.stages, known, { label: s.name, unit: s.unit, approximate: s.known.approximate })}
${figureList(s.stages, known, { approximate: s.known.approximate })}
${facts}${note}${detail}${when}
</article>`;
}

const electionParts = (s, unit) => [
  { label: `${unit === 'rounds' ? 'Rounds' : 'Contests'} on the site`, value: s.onSite },
  { label: 'with full figures', value: s.full },
  { label: 'verified against a source', value: s.verified },
];

function renderElectionRow(s, unit) {
  const parts = electionParts(s, unit);
  const span = s.span ? ` <span class="srow__span">${s.span[0] === s.span[1] ? s.span[0] : `${s.span[0]}–${s.span[1]}`}</span>` : '';
  return `<li class="srow">
<div class="srow__head"><span class="srow__label">${esc(s.label)}${span}</span><span class="srow__total">${fmt(s.onSite)} of ${fmt(s.known)} ${esc(unit)}</span></div>
${bar(parts, s.known, { label: s.label, unit })}
${figureList(parts, s.known)}
${s.basis ? `<p class="srow__basis">${esc(s.basis)}</p>` : ''}
</li>`;
}

function renderElectionGroup(g) {
  return `<article class="status-item">
<h3 id="elections-${esc(g.id)}">${esc(g.name)}</h3>
${g.about ? `<p class="status-note">${esc(g.about)}</p>` : ''}
<p class="status-total"><strong>${fmt(g.totals.onSite)}</strong> of ${fmt(g.totals.known)} known ${esc(g.unit)} on the site; ${fmt(g.totals.full)} with full figures; ${fmt(g.totals.verified)} verified.</p>
<ul class="srows">
${g.segments.map((s) => renderElectionRow(s, g.unit)).join('\n')}
</ul>
</article>`;
}

function mapFigures(t) {
  const parts = [
    { label: 'Complete on the site', value: t.complete, level: 4 },
    { label: 'Partial (part of the area only)', value: t.partial, level: 2 },
    { label: 'Known, not yet drawn', value: t.notDrawn, level: 0 },
  ];
  return `<ul class="sfigs">${parts.map((p) => `<li><span class="swatch swatch--l${p.level}" aria-hidden="true"></span>${esc(p.label)}: <span class="sfigs__n">${fmt(p.value)}</span> <span class="sfigs__p">(${pctText(p.value, t.known) || '0%'})</span></li>`).join('')}</ul>`;
}
function mapBar(t, label) {
  const segs = [];
  if (t.complete) segs.push(`<span class="sbar__seg sbar__seg--l4" style="width:${widthOf(t.complete, t.known)}"></span>`);
  if (t.partial) segs.push(`<span class="sbar__seg sbar__seg--l2" style="width:${widthOf(t.partial, t.known)}"></span>`);
  return `<div class="sbar" role="img" aria-label="${esc(`${label}: ${fmt(t.complete)} complete and ${fmt(t.partial)} partial on the site, ${fmt(t.notDrawn)} not yet drawn, of ${fmt(t.known)} known editions`)}">${segs.join('')}</div>`;
}

function renderShelf(shelf) {
  const t = shelf.totals;
  const rows = shelf.series.map((r) => {
    const years = r.years ? (r.years[0] === r.years[1] ? `${r.years[0]}` : `${r.years[0]}–${r.years[1]}`) : '';
    const meta = [r.scope, years].filter(Boolean).join(', ');
    const versions = r.versions ? ` Also ${plural(r.versions, 'other version or local copy', 'other versions or local copies')}.` : '';
    return `<li class="srow">
<div class="srow__head"><span class="srow__label">${esc(r.name)}${meta ? ` <span class="srow__span">${esc(meta)}</span>` : ''}</span><span class="srow__total">${fmt(r.complete + r.partial)} of ${fmt(r.known)}</span></div>
${mapBar(r, r.name)}
<p class="srow__basis">${fmt(r.complete)} complete${r.partial ? `, ${fmt(r.partial)} partial` : ''}${r.notDrawn ? `, ${fmt(r.notDrawn)} not yet drawn` : ''}.${versions}</p>
</li>`;
  }).join('\n');
  return `<article class="status-item">
<h3 id="maps-${esc(shelf.id)}">${esc(shelf.name)}</h3>
<p class="status-total"><strong>${fmt(t.complete + t.partial)}</strong> of ${fmt(t.known)} known editions on the site, in ${plural(shelf.series.length, 'series', 'series')}.</p>
${mapBar(t, shelf.name)}
${mapFigures(t)}
<details class="status-details"><summary>Each series (${fmt(shelf.series.length)})</summary>
<ul class="srows">
${rows}
</ul>
</details>
</article>`;
}

const sum = (arr, k) => arr.reduce((s, x) => s + x.totals[k], 0);
const mapTotals = { known: sum(mapShelves, 'known'), complete: sum(mapShelves, 'complete'), partial: sum(mapShelves, 'partial'), notDrawn: sum(mapShelves, 'notDrawn') };
const electionContestGroups = electionGroups.filter((g) => g.unit !== 'rounds');
const elTotals = { known: sum(electionContestGroups, 'known'), onSite: sum(electionContestGroups, 'onSite'), full: sum(electionContestGroups, 'full'), verified: sum(electionContestGroups, 'verified') };

const generatedDate = formatDisplayDate(generatedAt.slice(0, 10));
const body = `<p class="status-when status-when--lead">Figures last changed <time datetime="${esc(generatedAt.slice(0, 10))}">${esc(generatedDate)}</time>. The page is rebuilt with the site; counts that come from outside the site carry the date they were taken.</p>
<nav class="status-toc" aria-label="On this page"><a href="#sources">Sources</a><a href="#elections">Elections</a><a href="#maps">Maps</a></nav>
<p>Each bar is measured against a total, and every total says where it comes from. A bar fills from the left with the furthest stage reached, in the strongest colour; the figures beside it give every stage in full, and their colour keys match the bar.</p>
<section id="sources" aria-labelledby="sources-h">
<h2 id="sources-h">Sources</h2>
<p>Public sources Civgraph draws on, and how far each has got: obtained, read into structured data, used on the site, and checked.</p>
${sources.map(renderSource).join('\n')}
</section>
<section id="elections" aria-labelledby="elections-h">
<h2 id="elections-h">Elections</h2>
<p>A contest is one constituency, ward or count area at one election; a seat returned unopposed counts as a contest, with full figures. <strong>Full figures</strong> means every candidate's vote is recorded. <strong>Verified</strong> means the contest has been checked against a named source. In all, ${fmt(elTotals.onSite)} of ${fmt(elTotals.known)} known contests are on the site, ${fmt(elTotals.full)} with full figures and ${fmt(elTotals.verified)} verified.</p>
${electionGroups.map(renderElectionGroup).join('\n')}
</section>
<section id="maps" aria-labelledby="maps-h">
<h2 id="maps-h">Maps</h2>
<p>Each map series in the catalogue, by shelf. Known editions are the editions the catalogue lists plus those it lists as still to be added. A <strong>partial</strong> map covers only part of its area. In all, ${fmt(mapTotals.complete + mapTotals.partial)} of ${fmt(mapTotals.known)} known editions are on the site (${fmt(mapTotals.partial)} of them partial).</p>
${mapShelves.map(renderShelf).join('\n')}
</section>`;

const MARKER = /(<!-- status:body -->)[\s\S]*?(<!-- \/status:body -->)/;
if (!existsSync(PAGE)) fail('pages/status.html does not exist.');
const pageBefore = readFileSync(PAGE, 'utf8');
if (!MARKER.test(pageBefore)) fail('pages/status.html has no <!-- status:body --> ... <!-- /status:body --> region.');
const eol = pageBefore.includes('\r\n') ? '\r\n' : '\n';
const pageAfter = pageBefore.replace(MARKER, (_m, open, close) => `${open}\n${body}\n${close}`.replace(/\r?\n/g, eol));

if (CHECK) {
  const problems = [];
  if (!unchanged) problems.push('data/database/status.json does not match the figures computed from the data');
  if (pageAfter !== pageBefore) problems.push('pages/status.html does not match status.json');
  if (problems.length) fail(`${problems.join('; ')}.\n  Regenerate: node scripts/build/build-status.mjs`);
  console.log('PASS: the Status page and data/database/status.json are current.');
  process.exit(0);
}

if (!unchanged) writeFileSync(OUT, `${JSON.stringify(stamp, null, 2)}\n`);
if (pageAfter !== pageBefore) writeFileSync(PAGE, pageAfter);
console.log(`Status: ${sources.length} sources, ${electionGroups.length} election groups (${fmt(contests.length)} contests), `
  + `${mapShelves.length} map shelves (${fmt(mapTotals.known)} known editions)`);
console.log(unchanged ? 'Unchanged; data/database/status.json left as it is.' : 'Wrote data/database/status.json');
console.log(pageAfter !== pageBefore ? 'Wrote pages/status.html' : 'pages/status.html already current.');
