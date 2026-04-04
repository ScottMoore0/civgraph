#!/usr/bin/env node

/**
 * Copy this file and replace the placeholder sections for a narrow, deterministic benchmark.
 *
 * Rules:
 * - benchmark one concern only
 * - use fixed sample inputs
 * - avoid network and browser automation
 * - print concise, pasteable output
 */

import { performance } from 'perf_hooks';

function buildSampleInput() {
  return {
    placeholder: true
  };
}

function targetOperation(sample) {
  return sample;
}

function run(iterations = 100) {
  const sample = buildSampleInput();
  const durations = [];

  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    targetOperation(sample);
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const mean = total / durations.length;
  const median = durations[Math.floor(durations.length / 2)];
  const min = durations[0];
  const max = durations[durations.length - 1];

  console.log('# Benchmark Report');
  console.log(`iterations: ${iterations}`);
  console.log(`mean_ms: ${mean.toFixed(4)}`);
  console.log(`median_ms: ${median.toFixed(4)}`);
  console.log(`min_ms: ${min.toFixed(4)}`);
  console.log(`max_ms: ${max.toFixed(4)}`);
}

run();

