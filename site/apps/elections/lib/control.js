/**
 * Council control's logic (/elections/control/, stream el-bodies): its URL state, the words for
 * who controlled a council, the timeline chart (HTML bars, so the text stays legible on a phone),
 * the cross-council view of one year and the CSVs. Pure (no DOM): the unit test elections-app-bodies.test.mjs.
 *
 * URL state: council=<id> shows one council over time; otherwise year=<yyyy> (default the latest
 * year with an election on file) shows every council in that year.
 */
import { TEXT, fill } from './bodies-text.js';
import { toCsvText } from './csv.js';
import { esc, fmtInt } from './format.js';
import { partyColour } from './party.js';

/** @typedef {import('./tables.js').ControlTable} Table @typedef {import('./tables.js').Council} Council */
/** @typedef {import('./tables.js').TimelineEntry} Entry @typedef {import('./tables.js').Control} Control */
/** @typedef {import('./tables.js').Seats} Seats @typedef {import('./tables.js').Parties} Parties */
/** @typedef {{ council: string, year: number | null }} State */

/** The last year a council of each generation sat (the 1973 reorganisation, the 2015 one, the Republic's 2014 one). */
export const GENERATION_END = Object.freeze({ 'pre-1973': 1973, 1973: 2014, 'pre-2014': 2013 });
/** A council's composition is shown for a year only if an election of it is on file this many years before. */
export const STALE_YEARS = 12;

/** @param {URLSearchParams} q @returns {State} */
export function stateFromQuery(q) {
  const y = q.get('year');
  return { council: q.get('council') || '', year: y && /^\d{4}$/.test(y) ? Number(y) : null };
}

/** @param {State} s */
export function queryFromState(s) {
  const q = new URLSearchParams();
  if (s.council) q.set('council', s.council);
  else if (s.year !== null) q.set('year', String(s.year));
  return q.toString();
}

/** A party's name in a table, or the no-label wording. @param {Parties} parties @param {string | null | undefined} p */
export const partyName = (parties, p) => (p ? parties[p]?.name || p : TEXT.notRecorded);

/**
 * Who controlled a council, in words.
 * @param {Control | null} c @param {Parties} parties
 */
export function controlText(c, parties) {
  if (!c) return TEXT.compositionNotRecorded;
  if (c.kind === 'majority') return fill(TEXT.majorityOf, { name: partyName(parties, c.party) });
  if (c.kind === 'independent') return TEXT.independentMajority;
  if (c.kind === 'unknown') return TEXT.notDeterminable;
  return c.party ? fill(TEXT.nocLargest, { name: partyName(parties, c.party) }) : TEXT.noc;
}

/** The largest party of a composition (not independents, not the unlabelled), or null on a tie. @param {Seats | null} seats */
export function largestParty(seats) {
  const parties = (seats || []).filter(([p]) => p !== null && p !== 'independent').sort((a, b) => b[1] - a[1]);
  return parties[0] && (!parties[1] || parties[1][1] < parties[0][1]) ? parties[0][0] : null;
}

/** Seats as "UUP 25 · Alliance 8 · no party label 2". @param {Seats | null | undefined} seats @param {Parties} parties */
export const seatsText = (seats, parties) => (seats || []).map(([p, n]) => `${p ? partyName(parties, p) : TEXT.noLabelSeats} ${fmtInt(n)}`).join(' · ');

/**
 * The timeline chart: one bar per election, of the composition after it (or, for an election of
 * part of the council, the seats it filled), scaled to the largest council of the timeline, with a
 * mark at half the seats, each party in the same place on every bar. HTML, not SVG: the words stay at body size on a phone. Each bar's
 * figures are in the table beside it; the year and the control are text on each row.
 * @param {Council} council @param {Parties} parties
 */
