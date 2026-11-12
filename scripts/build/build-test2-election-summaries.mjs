#!/usr/bin/env node
/**
 * Build compact sidecars for /test2 election entries. Full election bundles
 * remain lazy-loaded, but these summaries give the route quick metadata for
 * catalogue/diagnostic work without parsing every result bundle at startup.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { writeStableGeneratedJson } from '../lib/stable-generated-json.mjs';
import { ELECTION_MANIFEST, ELECTION_SUMMARY_DIR } from '../../packages/loader/src/paths.mjs';
import { localPathForUrl } from '../../packages/loader/src/paths.mjs';

const ROOT = process.cwd();
const MANIFEST_PATH = ELECTION_MANIFEST;
const SUMMARY_DIR = ELECTION_SUMMARY_DIR;

/**
 * @typedef {{ status?: unknown, elected?: unknown, party?: unknown }} Candidate
 * @typedef {{ candidates?: Candidate[], animationPayload?: unknown, [field: string]: unknown }} ElectionResult
 * @typedef {{ results?: unknown, [field: string]: unknown }} ResultBundle
 * @typedef {{ key?: string, resultUrl?: string, [field: string]: unknown }} ManifestEntry
 */

function readJson(/** @type {string} */ file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJsonIfChanged(file, value) {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  writeStableGeneratedJson(file, value);
  const after = existsSync(file) ? readFileSync(file, 'utf8') : null;
  return before !== after;
}


function safeFileName(/** @type {unknown} */ key) {
  return String(key || 'election').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function numberOrNull(/** @type {unknown} */ value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function electedCount(/** @type {ElectionResult} */ result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  return candidates.filter((/** @type {Candidate} */ candidate) => {
    const status = String(candidate.status || '').toLowerCase();
    return candidate.elected === true || status.includes('elected');
  }).length;
}

function partyCount(/** @type {ElectionResult} */ result) {
  /** @type {Set<string>} */
  const parties = new Set();
  for (const candidate of result?.candidates || []) {
    if (candidate?.party) parties.add(String(candidate.party));
  }
  return parties.size;
}

function summarizeResult(/** @type {ElectionResult} */ result) {
  return {
    constituency: result.constituency || result.matchName || result.featureName || '',
    matchName: result.matchName || null,
    featureName: result.featureName || null,
    localCouncil: result.localCouncil || null,
    district: result.district || null,
    seatsTotal: numberOrNull(result.seatsTotal),
    seatsWon: numberOrNull(result.seatsWon),
    validPoll: numberOrNull(result.validPoll),
    quota: numberOrNull(result.quota),
    winnerParty: result.winnerParty || null,
    winnerName: result.winnerName || null,
    leadingParty: result.leadingParty || null,
    leadingName: result.leadingName || null,
    leadingVotes: numberOrNull(result.leadingVotes),
    leadingPct: numberOrNull(result.leadingPct),
    turnoutPct: numberOrNull(result.turnoutPct),
    majority: numberOrNull(result.majority),
    candidateCount: Array.isArray(result.candidates) ? result.candidates.length : 0,
    electedCount: electedCount(result),
    partyCount: partyCount(result),
    hasAnimation: Boolean(result.animationPayload)
  };
}

/**
 * @param {ManifestEntry} entry
 * @param {ResultBundle} bundle
 */
function summarizeBundle(entry, bundle) {
  const results = Array.isArray(bundle?.results) ? bundle.results : [];
  return {
    key: entry.key,
    body: entry.body,
    date: entry.date,
    displayTitle: entry.displayTitle || bundle.displayTitle || entry.body,
    displaySubtitle: entry.displaySubtitle || '',
    displayProvider: entry.displayProvider || entry.body,
    sourceMapId: entry.sourceMapId || bundle.sourceMapId || null,
    layerId: entry.layerId || bundle.layerId || null,
    resultCount: results.length,
    matchedCount: numberOrNull(entry.matchedCount),
    unmatchedCount: numberOrNull(entry.unmatchedCount),
    totalConstituencies: numberOrNull(entry.totalConstituencies),
    hasAnyAnimation: results.some((/** @type {ElectionResult | null} */ result) => result?.animationPayload),
    results: results.map(summarizeResult)
  };
}

function build() {
  const manifest = readJson(MANIFEST_PATH);
  rmSync(SUMMARY_DIR, { recursive: true, force: true });
  mkdirSync(SUMMARY_DIR, { recursive: true });
  let written = 0;

  const elections = (manifest.elections || []).map((/** @type {ManifestEntry} */ entry) => {
    if (!entry.resultUrl) return entry;
    const source = localPathForUrl(entry.resultUrl);
    if (!source || !existsSync(source)) return entry;
    const bundle = readJson(source);
    const fileName = `${safeFileName(entry.key)}.json`;
    const summaryUrl = `/render/metadata/elections-test2-summaries/${fileName}`;
    writeJsonIfChanged(path.join(SUMMARY_DIR, fileName), summarizeBundle(entry, bundle));
    written += 1;
    return { ...entry, summaryUrl };
  });

  writeJsonIfChanged(MANIFEST_PATH, {
    ...manifest,
    elections
  });
  console.log(`Test2 election summaries: ${written} files`);
}

build();
