// The phase-3 compatibility route for the documents named below (packages/api/src/handlers/_compat-documents.js).
import { onCompatDocument } from '../../../packages/api/src/handlers/_compat-documents.js';

/** The paths this answers; _routes.json includes exactly these (validate-routes-manifest.mjs). */
export const ROUTE_PATTERNS = ['/data/database/maps.json'];

export const onRequestGet = onCompatDocument;
