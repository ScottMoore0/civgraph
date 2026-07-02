import { serveShell } from './_proni-shell.js';

// GET /proni  -> the search app (home view)
export const onRequestGet = serveShell;
