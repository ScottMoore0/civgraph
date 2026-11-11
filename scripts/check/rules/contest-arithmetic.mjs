#!/usr/bin/env node
/**
 * The arithmetic of every election contest Civgraph holds (arith-audit, 11 Nov 2026).
 *
 * Reads the local records database (the one `npm run records:build` writes and the site's D1 is
 * loaded from; CIVGRAPH_RECORDS_DB or --db), so it checks the figures as the site shows them,
 * after the source-checked fixes. Rules, by voting system:
 *
 *   every contest that went to a poll
 *     poll-identity        total poll = valid poll + rejected papers, where all three are recorded
 *     electorate-poll      the electorate is at least the total poll (else the valid poll)
 *     turnout              a turnout the source states (countInfo Turnout_Pct or
 *                          Percentage_Poll_Printed) = total poll / electorate, to the precision
 *                          printed; one that equals valid poll / electorate is listed as
 *                          turnout-valid-basis (the source's own definition), not failed
 *   FPTP (fptp, and leadership ballots)
 *     fptp-sum             one vote each: the candidates' votes add up to the valid poll;
 *                          block vote (votesPerElector > 1, or several seats): valid poll <= votes
 *                          <= valid poll x votes per elector
 *     fptp-winner          the candidates marked elected are the ones with the most votes
 *     fptp-majority        a printed majority (Majority_Printed) = the last winner's votes minus
 *                          the first loser's
 *     elected-count        as many candidates are marked elected as there are seats
 *   STV (stv-hare, stv-gregory)
 *     stv-first-sum        the first preferences add up to the valid poll
 *     stv-quota            quota = floor(valid / (seats + 1)) + 1; the variants some returning
 *                          officers used (the exact fraction plus 1, or rounded up, or over the
 *                          seats left after a Ceann Comhairle's automatic return) are accepted
 *     elected-count        elected = seats
 *     stv-row-transfer     each stage's total = the last stage's total + the transfer recorded
 *                          (where the file records transfers)
 *     stv-conservation     no stage hands out more votes than were released into it (a surplus,
 *                          or the votes of the candidates excluded); where the file records the
 *                          non-transferable papers, every stage adds up to the valid poll
 *     stv-surplus          a surplus distributed brings the candidate down to the quota, and no
 *                          candidate gains votes after reaching the quota
 *     stv-exclusion        the candidates excluded are the lowest of those still in the count
 *   party list (Forum 1996)
 *     list-sum             the lists' votes add up to the valid poll
 *   referendums (ordinal)
 *     referendum-sum       yes + no = valid poll
 *   no poll
 *     unopposed-votes      a candidate returned unopposed carries no votes, and a contest with no
 *                          poll has no valid poll or turnout recorded as a figure
 *
 * A contest that lacks what a rule needs (no valid poll, a candidate without votes, no count
 * stages) is listed under `missing` for that rule, never failed. Failures the source itself
 * contains (the published figures do not add up) are allowlisted with a reason and the source in
 * data/elections/corrections/contest-arithmetic-allowlist.json ({ entries: [{ sourceFile, rule,
 * reason, source }] }; sourceFile may be "*" for every contest of an electionKey).
 *
 *   node scripts/check/rules/contest-arithmetic.mjs [--db FILE | --from-bundles] [--json FILE] [--csv FILE]
 *                                                   [--body GROUP] [--fail]
 *
 * --from-bundles reads the election bundles of the last manifest build instead of the database
 * (CIVGRAPH_BUILD_DIR=tmp/records node scripts/build/build-test2-election-manifest.mjs, a few
 * minutes), for checking fixes without a full records build.
 *
 * Report mode by default: it prints the counts by body and rule and exits 0. --fail exits 1 on any
 * failure not allowlisted (for when the remaining list is empty). Without a records database (a
 * clean checkout, CI) it prints SKIP and exits 0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ALLOWLIST = path.join(ROOT, 'data', 'elections', 'corrections', 'contest-arithmetic-allowlist.json');

/** Absolute tolerance for vote figures that may carry fractions (Gregory, Senatorial rules). */
const VOTE_TOL = 0.5;

/** @param {unknown} v */
const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * The audit's body group for an election body slug and date.
 * @param {string} bodySlug
 * @param {string} date
 */
