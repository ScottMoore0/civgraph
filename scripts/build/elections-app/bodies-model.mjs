/**
 * The Elections app's by-election tracker and council-control tables (stream el-bodies, 14 Nov
 * 2026), as pure functions over elections the records build gives (scripts/build/elections-app/
 * bodies.mjs reads them). No I/O here; its unit test is elections-app-bodies-model.test.mjs.
 *
 * What the tables claim, and what they leave as "not recorded":
 *
 * - A by-election is a contest of an election whose kind is "by-election", or, for a council, a
 *   contest the source files as filling a casual vacancy (a "Cause" note, or a note that opens
 *   "By-election" or says "to fill a casual vacancy"): the pre-1973 Northern Ireland councils file
 *   their by-elections under the ordinary election kind.
 * - The defending party is the party of the member the by-election replaced, and only where the
 *   records link that member to the seat: the one member of a single-member seat at the last
 *   election (and no cause naming someone else), or the one sitting member of the seat whose
 *   surname the cause names. Otherwise it is null ("not recorded"), never guessed.
 * - A council's composition is known after an election that renewed the whole council; it is
 *   carried forward through by-elections and co-options only while each one's departing member is
 *   known. An election that renewed only part of the council (annual thirds, a partial record)
 *   ends the known composition until the next whole-council election. Defections are not in the
 *   records, so composition between elections never moves for them.
 */

/** The share of the council's usual size an election must fill to count as renewing all of it. */
export const WHOLE_COUNCIL_SHARE = 0.75;
/** Years either side over which a council's usual size (the most seats any election filled) is taken. */
export const SIZE_WINDOW_YEARS = 10;
/** The party key of independent members: not a party, so never "in control". */
export const INDEPENDENT = 'independent';

/**
 * One candidacy as the tables need it. `party` is the folded party key (party_label_map), null
 * for no label.
 * @typedef {{ name: string, personId: string | null, party: string | null, votes: number | null, elected: boolean }} Cand
 */
/**
 * One contest. `notes` are the contest's notes ({ label, text }), `unopposed` whether it was
 * returned without a poll.
 * `keys` are the seat's identities, most specific first (the map feature it matched, then its
 * slug): a by-election and the general election before it may spell the seat differently
 * ("south-kildare", "kildare-s") but match the same feature.
 * @typedef {{ seq: number, name: string, slug: string, keys?: string[], seats: number | null, electorate: number | null, turnout: number | null, majority: number | null, majorityPct: number | null, validPoll: number | null, unopposed: boolean, notes: Array<{ label?: string, text?: string }>, cands: Cand[] }} Contest
 */
/**
 * One election of one unit (a body, or a council of a shared body). `council` says whether the
 * unit is a council (its by-elections may be filed under the ordinary kind).
 * @typedef {{ key: string, body: string, unit: string, council: boolean, kind: string, date: string, contests: Contest[] }} El
 */
/**
 * A member sitting for a seat, as the tables track them.
 * @typedef {{ name: string, personId: string | null, party: string | null, since: string }} Holder
 */
/**
 * The member a by-election replaced, and how the records link them to the seat: 'seat' (the one
 * member of a single-member seat), 'cause' (the one sitting member the cause names).
 * @typedef {{ name: string, personId: string | null, party: string | null, since: string, basis: 'seat' | 'cause' }} Defending
 */
/**
 * Whether the defending party kept the seat ('held'), lost it ('gained' by the winner), or it
 * cannot be said (null: the defending party, or the winner's, is not recorded, or more than one
 * seat was filled).
 * @typedef {'held' | 'gained' | null} ResultKind
 */
/**
 * One row of the by-election tracker.
 * @typedef {{
 *   type: 'by-election' | 'co-option', election: string | null, contest: string | null, date: string, body: string, unit: string,
 *   area: string | null, areaSlug: string | null, seats: number, unopposed: boolean, turnout: number | null, electorate: number | null,
 *   majority: number | null, majorityPct: number | null,
 *   winners: Array<{ name: string, personId: string | null, party: string | null }>,
 *   candidates: Array<{ name: string, party: string | null, votes: number | null, share: number | null, elected: boolean }>,
 *   defending: Defending | null, result: ResultKind, cause: string | null,
 * }} ByElectionRow
 */
