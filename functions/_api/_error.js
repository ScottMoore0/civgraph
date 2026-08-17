/**
 * Turn an exception into something safe to return, and something findable in the
 * logs.
 *
 * WHY
 *
 * Three endpoints returned the raw exception text to the caller:
 *
 *   catalogue/index.js   detail: String(error?.message || error)
 *   elections/index.js   String(error.message || error)
 *   proni/search.js      String(error && error.message || error)
 *
 * D1 errors carry SQL fragments and column names, and all three routes are
 * public and unauthenticated. The disclosure is minor -- schema, not data -- but
 * it should be a deliberate choice rather than the default, and losing the detail
 * entirely would trade one problem for a worse one: an operator with no way to
 * diagnose a 500.
 *
 * So the detail goes to the log with a correlation id, and the caller gets the
 * id. `wrangler pages tail civgraph | grep <id>` finds it.
 *
 * CIVGRAPH_VERBOSE_ERRORS=true restores the old behaviour for local debugging.
 * Like the dev-auth bypass in _auth.js it is opt-in and must stay unset in
 * production -- absent configuration means "do not disclose".
 */

/** Short, unguessable, and enough to find one request among a day of logs. */
function correlationId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @returns {{ errorId: string, detail?: string }} `detail` only when verbose
 *   errors are switched on.
 */
export function reportError(env, where, error) {
  const errorId = correlationId();
  const message = String(error?.message || error);

  // Structured, so `wrangler tail | jq` can filter it.
  console.error(JSON.stringify({
    evt: 'endpoint_error',
    errorId,
    where,
    message,
    stack: typeof error?.stack === 'string' ? error.stack.slice(0, 2000) : undefined,
  }));

  if (String(env?.CIVGRAPH_VERBOSE_ERRORS || '').toLowerCase() === 'true') {
    return { errorId, detail: message };
  }
  return { errorId };
}