export function bodyGroup(bodySlug, date) {
  const year = Number(String(date).slice(0, 4));
  if (bodySlug === 'house-of-commons-of-the-united-kingdom') return 'westminster';
  if (bodySlug === 'parliament-of-northern-ireland') return 'stormont';
  if (/^northern-ireland-(assembly|constitutional-convention|forum)/.test(bodySlug)) return 'ni-assembly';
  if (bodySlug === 'dail-eireann') return 'dail';
  if (bodySlug.startsWith('seanad')) return 'seanad';
  if (bodySlug === 'european-parliament' || bodySlug === 'ireland-european') return 'european';
  if (bodySlug === 'ireland-local') return 'roi-local';
  if (/referendum/.test(bodySlug)) return 'referendum';
  if (bodySlug === 'ireland-president') return 'president';
  if (/leadership|nomination/.test(bodySlug)) return 'party-ballot';
  if (bodySlug === 'local-government' && year >= 1973) return 'ni-council-1973+';
  if (/council|commissioners|aldermen|local-government/.test(bodySlug)) {
    if (year >= 1921 && year <= 1967) return 'ni-council-1921-67';
    if (year < 1921) return 'ni-council-pre-1921';
    return 'ni-council-1968-72';
  }
  return 'other';
}

/** @param {string} status */
const isElectedStatus = (status) => /elected|made quota|deemed/i.test(status) && !/not elected/i.test(status);
/** @param {string} status */
const isUnopposedStatus = (status) => /unopposed/i.test(status);
/** @param {string} status */
const isAutoReturned = (status) => /auto[- ]?returned/i.test(status);

/**
 * The decimals a printed figure carries ("67.7" -> 1).
 * @param {unknown} v
 */
const decimals = (v) => {
  const m = String(v ?? '').match(/\.(\d+)/);
  return m ? m[1].length : 0;
};

/**
 * @typedef {{ ord: number, name: string, firstPrefs: number|null, finalVotes: number|null, elected: boolean, electedAt: number|null,
 *   excluded: boolean, excludedAt: number|null, status: string, unopposed: boolean, autoReturned: boolean,
 *   stages: Map<number, { total: number|null, transfers: number|null, status: string }> }} Cand
 * @typedef {{ electionKey: string, seq: number, name: string, sourceFile: string, bodySlug: string, group: string, date: string,
 *   votingSystem: string, contestStatus: string, seats: number|null, electorate: number|null, quota: number|null,
 *   validPoll: number|null, totalPoll: number|null, spoiled: number|null, votesPerElector: number|null,
 *   info: Record<string, unknown>, nonTransferable: Array<{ count: number, total: number|null, transfers: number|null }>,
 *   candidates: Cand[] }} Contest
 * @typedef {{ rule: string, kind: 'fail'|'missing'|'info', detail: string }} Finding
 */

/**
 * Every check over one contest.
 * @param {Contest} c
 * @returns {Finding[]}
 */
