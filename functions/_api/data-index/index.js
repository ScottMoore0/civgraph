/**
 * Public index of the published data, scoped to the R2 publication allowlist.
 *
 * WHAT THIS IS FOR
 *
 * R2 public buckets cannot list, so until now the only way to get a file from
 * data.civgraph.net was to already know its key. For an open-data project that is a poor
 * bargain: it means "you can have this if you can guess its name" rather than "here is
 * everything we hold". This makes the published corpus browsable.
 *
 * THE SCOPE IS THE ALLOWLIST, NOT THE BUCKET
 *
 * Listing is restricted to the prefixes compiled into functions/_api/_public-prefixes.js,
 * generated from data/database/r2-publication-allowlist.json. That is deliberate and it is
 * the whole safety property. Six prefixes are readable on the public bucket today that
 * never passed the allowlist -- data/deprivation/, data/nisra-files/, data/nisra-portal/,
 * data/pointclouds/, data/polling/, data/thumbnails/ -- and advertising them is a decision
 * nobody has taken. Scoping to the allowlist means anything unreviewed is invisible here by
 * construction rather than by anyone remembering to exclude it.
 *
 * Note the asymmetry this creates and does not resolve: those six prefixes remain
 * READABLE by key. Not listing them is not the same as not publishing them. The fix for
 * that is to reconcile the allowlist with the bucket, not to change this file.
 *
 * ABUSE. list is a Class A R2 operation, so an unattended crawler costs real money. Every
 * response is cacheable for five minutes, which collapses a crawl into a handful of
 * origin calls while staying fresh enough for a data index.
 *
 *   GET /_api/data-index                  the approved prefixes
 *   GET /_api/data-index?prefix=data/maps/townlands/
 *   GET /_api/data-index?prefix=data/books/&cursor=...&limit=500
 */
import { jsonResponse, jsonNotAllowed } from '../_auth.js';
import { listLevel, normalisePrefix, parseLimit, publicUrl } from '../_r2-listing.js';
import { PUBLIC_PREFIXES, isListablePrefix, isPublicPrefix } from '../_public-prefixes.js';

const CACHE = 'public, max-age=300, stale-while-revalidate=600';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return jsonNotAllowed(context.request.method);

  const bucket = context.env.MAPS_BUCKET;
  if (!bucket) {
    return jsonResponse({ ok: false, error: 'R2 binding MAPS_BUCKET is not configured.' }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const prefix = normalisePrefix(url.searchParams.get('prefix'));
  if (prefix === null) {
    return jsonResponse({ ok: false, error: 'Invalid prefix.' }, { status: 400 });
  }

  // Root: hand back the approved prefixes rather than listing the bucket. Listing "" with a
  // delimiter would reveal every top-level prefix including the unreviewed ones.
  if (!prefix) {
    return jsonResponse({
      ok: true,
      scope: 'published',
      prefix: '',
      folders: PUBLIC_PREFIXES.map((value) => ({
        prefix: value,
        name: value.replace(/\/$/, ''),
      })),
      files: [],
      truncated: false,
      cursor: null,
      note: 'Only prefixes approved for publication are listed. Files are served from '
        + 'https://data.civgraph.net/',
    }, { headers: { 'Cache-Control': CACHE } });
  }

  if (!isListablePrefix(prefix)) {
    // 404 rather than 403: a prefix outside the allowlist should not be confirmed to exist.
    return jsonResponse({
      ok: false,
      error: 'Not found.',
      hint: 'Only prefixes approved for publication can be listed. GET /_api/data-index for the list.',
    }, { status: 404, headers: { 'Cache-Control': CACHE } });
  }

  let listing;
  try {
    listing = await listLevel(bucket, {
      prefix,
      cursor: url.searchParams.get('cursor') || undefined,
      limit: parseLimit(url.searchParams.get('limit')),
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: `Listing failed: ${error.message}` }, { status: 502 });
  }

  // A prefix may be a PARENT of an approved one (asking for "data/" when only "data/maps/"
  // is approved). Listing it is allowed so navigation works, but the children are filtered
  // to what is approved.
  const folders = listing.folders.filter((folder) => isListablePrefix(folder.prefix));
  const files = listing.files
    .filter((file) => isPublicPrefix(file.key))
    .map((file) => ({ ...file, url: publicUrl(file.key) }));

  return jsonResponse({
    ok: true,
    scope: 'published',
    prefix: listing.prefix,
    folders,
    files,
    truncated: listing.truncated,
    cursor: listing.cursor,
  }, { headers: { 'Cache-Control': CACHE } });
}
