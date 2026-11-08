/**
 * The statuses registry (data/registries/statuses.json): the data statuses of the state-machine
 * catalogue (RG-01 to RG-06), as values, transition tables, spellings and site rules. Pure: the
 * runnable machines are built by registries/status-machines.mjs over the shared helper
 * (scripts/lib/state-machine.mjs), which every stream uses.
 */

/** The states of a machine entry: the keys of its table (full) or its values (light). */
export function statesOf(registry, name) {
  const m = registry.machines[name];
  if (!m) throw new Error(`Unknown status machine ${name}`);
  return m.weight === 'full' ? Object.keys(m.transitions) : [...m.values];
}

/** Whether `from -> to` is in a full machine's table. */
export function canTransition(registry, name, from, to) {
  return Boolean(registry.machines[name]?.transitions?.[from]?.includes(to));
}

/** The values of an enum entry (RG-06), or of a light machine. */
export function enumValues(registry, name) {
  const e = registry.enums[name] || registry.machines[name];
  if (!e?.values) throw new Error(`Unknown status enum ${name}`);
  return [...e.values];
}

/**
 * The kind a candidate's Status means (RG-01): '' while continuing, else elected, not-elected,
 * excluded, or the folded text itself when no pattern matches; exactly src/election-domain.mjs
 * statusKind, which normalises the text the same way first.
 */
export function candidateStatusKind(registry, status) {
  const normalized = String(status || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return '';
  for (const { kind, pattern } of registry.machines['candidate-count'].kindPatterns) {
    if (new RegExp(pattern).test(normalized)) return kind;
  }
  return normalized;
}

/** The machine state a candidate Status spelling stands for ('' is continuing). */
export function candidateCountState(registry, status) {
  const kind = candidateStatusKind(registry, status);
  return kind === '' ? 'continuing' : kind;
}

/**
 * The site status of a published pre-1973 council round (RG-03), as
 * scripts/build/build-ni-local-grouped.mjs computes it: complete, moved down by the work status,
 * an apply exclusion, or a round-completeness entry that is not complete. Returns the walk taken
 * (the states entered after `complete`) and the status.
 * @param {{ work?: string, excluded?: unknown }|null} row the round-status.json row, if any
 * @param {{ text?: string, complete?: boolean }|undefined} completeness the round-completeness entry
 */
export function siteRoundStatus(registry, row, completeness) {
  const m = registry.machines['election-round'];
  let status = m.initial;
  const walk = [];
  const to = (next) => { if (next !== status) { walk.push(next); status = next; } };
  const work = row?.work;
  if (work === 'partial' || work === 'held') to(work);
  if (row?.excluded && status === 'complete') to('partial');
  if (completeness?.text && !completeness.complete && status === 'complete') to('partial');
  return { status, walk };
}

/** Why a calendar-held round is missing from the map, and the label the map shows. */
export function missingRoundReason(registry, row) {
  const r = registry.machines['election-round'].missingReasons;
  return row?.excluded ? r.excluded : r.otherwise;
}

/** Whether a contest status (RG-02) means a poll was held; a missing value reads as contested. */
export function isContested(registry, contestStatus) {
  const m = registry.machines.contest;
  return (contestStatus || m.missingMeans) === 'contested';
}

/**
 * Checks the schema cannot state: tables are closed (every target is a state), the initial
 * state exists and every state is reachable from it; labels and spellings name real states.
 * @returns {string[]} errors
 */
export function checkStatuses(registry) {
  const errors = [];
  for (const [name, m] of Object.entries(registry.machines)) {
    if (m.weight !== 'full') {
      for (const key of Object.keys(m.labels || {})) if (!m.values.includes(key)) errors.push(`${name}: label for unknown value ${key}`);
      if (m.missingMeans && !m.values.includes(m.missingMeans)) errors.push(`${name}: missingMeans ${m.missingMeans} is not a value`);
      continue;
    }
    const states = Object.keys(m.transitions);
    if (!states.includes(m.initial)) errors.push(`${name}: initial ${m.initial} is not a state`);
    for (const [from, tos] of Object.entries(m.transitions)) {
      for (const to of tos) if (!states.includes(to)) errors.push(`${name}: ${from} -> ${to} names no state`);
    }
    const reached = new Set([m.initial]);
    for (let grew = true; grew;) {
      grew = false;
      for (const s of [...reached]) for (const t of m.transitions[s] || []) if (!reached.has(t)) { reached.add(t); grew = true; }
    }
    for (const s of states) if (!reached.has(s)) errors.push(`${name}: ${s} cannot be reached from ${m.initial}`);
    for (const d of m.decisions || []) if (!(m.transitions[m.initial] || []).includes(d)) errors.push(`${name}: decision ${d} is not a move from ${m.initial}`);
    for (const [spelling, state] of Object.entries(m.spellings || {})) if (!states.includes(state)) errors.push(`${name}: spelling ${JSON.stringify(spelling)} means unknown state ${state}`);
    for (const k of m.kindPatterns || []) if (!states.includes(k.kind)) errors.push(`${name}: pattern kind ${k.kind} is not a state`);
    for (const key of Object.keys(m.siteLabels || {})) if (!states.includes(key)) errors.push(`${name}: site label for unknown state ${key}`);
    if (m.appliedValue && !states.includes(m.appliedValue)) errors.push(`${name}: appliedValue ${m.appliedValue} is not a state`);
  }
  return errors;
}
