/**
 * The embeddable result widget (prototype): /apps/elections/embed/?e=<election slug> in an
 * iframe shows an election's seat chart and leading parties, linking back to its page. Not
 * public yet. To embed on other sites the page needs its own frame-ancestors rule (_headers
 * sets frame-ancestors 'none' for the whole site): an owner decision before launch.
 */
import { electionDetail } from '../lib/api.js';
import { parliamentArc, seatBar } from '../lib/charts.js';
import { appUrl, esc, fmtDate, fmtPct } from '../lib/format.js';
import { partyColour } from '../lib/party.js';
import { EMBED } from '../state-machines.js';

const box = /** @type {HTMLElement} */ (document.getElementById('w'));
const slug = new URLSearchParams(location.search).get('e') || 'northern-ireland-assembly-2022-05-05';
/** EL-14: loading, then shown or failed (box data-state). */
const state = EMBED.start();
box.dataset.state = state.state();

electionDetail(slug).then((/** @type {any} */ d) => {
  const parties = (d.partySummary || []).filter((/** @type {any} */ p) => p.seats > 0 || p.share >= 2).slice(0, 8);
  const seated = (d.partySummary || []).filter((/** @type {any} */ p) => p.seats > 0).map((/** @type {any} */ p) => ({ party: p.party, seats: p.seats, colour: p.colour }));
  const seats = seated.reduce((/** @type {number} */ s, /** @type {any} */ p) => s + p.seats, 0);
  const votes = (d.totals?.validPoll || 0) > 0;
  const link = new URL(appUrl.election(d.key), location.origin).toString();
  box.innerHTML = `<h1><a href="${esc(link)}" target="_top">${esc(d.title)}</a></h1>
    <p class="meta">${esc(fmtDate(d.date))} · ${seats} seats${parties.length < seated.length ? ` · the ${parties.length} largest parties shown` : ''}</p>
    ${seats >= 30 ? parliamentArc(seated, { title: `${seats} seats` }) : seatBar(seated, { title: `${seats} seats` })}
    <table><thead><tr><th>Party</th><th class="n">Seats</th>${votes ? '<th class="n">Share</th>' : ''}</tr></thead>
    <tbody>${parties.map((/** @type {any} */ p) => `<tr><td><span class="sw" style="background:${esc(partyColour(p.colour))}"></span>${esc(p.party)}</td><td class="n">${p.seats}</td>${votes ? `<td class="n">${fmtPct(p.share)}</td>` : ''}</tr>`).join('')}</tbody></table>
    <footer>Source: <a href="${esc(link)}" target="_top">Civgraph Elections</a>, with the source of every figure.</footer>`;
  box.dataset.state = state.to('shown');
}).catch((err) => {
  box.textContent = `Could not load this election (${err?.status || err}).`;
  box.dataset.state = state.to('failed');
});
