// The phase-3 compatibility route for the documents named below (functions/_api/_compat-documents.js).
import { onCompatDocument } from '../../_api/_compat-documents.js';

/** The paths this answers; _routes.json includes exactly these (validate-routes-manifest.mjs). */
export const ROUTE_PATTERNS = ['/data/catalogue/catalogue.json', '/data/catalogue/places.json', '/data/catalogue/people.json'];

export const onRequestGet = onCompatDocument;
