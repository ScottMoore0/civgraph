/**
 * One place for the method guard that nine API routes were each carrying a copy
 * of.
 *
 * WHY THE GUARD EXISTS AT ALL
 *
 * A Pages Function module that exports only `onRequestPost` has no handler for a
 * GET. Rather than answering 405 itself, the runtime moves on -- and what it
 * moves on to is the static asset layer, which on this project has an SPA-shaped
 * fallback. That is the failure this codebase has already been bitten by twice:
 * a missing thing answered with index.html at HTTP 200, which every status-code
 * check reads as healthy (see the comment in functions/data/graph/[[path]].js).
 *
 * Exporting an explicit `onRequest` keeps the route owning every method, so a
 * wrong verb gets a truthful 405 with an Allow header instead of a page.
 *
 * Each route wrote that out longhand, six lines at a time, and none of them said
 * why -- so the guard read as ceremony and was one tidy-up away from being
 * deleted. Consolidating it is worth doing mostly because the reason now has
 * somewhere to live.
 *
 * The response body differs by route, which is why `notAllowed` is a parameter:
 * the JSON routes answer with the same `{ ok: false, error }` envelope they use
 * everywhere else, and the two plain-text routes stay plain text.
 */

/**
 * Wrap a single-method handler so every other verb gets 405 + Allow.
 *
 *   export const onRequest = methodGuard('POST', onRequestPost, jsonNotAllowed);
 */
export function methodGuard(method, handler, notAllowed = textNotAllowed) {
  return async function onRequest(context) {
    if (context.request.method !== method) return notAllowed(method);
    return handler(context);
  };
}

export function textNotAllowed(method) {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: method } });
}
