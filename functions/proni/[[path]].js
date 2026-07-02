import { serveShell } from '../_proni-shell.js';

// GET /proni/<reference…>  -> the same app shell; the client router reads the
// path and renders the individual-record view (e.g. /proni/AA/3).
export const onRequestGet = serveShell;
