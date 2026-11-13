// Contributions: an approved submission from the site's contribution queue as an intake batch
// (refactor plan IP-4). `intake from-contribution <id> <batch-dir>` writes the submission into
// the batch (contribution/submission.json, without the contributor's identity) and runs this
// plugin, which plans the catalogue edits (packages/intake/src/contribution.mjs). A map
// submission stays work by hand. Nothing here reads the queue, R2 or D1.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planContribution } from '../../../packages/intake/src/contribution.mjs';
import { definePlugin } from '../../../packages/intake/src/plugins.mjs';

const CATALOGUE = 'data/database/maps.json';

export default definePlugin({
  id: 'contribution',
  title: 'A contribution from the site',
  kinds: ['contribution'],
  personalData: { contains: false, handling: 'none', note: "The batch keeps the submission without the contributor's identity (submittedBy) or browser (userAgent)." },
  sources: [
    { id: 'civgraph-contribution', title: 'A contribution submitted on civgraph.net and approved in the review queue', rights: 'owner-permission', note: 'The owner approved the submission in the queue; the citations it carries are in contribution/submission.json.' },
  ],
  inputs: {
    submission: { description: 'the submission JSON (written by intake from-contribution)' },
  },
  produce(ctx) {
    const file = ctx.inputs.submission;
    if (!file) throw new Error('contribution: give --input submission=<file> (intake from-contribution does)');
    const submission = JSON.parse(readFileSync(file, 'utf8'));
    const catalogue = JSON.parse(readFileSync(path.join(ctx.repo, CATALOGUE), 'utf8'));
    const plan = planContribution(submission, catalogue);
    if ('error' in plan) throw new Error(`contribution ${submission.id}: ${plan.error}`);
    const notes = [
      `Submission ${submission.id} (${submission.kind}${submission.entityId ? ` of ${submission.entityId}` : ''}): ${submission.title || '(no title)'}.`,
      ...plan.changes.map((c) => `${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`),
      `After the batch is merged, close the queue entry: node scripts/intake/contributions.mjs --mark-applied ${submission.id}`,
    ];
    mkdirSync(path.join(ctx.batchDir, 'contribution'), { recursive: true });
    writeFileSync(path.join(ctx.batchDir, 'contribution', 'edits.json'), `${JSON.stringify(plan.edits, null, 2)}\n`);
    return {
      notes,
      operations: [{
        id: 'contribution-edits',
        type: 'maps-json-patch',
        note: `The catalogue edits of submission ${submission.id}, as contributions.mjs --apply makes them.`,
        sources: ['civgraph-contribution'],
        target: CATALOGUE,
        edits: 'contribution/edits.json',
      }],
    };
  },
});