export function controlChart(council, parties) {
  const els = council.timeline.filter((e) => e.type === 'election');
  const size = (/** @type {Entry} */ e) => (e.whole ? e.total ?? e.filled ?? 0 : e.filled ?? 0);
  const max = Math.max(1, ...els.map(size));
  // One order of parties for every bar (most seats over the timeline first, no label last), so a
  // party keeps its place from row to row.
  /** @type {Map<string | null, number>} */
  const weight = new Map();
  for (const e of els) for (const [p, n] of e.seats || []) weight.set(p, (weight.get(p) || 0) + n);
  const rank = (/** @type {string | null} */ p) => (p === null ? -1 : weight.get(p) || 0);
  const rows = els.map((e) => {
    const seats = [...(e.whole && e.composition ? e.composition : e.seats || [])].sort((a, b) => rank(b[0]) - rank(a[0]) || String(a[0]).localeCompare(String(b[0])));
    const segs = seats.map(([p, n]) => `<span class="el-ctl-seg" style="flex-grow:${n};background:${esc(partyColour(p ? parties[p]?.colour : null))}" title="${esc(`${p ? partyName(parties, p) : TEXT.noLabelSeats}: ${n}`)}"></span>`).join('')
      + (e.whole && e.missing ? `<span class="el-ctl-seg el-ctl-seg--missing" style="flex-grow:${e.missing}" title="${esc(`${TEXT.missingSeats}: ${e.missing}`)}"></span>` : '');
    const width = (100 * size(e)) / max;
    const text = e.whole ? controlText(e.control, parties) : TEXT.partCouncil;
    return `<li class="el-ctl-row${e.whole ? '' : ' el-ctl-row--part'}"><span class="el-ctl-year">${esc(e.date.slice(0, 4))}</span>`
      + `<span class="el-ctl-track"><span class="el-ctl-bar" style="width:${width.toFixed(1)}%" aria-hidden="true">${segs}</span></span>`
      + `<span class="el-ctl-text">${esc(text)}</span></li>`;
  }).join('');
  return `<ol class="el-ctl-chart" aria-label="${esc(TEXT.chartTitle)}">${rows}</ol>`;
}

/**
 * Every council in a year: the composition after its last election on or before the year, with
 * the recorded changes since. A council is listed from its first election on file to the end of
 * its generation, while an election of it is on file within STALE_YEARS before.
 * @param {Table} table @param {number} year
 * @returns {Array<{ council: Council, entry: Entry, election: Entry }>}
 */
export function yearView(table, year) {
  const end = `${year}-12-31`;
  /** @type {Record<string, number>} */
  const ends = GENERATION_END;
  const out = [];
  for (const council of table.councils) {
    const last = ends[council.generation];
    if (last !== undefined && year > last) continue;
    const upto = council.timeline.filter((e) => e.date <= end);
    const election = upto.filter((e) => e.type === 'election').at(-1);
    if (!election || year - Number(election.date.slice(0, 4)) > STALE_YEARS) continue;
    out.push({ council, entry: /** @type {Entry} */ (upto.at(-1)), election });
  }
  return out.sort((a, b) => a.council.name.localeCompare(b.council.name));
}

/**
 * The counts of a year's summary: councils under a party majority, under no overall control,
 * and the rest (independents' majority, not determinable, not recorded).
 * @param {ReturnType<typeof yearView>} rows
 */
export function yearCounts(rows) {
  const majority = rows.filter((r) => r.entry.control?.kind === 'majority').length;
  const noc = rows.filter((r) => r.entry.control?.kind === 'noc').length;
  return { councils: rows.length, majority, noc, other: rows.length - majority - noc };
}

/** The years with an election of some council on file, first and last. @param {Table} table */
export function yearRange(table) {
  const years = table.councils.flatMap((c) => c.timeline.map((e) => Number(e.date.slice(0, 4))));
  return { first: Math.min(...years), last: Math.max(...years) };
}

