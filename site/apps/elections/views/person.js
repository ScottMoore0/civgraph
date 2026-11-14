/**
 * A person's career (/elections/person/<slug or id>/, el-places, 14 Nov 2026): every candidacy
 * across bodies with its result, the relatives the records hold, the other people Civgraph keeps
 * under the same name, and the person's Browse page. The derivations are lib/career.js (pure).
 */
import { personCandidacies, personRecord, personSearch } from '../lib/api.js';
import { careerRows, careerSummary, namesakes } from '../lib/career.js';
import { appUrl, esc, fmtDate, fmtInt, fmtPct } from '../lib/format.js';
import { partyChip } from '../lib/party.js';
import { areaUrl, personAppUrl, personBrowseUrl } from '../lib/place-urls.js';
import { TEXT, fill } from '../lib/places-text.js';
import { yearSpan } from '../../../pkg/core/src/format.js';

/** @typedef {import('../lib/career.js').CareerRow} CareerRow */

/** The person page's URL state: the person's slug or id. Pure. @param {import('../lib/route.js').Route} route */
export function personState(route) {
  return { key: String(route.person || '') };
}

/** A candidacy's outcome in words. @param {CareerRow['outcome']} outcome */
function outcomeText(outcome) {
  if (outcome === 'unopposed') return TEXT.returnedUnopposed;
  return outcome === 'not-elected' ? TEXT.notElected : TEXT.elected;
}

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route */
export async function render(root, route) {
  const { key } = personState(route);
  const [{ person }, { candidacies }] = await Promise.all([personRecord(key), personCandidacies(key)]);
  const others = await personSearch(person.title, 40).then((found) => namesakes(found, person)).catch(() => []);
  const rows = careerRows(candidacies || [], person.elections || []);
  const sum = careerSummary(rows);
  const relatives = person.relatives || [];

  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">Elections</a> › ${esc(person.title)}</nav>
    <header class="el-head">
      <h1>${esc(person.title)}</h1>
      <p class="el-lead">${esc(fill(TEXT.personSummary, { stood: fmtInt(sum.stood), elected: fmtInt(sum.elected), years: yearSpan(sum.firstYear, sum.lastYear) }))}${sum.bodies.length ? ` · ${esc(sum.bodies.join(', '))}` : ''}</p>
      <p class="el-muted"><a href="${esc(personBrowseUrl(person.slug))}">${esc(TEXT.personBrowse)}</a></p>
    </header>
    <section aria-labelledby="el-career"><h2 id="el-career">${esc(TEXT.personCareer)}</h2>
      <div class="cg-table-wrap" tabindex="0" role="region" aria-labelledby="el-career"><table class="cg-table cg-table--compact el-career">
        <thead><tr><th scope="col">${esc(TEXT.colElection)}</th><th scope="col">${esc(TEXT.colContest)}</th><th scope="col">${esc(TEXT.colParty)}</th><th scope="col" class="num">${esc(TEXT.colVotes)}</th><th scope="col" class="num">${esc(TEXT.colShare)}</th><th scope="col">${esc(TEXT.colOutcome)}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr${r.outcome !== 'not-elected' ? ' class="cg-elected"' : ''}>`
          + `<th scope="row">${r.contestSlug ? `<a href="${appUrl.contest(r.electionKey, r.contestSlug)}">${esc(r.electionTitle)}</a>` : `<a href="${appUrl.election(r.electionKey)}">${esc(r.electionTitle)}</a>`}<br><span class="el-muted">${esc(fmtDate(r.date))}</span></th>`
          + `<td>${r.contestSlug ? `<a href="${areaUrl(r.contestSlug, null)}">${esc(r.contest)}</a>` : esc(r.contest)}</td>`
          + `<td>${partyChip(r.party, r.colour)}</td><td class="num">${fmtInt(r.votes)}</td><td class="num">${fmtPct(r.share)}</td>`
          + `<td>${r.outcome === 'not-elected' ? esc(outcomeText(r.outcome)) : `<span class="cg-badge cg-badge--success">${esc(outcomeText(r.outcome))}</span>`}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    ${relatives.length ? `<section aria-labelledby="el-relatives"><h2 id="el-relatives">${esc(TEXT.personRelatives)}</h2><ul class="el-list">${relatives.map((r) => {
      const url = personAppUrl({ personSlug: r.slug, personId: r.personId });
      return `<li>${esc(r.relation)}: ${url ? `<a href="${esc(url)}">${esc(r.name)}</a>` : esc(r.name)}${r.source ? ` <span class="el-muted">${esc(r.source)}</span>` : ''}</li>`;
    }).join('')}</ul></section>` : ''}
    ${others.length ? `<section aria-labelledby="el-namesakes"><h2 id="el-namesakes">${esc(TEXT.personNamesakes)}</h2><p class="el-muted">${esc(TEXT.personNamesakesNote)}</p><ul class="el-list">${others.map((p) => {
      const url = personAppUrl({ personSlug: p.slug });
      const span = yearSpan(p.firstYear ?? null, p.lastYear ?? null);
      return `<li><a href="${esc(String(url))}">${esc(p.title)}</a>${span ? ` <span class="el-muted">${esc(span)}${p.bodies?.length ? ` · ${esc(p.bodies.join(', '))}` : ''}</span>` : ''}</li>`;
    }).join('')}</ul></section>` : ''}`;
  return person.title;
}