export function checkContest(c) {
  /** @type {Finding[]} */
  const out = [];
  const fail = (/** @type {string} */ rule, /** @type {string} */ detail) => out.push({ rule, kind: 'fail', detail });
  const missing = (/** @type {string} */ rule, /** @type {string} */ detail) => out.push({ rule, kind: 'missing', detail });
  const info = (/** @type {string} */ rule, /** @type {string} */ detail) => out.push({ rule, kind: 'info', detail });

  const cands = c.candidates;
  const polled = cands.filter((k) => !k.unopposed && !k.autoReturned);
  const unopposedAll = cands.length > 0 && cands.every((k) => k.unopposed || k.autoReturned);

  // ---- no poll
  for (const k of cands) {
    if (k.unopposed && (k.firstPrefs ?? 0) > 1) fail('unopposed-votes', `${k.name} returned unopposed with ${k.firstPrefs} votes`);
  }
  if (unopposedAll || (c.contestStatus === 'uncontested' && !polled.some((k) => (k.firstPrefs ?? 0) > 0))) {
    if (c.validPoll === 0 || c.totalPoll === 0) fail('unopposed-votes', `no poll, but a valid/total poll of 0 is recorded`);
    return out;
  }
  if (!cands.length) {
    missing('candidates', 'no candidates recorded');
    return out;
  }

  // ---- poll figures
  const { validPoll: valid, totalPoll: total, spoiled, electorate } = c;
  const blockVote = (c.votesPerElector ?? 1) > 1 || ((c.seats ?? 1) > 1 && !c.votingSystem.startsWith('stv') && c.votingSystem !== 'party-list-dhondt');
  if (valid !== null && total !== null && spoiled !== null && (spoiled > 0 || total !== valid)) {
    if (Math.abs(valid + spoiled - total) > 0.5) {
      // A block vote's "valid poll" may be the votes cast, more than the voters.
      if (blockVote && valid > total) info('poll-identity', `block vote: valid ${valid} is votes cast, total poll ${total} voters`);
      else if (total === valid) info('poll-total-is-valid', `total poll ${total} equals the valid poll; ${spoiled} rejected not included`);
      else fail('poll-identity', `valid ${valid} + rejected ${spoiled} = ${valid + spoiled}, total poll ${total}`);
    }
  }
  if (electorate !== null && electorate > 0) {
    const poll = total ?? (valid !== null && spoiled !== null ? valid + spoiled : valid);
    if (poll !== null && poll > electorate * (blockVote && total === null ? Math.max(c.votesPerElector ?? 1, c.seats ?? 1) : 1) + 0.5) {
      fail('electorate-poll', `electorate ${electorate} < ${total !== null ? 'total' : 'valid'} poll ${poll}`);
    }
  }
  const statedTurnout = c.info.Turnout_Pct ?? c.info.Percentage_Poll_Printed;
  const turnout = num(statedTurnout);
  if (turnout !== null && turnout > 0) {
    const tol = 0.5 * 10 ** -decimals(statedTurnout) + 0.011;
    const poll = total ?? (valid !== null && spoiled !== null ? valid + spoiled : null);
    if (electorate && poll !== null) {
      const computed = (poll / electorate) * 100;
      if (Math.abs(computed - turnout) > tol) {
        const validBasis = valid !== null ? (valid / electorate) * 100 : null;
        if (validBasis !== null && Math.abs(validBasis - turnout) <= tol) info('turnout-valid-basis', `turnout ${turnout}% is valid poll / electorate; total poll gives ${computed.toFixed(2)}%`);
        else fail('turnout', `turnout stated ${turnout}%, total poll ${poll} / electorate ${electorate} = ${computed.toFixed(2)}%`);
      }
    } else if (electorate && valid !== null) {
      const computed = (valid / electorate) * 100;
      if (computed - turnout > tol) fail('turnout', `turnout stated ${turnout}%, but the valid poll alone is ${computed.toFixed(2)}% of the electorate ${electorate}`);
    }
  }

  const votes = polled.map((k) => k.firstPrefs);
  const votesKnown = votes.every((v) => v !== null);
  const sum = polled.reduce((s, k) => s + (k.firstPrefs ?? 0), 0);
  // An STV seat inside an FPTP election (Queen's University at Stormont after 1929): a quota and
  // count stages say how it was counted.
  const system = c.votingSystem === 'fptp' && c.quota && cands.some((k) => k.stages.size > 1) ? 'stv' : c.votingSystem;

  if (system === 'ordinal') {
    if (valid === null) missing('referendum-sum', 'no valid poll');
    else if (Math.abs(sum - valid) > 0.5) fail('referendum-sum', `yes + no = ${sum}, valid poll ${valid} (${sum - valid > 0 ? '+' : ''}${sum - valid})`);
    return out;
  }
  if (system === 'party-list-dhondt') {
    if (valid === null) missing('list-sum', 'no valid poll');
    else if (Math.abs(sum - valid) > 0.5) fail('list-sum', `lists add up to ${sum}, valid poll ${valid}`);
    return out;
  }

  if (!votesKnown) missing('votes', `${votes.filter((v) => v === null).length} of ${polled.length} candidates have no votes recorded`);
  const electedN = cands.filter((k) => k.elected).length;
  const seats = c.seats;

  if (system.startsWith('stv')) {
    checkStv(c, { fail, missing, info, valid, sum, votesKnown, electedN });
    return out;
  }

  // ---- FPTP and block vote
  const vpe = c.votesPerElector && c.votesPerElector > 1 ? c.votesPerElector : (seats && seats > 1 ? seats : 1);
  if (votesKnown) {
    if (valid === null) missing('fptp-sum', 'no valid poll');
    else if (vpe === 1) {
      if (Math.abs(sum - valid) > 0.5) fail('fptp-sum', `votes add up to ${sum}, valid poll ${valid} (${sum - valid > 0 ? '+' : ''}${sum - valid})`);
    } else if (sum + 0.5 < valid || sum > valid * vpe + 0.5) {
      // A block-vote valid poll is ballots (voters); some sources print the votes cast instead.
      if (Math.abs(sum - valid) > 0.5) fail('fptp-sum', `block vote (${vpe} per elector): votes ${sum} outside valid poll ${valid} .. ${valid * vpe}`);
    }
  }
  if (seats !== null && seats > 0 && electedN !== seats) {
    const short = cands.length < seats;
    (short ? info : fail)('elected-count', `${electedN} marked elected for ${seats} seat${seats === 1 ? '' : 's'}${short ? ` (only ${cands.length} candidates)` : ''}`);
  }
  if (votesKnown && electedN > 0) {
    const winners = polled.filter((k) => k.elected);
    const losers = polled.filter((k) => !k.elected);
    const minWin = Math.min(...winners.map((k) => k.firstPrefs ?? 0));
    const maxLose = losers.length ? Math.max(...losers.map((k) => k.firstPrefs ?? 0)) : -Infinity;
    if (winners.length && maxLose > minWin) {
      const top = losers.find((k) => k.firstPrefs === maxLose);
      const low = winners.find((k) => k.firstPrefs === minWin);
      fail('fptp-winner', `${top?.name} (${maxLose}) not elected, ${low?.name} (${minWin}) elected`);
    }
    const printed = num(c.info.Majority_Printed);
    if (printed !== null && winners.length && losers.length && Number.isFinite(maxLose)) {
      const majority = minWin - maxLose;
      if (Math.abs(majority - printed) > 0.5) fail('fptp-majority', `majority printed ${printed}, votes give ${majority}`);
    }
  }
  return out;
}

