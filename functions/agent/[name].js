// The phase-3 compatibility route for the documents named below (packages/api/src/handlers/_compat-documents.js).
import { onCompatDocument } from '../../packages/api/src/handlers/_compat-documents.js';

/** The paths this answers; _routes.json includes exactly these (validate-routes-manifest.mjs). */
export const ROUTE_PATTERNS = ['/agent/maps-index.json'];

export const onRequestGet = onCompatDocument;
// HEAD is answered by the same handler (the runtime drops the body). Without it a HEAD fell through
// to the asset layer, which still held a week-old object from before these documents moved to D1.
export const onRequestHead = onCompatDocument;
