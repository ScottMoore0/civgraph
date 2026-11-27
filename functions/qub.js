import { serveQub } from '@civgraph/api/handlers/qub/page.js';

// GET /qub -> the Independent QUB Catalogue (404 when QUB_DB is not bound; bound in production since 27 Nov 2026).
export const onRequestGet = serveQub;
