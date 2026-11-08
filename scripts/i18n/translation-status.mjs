// @ts-check
/**
 * The `_status` of a built translation file, as an explicit machine (state-machine catalogue PL-05).
 *
 *   source     en.json: the English every key falls back to. Fixed.
 *   generated  machine-written indexes (place-name-fields.json). Fixed.
 *   draft      a language file nobody fluent has reviewed.
 *   reviewed   a language file a named reviewer has checked (META.<lang>.reviewedBy in
 *              build-i18n.mjs, the route data/i18n/README.md documents).
 *
 *   draft <-> reviewed   naming the reviewer marks it reviewed; removing the name marks it draft
 *
 * build-i18n.mjs used to write `draft` for every language unconditionally, so `reviewed` could
 * never be recorded and a rebuild would have reset it. It now asks `languageFileStatus`. With no
 * reviewer named (today, for Irish and Ulster-Scots) the output is unchanged.
 */
import { defineMachine } from '../../packages/core/src/state-machine.mjs';
import { checkTransition, defineGuards } from '../publish/transition-check.mjs';

/** @typedef {'source' | 'generated' | 'draft' | 'reviewed'} TranslationStatus */

export const translationStatus = defineMachine(/** @type {import('../../packages/core/src/state-machine.mjs').MachineSpec<TranslationStatus>} */ ({
  name: 'translation file status',
  initial: 'draft',
  transitions: { source: [], generated: [], draft: ['reviewed'], reviewed: ['draft'] },
}));

export const translationStatusGuards = defineGuards(translationStatus, {
  'draft->reviewed': (/** @type {{ reviewedBy?: string | null }} */ ctx) => (
    String(ctx.reviewedBy ?? '').trim() ? null : 'no reviewer is named (META.<lang>.reviewedBy)'
  ),
});

/** @param {string} from @param {string} to @param {object} [context] */
export const checkTranslationStatus = (from, to, context) => checkTransition(translationStatus, translationStatusGuards, from, to, context);

/**
 * The status a language file is built with: `reviewed` once a reviewer is named, else `draft`.
 * @param {{ reviewedBy?: string | null }} meta
 * @returns {TranslationStatus}
 */
export function languageFileStatus(meta) {
  return checkTranslationStatus('draft', 'reviewed', meta).ok ? 'reviewed' : 'draft';
}