/**
 * The STV rules (see the header).
 * @param {Contest} c
 * @param {{ fail: (r: string, d: string) => void, missing: (r: string, d: string) => void, info: (r: string, d: string) => void,
 *   valid: number|null, sum: number, votesKnown: boolean, electedN: number }} ctx
 */
function checkStv(c, { fail, missing, info, valid, sum, votesKnown, electedN }) {
  const cands = c.candidates;
  const seats = c.seats;
  const auto = cands.filter((k) => k.autoReturned).length;
  if (votesKnown) {
    if (valid === null) missing('stv-first-sum', 'no valid poll');
    else if (Math.abs(sum - valid) > VOTE_TOL) fail('stv-first-sum', `first preferences add up to ${sum}, valid poll ${valid} (${sum - valid > 0 ? '+' : ''}${Math.round((sum - valid) * 100) / 100})`);
  }
  if (seats !== null && seats > 0 && electedN !== seats) {
    const short = cands.length < seats;
    (short ? info : fail)('elected-count', `${electedN} marked elected for ${seats} seats${short ? ` (only ${cands.length} candidates)` : ''}`);
  }
  const quota = c.quota;
  let quotaOk = false;
  if (quota === null || quota === 0) { if (seats && seats > 1) missing('stv-quota', 'no quota recorded'); }
  else if (valid !== null && seats) {
    const ok = quotaOk = [seats, seats - auto].filter((s) => s > 0).some((s) => {
      const exact = valid / (s + 1);
      return [Math.floor(exact) + 1, Math.ceil(exact), exact + 1, Math.floor(exact * 100) / 100 + 0.01, Math.round(exact)].some((q) => Math.abs(q - quota) <= 0.011);
    });
    if (!ok) {
      const expect = Math.floor(valid / (seats - auto + 1)) + 1;
      fail('stv-quota', `quota ${quota}, floor(${valid} / ${seats - auto + 1}) + 1 = ${expect}`);
    }
  }

  // ---- the count stages
  const stageSet = new Set();
  for (const k of cands) for (const s of k.stages.keys()) stageSet.add(s);
  const stages = [...stageSet].sort((a, b) => a - b);
  if (stages.length < 2) return;
  // Some imports repeat the first count at every stage: no count detail.
  const flat = cands.every((k) => {
    const totals = [...k.stages.values()].map((r) => r.total);
    return totals.every((t) => t === totals[0]);
  });
  if (flat) { info('stv-stages', 'stages repeat the first count (no transfer detail)'); return; }
  // Only some stages printed (1, 4, 7 ...): the rows check, but not exclusions or conservation.
  const partial = stages.some((s, i) => i > 0 && s !== stages[i - 1] + 1);
  if (partial) info('stv-stages', `only stages ${stages.join(', ')} recorded`);

  const totalAt = (/** @type {Cand} */ k, /** @type {number} */ s) => k.stages.get(s)?.total ?? null;
  const lastStage = (/** @type {Cand} */ k) => Math.max(...k.stages.keys());
  // Rows carried to the end (every candidate has every stage) or stopped at election/exclusion.
  const fullRows = cands.every((k) => k.stages.size === stages.length);
  const recordsTransfers = cands.some((k) => [...k.stages.entries()].some(([s, r]) => s > stages[0] && (r.transfers ?? 0) !== 0));

  // stv-row-transfer. Some imports kept the transfers' fractions but cut the stage totals to
  // whole votes (stv-whole-totals); those totals are rebuilt from the transfers for the rules
  // below, and listed once per contest.
  if (recordsTransfers) {
    let bad = 0; let first = ''; let cut = 0;
    for (const k of cands) {
      let run = null;
      for (let i = 0; i < stages.length; i += 1) {
        const b = k.stages.get(stages[i]);
        if (!b || b.total === null) { run = null; continue; }
        if (run === null || b.transfers === null) { run = b.total; continue; }
        const expect = run + b.transfers;
        if (Math.abs(expect - b.total) <= 0.011) { run = b.total; continue; }
        if (b.total === Math.floor(expect + 1e-6) || b.total === Math.round(expect)) {
          cut += 1;
          b.total = Math.round(expect * 100) / 100;
          run = b.total;
          continue;
        }
        bad += 1;
        if (!first) first = `${k.name} stage ${stages[i]}: ${round2(run)} + ${b.transfers} != ${b.total}`;
        run = b.total;
      }
    }
    if (cut) info('stv-whole-totals', `${cut} stage total${cut === 1 ? '' : 's'} cut to whole votes (the transfers carry the fractions)`);
    if (bad) fail('stv-row-transfer', `${bad} row${bad === 1 ? '' : 's'}; first: ${first}`);
  }

  // When a candidate is elected and when excluded, from the rows.
  // Without a recorded quota (or with one the quota rule fails), the Droop quota stands in for the count rules (not the quota rule).
  const derivedQuota = valid !== null && seats ? Math.floor(valid / (seats - auto + 1)) + 1 : null;
  const q = quota && quota > 0 && (quotaOk || derivedQuota === null) ? quota : derivedQuota;
  /** @type {Map<Cand, number>} the stage whose totals each excluded candidate was excluded on */
  const exclusionBase = new Map();
  for (const k of cands) {
    if (k.elected || k.autoReturned || k.unopposed) continue;
    const rows = [...k.stages.entries()].sort((a, b) => a[0] - b[0]);
    const positive = rows.filter(([, r]) => (r.total ?? 0) > 0).map(([s]) => s);
    const markedExcluded = k.excluded || rows.some(([, r]) => /exclu|eliminat/i.test(r.status));
    const last = lastStage(k);
    if (!markedExcluded && (fullRows || last === stages.at(-1))) continue; // in the count to the end
    const base = positive.length ? Math.max(...positive) : stages[0];
    if (base >= stages.at(-1)) continue; // excluded at the end: not distributed
    exclusionBase.set(k, base);
  }
  /** @type {Map<Cand, number>} the first stage each elected candidate's total reached the quota */
  const reached = new Map();
  for (const k of cands) {
    if (!k.elected || !q) continue;
    for (const s of stages) { const t = totalAt(k, s); if (t !== null && t >= q - 0.001) { reached.set(k, s); break; } }
  }

  // stv-surplus: nobody gains after reaching the quota; a surplus transfer leaves the quota
  if (q) {
    let gains = ''; let downs = '';
    for (const [k, s0] of reached) {
      let prev = totalAt(k, s0);
      for (const s of stages.filter((x) => x > s0)) {
        const t = totalAt(k, s);
        if (t === null || prev === null) continue;
        if (t > prev + VOTE_TOL && !gains) gains = `${k.name} has ${t} at stage ${s} after reaching the quota (${prev})`;
        if (t < prev - VOTE_TOL && Math.abs(t - q) > VOTE_TOL && !downs) downs = `${k.name} goes from ${prev} to ${t} at stage ${s}, quota ${q}`;
        prev = t;
      }
    }
    if (gains) fail('stv-surplus', gains);
    if (downs) fail('stv-surplus', downs);
  }

  if (partial) return;
  // A candidate whose rows stop before the stage they were elected or excluded at: rows missing.
  const short = cands.filter((k) => k.stages.size && ((k.excludedAt !== null && lastStage(k) < k.excludedAt - 1) || (k.electedAt !== null && lastStage(k) < k.electedAt)));
  if (short.length) { missing('stv-rows', `${short.length} candidate${short.length === 1 ? '' : 's'}' rows stop early (first: ${short[0].name}, rows to stage ${lastStage(short[0])})`); return; }

  // stv-exclusion: the excluded are the lowest still in the count at their stage
  {
    let bad = '';
    const byBase = new Map();
    for (const [k, s] of exclusionBase) { if (!byBase.has(s)) byBase.set(s, []); byBase.get(s).push(k); }
    for (const [s, out] of [...byBase.entries()].sort((a, b) => a[0] - b[0])) {
      const outSet = new Set(out);
      const continuing = cands.filter((k) => {
        if (outSet.has(k) || k.autoReturned || k.unopposed) return false;
        const t = totalAt(k, s);
        if (t === null || t <= 0) return false;
        if (q && t >= q - 0.001) return false;
        if (k.elected && k.electedAt !== null && k.electedAt <= s) return false;
        const base = exclusionBase.get(k);
        return base === undefined || base > s;
      });
      if (!continuing.length) continue;
      const maxOut = Math.max(...out.map((k) => totalAt(k, s) ?? 0));
      const minIn = Math.min(...continuing.map((k) => totalAt(k, s) ?? 0));
      if (maxOut > minIn + VOTE_TOL && !bad) {
        const hi = out.find((k) => (totalAt(k, s) ?? 0) === maxOut);
        const lo = continuing.find((k) => (totalAt(k, s) ?? 0) === minIn);
        bad = `stage ${s}: ${hi?.name} (${maxOut}) excluded while ${lo?.name} (${minIn}) stayed in`;
      }
    }
    if (bad) fail('stv-exclusion', bad);
  }

  // stv-conservation
  const ntByStage = new Map(c.nonTransferable.filter((r) => r.total !== null).map((r) => [Number(r.count), /** @type {number} */ (r.total)]));
  if (fullRows) {
    // Every candidate has every stage: what they hold plus the non-transferable papers is the poll.
    let prevHeld = null; let bad = '';
    for (const s of stages) {
      const held = cands.reduce((acc, k) => acc + (totalAt(k, s) ?? 0), 0);
      if (valid !== null && ntByStage.size) {
        const nt = ntByStage.get(s) ?? [...ntByStage.entries()].filter(([x]) => x <= s).sort((a, b) => b[0] - a[0])[0]?.[1] ?? 0;
        if (Math.abs(held + nt - valid) > 1 && !bad) bad = `stage ${s}: held ${round2(held)} + non-transferable ${nt} = ${round2(held + nt)}, valid poll ${valid}`;
      } else if (valid !== null && held > valid + 1 && !bad) bad = `stage ${s}: candidates hold ${round2(held)}, more than the valid poll ${valid}`;
      else if (prevHeld !== null && held > prevHeld + 1 && !bad) bad = `stage ${s}: candidates hold ${round2(held)}, up from ${round2(prevHeld)}`;
      prevHeld = held;
    }
    if (bad) fail('stv-conservation', bad);
  } else {
    // Rows stop at election or exclusion: what a stage hands out <= what it released. A surplus
    // or an excluded candidate's votes may wait (a deferred surplus), so both go in a pool until
    // a stage hands out about that much.
    let bad = '';
    /** @type {Map<Cand, number>} */
    const pending = new Map();
    const done = new Set();
    for (let i = 1; i < stages.length; i += 1) {
      const s = stages[i]; const p = stages[i - 1];
      for (const k of cands) {
        if (pending.has(k) || done.has(k)) continue;
        const t = totalAt(k, p);
        if (t === null || lastStage(k) !== p) continue;
        if (q && k.elected && t > q + 0.001) pending.set(k, t - q);
        else if (exclusionBase.get(k) === p) pending.set(k, t);
      }
      let received = 0; let released = 0;
      for (const k of cands) {
        const a = totalAt(k, p); const b = totalAt(k, s);
        if (a !== null && b !== null && b > a) received += b - a;
        if (a !== null && b !== null && b < a) released += a - b;
      }
      let allowance = released;
      for (const v of pending.values()) allowance += v;
      if (received > allowance + 1 && !bad) bad = `stage ${s}: candidates gain ${round2(received)}, only ${round2(allowance)} released (exclusions and surpluses)`;
      // What this stage handed out leaves the pool. The candidates excluded together at one stage
      // are one unit, each surplus another: the smallest unit that covers it, else the largest
      // units until it is covered.
      let need = received - released;
      if (need > 1) {
        /** @type {Map<string, Array<[Cand, number]>>} */
        const units = new Map();
        for (const [k, v] of pending) {
          const id = exclusionBase.has(k) && !k.elected ? `x${exclusionBase.get(k)}` : `s${k.ord}:${k.name}`;
          if (!units.has(id)) units.set(id, []);
          /** @type {Array<[Cand, number]>} */ (units.get(id)).push([k, v]);
        }
        const sized = [...units.values()].map((members) => ({ members, size: members.reduce((a, [, v]) => a + v, 0) }));
        const cover = sized.filter((u) => u.size >= need - 1).sort((a, b) => a.size - b.size)[0];
        const chosen = cover ? [cover] : sized.sort((a, b) => b.size - a.size);
        const take = [];
        for (const u of chosen) { if (need <= 1) break; need -= u.size; take.push(...u.members); }
        need = 0;
        for (const [k] of take) { pending.delete(k); done.add(k); }
      }
    }
    if (bad) fail('stv-conservation', bad);
  }
}