/**
 * Who controls a council: 'majority' (one party holds more than half the seats), 'independent'
 * (independent members hold more than half), 'noc' (no overall control), 'unknown' (members
 * without a party label could tip it either way).
 * @typedef {'majority' | 'independent' | 'noc' | 'unknown'} ControlKind
 * @typedef {{ kind: ControlKind, party: string | null }} Control
 */
/**
 * A council's seats by party ([party key or null for no label, seats], largest first).
 * @typedef {Array<[string | null, number]>} Seats
 */
/**
 * One entry of a council's timeline: an election (the seats it filled; the composition after it
 * where known) or a change between elections (a by-election or co-option). `missing` is the seats
 * of the council not on file (the usual size less the seats the last whole-council election
 * filled); `total` the composition's seats with them.
 * @typedef {{
 *   type: 'election' | 'by-election' | 'co-option', date: string, election: string | null, contest: string | null, area: string | null,
 *   whole?: boolean, filled?: number, seats?: Seats,
 *   gain?: string | null, loss?: string | null, departing?: string | null, departingKnown?: boolean,
 *   composition: Seats | null, missing: number | null, total: number | null, control: Control | null,
 * }} TimelineEntry
 */

const year = (/** @type {string} */ date) => Number(String(date).slice(0, 4));

/** Accent-free lower-case words, with M' and Mac spelt Mc, for matching a surname in a cause. @param {unknown} s */
export function foldName(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bm['’]/g, 'mc').replace(/\bmac(?=[a-z]{3})/g, 'mc').replace(/['’]/g, '').replace(/[^a-z]+/g, ' ').trim();
}

/** The surname of a name as the records write it ("John Campbell White" -> "white"). @param {unknown} name */
export function surnameOf(name) {
  const words = foldName(String(name || '').replace(/\(.*?\)/g, ' ')).split(' ').filter((w) => w.length > 1 && !/^(jr|sr|jp|mp|kc|qc|md)$/.test(w));
  return words.at(-1) || '';
}

/** The "Cause" note of a contest (the source's reason for the by-election), or null. @param {Contest} c */
export function causeOf(c) {
  const n = c.notes.find((x) => x.label === 'Cause' && x.text);
  return n ? String(n.text).trim() : null;
}

/** A note that files a council contest as filling a casual vacancy. */
const BY_NOTE = /^(?:by-election|bye-election)\b|\bto fill (?:a|the) casual vacanc/i;

/**
 * Whether a contest is a by-election: its election's kind says so, or, for a council, the source
 * files it as filling a casual vacancy.
 * @param {El} el @param {Contest} c
 */
export function isByElectionContest(el, c) {
  if (el.kind === 'by-election') return true;
  if (!el.council) return false;
  if (causeOf(c)) return true;
  return c.notes.some((x) => x.label === 'Note' && BY_NOTE.test(String(x.text || '').trim()));
}

/** A contest's seat identities (Contest `keys`), its slug at least. @param {Contest} c */
export const seatKeys = (c) => (c.keys && c.keys.length ? c.keys : [c.slug]);

/** The members a contest returned. @param {Contest} c */
const winnersOf = (c) => c.cands.filter((x) => x.elected);

/**
 * The member a by-election replaced, where the records link them to the seat (see the header): the
 * one member a single-member seat returned (a cause that names someone else, such as a peerage
 * title, is not read as contradicting it), or the one sitting member whose surname the cause names.
 * @param {Holder[]} holders the seat's sitting members before the by-election
 * @param {boolean} singleMember whether the seat returned one member at its last election
 * @param {Contest} c the by-election contest
 * @returns {Defending | null}
 */
