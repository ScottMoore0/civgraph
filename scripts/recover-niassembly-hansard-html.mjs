#!/usr/bin/env node
/**
 * Recover the Hansard reports the NI Assembly API cannot serve.
 *
 * harvest-niassembly-opendata.mjs completes every operation except
 * hansard.GetHansardComponentsByReportId for 14 of 652 reports. Those return
 * HTTP 500 from the service itself:
 *
 *   Name cannot begin with the ',' character, hexadecimal value 0x2C.
 *   Line 1, position 101.
 *
 * That is an XML serialisation fault inside the Assembly's own code -- almost
 * certainly a name or affiliation containing a comma where an element name is
 * built. The _JSON variant wraps the same XML pipeline, so it fails identically,
 * and no client-side retry can help. Verified: a working report returns 806 KB
 * in 0.56s; these fail in 0.12s, deterministically.
 *
 * The debates are not lost, only unavailable through the API. The published
 * official report carries the full text:
 *
 *   www.niassembly.gov.uk/assembly-business/official-report/
 *     reports-<yy-yy>/<dd-month-yyyy>/
 *
 * Session slug and date come from GetAllHansardReports_JSON, so the mapping is
 * taken from the API's own metadata rather than guessed. Day pages are large
 * (the 2012-10-09 sitting is 752 KB of HTML, ~691k characters of text).
 *
 * Usage:
 *   node scripts/recover-niassembly-hansard-html.mjs --out <harvest-dir> [--dry]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://www.niassembly.gov.uk';
const UA = 'civgraph-opendata-harvest/1.0 (+https://civgraph.net; contact via repo)';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal('out', null);
const DRY = args.includes('--dry');
if (!OUT) { console.error('Usage: node scripts/recover-niassembly-hansard-html.mjs --out <harvest-dir> [--dry]'); process.exit(2); }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rec = (j) => {
  if (!j || typeof j !== 'object') return [];
  const t = Object.values(j)[0];
  if (Array.isArray(t)) return t;
  if (t && typeof t === 'object') {
    const i = Object.values(t)[0];
    if (Array.isArray(i)) return i;
    if (i && typeof i === 'object') return [i];
  }
  return [];
};

// Which reports are missing? Derived, not hardcoded: any report in the seed
// list with no harvested components file.
const reports = rec(JSON.parse(readFileSync(path.join(OUT, 'hansard', 'GetAllHansardReports_JSON', 'all.json'), 'utf8')));
const haveDir = path.join(OUT, 'hansard', 'GetHansardComponentsByReportId_JSON');
const missing = reports.filter((r) => !existsSync(path.join(haveDir, `${r.ReportDocId}.json`)));

console.log(`Hansard HTML recovery`);
console.log(`  reports in API list : ${reports.length}`);
console.log(`  missing from harvest: ${missing.length}\n`);
if (!missing.length) { console.log('  nothing to recover.'); process.exit(0); }

const outDir = path.join(OUT, 'hansard', '_recovered-html');
mkdirSync(outDir, { recursive: true });

// "2012-2013" -> "reports-12-13"
const sessionSlug = (name) => {
  const m = String(name).match(/(\d{4})\D+(\d{4})/);
  return m ? `reports-${m[1].slice(2)}-${m[2].slice(2)}` : null;
};

// strip scripts/styles, then tags, keeping paragraph breaks
function extractText(html) {
  const body = (html.match(/<div[^>]*id="content"[^>]*>([\s\S]*)/i) || [null, html])[1];
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

let ok = 0; let failed = 0;
for (const r of missing) {
  const date = String(r.PlenaryDate).slice(0, 10);
  const [y, m, d] = date.split('-');
  const slug = sessionSlug(r.PlenarySessionName);
  const url = `${SITE}/assembly-business/official-report/${slug}/${d}-${MONTHS[Number(m) - 1]}-${y}/`;
  const dest = path.join(outDir, `${r.ReportDocId}.json`);

  if (existsSync(dest)) { console.log(`  cached  ${r.ReportDocId}  ${date}`); ok += 1; continue; }
  if (DRY) { console.log(`  [dry]   ${r.ReportDocId}  ${date}  ${url}`); continue; }

  // Two sources. The published per-sitting-day page on the main site is the
  // cleaner render, but its session folders do not cover every mandate -- the
  // 2014-2015 reports 404 there. The AIMS report viewer is keyed directly by
  // the same docID the API gave us and does carry those, so it is the fallback.
  const aims = `https://aims.niassembly.gov.uk/officialreport/report.aspx?&eveDate=${date}&docID=${r.ReportDocId}`;
  let html = null; let usedUrl = url;

  for (const candidate of [url, aims]) {
    for (let a = 0; a < 3 && !html; a += 1) {
      try {
        const res = await fetch(candidate, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (res.ok) { html = await res.text(); usedUrl = candidate; } else { await sleep(1200 * (a + 1)); break; }
      } catch { await sleep(1200 * (a + 1)); }
    }
    if (html && extractText(html).length >= 5000) break;
    if (html && candidate === url) { html = null; }  // thin main-site page: try AIMS
  }

  if (!html) { console.error(`  FAIL    ${r.ReportDocId}  ${date}  ${url}`); failed += 1; continue; }

  const text = extractText(html);
  // A recovered report with almost no text means the URL resolved to a stub or
  // an error page; treat that as a failure rather than silently writing it.
  if (text.length < 5000) { console.error(`  THIN    ${r.ReportDocId}  ${date}  only ${text.length} chars -- check ${url}`); failed += 1; continue; }

  writeFileSync(dest, JSON.stringify({
    reportDocId: r.ReportDocId,
    plenaryDate: r.PlenaryDate,
    session: r.PlenarySessionName,
    source: usedUrl,
    recoveredAt: new Date().toISOString(),
    reason: 'API GetHansardComponentsByReportId returns HTTP 500 (server-side XML serialisation fault)',
    characters: text.length,
    text
  }, null, 1));
  console.log(`  ok      ${r.ReportDocId}  ${date}  ${(text.length / 1000).toFixed(0)}k chars`);
  ok += 1;
  await sleep(700);
}

console.log(`\n  recovered ${ok}/${missing.length}, failed ${failed}`);
if (failed) process.exit(1);
