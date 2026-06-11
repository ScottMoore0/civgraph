import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathParts(pathExpression) {
  return String(pathExpression).split('.').filter(Boolean);
}

function getPath(value, pathExpression) {
  let current = value;
  for (const part of pathParts(pathExpression)) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPath(value, pathExpression, nextValue) {
  const parts = pathParts(pathExpression);
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  if (parts.length) current[parts.at(-1)] = nextValue;
}

function deletePath(value, pathExpression) {
  const parts = pathParts(pathExpression);
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object') return;
    current = current[part];
  }
  if (current && typeof current === 'object' && parts.length) delete current[parts.at(-1)];
}

function normalizeForComparison(value, volatilePaths) {
  const copy = cloneJson(value);
  for (const volatilePath of volatilePaths) deletePath(copy, volatilePath);
  return copy;
}

function readExistingJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function preserveVolatileFields(file, data, volatilePaths = ['generatedAt']) {
  const existing = readExistingJson(file);
  if (!existing) return data;

  const normalizedExisting = normalizeForComparison(existing, volatilePaths);
  const normalizedNext = normalizeForComparison(data, volatilePaths);
  if (JSON.stringify(normalizedExisting) !== JSON.stringify(normalizedNext)) return data;

  const preserved = cloneJson(data);
  for (const volatilePath of volatilePaths) {
    const existingValue = getPath(existing, volatilePath);
    if (existingValue !== undefined) setPath(preserved, volatilePath, existingValue);
  }
  return preserved;
}

export function writeStableGeneratedJson(file, data, options = {}) {
  const volatilePaths = options.volatilePaths || ['generatedAt'];
  const nextData = preserveVolatileFields(file, data, volatilePaths);
  const nextText = `${JSON.stringify(nextData, null, 2)}\n`;
  const currentText = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (currentText !== nextText) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, nextText, 'utf8');
  }
  return nextData;
}
