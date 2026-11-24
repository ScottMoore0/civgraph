/**
 * Link health: which outside links still work, and what to show where one does not.
 *
 * Two lists feed it, both data:
 * - data/elections/wikipedia-verified-articles.json: Wikipedia articles whose titles the browse
 *   build derives from a name, confirmed to exist. A derived title is linked only when it is listed
 *   (or resolved in wikipedia-election-articles.json); a guess is never linked.
 * - data/database/dead-links.json: links found dead in the site's link review, each with the copy
 *   to show instead (Civgraph's own mirror, or an Internet Archive capture), or null when none is
 *   known. A citation of a dead link keeps its address, marked dead, and shows the copy first.
 *
 * Pure: the caller reads the lists and passes them in.
 */

/**
 * A derived Wikipedia article address -> the address to link (the article a redirect leads to),
 * or null when the article was not confirmed to exist.
 * @typedef {Readonly<Record<string, string | null>>} VerifiedArticles
 */

/**
 * A dead link -> the copy to show instead, or null when none is known.
 * @typedef {Readonly<Record<string, string | null>>} DeadLinks
 */

/**
 * The address to link for a Wikipedia article whose title was derived, not resolved: the
 * article itself (or where its redirect leads) when it is confirmed to exist, else null.
 * @param {string | null | undefined} url
 * @param {VerifiedArticles} articles
 * @returns {string | null}
 */
export function verifiedArticleUrl(url, articles) {
  if (!url || !Object.hasOwn(articles, url)) return null;
  return articles[url] || url;
}

/**
 * The Wikipedia reference for an election or constituency: the article resolved against
 * Wikipedia when there is one; else the address derived from its name, linked only when that
 * article was confirmed to exist; an address that is not a Wikipedia article (a referendum's own
 * first source) is kept as it is. Never a guessed title.
 * @param {string | null | undefined} resolvedUrl
 * @param {string | null | undefined} derivedUrl
 * @param {VerifiedArticles} articles
 * @returns {string | null}
 */
export function wikipediaReferenceUrl(resolvedUrl, derivedUrl, articles) {
  if (resolvedUrl) return resolvedUrl;
  if (derivedUrl && !/^https:\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(derivedUrl)) return derivedUrl;
  return verifiedArticleUrl(derivedUrl, articles);
}

/**
 * Whether a link is in the dead list, and the copy to show for it.
 * @param {string | null | undefined} url
 * @param {DeadLinks} deadLinks
 * @returns {{ dead: boolean, archive: string | null }}
 */
export function deadLinkStatus(url, deadLinks) {
  if (!url || !Object.hasOwn(deadLinks, url)) return { dead: false, archive: null };
  return { dead: true, archive: deadLinks[url] || null };
}

/**
 * Whether an address is a copy Civgraph holds itself (its data origin), which is preferred
 * to an outside archive's capture.
 * @param {string | null | undefined} url
 * @param {string} dataOrigin  e.g. SITE.dataOrigin from @civgraph/config
 */
export function isOwnMirror(url, dataOrigin) {
  return Boolean(url && dataOrigin && url.startsWith(`${dataOrigin}/`));
}

/**
 * A citation with its link health applied. A citation whose url is dead gains `urlDead: true`
 * and an `archiveUrl`: Civgraph's own mirror when one is held, else the archive address the
 * citation already carries, else the capture from the dead list. A citation whose url works
 * comes back unchanged (the same object), so a build that applies this to every citation adds
 * nothing to the ones that are fine.
 * @template {{ url?: string | null, archiveUrl?: string | null }} T
 * @param {T} citation
 * @param {DeadLinks} deadLinks
 * @param {string} dataOrigin
 * @returns {T | (T & { urlDead: true, archiveUrl: string | null })}
 */
export function withLinkHealth(citation, deadLinks, dataOrigin) {
  const { dead, archive } = deadLinkStatus(citation.url, deadLinks);
  if (!dead) return citation;
  const own = isOwnMirror(archive, dataOrigin) ? archive : null;
  return { ...citation, urlDead: true, archiveUrl: own || citation.archiveUrl || archive || null };
}

/**
 * Which address a citation shows, and in what order (the pages' rule, one place):
 * - a working url links the title, with its archived copy, if any, after it;
 * - a dead url with an archived copy: the title links the copy (said to be an archived copy) and
 *   the dead original follows, struck through;
 * - a dead url with no copy: the title is not linked and the dead original follows, struck through;
 * - no url: the title links the archived copy, if any.
 * @param {{ url?: string | null, archiveUrl?: string | null, urlDead?: unknown }} citation
 * @returns {{ main: string | null, mainIsArchive: boolean, archive: string | null, deadOriginal: string | null }}
 */
export function citationLinks(citation) {
  const url = citation.url || null;
  const archive = citation.archiveUrl || null;
  if (url && citation.urlDead) return { main: archive, mainIsArchive: Boolean(archive), archive: null, deadOriginal: url };
  if (url) return { main: url, mainIsArchive: false, archive: archive && archive !== url ? archive : null, deadOriginal: null };
  return { main: archive, mainIsArchive: Boolean(archive), archive: null, deadOriginal: null };
}
