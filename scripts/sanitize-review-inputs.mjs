#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOCAL_PATH_RE = /[A-Z]:\\|\\\\|\/Users\/scomo|C:\/Users\/scomo|D:\//i;
const SENSITIVE_TOKEN_RE = new RegExp([
  String.fromCharCode(85, 80, 82, 78),
  String.fromCharCode(80, 111, 105, 110, 116, 101, 114),
  'address' + '-level',
  'post' + 'code'
].join('|'), 'i');

// The withheld address-layer source row carries no obfuscated sensitive token, only the
// file-name signature below; neutralize the whole row by that signature so the descriptor
// never reaches a tracked file.
const SENSITIVE_ROW_RE = /properties\.geojson/i;

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.output) {
  console.error('Usage: node scripts/sanitize-review-inputs.mjs --input <raw-file> --output <tracked-file> [--drop-row 555] [--format csv|json]');
  process.exit(1);
}

main();

function main() {
  const input = path.resolve(args.input);
  const output = path.resolve(args.output);
  const format = args.format || (input.endsWith('.json') ? 'json' : 'csv');
  if (!existsSync(input)) throw new Error(`Missing input: ${input}`);
  mkdirSync(path.dirname(output), { recursive: true });

  if (format === 'json') {
    const value = JSON.parse(readFileSync(input, 'utf8'));
    const sanitized = sanitizeValue(value);
    assertPublicSafe(sanitized);
    writeFileSync(output, `${JSON.stringify(sanitized, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, output)} from JSON input.`);
    return;
  }

  const { headers, rows } = parseCsv(readFileSync(input, 'utf8'));
  const dropRows = new Set(normalizeArray(args.dropRow || args['drop-row']).map((value) => String(value)));
  const sanitizedRows = rows
    .filter((row, index) => {
      const sourceRowNumber = String(row.rowNumber || row.auditRowNumber || row.sourceRowNumber || index + 1);
      return !dropRows.has(sourceRowNumber);
    })
    .map((row, index) => maybeNeutralizeSensitiveRow(sanitizeCsvRow(row, index + 1)));
  assertPublicSafe({ headers, rows: sanitizedRows });
  writeCsv(output, sanitizedRows, headers);
  console.log(`Wrote ${path.relative(ROOT, output)} with ${sanitizedRows.length} sanitized rows from ${rows.length} raw rows.`);
}

function maybeNeutralizeSensitiveRow(row) {
  const isSensitive = Object.values(row).some((value) => SENSITIVE_ROW_RE.test(String(value ?? '')));
  if (!isSensitive) return row;
  let markedTitle = false;
  const neutralized = {};
  for (const key of Object.keys(row)) {
    if (/^rownumber$|^safetyclass$/i.test(key)) {
      neutralized[key] = row[key];
    } else if (!markedTitle && /title|name/i.test(key)) {
      neutralized[key] = 'withheld-sensitive-review-row';
      markedTitle = true;
    } else {
      neutralized[key] = '';
    }
  }
  return neutralized;
}

function sanitizeCsvRow(row, fallbackNumber) {
  const sanitized = {};
  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = sanitizeCell(key, value);
  }
  if (args.renumber === 'true' && 'rowNumber' in sanitized) sanitized.rowNumber = String(fallbackNumber);
  return sanitized;
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValueForKey(key, item)]));
  }
  if (typeof value === 'string') return sanitizeText(value);
  return value;
}

function sanitizeValueForKey(key, value) {
  if (typeof value === 'string') return sanitizeCell(key, value);
  return sanitizeValue(value);
}

function sanitizeCell(key, value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (/dPath|path|local/i.test(key) && LOCAL_PATH_RE.test(text)) return sanitizePathToken(text);
  return sanitizeText(text);
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/\b[A-Z]:\\[^\r\n,|;"]+/g, '[local source path withheld]')
    .replace(/\bC:\/Users\/scomo\/[^\r\n,|;"]+/gi, '[local source path withheld]')
    .replace(/\bD:\/[^\r\n,|;"]+/gi, '[local source path withheld]')
    .replace(/\\\\[^\r\n,|;"]+/g, '[local source path withheld]')
    .replace(/\/Users\/scomo\/[^\r\n,|;"]+/gi, '[local source path withheld]');
}

function sanitizePathToken(value) {
  const text = String(value ?? '');
  const normalized = text.replaceAll('\\', '/');
  const leaf = normalized.split('/').filter(Boolean).pop() || '';
  if (!leaf || /^\[local source path withheld\]$/i.test(leaf)) return '[local source path withheld]';
  return `.../${leaf}`;
}

function assertPublicSafe(value) {
  const text = JSON.stringify(value);
  if (LOCAL_PATH_RE.test(text)) throw new Error('Sanitized output still contains a local filesystem path token.');
  if (SENSITIVE_TOKEN_RE.test(text)) throw new Error('Sanitized output still contains a sensitive address/source token.');
  if (SENSITIVE_ROW_RE.test(text)) throw new Error('Sanitized output still contains the withheld address-layer source-file signature.');
}

function parseArgs(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = items[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    i += 1;
    if (out[key]) out[key] = normalizeArray(out[key]).concat(next);
    else out[key] = next;
  }
  return out;
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    records.push(row);
  }
  const [headers, ...body] = records.filter((candidate) => candidate.some((cell) => String(cell || '').trim()));
  return {
    headers,
    rows: body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])))
  };
}

function writeCsv(file, rows, headers) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  writeFileSync(file, `${lines.join('\n')}\n`);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
