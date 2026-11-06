/**
 * Party labels as printed, on demand.
 *
 * Results tables show the party or independent label each candidate is read as (the
 * interpreted label: "UUP" whether the paper printed "U.", "Unionist" or "Official Unionist").
 * A reader can ask for the label as printed as well: one control, "Show labels as printed",
 * adds an "As printed" column to every table that lists candidates. The choice is remembered
 * in this browser and applies to every table on every page.
 *
 * The column shows the ballot paper's description where the Electoral Office's sheet gives one
 * (modern elections), otherwise the label the cited newspaper or report printed beside the name
 * (Party_As_Printed). It is blank where nothing was printed. Ballot papers carried no party
 * descriptions before the late 1960s, so a historical label is the newspaper's or the report's,
 * not the ballot paper's.
 *
 * Browse (browse/browse.js) is not bundled and carries its own copy of the few lines below;
 * the storage key and the root attribute are the same, so one choice serves both.
 */

export const PRINTED_LABELS_STORAGE_KEY = 'civgraph.showPrintedLabels';
export const PRINTED_LABELS_ROOT_ATTRIBUTE = 'data-show-printed-labels';
export const PRINTED_LABELS_NOTE = 'Ballot papers carried no party descriptions before the late 1960s: '
  + 'a historical label is as printed in the cited newspaper or report. Modern labels are the ballot paper description.';

/** The verbatim label for a candidate: the ballot description, else the printed label, else ''. */
export function printedLabelText(candidate) {
  const ballot = String(candidate?.ballotDescription || '').trim();
  if (ballot) return ballot;
  return String(candidate?.partyAsPrinted || '').trim();
}

/** Whether the reader asked to see printed labels (false when storage is unavailable). */
export function printedLabelsShown() {
  try {
    return globalThis.localStorage?.getItem(PRINTED_LABELS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function applyPrintedLabels(shown) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (shown) root.setAttribute(PRINTED_LABELS_ROOT_ATTRIBUTE, '');
  else root.removeAttribute(PRINTED_LABELS_ROOT_ATTRIBUTE);
  for (const input of globalThis.document.querySelectorAll('input[data-printed-labels-toggle]')) {
    input.checked = shown;
  }
}

/** Remember the choice (where storage allows) and apply it to every table on the page. */
export function setPrintedLabelsShown(shown) {
  try {
    if (shown) globalThis.localStorage?.setItem(PRINTED_LABELS_STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(PRINTED_LABELS_STORAGE_KEY);
  } catch {
    // Private windows and blocked storage: the choice holds for this page only.
  }
  applyPrintedLabels(shown);
}

let initialised = false;

/**
 * Apply the remembered choice and listen for the toggles. Safe to call more than once. Tables
 * render the column always; CSS hides it unless the root carries the attribute, so a toggle
 * never re-renders a table.
 */
export function initPrintedLabels() {
  if (initialised || !globalThis.document) return;
  initialised = true;
  applyPrintedLabels(printedLabelsShown());
  globalThis.document.addEventListener('change', (event) => {
    const input = event.target;
    if (input?.matches?.('input[data-printed-labels-toggle]')) setPrintedLabelsShown(Boolean(input.checked));
  });
}

/** The control, as HTML: a labelled checkbox (keyboard reachable, Space toggles it). */
export function printedLabelsToggleHtml(escape, className = 'printed-labels-toggle') {
  const checked = printedLabelsShown() ? ' checked' : '';
  return `<label class="${escape(className)}" title="${escape(PRINTED_LABELS_NOTE)}">`
    + `<input type="checkbox" data-printed-labels-toggle${checked}> Show labels as printed</label>`;
}
