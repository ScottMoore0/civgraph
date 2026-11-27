import { serveQub } from '@civgraph/api/handlers/qub/page.js';

// GET /qub -> the Independent QUB Catalogue (404 unless QUB_DB is bound: local only until the owner approves).
export const onRequestGet = serveQub;