const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * Every contest in a records database, with its candidates and their count stages.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Contest[]}
 */
export function loadContests(db) {
  /** @type {Map<string, Contest>} */
  const contests = new Map();
  const elections = new Map(db.prepare('SELECT key, body_slug, date, voting_system, contest_status, meta FROM r_elections').all()
    .map((r) => [r.key, r]));
  for (const row of db.prepare('SELECT election_key, seq, name, source_file, seats_total, electorate, quota, meta FROM contests').iterate()) {
    const e = elections.get(row.election_key);
    if (!e) continue;
    const meta = JSON.parse(String(row.meta));
    const infoRaw = meta.countInfo || {};
    const key = `${row.election_key}#${row.seq}`;
    contests.set(key, {
      electionKey: String(row.election_key),
      seq: Number(row.seq),
      name: String(row.name),
      sourceFile: String(row.source_file || meta.sourceFile || ''),
      bodySlug: String(e.body_slug),
      group: bodyGroup(String(e.body_slug), String(e.date)),
      date: String(e.date),
      votingSystem: String(meta.votingSystem || e.voting_system || ''),
      contestStatus: String(meta.contestStatus || e.contest_status || ''),
      seats: num(row.seats_total) ?? num(infoRaw.Number_Of_Seats),
      electorate: num(infoRaw.Total_Electorate) ?? num(row.electorate),
      quota: num(infoRaw.Quota) ?? num(row.quota),
      validPoll: num(infoRaw.Valid_Poll) ?? num(meta.validPoll),
      totalPoll: num(infoRaw.Total_Poll) ?? num(meta.totalPoll),
      spoiled: num(infoRaw.Spoiled) ?? num(meta.spoiled),
      votesPerElector: num(meta.votesPerElector),
      info: infoRaw,
      nonTransferable: Array.isArray(meta.nonTransferable) ? meta.nonTransferable.map((/** @type {any} */ r) => ({ count: Number(r.count), total: num(r.total), transfers: num(r.transfers) })) : [],
      candidates: [],
    });
  }
  /** @type {Map<string, Cand>} */
  const byOrd = new Map();
  for (const row of db.prepare('SELECT election_key, contest_seq, ord, name, first_prefs, final_votes, elected, elected_at, excluded, excluded_at, status, unopposed FROM candidacies').iterate()) {
    const c = contests.get(`${row.election_key}#${row.contest_seq}`);
    if (!c) continue;
    const status = String(row.status || '');
    /** @type {Cand} */
    const cand = {
      ord: Number(row.ord),
      name: String(row.name || ''),
      firstPrefs: num(row.first_prefs),
      finalVotes: num(row.final_votes),
      elected: Number(row.elected) === 1,
      electedAt: num(row.elected_at),
      excluded: Number(row.excluded) === 1,
      excludedAt: num(row.excluded_at),
      status,
      unopposed: Number(row.unopposed) === 1 || isUnopposedStatus(status),
      autoReturned: isAutoReturned(status),
      stages: new Map(),
    };
    c.candidates.push(cand);
    byOrd.set(`${row.election_key}#${row.contest_seq}#${row.ord}`, cand);
  }
  for (const row of db.prepare('SELECT election_key, contest_seq, candidacy_ord, count_number, total_votes, transfers, status FROM r_counts').iterate()) {
    const cand = byOrd.get(`${row.election_key}#${row.contest_seq}#${row.candidacy_ord}`);
    if (!cand || row.count_number === null) continue;
    cand.stages.set(Number(row.count_number), { total: num(row.total_votes), transfers: num(row.transfers), status: String(row.status || '') });
  }
  return [...contests.values()];
}

