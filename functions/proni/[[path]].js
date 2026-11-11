import { serveShell } from '../_proni-shell.js';
import { serveRecordPage } from '../../packages/api/src/handlers/proni/page.js';

// GET /proni/<reference…>  -> the app shell with the record rendered into it (page.js), 404 for
// a reference the catalogue does not hold; the client router takes over from there.
/** @param {FunctionContext} context */
export const onRequestGet = (context) => serveRecordPage(context, serveShell);