export function defendingOf(holders, singleMember, c) {
  if (singleMember && (c.seats ?? 1) === 1 && holders.length === 1) return { ...holders[0], basis: 'seat' };
  const cause = causeOf(c);
  if (!cause) return null;
  const words = ` ${foldName(cause)} `;
  // None named, or two sitting members of one surname (the cause cannot say which): not recorded.
  const hits = holders.filter((h) => {
    const s = surnameOf(h.name);
    return !!s && words.includes(` ${s} `);
  });
  return hits.length === 1 ? { ...hits[0], basis: 'cause' } : null;
}

/** @param {Defending | null} def @param {Array<{ party: string | null }>} winners @param {number} seats @returns {ResultKind} */
export function resultOf(def, winners, seats) {
  if (!def || !def.party || seats !== 1 || winners.length !== 1 || !winners[0].party) return null;
  return winners[0].party === def.party ? 'held' : 'gained';
}

/**
 * Which of a unit's ordinary elections renewed the whole council, and the council's usual size
 * then: the most seats any ordinary election of the unit filled within SIZE_WINDOW_YEARS either
 * side. An election renewed the whole council when it filled at least WHOLE_COUNCIL_SHARE of that;
 * the seats it filled short of it are seats not on file. A body that is not a council: every
 * ordinary election, at the seats it filled.
 * @param {Array<{ key: string, date: string, filled: number }>} ordinary
 * @param {boolean} council
 * @returns {Map<string, number>} the whole-council elections' keys, each with the council's usual size
 */
export function wholeElections(ordinary, council) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const e of ordinary) {
    if (e.filled <= 0) continue;
    if (!council) { out.set(e.key, e.filled); continue; }
    const size = Math.max(...ordinary.filter((o) => Math.abs(year(o.date) - year(e.date)) <= SIZE_WINDOW_YEARS).map((o) => o.filled));
    if (e.filled >= WHOLE_COUNCIL_SHARE * size) out.set(e.key, size);
  }
  return out;
}

/**
 * Who controls a council of this composition, with `missing` seats not on file (they count as
 * members whose party is not recorded).
 * @param {Seats} seats
 * @param {number} [missing]
 * @returns {Control | null} null for an empty council
 */
export function controlOf(seats, missing = 0) {
  const total = seats.reduce((s, [, n]) => s + n, 0) + missing;
  if (!total) return null;
  const unlabelled = seats.filter(([p]) => p === null).reduce((s, [, n]) => s + n, 0) + missing;
  const parties = seats.filter(([p]) => p !== null && p !== INDEPENDENT).sort((a, b) => b[1] - a[1]);
  const independents = seats.filter(([p]) => p === INDEPENDENT).reduce((s, [, n]) => s + n, 0);
  const top = parties[0];
  if (top && top[1] * 2 > total) return { kind: 'majority', party: top[0] };
  if (independents * 2 > total) return { kind: 'independent', party: null };
  const tip = Math.max(top ? top[1] : 0, independents) + unlabelled;
  if (unlabelled > 0 && tip * 2 > total) return { kind: 'unknown', party: null };
  const largest = top && (!parties[1] || parties[1][1] < top[1]) ? top[0] : null;
  return { kind: 'noc', party: largest };
}

