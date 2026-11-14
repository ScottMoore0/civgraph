/**
 * A contest source's description in words a reader knows (14 Nov 2026). The records keep each
 * citation's kind, scope and basis as codes ("article", "inline-citation"); the basis is how the
 * build found the citation and is not shown, the kind is named by the source-kinds registry (as
 * Browse names it), and the scope is said in words. A check note that says the source was only
 * partly checked, or not checked, sets the badge, so the badge and the note never disagree.
 * Pure: tests/unit/elections-app-fixes.test.mjs. The words are keyed in data/i18n/strings/elections.txt (R10).
 */
import { sourceKindLabels } from '../../../pkg/registries/src/browser/source-kind-labels.mjs';

/** Every fixed wording (keys of data/i18n/strings/elections.txt). */
export const SOURCE_WORDS = Object.freeze({
  coversContest: 'covers this contest',
  coversElection: 'covers the whole election',
  coversArticle: 'cited for the election as a whole',
  coversSection: 'cited for a group of contests that includes this one',
  checked: 'checked',
  partlyChecked: 'partly checked',
  notChecked: 'not checked',
  untitled: 'Untitled source',
});

/** Scope code -> words; a code not listed is not shown. @type {Readonly<Record<string, string>>} */
const SCOPE_WORDS = Object.freeze({
  'this contest': SOURCE_WORDS.coversContest,
  'this election': SOURCE_WORDS.coversElection,
  article: SOURCE_WORDS.coversArticle,
  'same section': SOURCE_WORDS.coversSection,
});

/**
 * @typedef {{ url?: string | null, title?: string | null, host?: string | null, kind?: string | null, scope?: string | null,
 *   check?: string | null, checked?: boolean }} SourceIn
 * @typedef {{ title: string, kind: string, scope: string, badge: 'checked' | 'partly' | 'unchecked', badgeText: string, note: string }} SourceWords
 */

/**
 * @param {SourceIn} ci
 * @returns {SourceWords}
 */
export function sourceWords(ci) {
  const rawTitle = String(ci.title || '').trim();
  let host = String(ci.host || '');
  if (!host && ci.url) { try { host = new URL(String(ci.url)).host.replace(/^www\./, ''); } catch { host = ''; } }
  // A bare address as the title (an archive's ARK, say) reads as its site.
  const title = rawTitle && !/^https?:\/\//i.test(rawTitle) ? rawTitle : host || rawTitle || SOURCE_WORDS.untitled;
  const kindId = String(ci.kind || '');
  const kind = Object.hasOwn(sourceKindLabels, kindId) ? sourceKindLabels[kindId] : '';
  const scope = Object.hasOwn(SCOPE_WORDS, String(ci.scope || '')) ? SCOPE_WORDS[String(ci.scope)] : '';
  let note = String(ci.check || '').trim();
  /** @type {SourceWords['badge']} */
  let badge = ci.checked ? 'checked' : 'unchecked';
  const partly = /^partly checked\s*[:;,.-]?\s*/i.exec(note);
  const not = /^not checked\s*[:;,.-]?\s*/i.exec(note);
  if (partly) { badge = 'partly'; note = note.slice(partly[0].length); }
  else if (not && !ci.checked) note = note.slice(not[0].length);
  const badgeText = badge === 'checked' ? SOURCE_WORDS.checked : badge === 'partly' ? SOURCE_WORDS.partlyChecked : SOURCE_WORDS.notChecked;
  return { title, kind, scope, badge, badgeText, note };
}
