import { getContributorAuth, jsonResponse, jsonNotAllowed, sanitizeAuth } from '../_auth.js';
import { methodGuard } from '../_method.js';

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

export const onRequest = methodGuard('GET', onRequestGet, jsonNotAllowed);
