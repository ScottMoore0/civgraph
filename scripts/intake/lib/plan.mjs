/**
 * `plan` and `report`: what a batch will change in the repository and on R2, worked out from
 * batch.json and the current tree, and REPORT.md generated from the same facts -- the upload
 * list and handoff that each batch used to write by hand (UPLOAD.txt, post-upload.txt).
 */
import { existsSync, statSync } from 'node:fs';
import { batchPath, phaseOf, pmtilesKey, repoPath, resolveFgbPairs, resolveIds, resolveTreeEntries } from './batch.mjs';
import { buildPostUploadSteps, buildUploadSteps, formatStep } from './commands.mjs';
import { stageBatch } from './stage.mjs';

/** @typedef {import('./batch.mjs').Batch} Batch */
/** @typedef {import('./batch.mjs').Manifest} Manifest */
/** @typedef {import('./batch.mjs').Operation} Operation */
/** @typedef {import('./stage.mjs').StageResult} StageResult */
/** @typedef {ReturnType<typeof planBatch>} Plan */
/** @typedef {{ command: string, expect: string, note?: string, details?: string[] }} ExpectedCheck */

/** @param {string | undefined} file */
function sizeOf(file) {
  return file && existsSync(file) ? statSync(file).size : null;
}

/** @param {Batch} batch */
export function planBatch(batch) {
  const m = batch.manifest;
  /** @type {Map<string, string>} */
  const copiedFrom = new Map();
  for (const op of m.operations) {
    if (op.type === 'copy-files') for (const f of op.files) copiedFrom.set(f.to, batchPath(batch, f.from));
  }
  /** @param {string} repoRel */
  const localSize = (repoRel) => sizeOf(repoPath(batch, repoRel)) ?? sizeOf(copiedFrom.get(repoRel));

  /** @type {{ op: string, kind: string, key: string, file: string, bytes: number | null }[]} */
  const objects = [];
  /** @type {{ op: string, prefix: string, ext: string }[]} */
  const cacheControl = [];
  /** @type {{ op: string, layerId: string, key: string, file: string, bytes: number | null }[]} */
  const pmtiles = [];
  for (const op of m.operations) {
    if (op.type === 'r2-fgb') {
      for (const p of resolveFgbPairs(batch, op)) objects.push({ op: op.id, kind: 'fgb', key: p.key, file: p.file, bytes: localSize(p.file) });
    } else if (op.type === 'r2-tree') {
      for (const e of resolveTreeEntries(batch, op)) {
        objects.push({ op: op.id, kind: 'file', key: op.prefix + e.rel, file: e.repoRel || e.local, bytes: e.repoRel ? localSize(e.repoRel) : sizeOf(e.local) });
      }
      if (op.dir && !existsSync(repoPath(batch, op.dir))) objects.push({ op: op.id, kind: 'tree', key: `${op.prefix}**`, file: `${op.dir}/**`, bytes: null });
    } else if (op.type === 'r2-cache-control') {
      for (const prefix of op.prefixes) cacheControl.push({ op: op.id, prefix, ext: op.ext || 'fgb,gz,br' });
    } else if (op.type === 'r2-pmtiles') {
      for (const id of resolveIds(batch, op)) {
        const file = `render/pmtiles/generated/${id}.pmtiles`;
        pmtiles.push({ op: op.id, layerId: id, key: pmtilesKey(id), file, bytes: localSize(file) });
      }
    }
  }

  return {
    batch: { id: m.id, title: m.title, date: m.date, status: m.status, summary: m.summary || '' },
    repo: batch.repo,
    stage: stageBatch(batch, { write: false }),
    r2: { objects, cacheControl, pmtiles },
    upload: {
      dryRun: buildUploadSteps(batch, { dryRun: true, writeManifests: false }),
      real: buildUploadSteps(batch, { dryRun: false, writeManifests: false }),
    },
    postUpload: buildPostUploadSteps(batch),
    /** @type {Record<string, ExpectedCheck[] | undefined>} */
    expectedChecks: m.expectedChecks || {},
    /** @type {string[]} */
    phases: [...new Set(m.operations.map(phaseOf))],
  };
}