/** The picker's groups of councils: [label, councils by name]. @param {Table} table @returns {Array<[string, Council[]]>} */
export function councilGroups(table) {
  /** @type {Array<[string, (c: Council) => boolean]>} */
  const groups = [
    [TEXT.generationPre1973, (c) => c.generation === 'pre-1973'],
    [TEXT.generation1973, (c) => c.jurisdiction === 'northern-ireland' && c.generation === '1973'],
    [TEXT.generation2014, (c) => c.jurisdiction === 'northern-ireland' && c.generation === '2014'],
    [TEXT.generationIreland, (c) => c.jurisdiction === 'ireland'],
  ];
  const byName = [...table.councils].sort((a, b) => a.name.localeCompare(b.name));
  return groups.map(([label, test]) => /** @type {[string, Council[]]} */ ([label, byName.filter(test)])).filter(([, list]) => list.length);
}

/**
 * A council's predecessors that have a timeline here, and theirs in turn (nearest first, each once).
 * @param {Table} table @param {Council} council
 */
export function predecessorChain(table, council) {
  const byId = new Map(table.councils.map((c) => [c.id, c]));
  /** @type {Council[]} */
  const out = [];
  const seen = new Set([council.id]);
  let level = [council];
  while (level.length) {
    /** @type {Council[]} */
    const next = [];
    for (const c of level) {
      for (const p of c.predecessors) {
        const pc = byId.get(p.id);
        if (!pc || seen.has(pc.id)) continue;
        seen.add(pc.id);
        out.push(pc);
        next.push(pc);
      }
    }
    level = next;
  }
  return out;
}

const pairs = (/** @type {Seats | null | undefined} */ seats, /** @type {Parties} */ parties) => (seats || []).map(([p, n]) => `${p ? partyName(parties, p) : 'no party label'}: ${n}`).join('; ');

/** A council's timeline as CSV. @param {Council} council @param {Parties} parties */
export function councilCsv(council, parties) {
  const columns = ['council', 'date', 'type', 'election_key', 'contest_slug', 'area', 'whole_council', 'seats_filled', 'gain', 'loss', 'departing_member', 'composition_after', 'seats_not_on_file', 'total_seats', 'control', 'control_party'];
  return toCsvText(columns, council.timeline.map((e) => ({
    council: council.name,
    date: e.date,
    type: e.type,
    election_key: e.election,
    contest_slug: e.contest,
    area: e.area,
    whole_council: e.type === 'election' ? !!e.whole : null,
    seats_filled: e.type === 'election' ? pairs(e.seats, parties) : null,
    gain: e.type === 'election' ? null : e.gain ? partyName(parties, e.gain) : e.departingKnown ? 'no party label' : '',
    loss: e.type === 'election' ? null : e.loss ? partyName(parties, e.loss) : e.departingKnown ? 'no party label' : '',
    departing_member: e.departing ?? null,
    composition_after: e.composition ? pairs(e.composition, parties) : null,
    seats_not_on_file: e.missing,
    total_seats: e.total,
    control: e.control?.kind ?? null,
    control_party: e.control?.party ? partyName(parties, e.control.party) : null,
  })));
}

/** A year's councils as CSV. @param {ReturnType<typeof yearView>} rows @param {Parties} parties @param {number} year */
export function yearCsv(rows, parties, year) {
  const columns = ['year', 'council', 'council_id', 'generation', 'last_election', 'as_of', 'control', 'control_party', 'largest_party', 'composition', 'seats_not_on_file', 'total_seats'];
  return toCsvText(columns, rows.map(({ council, entry, election }) => ({
    year,
    council: council.name,
    council_id: council.id,
    generation: council.generation,
    last_election: election.date,
    as_of: entry.date,
    control: entry.control?.kind ?? null,
    control_party: entry.control?.party ? partyName(parties, entry.control.party) : null,
    largest_party: largestParty(entry.composition) ? partyName(parties, largestParty(entry.composition)) : null,
    composition: entry.composition ? pairs(entry.composition, parties) : null,
    seats_not_on_file: entry.missing,
    total_seats: entry.total,
  })));
}
