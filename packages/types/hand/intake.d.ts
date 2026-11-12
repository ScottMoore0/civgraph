// An intake batch (batch.json), as packages/intake reads it: scripts/intake/batch.schema.json in
// TypeScript, hand-written. validateBatch (packages/intake/src/batch.mjs) checks a parsed file
// against that schema at run time, so code past validation reads it as this shape; a field the
// schema adds is added here too.

/** A file a copy-files operation copies into the repository. */
export interface IntakeCopyFile {
  from: string;
  to: string;
  sha256?: string;
}

/** One FlatGeobuf an r2-fgb operation uploads: a repo-relative file and its R2 key. */
export interface IntakeFgbPair {
  file: string;
  key: string;
}

/** The fields every operation has. */
interface IntakeOperationBase {
  id: string;
  note?: string;
}

/** copy-files: files from the batch into the repository. */
export interface IntakeCopyFilesOp extends IntakeOperationBase {
  type: 'copy-files';
  sources?: string[];
  onConflict?: 'replace' | 'refuse';
  files: IntakeCopyFile[];
}

/** maps-json-patch: map entries, catalogue classes and edits into data/database/maps.json. */
export interface IntakeMapsJsonPatchOp extends IntakeOperationBase {
  type: 'maps-json-patch';
  sources?: string[];
  target?: string;
  entries?: string;
  insertAfter?: string;
  classes?: string;
  edits?: string;
}

/** election-sources: a tree of election source files into the repository. */
export interface IntakeElectionSourcesOp extends IntakeOperationBase {
  type: 'election-sources';
  sources?: string[];
  fromDir: string;
  toDir?: string;
  excludeRounds?: string;
  onConflict?: 'replace' | 'refuse';
}

/** corrections: records upserted into a corrections file, matched on the key fields. */
export interface IntakeCorrectionsOp extends IntakeOperationBase {
  type: 'corrections';
  sources?: string[];
  target: string;
  records: string;
  key: string[];
}

/** r2-fgb: FlatGeobufs to R2. */
export interface IntakeR2FgbOp extends IntakeOperationBase {
  type: 'r2-fgb';
  pairs?: IntakeFgbPair[];
  pairsFile?: string;
  chunkSize?: number;
}

/** r2-tree: files to one R2 sub-prefix. */
export interface IntakeR2TreeOp extends IntakeOperationBase {
  type: 'r2-tree';
  prefix: string;
  files?: string[];
  manifest?: string;
  dir?: string;
  force?: boolean;
  verify?: boolean;
}

/** r2-cache-control: Cache-Control on the objects under each sub-prefix. */
export interface IntakeR2CacheControlOp extends IntakeOperationBase {
  type: 'r2-cache-control';
  prefixes: string[];
  ext?: string;
}

/** r2-pmtiles: PMTiles archives to R2, then a CDN byte-range check. */
export interface IntakeR2PmtilesOp extends IntakeOperationBase {
  type: 'r2-pmtiles';
  ids?: string[];
  idsFile?: string;
  /** Not allowed here (only switch-to-cdn takes its ids from another operation). */
  idsFrom?: never;
  refreshCdnManifest?: boolean;
  verifyCdn?: boolean;
}

/** stamp-cache-tokens: content cache tokens on the catalogue's CDN URLs. */
export interface IntakeStampCacheTokensOp extends IntakeOperationBase {
  type: 'stamp-cache-tokens';
  mapIds?: string[];
}

/** switch-to-cdn: point the layers at their verified CDN copies. */
export interface IntakeSwitchToCdnOp extends IntakeOperationBase {
  type: 'switch-to-cdn';
  ids?: string[];
  idsFile?: string;
  idsFrom?: string;
}

/** thumbnails: catalogue thumbnails for new maps, then the thumbnail sync. */
export interface IntakeThumbnailsOp extends IntakeOperationBase {
  type: 'thumbnails';
  mapIds: string[];
  sync?: boolean;
}

/** command: a further step run as given. */
export interface IntakeCommandOp extends IntakeOperationBase {
  type: 'command';
  phase: 'upload' | 'post-upload';
  argv: string[];
  credentials?: boolean;
  realOnly?: boolean;
}

/** One operation of batch.json, by its `type` (the schema's `oneOf`). */
export type IntakeOperation =
  | IntakeCopyFilesOp
  | IntakeMapsJsonPatchOp
  | IntakeElectionSourcesOp
  | IntakeCorrectionsOp
  | IntakeR2FgbOp
  | IntakeR2TreeOp
  | IntakeR2CacheControlOp
  | IntakeR2PmtilesOp
  | IntakeStampCacheTokensOp
  | IntakeSwitchToCdnOp
  | IntakeThumbnailsOp
  | IntakeCommandOp;

/** An operation of one type. */
export type IntakeOperationOf<T extends IntakeOperation['type']> = Extract<IntakeOperation, { type: T }>;

/** One edit of a maps-json-patch operation's `edits` file. */
export type IntakeMapEdit =
  | { op: 'replace-text'; id: string; field: string; old: string; new: string }
  | { op: 'add-reference'; id: string; ref: { label: string; [field: string]: unknown } }
  | { op: 'set-field'; id: string; field: string; value: unknown };

/** A source a batch cites. */
export interface IntakeSource {
  id: string;
  title: string;
  publisher?: string;
  url?: string;
  licence?: string;
  rights?: 'OGL' | 'CC-BY' | 'CC-BY-SA' | 'public-domain' | 'facts-with-citation' | 'owner-permission' | 'unknown';
  citation?: string;
  accessed?: string;
  note?: string;
}

/** A check a batch expects to pass (or fail) at a step. */
export interface IntakeCheck {
  command: string;
  expect: 'pass' | 'fail';
  details?: string[];
  note?: string;
}

/** An owner's approval, recorded by the main session. */
export interface IntakeApproval {
  step: 'apply' | 'upload' | 'publish';
  date: string;
  note: string;
}

/** A parsed batch.json. */
export interface IntakeManifest {
  $schema?: string;
  schemaVersion: number;
  id: string;
  title: string;
  date: string;
  status: string;
  summary?: string;
  preparedBy?: string;
  kinds?: string[];
  personalData: { contains: boolean; handling?: string; note?: string };
  approvals?: IntakeApproval[];
  repo?: { baseCommit?: string; commits?: string[] };
  sources: IntakeSource[];
  operations: IntakeOperation[];
  expectedChecks?: { beforeUpload?: IntakeCheck[]; afterPostUpload?: IntakeCheck[] };
  notes?: string[];
}
