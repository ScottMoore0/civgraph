const assert = require('node:assert');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const stagesPath = path.join(projectRoot, 'electionsni-master', 'website', 'js', 'stages2.js');

const { computeRecipientSliceGeometry } = require(stagesPath);

function nearlyEqual(a, b, tolerance = 1e-9) {
  return Math.abs(a - b) <= tolerance;
}

// Scenario where the workbook's final tally is smaller than the inferred transfer sum.
{
  const scale = 0.5;
  const previousVotes = 100;
  const transferVotes = 12;
  const finalVotes = 107;
  const geometry = computeRecipientSliceGeometry(previousVotes, transferVotes, finalVotes, scale);

  assert.strictEqual(geometry.sliceWidth, transferVotes * scale, 'slice width should scale with transfers');
  assert.strictEqual(
    geometry.targetBarWidth,
    Math.max(finalVotes * scale, (previousVotes + transferVotes) * scale),
    'bar width should cover both data and animated slice'
  );
  assert(
    nearlyEqual(geometry.sliceLeft, previousVotes * scale),
    'slice should kiss the original bar edge when totals under-report transfers'
  );
}

// Scenario where the workbook final tally exceeds the explicit transfer amount (rounding leakage).
{
  const scale = 2;
  const previousVotes = 80;
  const transferVotes = 5;
  const finalVotes = 90;
  const geometry = computeRecipientSliceGeometry(previousVotes, transferVotes, finalVotes, scale);

  assert.strictEqual(geometry.sliceWidth, transferVotes * scale, 'slice width should scale with transfers');
  assert.strictEqual(geometry.targetBarWidth, finalVotes * scale, 'bar width should respect the reported final total');
  assert(
    nearlyEqual(geometry.sliceLeft + geometry.sliceWidth, geometry.targetBarWidth),
    'slice should land flush with the expanded bar edge when totals exceed transfers'
  );
}

// Degenerate case with zero scale to ensure stability.
{
  const geometry = computeRecipientSliceGeometry(50, 10, 55, 0);
  assert.strictEqual(geometry.sliceWidth, 0);
  assert.strictEqual(geometry.targetBarWidth, 0);
  assert.strictEqual(geometry.sliceLeft, 0);
}
