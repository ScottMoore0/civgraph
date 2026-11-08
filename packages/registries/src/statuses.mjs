/**
 * The statuses registry (data/registries/statuses.json): the data statuses of the state-machine
 * catalogue (RG-01 to RG-06), as values, transition tables, spellings and site rules. Pure: the
 * runnable machines are built by packages/registries/src/status-machines.mjs over the shared helper
 * (packages/core/src/state-machine.mjs), which every stream uses.
 */

/** @typedef {import('../../types/index.js').StatusesRegistry} StatusesRegistry */

/**
 * The fields a machine entry may carry beyond the schema's common ones (the schema's own
 * per-machine rules; data/registries/statuses.json).
 * @typedef {StatusesRegistry['machines'][string] & {
 *   labels?: { [value: string]: string },
 *   missingMeans?: string,
 *   decisions?: string[],
 *   spellings?: { [spelling: string]: string },
 *   kindPatterns?: Array<{ kind: string, pattern: string }>,
 *   siteLabels?: { [state: string]: string },
 *   appliedValue?: string,
 *   missingReasons?: { excluded: MissingReason, otherwise: MissingReason }
 * }} StatusMachineFields
 */

/**
 * A machine entry: a full machine has its initial state and transition table, a light one its
 * values (the schema requires each by weight).
 * @typedef {(StatusMachineFields & { weight: 'full', initial: string, transitions: { [state: string]: string[] } })
 *   | (StatusMachineFields & { weight: 'light', values: string[] })} StatusMachineEntry
 */
/** @typedef {{ reason: string, label: string }} MissingReason */

/**
 * The entry `name` of the registry's machines, with its kind's fields.
 * @param {StatusesRegistry} registry
 * @param {string} name
 * @returns {StatusMachineEntry | undefined}
 */
const machineEntry = (registry, name) => /** @type {StatusMachineEntry | undefined} */ (registry.machines[name]);

/**
 * The registry's machines, each with its kind's fields.
 * @param {StatusesRegistry} registry
 * @returns {{ [name: string]: StatusMachineEntry }}
 */
const machineEntries = (registry) => /** @type {{ [name: string]: StatusMachineEntry }} */ (registry.machines);

/**
 * The states of a machine entry: the keys of its table (full) or its values (light).
 * @param {StatusesRegistry} registry
 * @param {string} name
 * @returns {string[]}
 */
export function statesOf(registry, name) {
  const m = machineEntry(registry, name);
  if (!m) throw new Error(`Unknown status machine ${name}`);
  return m.weight === 'full' ? Object.keys(m.transitions) : [...m.values];
}

/**
 * Whether `from -> to` is in a full machine's table.
 * @param {StatusesRegistry} registry
 * @param {string} name
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(registry, name, from, to) {
  return Boolean(registry.machines[name]?.transitions?.[from]?.includes(to));
}

/**
 * The values of an enum entry (RG-06), or of a light machine.
 * @param {StatusesRegistry} registry
 * @param {string} name
 * @returns {string[]}
 */
export function enumValues(registry, name) {
  const e = registry.enums[name] || registry.machines[name];
  if (!e?.values) throw new Error(`Unknown status enum ${name}`);
  return [...e.values];
}

/**
 * The kind a candidate's Status means (RG-01): '' while continuing, else elected, not-elected,
 * excluded, or the folded text itself when no pattern matches; exactly packages/core/src/election-domain.mjs
 * statusKind, which normalises the text the same way first.
 * @param {StatusesRegistry} registry
 * @param {unknown} status
 * @returns {string}
 */
export function candidateStatusKind(registry, status) {
  const normalized = String(status || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return '';
  for (const { kind, pattern } of /** @type {NonNullable<StatusMachineEntry['kindPatterns']>} */ (registry.machines['candidate-count'].kindPatterns)) {
    if (new RegExp(pattern).test(normalized)) return kind;
  }
  return normalized;
}

/**
 * The machine state a candidate Status spelling stands for ('' is continuing).
 * @param {StatusesRegistry} registry
 * @param {unknown} status
 * @returns {string}
 */
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
 * @param {StatusesRegistry} registry
 * @returns {{ status: string, walk: string[] }}
 */
export function siteRoundStatus(registry, row, completeness) {
  const m = /** @type {StatusMachineEntry & { weight: 'full' }} */ (machineEntry(registry, 'election-round'));
  let status = m.initial;
  /** @type {string[]} */
  const walk = [];
  const to = (/** @type {string} */ next) => { if (next !== status) { walk.push(next); status = next; } };
  const work = row?.work;
  if (work === 'partial' || work === 'held') to(work);
  if (row?.excluded && status === 'complete') to('partial');
  if (completeness?.text && !completeness.complete && status === 'complete') to('partial');
  return { status, walk };
}

/**
 * Why a calendar-held round is missing from the map, and the label the map shows.
 * @param {StatusesRegistry} registry
 * @param {{ excluded?: unknown } | null | undefined} row the round-status.json row, if any
 * @returns {MissingReason}
 */
export function missingRoundReason(registry, row) {
  const r = /** @type {NonNullable<StatusMachineEntry['missingReasons']>} */ (registry.machines['election-round'].missingReasons);
  return row?.excluded ? r.excluded : r.otherwise;
}

/**
 * Whether a contest status (RG-02) means a poll was held; a missing value reads as contested.
 * @param {StatusesRegistry} registry
 * @param {string | null | undefined} contestStatus
 * @returns {boolean}
 */
export function isContested(registry, contestStatus) {
  const m = /** @type {StatusMachineEntry} */ (machineEntry(registry, 'contest'));
  return (contestStatus || m.missingMeans) === 'contested';
}

/**
 * Checks the schema cannot state: tables are closed (every target is a state), the initial
 * state exists and every state is reachable from it; labels and spellings name real states.
 * @param {StatusesRegistry} registry
 * @returns {string[]} errors
 */
export function checkStatuses(registry) {
  /** @type {string[]} */
  const errors = [];
  for (const [name, m] of Object.entries(machineEntries(registry))) {
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