/** Seats as sorted pairs, largest first, the unlabelled last. @param {Map<string | null, number>} m @returns {Seats} */
export function seatsOf(m) {
  return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

/** @param {Contest} c @returns {ByElectionRow['candidates']} */
function candidatesOf(c) {
  const valid = c.validPoll ?? (c.cands.every((x) => x.votes !== null) ? c.cands.reduce((s, x) => s + (x.votes || 0), 0) : null);
  return c.cands.map((x) => ({
    name: x.name,
    party: x.party,
    votes: x.votes,
    share: x.votes !== null && valid ? Math.round((10000 * x.votes) / valid) / 100 : null,
    elected: x.elected,
  }));
}

/**
 * A co-option or other filling of a vacancy without a poll, from the offices' tenures.
 * @typedef {{ unit: string, body: string, date: string, name: string, personId: string | null, party: string | null, note: string | null }} CoOption
 */

/**
 * The by-election rows and every council's timeline, from all elections in date order.
 * @param {El[]} elections
 * @param {{ councils?: Set<string>, coOptions?: CoOption[] }} [opts] councils: units that are councils besides those
 *   whose elections say so (each council gets a timeline)
 * @returns {{ rows: ByElectionRow[], timelines: Map<string, TimelineEntry[]> }}
 */
export function buildTables(elections, opts = {}) {
  const councils = opts.councils || new Set();
  /** @type {Map<string, El[]>} */
  const byUnit = new Map();
  for (const el of [...elections].sort((a, b) => a.unit.localeCompare(b.unit) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key))) {
    if (!byUnit.has(el.unit)) byUnit.set(el.unit, []);
    /** @type {El[]} */ (byUnit.get(el.unit)).push(el);
  }
  /** @type {ByElectionRow[]} */
  const rows = [];
  /** @type {Map<string, TimelineEntry[]>} */
  const timelines = new Map();
  /** @type {Map<string, CoOption[]>} */
  const coByUnit = new Map();
  for (const co of opts.coOptions || []) {
    if (!coByUnit.has(co.unit)) coByUnit.set(co.unit, []);
    /** @type {CoOption[]} */ (coByUnit.get(co.unit)).push(co);
  }

  for (const [unit, els] of byUnit) {
    const isCouncil = councils.has(unit) || els.some((el) => el.council);
    const ordinary = els.map((el) => ({
      key: el.key,
      date: el.date,
      filled: el.contests.filter((c) => !isByElectionContest(el, c)).reduce((s, c) => s + winnersOf(c).length, 0),
    })).filter((e) => e.filled > 0);
    const whole = wholeElections(ordinary, isCouncil);
    /** @type {Map<string, Holder[]>} */
    const holders = new Map();
    /** @type {Map<string, boolean>} */
    const single = new Map();
    /** When each seat identity's members were last set: an old map feature can outlive its seat. */
    /** @type {Map<string, string>} */
    const setOn = new Map();
    /** The identity of a contest's seat last set (its newest record), or undefined. @param {Contest} c */
    const keyOf = (c) => seatKeys(c).filter((x) => holders.has(x)).sort((a, b) => String(setOn.get(b)).localeCompare(String(setOn.get(a))))[0];
    /** The sitting members of a contest's seat. @param {Contest} c */
    const holdersOf = (c) => {
      const k = keyOf(c);
      return k === undefined ? [] : /** @type {Holder[]} */ (holders.get(k));
    };
    /** @type {TimelineEntry[]} */
    const timeline = [];
    /** @type {Map<string | null, number> | null} */
    let comp = null;
    /** Seats of the council not on file at its last whole-council election. */
    let missing = 0;
    const after = () => (comp
      ? { composition: seatsOf(comp), missing, total: [...comp.values()].reduce((s, n) => s + n, 0) + missing, control: controlOf(seatsOf(comp), missing) }
      : { composition: null, missing: null, total: null, control: null });
    /** @type {Array<{ date: string, run: () => void }>} */
    const steps = [];
    for (const el of els) {
      steps.push({ date: el.date, run: () => {
        const ordinaryContests = el.contests.filter((c) => !isByElectionContest(el, c));
        const isWhole = whole.has(el.key);
        if (ordinaryContests.length) {
          /** @type {Map<string | null, number>} */
          const filled = new Map();
          for (const c of ordinaryContests) {
            const won = winnersOf(c);
            for (const w of won) filled.set(w.party, (filled.get(w.party) || 0) + 1);
            const sitting = won.map((w) => ({ name: w.name, personId: w.personId, party: w.party, since: el.date }));
            const prior = holdersOf(c);
            const next = isWhole ? sitting
              : [...prior.filter((h) => !sitting.some((s) => (s.personId && s.personId === h.personId) || foldName(s.name) === foldName(h.name))), ...sitting]
                .filter((h) => year(el.date) - year(h.since) <= SIZE_WINDOW_YEARS);
            for (const k of seatKeys(c)) {
              holders.set(k, next);
              setOn.set(k, el.date);
              single.set(k, isWhole && won.length === 1 && (c.seats ?? 1) === 1);
            }
          }
          if (isCouncil && [...filled.values()].some((n) => n > 0)) {
            const count = [...filled.values()].reduce((s, n) => s + n, 0);
            comp = isWhole ? new Map(filled) : null;
            missing = isWhole ? Math.max(0, /** @type {number} */ (whole.get(el.key)) - count) : 0;
            timeline.push({ type: 'election', date: el.date, election: el.key, contest: null, area: null, whole: isWhole, filled: count, seats: seatsOf(filled), ...after() });
          }
        }
        for (const c of el.contests.filter((x) => isByElectionContest(el, x))) {
          const sitting = holdersOf(c);
          const key = keyOf(c);
          const def = defendingOf(sitting, key !== undefined && single.get(key) === true, c);
          const won = winnersOf(c);
          const seats = c.seats ?? won.length;
          rows.push({
            type: 'by-election', election: el.key, contest: c.slug, date: el.date, body: el.body, unit,
            area: c.name, areaSlug: c.slug, seats, unopposed: c.unopposed, turnout: c.turnout, electorate: c.electorate,
            majority: seats === 1 && !c.unopposed ? c.majority : null, majorityPct: seats === 1 && !c.unopposed ? c.majorityPct : null,
            winners: won.map((w) => ({ name: w.name, personId: w.personId, party: w.party })),
            candidates: candidatesOf(c),
            defending: def, result: resultOf(def, won, seats), cause: causeOf(c),
          });
          const rest = def ? sitting.filter((h) => h !== sitting.find((x) => x.name === def.name && x.since === def.since)) : sitting;
          const now = [...rest, ...won.map((w) => ({ name: w.name, personId: w.personId, party: w.party, since: el.date }))];
          for (const k of seatKeys(c)) {
            if (!single.has(k) && key !== undefined) single.set(k, single.get(key) === true);
            holders.set(k, now);
            setOn.set(k, el.date);
          }
          if (isCouncil) {
            const known = !!def && won.length === 1;
            if (comp && known) {
              const m = /** @type {Map<string | null, number>} */ (comp);
              const loss = /** @type {Defending} */ (def).party;
              if ((m.get(loss) || 0) > 0) {
                m.set(loss, (m.get(loss) || 0) - 1);
                m.set(won[0].party, (m.get(won[0].party) || 0) + 1);
              } else comp = null;
            } else if (comp && won.length > 0) comp = null;
            timeline.push({
              type: 'by-election', date: el.date, election: el.key, contest: c.slug, area: c.name,
              gain: won.length === 1 ? won[0].party : null, loss: def ? def.party : null, departing: def ? def.name : null, departingKnown: !!def,
              ...after(),
            });
          }
        }
      } });
    }
    for (const co of coByUnit.get(unit) || []) {
      steps.push({ date: co.date, run: () => {
        rows.push({
          type: 'co-option', election: null, contest: null, date: co.date, body: co.body, unit, area: null, areaSlug: null,
          seats: 1, unopposed: false, turnout: null, electorate: null, majority: null, majorityPct: null,
          winners: [{ name: co.name, personId: co.personId, party: co.party }], candidates: [],
          defending: null, result: null, cause: co.note,
        });
        // The departing member of a co-option is not linked in the records: the composition after it is not known.
        if (isCouncil) {
          comp = null;
          timeline.push({ type: 'co-option', date: co.date, election: null, contest: null, area: null, gain: co.party, loss: null, departing: null, departingKnown: false, ...after() });
        }
      } });
    }
    // Elections before co-options of the same day (a stable sort keeps the elections' order).
    steps.sort((a, b) => a.date.localeCompare(b.date));
    for (const s of steps) s.run();
    if (isCouncil && timeline.length) timelines.set(unit, timeline);
  }
  for (const [unit, cos] of coByUnit) {
    if (byUnit.has(unit)) continue;
    for (const co of cos) {
      rows.push({
        type: 'co-option', election: null, contest: null, date: co.date, body: co.body, unit, area: null, areaSlug: null,
        seats: 1, unopposed: false, turnout: null, electorate: null, majority: null, majorityPct: null,
        winners: [{ name: co.name, personId: co.personId, party: co.party }], candidates: [], defending: null, result: null, cause: co.note,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit) || String(a.area).localeCompare(String(b.area)));
  return { rows, timelines };
}

// ------------------------------------------------------------------ councils

/**
 * A council of the registry (data/registries/councils.json), as far as the tables use it.
 * @typedef {{ id: string, name: string, bodySlug: string, generation: string, jurisdiction: string, searchName?: string, officialNameAliases?: string[], aldermenOf?: string, predecessors?: Array<{ id: string }>, successors?: Array<{ id: string }> }} RegistryCouncil
 */

/** A council name folded for matching ("Newry, Mourne and Down" -> "newry mourne and down"). */
const foldCouncil = foldName;

/**
 * The registry council of a 1973 or 2014 district council named in a contest (its localBody),
 * by the election's date: the 2014 councils from 2014.
 * @param {RegistryCouncil[]} registry @param {string} localBody @param {string} date
 * @returns {string | null}
 */
export function districtCouncilId(registry, localBody, date) {
  const generation = date >= '2014-01-01' ? '2014' : '1973';
  const want = foldCouncil(localBody);
  const hit = registry.find((r) => r.jurisdiction === 'northern-ireland' && r.generation === generation
    && [r.name, r.searchName, ...(r.officialNameAliases || [])].some((n) => n && foldCouncil(n) === want));
  return hit ? hit.id : null;
}

/** A Republic council's name as the sources print it, without "County Council" ("Cavan County Council" -> "Cavan"). @param {string} name */
export const irishBaseName = (name) => String(name).replace(/ County Council$/, '').replace(/ City Council$/, ' City').trim();

/** @param {string} s */
const slug = (s) => foldName(s).replace(/ /g, '-');

/**
 * The units of the Republic's councils, from the council names the source files print (by
 * election date). A name the registry holds (data/registries/councils.json, the councils since
 * 2014) is that council, for every year, unless the 2014 council merged a city council into it
 * (Limerick, Waterford): then the councils before 2014 are their own units, and predecessors of
 * the merged council. A name the registry does not hold is its own unit.
 * @param {RegistryCouncil[]} registry
 * @param {Array<{ name: string, date: string }>} printed every council name with an election date it was printed for
 * @returns {{ unitOf: (name: string, date: string) => string, units: Map<string, { name: string, predecessorOf: string | null }> }}
 */
export function irishCouncilUnits(registry, printed) {
  const ie = registry.filter((r) => r.jurisdiction === 'ireland');
  const byName = new Map(ie.map((r) => [r.name, r]));
  const reg = (/** @type {string} */ base) => byName.get(base) || byName.get(`${base} County`) || null;
  const before = new Set(printed.filter((p) => p.date < '2014-01-01').map((p) => irishBaseName(p.name)));
  /** A registry council that took in a city council in 2014: a "<name> City" before, no such council after. */
  const merged = (/** @type {RegistryCouncil} */ r) => before.has(`${r.name} City`) && !byName.has(`${r.name} City`);
  /** @type {Map<string, { name: string, predecessorOf: string | null }>} */
  const units = new Map();
  const unitOf = (/** @type {string} */ name, /** @type {string} */ date) => {
    const base = irishBaseName(name);
    const r = reg(base);
    if (r && !(merged(r) && date < '2014-01-01')) {
      units.set(r.id, { name: r.name, predecessorOf: null });
      return r.id;
    }
    const id = `ireland-local-${slug(name)}`;
    const into = r || ie.find((x) => base.startsWith(`${x.name} `)) || (base.endsWith(' City') ? byName.get(base.slice(0, -5)) : null) || null;
    units.set(id, { name, predecessorOf: into ? into.id : null });
    return id;
  };
  return { unitOf, units };
}