/**
 * The allowlist entries, keyed `${sourceFile}|${rule}` (sourceFile "*" with electionKey for a
 * whole election).
 */
export function loadAllowlist(file = ALLOWLIST) {
  if (!existsSync(file)) return { entries: [], has: () => false };
  const entries = JSON.parse(readFileSync(file, 'utf8')).entries || [];
  const keys = new Set(entries.map((/** @type {any} */ e) => `${e.sourceFile === '*' ? `*${e.electionKey}` : e.sourceFile}|${e.rule}`));
  return {
    entries,
    has: (/** @type {Contest} */ c, /** @type {string} */ rule) => keys.has(`${c.sourceFile}|${rule}`) || keys.has(`*${c.electionKey}|${rule}`),
  };
}

/**
 * The audit over a database: every finding, tagged allowlisted or not.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function auditContests(db, { allowlist = loadAllowlist(), body = /** @type {string|null} */ (null) } = {}) {
  const rows = [];
  let contestsChecked = 0;
  /** @type {Record<string, number>} */
  const contestsByGroup = {};
  for (const c of loadContests(db)) {
    if (body && c.group !== body) continue;
    contestsChecked += 1;
    contestsByGroup[c.group] = (contestsByGroup[c.group] || 0) + 1;
    for (const f of checkContest(c)) {
      const allowed = f.kind === 'fail' && allowlist.has(c, f.rule);
      rows.push({ group: c.group, electionKey: c.electionKey, date: c.date, contest: c.name, sourceFile: c.sourceFile, rule: f.rule, kind: allowed ? 'allowlisted' : f.kind, detail: f.detail });
    }
  }
  return { contestsChecked, contestsByGroup, rows };
}

