/**
 * The methods page (/elections/methods/): how each figure the app works out, rather than reads
 * from a source, is made (lib/methods.js holds the words). Every worked-out figure in the app
 * links to its section here. The page reads nothing from the API.
 */
import { esc } from '../lib/format.js';
import { METHODS } from '../lib/methods.js';

/** The page's fixed words (keys of data/i18n/strings/elections.txt). */
export const METHODS_PAGE = Object.freeze({
  title: 'How the figures are worked out',
  lead: 'Most figures in this app are read from the sources each contest cites. These are the ones Civgraph works out, and exactly how. Each such figure links here from where it is shown.',
  contents: 'On this page',
  crumb: 'Elections',
});

/** @param {HTMLElement} root @param {import('../lib/route.js').Route} route */
export async function render(root, route) {
  root.innerHTML = `
    <nav class="el-crumbs" aria-label="Breadcrumb"><a href="/elections/">${esc(METHODS_PAGE.crumb)}</a> › ${esc(METHODS_PAGE.title)}</nav>
    <header class="el-head"><h1>${esc(METHODS_PAGE.title)}</h1><p class="el-lead">${esc(METHODS_PAGE.lead)}</p></header>
    <nav class="el-methods-toc" aria-labelledby="el-methods-toc"><h2 id="el-methods-toc">${esc(METHODS_PAGE.contents)}</h2>
      <ul class="el-list">${METHODS.map((m) => `<li><a href="#${m.id}">${esc(m.title)}</a></li>`).join('')}</ul></nav>
    ${METHODS.map((m) => `<section class="el-method-section" aria-labelledby="${m.id}"><h2 id="${m.id}" tabindex="-1">${esc(m.title)}</h2>${m.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`).join('')}`;
  // A link from a figure names a section (#swing): the router draws the page, then the browser
  // has nothing left to scroll to, so go to it here.
  const want = decodeURIComponent(location.hash.slice(1));
  const target = want ? root.querySelector(`[id="${CSS.escape(want)}"]`) : null;
  if (target instanceof HTMLElement && route.view === 'methods') {
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  }
  return METHODS_PAGE.title;
}