/** @param {number | null | undefined} n */
export function formatBytes(n) {
  if (n == null) return '(not built yet)';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

/** @param {StageResult} stage */
function summariseStage(stage) {
  /** @type {Map<string, number>} */
  const byOp = new Map();
  for (const c of stage.changes) {
    const key = `${c.op}\u0000${c.action}\u0000${c.action === 'edit' ? c.path : ''}`;
    byOp.set(key, (byOp.get(key) || 0) + 1);
  }
  return byOp;
}

/**
 * Plain-text plan for the terminal.
 * @param {Plan} plan
 * @param {{ verbose?: boolean }} [options]
 */
export function formatPlan(plan, { verbose = false } = {}) {
  /** @type {string[]} */
  const lines = [];
  const { stage, r2 } = plan;
  lines.push(`Batch ${plan.batch.id} (${plan.batch.date}, ${plan.batch.status}): ${plan.batch.title}`);
  lines.push(`Repository: ${plan.repo}`);
  lines.push('');
  lines.push(`1. Repository (stage): ${stage.changes.length} change(s), ${stage.unchanged} already in place, ${stage.conflicts.length} conflict(s)`);
  for (const c of stage.changes) {
    if (!verbose && stage.changes.length > 40 && c.action !== 'edit') continue;
    lines.push(c.action === 'edit' ? `     ${c.path}: ${c.detail}` : `     ${c.action.padEnd(7)} ${c.path}  ${formatBytes(c.bytes)}`);
  }
  if (!verbose && stage.changes.length > 40) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const c of stage.changes) if (c.action !== 'edit') counts[c.action] = (counts[c.action] || 0) + 1;
    for (const [a, n] of Object.entries(counts)) lines.push(`     ${a}: ${n} file(s) (--verbose lists them)`);
  }
  for (const c of stage.conflicts) lines.push(`     CONFLICT ${c.path}: ${c.reason}`);
  for (const e of stage.errors) lines.push(`     ERROR ${e}`);
  for (const w of stage.warnings) lines.push(`     warning: ${w}`);
  for (const n of stage.notes) lines.push(`     note: ${n}`);
  lines.push('');
  lines.push(`2. R2 (data.civgraph.net): ${r2.objects.length} file(s), ${r2.pmtiles.length} PMTiles archive(s), Cache-Control on ${r2.cacheControl.length} prefix(es)`);
  for (const o of r2.objects) lines.push(`     ${o.key}  ${formatBytes(o.bytes)}`);
  for (const p of r2.pmtiles) lines.push(`     ${p.key}  ${formatBytes(p.bytes)}`);
  for (const c of r2.cacheControl) lines.push(`     Cache-Control: ${c.prefix} (${c.ext})`);
  lines.push('');
  lines.push(`3. Upload commands (run from the repository root; intake upload runs them):`);
  for (const s of plan.upload.real) lines.push(`     ${formatStep(s)}`);
  lines.push(`   Dry run (intake upload --dry-run) differs: ${plan.upload.dryRun.filter((s) => !s.realOnly).length} step(s) in their dry form; ${plan.upload.dryRun.filter((s) => s.realOnly).length} real-only step(s) skipped.`);
  lines.push('');
  lines.push(`4. Post-upload (intake post-upload):`);
  for (const s of plan.postUpload) lines.push(`     ${formatStep(s)}`);
  if (!plan.postUpload.length) lines.push('     none');
  return lines.join('\n');
}

/** @param {string} title @param {ExpectedCheck[] | undefined} checks */
function checksSection(title, checks) {
  if (!checks?.length) return [];
  const out = [`### ${title}`, ''];
  for (const c of checks) {
    out.push(`- \`${c.command}\`: expected to **${c.expect}**${c.note ? `. ${c.note}` : ''}`);
    for (const d of c.details || []) out.push(`  - ${d}`);
  }
  out.push('');
  return out;
}

/**
 * REPORT.md: the upload list and handoff, generated.
 * @param {Plan} plan
 * @param {Manifest} manifest
 * @param {{ generatedAt?: string, manifestLabel?: string, repoLabel?: string }} [options]
 */
