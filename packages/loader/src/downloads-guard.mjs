/**
 * Which bulk-download files an upload may write (owner decision PG15, 13 Nov 2026): every
 * snapshot version stays online, and an upload never overwrites a published version with
 * different content. Pure, so scripts/publish/r2-upload-downloads.mjs and its tests share it.
 *
 * A snapshot's VERSIONED files carry its version in their names and never change once published:
 *   civgraph-records-<version>.sqlite.gz   the records database (export-formats.mjs)
 *   manifest-<version>.json                that snapshot's manifest, kept beside it
 * Everything else MOVES to the newest snapshot on each upload: civgraph-records-latest.sqlite.gz,
 * the graph exports and manifest.json.
 *
 * A versioned file already on R2 is left alone when its content is known to be the same: from the
 * sha256 metadata this upload writes, or, for files published before it did, from the published
 * manifest.json's checksum for that name and size. If its content differs, or cannot be known,
 * the whole upload is refused before anything is written.
 */

/** Where the downloads are published on R2 (served at https://data.civgraph.net/data/downloads/). */
export const DOWNLOADS_PREFIX = 'data/downloads';

/**
 * @typedef {{ name: string, bytes: number, sha256: string }} DownloadFile  a manifest entry
 * @typedef {{ version?: unknown, files?: DownloadFile[] }} DownloadManifest
 * @typedef {{ bytes: number | null, sha256: string | null }} RemoteFile  what a HEAD says of an object on R2
 * @typedef {{ name: string, reason: string }} Refusal
 * @typedef {{ version: string, upload: string[], keep: string[], refuse: Refusal[] }} UploadPlan
 */

/**
 * The name a snapshot's own copy of its manifest is published under.
 * @param {string} version
 */
export function versionedManifestName(version) {
  return `manifest-${version}.json`;
}

/**
 * Whether a download's name is one of a snapshot's versioned files.
 * @param {string} name
 * @param {string} version
 */
export function isVersionedName(name, version) {
  return name.includes(`-${version}.`);
}

/** A usable snapshot version: what the dataset table gave, never the 'unversioned' fallback. */
const VERSION = /^[0-9a-z][0-9a-z.-]{3,63}$/;

/**
 * Plan an upload of the local downloads.
 * @param {DownloadManifest} manifest  the local manifest.json (records:downloads wrote it)
 * @param {Map<string, RemoteFile | null>} remote  each versioned name -> its object on R2, or null if absent
 * @param {DownloadManifest | null} published  the manifest.json on R2 now, if any
 * @param {{ bytes: number, sha256: string }} manifestFile  the local manifest.json's size and checksum,
 *   which its versioned copy (manifest-<version>.json) is published with
 * @returns {UploadPlan}  `upload` in the order to write: the versioned database, the moving files,
 *   the snapshot's manifest, and manifest.json last, so it never names a file not yet there
 */
export function planDownloadsUpload(manifest, remote, published, manifestFile) {
  const version = typeof manifest.version === 'string' ? manifest.version : '';
  /** @type {Refusal[]} */
  const refuse = [];
  if (!VERSION.test(version) || version === 'unversioned') {
    return { version, upload: [], keep: [], refuse: [{ name: 'manifest.json', reason: `no usable snapshot version (${JSON.stringify(manifest.version)})` }] };
  }
  const snapshotManifest = versionedManifestName(version);
  const files = [...(Array.isArray(manifest.files) ? manifest.files : []), { name: snapshotManifest, ...manifestFile }];
  const publishedSha = new Map((published?.files || []).map((f) => [f.name, f]));
  /** @type {string[]} */
  const keep = [];
  /** @type {string[]} */
  const versioned = [];
  /** @type {string[]} */
  const moving = [];
  for (const file of files) {
    if (!isVersionedName(file.name, version)) { moving.push(file.name); continue; }
    const there = remote.get(file.name);
    if (!there) { versioned.push(file.name); continue; }
    const listed = publishedSha.get(file.name);
    const known = there.sha256 || (listed && listed.bytes === there.bytes ? listed.sha256 : null);
    if (there.bytes !== null && there.bytes !== file.bytes) {
      refuse.push({ name: file.name, reason: `already published with ${there.bytes} bytes; this one has ${file.bytes}` });
    } else if (!known) {
      refuse.push({ name: file.name, reason: 'already published, and its checksum cannot be confirmed' });
    } else if (known !== file.sha256) {
      refuse.push({ name: file.name, reason: `already published with SHA-256 ${known}; this one is ${file.sha256}` });
    } else {
      keep.push(file.name);
    }
  }
  // The snapshot's manifest goes after every file it names; manifest.json last of all.
  const first = versioned.filter((name) => name !== snapshotManifest);
  const tail = versioned.includes(snapshotManifest) ? [snapshotManifest] : [];
  return { version, upload: refuse.length ? [] : [...first, ...moving, ...tail, 'manifest.json'], keep, refuse };
}
