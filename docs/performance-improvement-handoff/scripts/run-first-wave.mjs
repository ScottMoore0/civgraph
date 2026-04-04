#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const handoffRoot = path.resolve(currentDir, '..');
const reportsDir = path.join(handoffRoot, 'reports');

const jobs = [
  {
    script: path.join(currentDir, 'report-bundle-sizes.mjs'),
    output: path.join(reportsDir, 'bundle-size-report.txt')
  },
  {
    script: path.join(currentDir, 'report-startup-imports.mjs'),
    output: path.join(reportsDir, 'startup-import-report.txt')
  },
  {
    script: path.join(currentDir, 'report-first-load-assets.mjs'),
    output: path.join(reportsDir, 'first-load-asset-report.txt')
  },
  {
    script: path.join(currentDir, 'report-font-usage.mjs'),
    output: path.join(reportsDir, 'font-usage-report.txt')
  },
  {
    script: path.join(currentDir, 'report-map-performance-metadata.mjs'),
    output: path.join(reportsDir, 'map-performance-metadata-report.txt')
  },
  {
    script: path.join(currentDir, 'report-dependency-usage.mjs'),
    output: path.join(reportsDir, 'dependency-usage-report.txt')
  }
];

fs.mkdirSync(reportsDir, { recursive: true });

console.log('# Run First Wave');
console.log(`Reports directory: ${reportsDir}`);

for (const job of jobs) {
  const result = spawnSync(process.execPath, [job.script], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Failed: ${job.script}\n`);
    process.exit(result.status ?? 1);
  }
  fs.writeFileSync(job.output, result.stdout, 'utf8');
  console.log(`wrote ${path.relative(handoffRoot, job.output).replace(/\\/g, '/')}`);
}

console.log('first-wave text reports refreshed');