export function renderReport(plan, manifest, { generatedAt = new Date().toISOString().slice(0, 10), manifestLabel = 'batch.json', repoLabel } = {}) {
  /** @type {string[]} */
  const out = [];
  const b = plan.batch;
  out.push(`# ${b.title}`, '');
  out.push(`> **Status: point-in-time, generated ${generatedAt}.** Batch status: ${b.status}.`, '');
  out.push(`Batch \`${b.id}\`, ${b.date}. Generated from \`${manifestLabel}\` on ${generatedAt} by \`node scripts/intake/intake.mjs report\`; edit the manifest, not this file.`, '');
  if (b.summary) out.push(b.summary, '');
  out.push('Nothing in this batch is pushed, uploaded or published without the owner\'s approval in chat. Commit locally, then stop and ask.', '');

  if (manifest.sources?.length) {
    out.push('## Sources', '');
    for (const s of manifest.sources) {
      const bits = [s.title, s.publisher, s.licence && `licence: ${s.licence}`].filter(Boolean).join('; ');
      out.push(`- **${s.id}**: ${bits}${s.url ? ` <${s.url}>` : ''}${s.citation ? `. Cite as: ${s.citation}` : ''}${s.note ? `. ${s.note}` : ''}`);
    }
    out.push('');
  }

  out.push('## 1. Repository changes (`intake stage`)', '');
  out.push(`Dry run first (\`node scripts/intake/intake.mjs stage <batch>\`), then \`--write\`. Idempotent: a second run reports no changes.`, '');
  const s = plan.stage;
  if (!plan.phases.includes('stage')) out.push('This batch has no repository operations.', '');
  else out.push(`${s.changes.length} change(s) against ${repoLabel || `the tree at ${plan.repo}`}; ${s.unchanged} already in place; ${s.conflicts.length} conflict(s).`, '');
  const grouped = summariseStage(s);
  for (const [key, n] of grouped) {
    const [op, action, p] = key.split('\u0000');
    const opDef = manifest.operations.find((/** @type {Operation} */ o) => o.id === op);
    out.push(`- \`${op}\` (${opDef?.type}): ${action}${p ? ` in \`${p}\`` : ''}, ${n}${opDef?.note ? `. ${opDef.note}` : ''}`);
  }
  for (const c of s.conflicts) out.push(`- CONFLICT \`${c.path}\`: ${c.reason}`);
  const edits = s.changes.filter((c) => c.action === 'edit');
  if (edits.length && edits.length <= 40) {
    out.push('', 'Edits:', '');
    for (const c of edits) out.push(`- \`${c.path}\`: ${c.detail}`);
  }
  out.push('');

  out.push('## 2. R2 uploads (`intake upload`)', '');
  out.push('Run `node scripts/intake/intake.mjs upload <batch> --dry-run` first. Credentials come from `.env.local` through `node --env-file=.env.local`; listings are limited to each sub-prefix, never the whole `data/maps/`.', '');
  if (plan.r2.objects.length) {
    out.push('| R2 key | size |', '|---|---|');
    for (const o of plan.r2.objects) out.push(`| \`${o.key}\` | ${formatBytes(o.bytes)} |`);
    out.push('');
  }
  if (plan.r2.pmtiles.length) {
    out.push('| PMTiles key | size |', '|---|---|');
    for (const p of plan.r2.pmtiles) out.push(`| \`${p.key}\` | ${formatBytes(p.bytes)} |`);
    out.push('');
  }
  for (const c of plan.r2.cacheControl) out.push(`- Cache-Control on \`${c.prefix}\` (${c.ext})`);
  if (plan.r2.cacheControl.length) out.push('');
  out.push('Commands, in order:', '', '```');
  for (const st of plan.upload.real) out.push(formatStep(st));
  out.push('```', '');

  out.push('## 3. After the upload (`intake post-upload`)', '');
  if (plan.postUpload.length) {
    out.push('```');
    for (const st of plan.postUpload) out.push(formatStep(st));
    out.push('```', '');
  } else out.push('Nothing.', '');
  for (const op of manifest.operations.filter((/** @type {Operation} */ o) => o.type === 'command' || o.type === 'switch-to-cdn' || o.type === 'thumbnails')) {
    if (op.note) out.push(`- \`${op.id}\`: ${op.note}`);
  }
  out.push('');

  const ec = plan.expectedChecks;
  if (ec.beforeUpload?.length || ec.afterPostUpload?.length) {
    out.push('## 4. Expected check results', '');
    out.push(...checksSection('Before the upload', ec.beforeUpload));
    out.push(...checksSection('After the post-upload steps', ec.afterPostUpload));
  }
  if (manifest.notes?.length) {
    out.push('## Notes', '');
    for (const n of manifest.notes) out.push(`- ${n}`);
    out.push('');
  }
  out.push('## Publishing', '', 'Only after the owner approves in chat: `bash .claude/publish/publish.sh`. The intake tool never runs it.', '');
  return out.join('\n');
}
