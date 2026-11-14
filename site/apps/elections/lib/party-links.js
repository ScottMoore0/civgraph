/**
 * Party chips link to the party's Browse page (el-places, 14 Nov 2026). The app has no party pages
 * of its own: Browse's party pages already hold each party's history, leaders, seats and votes by
 * body, members and ballot spellings, from the same records, so a second page in the app would
 * copy them and could drift. A chip is linked when the parties' name list knows its label
 * (/_api/parties?view=names, about 40 KB, read once).
 *
 * partyHref is pure; linkPartyChips touches only the chips of the view it is given.
 */
import { partyNames } from './api.js';
import { partyBrowseUrl } from './place-urls.js';
import { foldText } from './search.js';

/**
 * A party label's Browse page, or null when the label is not a known name of a party.
 * @param {unknown} label @param {Record<string, string>} names
 */
export function partyHref(label, names) {
  const slug = names[foldText(label)];
  return slug ? partyBrowseUrl(slug) : null;
}

/**
 * Wrap each party chip (.cg-party) of a view that is not already inside a link in a link to its
 * party's page. Does nothing once the view is gone (`stale`).
 * @param {HTMLElement} root
 * @param {() => boolean} stale
 */
export async function linkPartyChips(root, stale) {
  if (!root.querySelector('.cg-party')) return;
  const names = await partyNames().catch(() => ({}));
  if (stale()) return;
  for (const chip of root.querySelectorAll('.cg-party')) {
    if (chip.closest('a')) continue;
    const href = partyHref(chip.textContent, names);
    if (!href) continue;
    const a = document.createElement('a');
    a.href = href;
    a.className = 'el-party-link';
    chip.replaceWith(a);
    a.append(chip);
  }
}
