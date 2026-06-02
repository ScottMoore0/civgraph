import { getContributorAuth, jsonResponse, sanitizeAuth } from '../_auth.js';

export async function onRequestGet(context) {
  const auth = getContributorAuth(context);
  return jsonResponse({
    ok: true,
    auth: sanitizeAuth(auth),
    capabilities: {
      browse: true,
      proposeEdits: auth.allowed,
      submitMapRequests: auth.allowed,
      approveSubmissions: auth.isAdmin
    }
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'GET' } });
  }
  return onRequestGet(context);
}
