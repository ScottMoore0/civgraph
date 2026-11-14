/**
 * A contest page's arrows to the contests before and after it in the same body under the same
 * name, and a link to the area page (el-places, 14 Nov 2026). Added to the contest page's header
 * once its area's history is read; the neighbours come from lib/area.js (pure, tested).
 */
import { areaHistory } from '../lib/api.js';
import { contestNeighbours } from '../lib/area.js';
import { appUrl, esc } from '../lib/format.js';
import { areaUrl } from '../lib/place-urls.js';
import { TEXT, fill } from '../lib/places-text.js';

/**
 * @param {HTMLElement} root  the contest view
 * @param {{ electionKey: string, contestSlug: string, seq: number, name: string, bodySlug: string, stale: () => boolean }} here
 */
export async function mountContestNav(root, { electionKey, contestSlug, seq, name, bodySlug, stale }) {
  const history = await areaHistory(contestSlug).catch(() => null);
  if (!history || stale()) return;
  const { previous, next } = contestNeighbours(history, electionKey, seq);
  const head = root.querySelector('.el-head');
  if (!head) return;
  const nav = document.createElement('nav');
  nav.className = 'el-nav el-contest-nav';
  nav.setAttribute('aria-label', fill(TEXT.allContestsHere, { name }));
  nav.innerHTML = `${previous ? `<a href="${appUrl.contest(previous.electionKey, previous.contestSlug)}" rel="prev" title="${esc(TEXT.previousHere)}">← ${esc(previous.displayTitle)}</a>` : '<span></span>'}`
    + `<a href="${areaUrl(contestSlug, bodySlug)}">${esc(fill(TEXT.allContestsHere, { name }))}</a>`
    + `${next ? `<a href="${appUrl.contest(next.electionKey, next.contestSlug)}" rel="next" title="${esc(TEXT.nextHere)}">${esc(next.displayTitle)} →</a>` : '<span></span>'}`;
  head.append(nav);
}
