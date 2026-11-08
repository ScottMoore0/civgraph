/**
 * GET /404 -> the 404 page with a 404 status.
 *
 * Pages serves 404.html, with status 404, for any path that has no file. But the page's
 * own address is a file, so /404 (and /404.html, which Pages redirects to /404) answered
 * 200 -- a "soft 404" that a crawler would index as a real page. This serves the same
 * static page and only changes the status.
 * @param {FunctionContext} context
 */
export async function onRequestGet(context) {
  const page = await context.next();
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(page.body, { status: 404, headers });
}
