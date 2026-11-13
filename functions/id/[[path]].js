import { serveIdRedirect } from '../../packages/api/src/pages/id.js';

// GET /id/<kind>:<slug>: a linked-data identifier of the graph -> 303 See Other to the record's
// page, 404 for an id the graph does not hold (packages/api/src/pages/id.js).
export const onRequestGet = serveIdRedirect;
