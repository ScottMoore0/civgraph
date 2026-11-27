import { serveQub } from '@civgraph/api/handlers/qub/page.js';

// GET /qub/<mms_id> -> the app shell with the record's head; 404 for an id the catalogue does not hold.
export const onRequestGet = serveQub;
