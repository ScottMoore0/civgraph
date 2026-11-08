/**
 * Cloudflare Pages `_redirects`, read and matched as Pages does, for tests and local servers.
 *
 * Pages applies the first rule whose source matches the request path, before it looks for a
 * static file ("Redirects are always followed, regardless of whether or not an asset matches
 * the incoming request", developers.cloudflare.com/pages/configuration/redirects/). A source
 * may end in `*` (its match is `:splat` in the destination) and may hold `:name` placeholders.
 * Status 200 is a proxy: Pages serves the destination's content at the requested address.
 * Fragments never reach the server; the browser keeps the old one across a redirect whose
 * Location has none.
 *
 * Limited to what this site's file uses. It does not model query-string sources (Pages does not
 * support them either) or the 2,000/100 rule limits.
 */

/** @typedef {{ line: number, from: string, to: string, status: number }} RedirectRule */

/**
 * Parse the text of a `_redirects` file into ordered rules.
 * @param {string} text
 * @returns {RedirectRule[]}
 */
export function parseRedirects(text) {
  /** @type {RedirectRule[]} */
  const rules = [];
  for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status = '302'] = line.split(/\s+/);
    if (!from || !to) throw new Error(`_redirects line ${index + 1}: needs a source and a destination`);
    rules.push({ line: index + 1, from, to, status: Number(status) });
  }
  return rules;
}

/** @param {string} from */
function sourcePattern(from) {
  /** @type {string[]} */
  const names = [];
  let pattern = '';
  const parts = from.split(/(\*|:[A-Za-z]\w*)/);
  for (const part of parts) {
    if (part === '*') {
      names.push('splat');
      pattern += '(.*)';
    } else if (/^:[A-Za-z]\w*$/.test(part)) {
      names.push(part.slice(1));
      pattern += '([^/]+)';
    } else {
      pattern += part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return { re: new RegExp(`^${pattern}$`), names };
}

/**
 * The first rule matching `pathname`, with its destination filled in, or null.
 * Returns { rule, status, location } where location keeps the request's query when the
 * destination names none (as Pages does for these rules).
 * @param {RedirectRule[]} rules
 * @param {string} pathname
 * @param {string} [search]
 * @returns {{ rule: RedirectRule, status: number, location: string } | null}
 */
export function matchRedirect(rules, pathname, search = '') {
  for (const rule of rules) {
    const { re, names } = sourcePattern(rule.from);
    const match = re.exec(pathname);
    if (!match) continue;
    let location = rule.to;
    names.forEach((name, i) => {
      location = location.split(`:${name}`).join(match[i + 1]);
    });
    if (search && !location.includes('?')) location += search;
    return { rule, status: rule.status, location };
  }
  return null;
}