/** @param {Array<Record<string, unknown>>} rows */
const toCsv = (rows) => {
  const cols = ['group', 'electionKey', 'date', 'contest', 'sourceFile', 'rule', 'kind', 'detail'];
  const esc = (/** @type {unknown} */ v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `${cols.join(',')}\n${rows.map((r) => cols.map((k) => esc(r[k])).join(',')).join('\n')}\n`;
};

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  let db;
  if (args.includes('--from-bundles')) {
    // Fast loop while fixing: the election bundles the manifest build wrote
    // (CIVGRAPH_BUILD_DIR=tmp/records node scripts/build/build-test2-election-manifest.mjs),
    // ingested into an in-memory database exactly as the records build does.
    const { recordPaths } = await import('../../../packages/config/src/node.mjs');
    const { createDatabase } = await import('../../../packages/loader/src/db.mjs');
    const { ingestElections } = await import('../../../packages/loader/src/ingest-elections.mjs');
    const P = recordPaths({ ...process.env, CIVGRAPH_BUILD_DIR: process.env.CIVGRAPH_BUILD_DIR || 'tmp/records' });
    if (!existsSync(P.ELECTION_MANIFEST)) {
      console.log(`SKIP contest-arithmetic: no election manifest at ${path.relative(ROOT, P.ELECTION_MANIFEST)}`);
      return 0;
    }
    db = createDatabase(':memory:');
    ingestElections(db, { bundleDir: P.ELECTION_BUNDLE_DIR, manifestFile: P.ELECTION_MANIFEST, summaryDir: P.ELECTION_SUMMARY_DIR });
  } else {
    const dbPath = path.resolve(ROOT, opt('--db') || process.env.CIVGRAPH_RECORDS_DB || 'tmp/records/civgraph-records.sqlite');
    if (!existsSync(dbPath)) {
      console.log(`SKIP contest-arithmetic: no records database at ${path.relative(ROOT, dbPath)} (run npm run records:build, or pass --db)`);
      return 0;
    }
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
  }
  const { contestsChecked, contestsByGroup, rows } = auditContests(db, { body: opt('--body') });
  db.close();
  /** @type {Record<string, Record<string, number>>} */
  const table = {};
  for (const r of rows) {
    if (r.kind !== 'fail') continue;
    (table[r.group] ||= {})[r.rule] = ((table[r.group] || {})[r.rule] || 0) + 1;
  }
  const failing = rows.filter((r) => r.kind === 'fail');
  const counts = (/** @type {string} */ kind) => rows.filter((r) => r.kind === kind).length;
  console.log(`contest-arithmetic: ${contestsChecked} contests; ${failing.length} failures, ${counts('allowlisted')} allowlisted, ${counts('missing')} missing data, ${counts('info')} notes`);
  for (const [group, rules] of Object.entries(table).sort()) {
    const contestsFailing = new Set(failing.filter((r) => r.group === group).map((r) => `${r.electionKey}|${r.contest}`)).size;
    console.log(`  ${group} (${contestsByGroup[group]} contests, ${contestsFailing} failing): ${Object.entries(rules).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  const jsonOut = opt('--json');
  if (jsonOut) {
    mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    writeFileSync(path.resolve(jsonOut), `${JSON.stringify({ contestsChecked, contestsByGroup, table, rows }, null, 1)}\n`);
  }
  const csvOut = opt('--csv');
  if (csvOut) {
    mkdirSync(path.dirname(path.resolve(csvOut)), { recursive: true });
    writeFileSync(path.resolve(csvOut), toCsv(rows));
  }
  return args.includes('--fail') && failing.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
