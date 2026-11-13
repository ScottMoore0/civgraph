/**
 * The Books section: the current pane's book cards (cover, authors, View, Markdown, Archive.org),
 * built by the same function, under the same category icons.
 */
import { icon, BOOK_CATEGORY_ICONS } from './icons.js';
import { esc, plural } from './util.js';

export function booksHtml(c) {
  const all = c.books?.books || [];
  if (!all.length) return '<p class="cn-empty">The book shelf could not be loaded.</p>';
  const shown = c.query ? all.filter((b) => c.bookHits?.has(b.id)) : all;
  if (!shown.length) return `<p class="cn-empty" role="status">No books match “${esc(c.query)}”.${c.otherTabHint()}</p>`;
  const cats = (c.books.categories || []).map((cat) => ({ cat, list: shown.filter((b) => b.category === cat.id) })).filter((g) => g.list.length);
  const uncategorised = shown.filter((b) => !(c.books.categories || []).some((cat) => cat.id === b.category));
  if (uncategorised.length) cats.push({ cat: { id: 'other', name: 'Other' }, list: uncategorised });
  return `<p class="cn-summary" role="status">${plural(shown.length, 'book')}${c.query ? ` match “${esc(c.query)}”` : ''}: the printed sources the maps and results draw on.</p>
    ${cats.map(({ cat, list }) => `<section class="category-section cn-bookcat" id="cn-books-${esc(cat.id)}" data-cn-section="cn-books-${esc(cat.id)}">
      <div class="category-section__header"><span class="category-section__icon">${icon(BOOK_CATEGORY_ICONS[cat.id] || 'book-open', 'catalogue-flat__section-icon')}</span><h3 class="category-section__title">${esc(cat.name)}</h3><span class="cn-count">${list.length}</span></div>
      ${list.map((b) => `<div class="map-card book-card">${c.ui._buildBookCardHtml ? c.ui._buildBookCardHtml(b) : esc(b.title)}</div>`).join('')}
    </section>`).join('')}`;
}
