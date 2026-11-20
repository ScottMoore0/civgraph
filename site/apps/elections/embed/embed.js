/**
 * The embeddable result widget: /apps/elections/embed/?e=<election slug>[&c=<contest slug>] in an
 * iframe shows an election's seat chart and leading parties, or one contest's candidates with their
 * votes and outcome; each links back to its page, names Civgraph as the source, gives the licence
 * (Civgraph's compilation CC BY 4.0, each source's own licence named from the source ledger) and
 * says how to cite it.
 *
 * SWITCHED OFF for other sites until the owner approves the app going public: site/_headers lets
 * only civgraph.net frame this page, and the app offers no snippet (config.js EMBED.offered). How
 * to switch it on: lib/embed.js.
 */
import { contestCitations, contestResult, electionDetail, embedLicences } from '../lib/api.js';
import { parliamentArc, seatBar } from '../lib/charts.js';
import { countSheet } from '../lib/count.js';
import { WIDGET_TEXT, embedParams, sourceLicences } from '../lib/embed.js';
import { appUrl, esc, fmtDate, fmtInt, fmtPct, isStv } from '../lib/format.js';
import { partyColour } from '../lib/party.js';
import { EMBED } from '../state-machines.js';

const box = /** @type {HTMLElement} */ (document.getElementById('w'));
const { election, contest } = embedParams(location.search);
const slug = election || 'northern-ireland-assembly-2022-05-05';
/** EL-14: loading, then shown or failed (box data-state). */
const state = EMBED.start();
box.dataset['state'] = state.state();

/**
 * The licence footer: Civgraph's own licence, then each source's.
 * @param {string} link the page on Civgraph
 * @param {readonly unknown[]} urls the sources' links
 */
async function licenceFooter(link, urls) {
  const slice = /** @type {import('../lib/embed.js').LicenceSlice} */ (await embedLicences().catch(() => ({ own: { title: 'CC BY 4.0', url: '/pages/licence' }, licencePage: '/pages/licence', sources: [] })));
  const { named, unmatched } = sourceLicences(urls, slice);
  const own = `${esc(WIDGET_TEXT.own)} <a href="${esc(slice.own.url)}" target="_blank" rel="noopener license">${esc(slice.own.title)}</a>.`;
  const list = named.map((s) => `${esc(s.publisher)} (${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)})`).join('; ');
  const theirs = !named.length ? (unmatched ? ` ${esc(WIDGET_TEXT.sourcesListed)}` : '')
    : ` ${esc(WIDGET_TEXT.sourcesOwn)} ${list}${unmatched ? ` ${esc(WIDGET_TEXT.sourcesOther)}` : '.'}`;
  const page = new URL(slice.licencePage, location.origin).toString();
  return `<footer><p>${esc(WIDGET_TEXT.source)} <a href="${esc(link)}" target="_top">${esc(WIDGET_TEXT.sourceTail)}</a></p>`
    + `<p>${own}${theirs} <a href="${esc(page)}" target="_top">${esc(WIDGET_TEXT.licencePage)}</a></p></footer>`;
}

/** An election's seats and leading parties. @param {import('../lib/api.js').ElectionDetail} d */
async function electionWidget(d) {
  const parties = (d.partySummary || []).filter((p) => p.seats > 0 || (p.share ?? 0) >= 2).slice(0, 8);
  const seated = (d.partySummary || []).filter((p) => p.seats > 0).map((p) => ({ party: p.party, seats: p.seats, colour: p.colour }));
  const seats = seated.reduce((/** @type {number} */ s, p) => s + p.seats, 0);
  const votes = (d.totals?.validPoll || 0) > 0;
  const link = new URL(appUrl.election(d.key), location.origin).toString();
  const title = WIDGET_TEXT.nSeats.replace('{n}', fmtInt(seats));
  return `<h1><a href="${esc(link)}" target="_top">${esc(d.title)}</a></h1>
    <p class="meta">${esc(fmtDate(d.date))} · ${esc(title)}</p>
    ${seats >= 30 ? parliamentArc(seated, { title }) : seatBar(seated, { title })}
    <table><thead><tr><th>${esc(WIDGET_TEXT.party)}</th><th class="n">${esc(WIDGET_TEXT.seats)}</th>${votes ? `<th class="n">${esc(WIDGET_TEXT.share)}</th>` : ''}</tr></thead>
    <tbody>${parties.map((p) => `<tr><td><span class="sw" style="background:${esc(partyColour(p.colour))}"></span>${esc(p.party)}</td><td class="n">${fmtInt(p.seats)}</td>${votes ? `<td class="n">${fmtPct(p.share)}</td>` : ''}</tr>`).join('')}</tbody></table>
    ${await licenceFooter(link, (d.references || []).map((r) => r.url))}`;
}

/** One contest's candidates and outcome. @param {import('../lib/api.js').ElectionDetail} d @param {string} cslug */
async function contestWidget(d, cslug) {
  const result = await contestResult(d.key, cslug);
  const c = result.constituency || {};
  const cites = await contestCitations(d.key, Number(c['seq'])).catch(() => ({ citations: [] }));
  const sheet = countSheet(/** @type {Array<Record<string, unknown>>} */ (result.candidates || []), {
    quota: c['quota'], validPoll: c['validPoll'] ?? c['totalVotes'], seatsTotal: c['seatsTotal'], contestStatus: c['contestStatus'] || d.contestStatus,
  });
  const valid = sheet.validPoll;
  const stv = isStv(d.votingSystem);
  const rows = [...sheet.rows].sort((a, b) => (b.firstPrefs ?? -1) - (a.firstPrefs ?? -1));
  const name = String(c['name'] || c['constituency'] || '');
  const link = new URL(appUrl.contest(d.key, cslug), location.origin).toString();
  const outcome = (/** @type {import('../lib/count.js').SheetRow} */ r) => esc(r.unopposed ? WIDGET_TEXT.unopposed : r.elected ? WIDGET_TEXT.elected : WIDGET_TEXT.notElected);
  return `<h1><a href="${esc(link)}" target="_top">${esc(name)}</a></h1>
    <p class="meta">${esc(d.title)} · ${esc(fmtDate(d.date))} · ${esc(WIDGET_TEXT.nSeats.replace('{n}', fmtInt(c['seatsTotal'])))}</p>
    <table><thead><tr><th>${esc(WIDGET_TEXT.candidate)}</th><th class="n">${esc(stv ? WIDGET_TEXT.firstPrefs : WIDGET_TEXT.votes)}</th><th class="n">${esc(WIDGET_TEXT.share)}</th><th>${esc(WIDGET_TEXT.outcome)}</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${r.elected ? ' class="el"' : ''}><td><span class="sw" style="background:${esc(partyColour(r.colour))}"></span>${esc(r.name)}<div class="p">${esc(r.party)}</div></td><td class="n">${fmtInt(r.firstPrefs)}</td><td class="n">${fmtPct(r.firstPrefs !== null && valid ? (100 * r.firstPrefs) / valid : null)}</td><td>${outcome(r)}</td></tr>`).join('')}</tbody></table>
    ${await licenceFooter(link, (cites.citations || []).map((ci) => ci.url))}`;
}

electionDetail(slug).then((d) => (contest ? contestWidget(d, contest) : electionWidget(d))).then((html) => {
  box.innerHTML = html;
  box.dataset['state'] = state.to('shown');
}).catch((err) => {
  box.textContent = `${WIDGET_TEXT.failed} (${err?.status || err})`;
  box.dataset['state'] = state.to('failed');
});
