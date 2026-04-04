#!/usr/bin/env node

/**
 * Copy this file and replace the placeholder validation logic for one artifact or config shape.
 *
 * Rules:
 * - validate one artifact type only
 * - fail loudly on missing/invalid required fields
 * - print concise, pasteable output
 */

import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('usage: node validator-template.mjs <path-to-artifact>');
  process.exit(1);
}

const fullPath = path.resolve(process.cwd(), inputPath);

if (!fs.existsSync(fullPath)) {
  console.error(`missing: ${inputPath}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
} catch (err) {
  console.error(`invalid json: ${inputPath}`);
  process.exit(1);
}

const errors = [];

if (parsed == null || typeof parsed !== 'object') {
  errors.push('root must be an object or array');
}

if (errors.length > 0) {
  console.error('# Validation Report');
  console.error(`artifact: ${inputPath}`);
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log('# Validation Report');
console.log(`artifact: ${inputPath}`);
console.log('status: ok');

