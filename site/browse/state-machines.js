/**
 * Browse's state machines (REFACTOR-PLAN.md section 11; catalogue ids UI-01, UI-02, UI-L), as
 * tables over the shared helper (assets/ui/state/machine.js, the browser copy of
 * packages/core/src/state-machine.mjs).
 *
 * browse.js runs them; tests/unit/ui-state-machines.test.mjs walks the tables, including every
 * forbidden move, and tests/browser/ui-state-machines.spec.js drives the page.
 */
import { defineMachine, defineToggle } from '../assets/ui/state/machine.js';

/**
 * UI-01. The router: a navigation (hashchange, popstate, the first load) renders its address;
 * the render then finishes or fails. Only the latest navigation moves the machine, so a slower
 * earlier render that fails cannot end a newer one. Scroll positions are not saved while
 * `routing`.
 */
export const ROUTER = defineMachine({
  name: 'browse router',
  initial: 'idle',
  transitions: {
    idle: ['routing'],
    routing: ['routing', 'rendered', 'failed'],
    rendered: ['routing'],
    failed: ['routing'],
  },
});

/**
 * UI-02. Where the shared contributor form is: closed; in the dialog for a new map
 * (openMapSubmissionForm); or inline under the record it edits (openEditSubmissionForm,
 * showInlineEditor). Any surface can follow any other: opening one closes the other first,
 * and closing a closed surface is harmless (showInlineEditor closes the dialog whether or not
 * it was open; a second record's edit replaces the first).
 */
export const CONTRIBUTOR_FORM = defineMachine({
  name: 'browse contributor form',
  initial: 'closed',
  transitions: {
    closed: ['closed', 'map-submission', 'metadata-edit'],
    'map-submission': ['closed', 'map-submission', 'metadata-edit'],
    'metadata-edit': ['closed', 'map-submission', 'metadata-edit'],
  },
});

/**
 * UI-L. One submission of the contributor form (submitContributorForm starts one per submit):
 * sent once, answered once. The submit button is disabled exactly while it is `submitting`.
 */
/** @typedef {'idle' | 'submitting' | 'sent' | 'failed'} SubmissionState */
export const CONTRIBUTOR_SUBMISSION = defineMachine(/** @type {import('../assets/ui/state/machine.js').MachineSpec<SubmissionState>} */ ({
  name: 'browse contributor submission',
  initial: 'idle',
  transitions: {
    idle: ['submitting'],
    submitting: ['sent', 'failed'],
    sent: [],
    failed: [],
  },
}));

/** The status line's class in each submission state. */
export const SUBMISSION_STATUS_CLASS = Object.freeze({
  idle: 'contributor-form__status',
  submitting: 'contributor-form__status',
  sent: 'contributor-form__status contributor-form__status--success',
  failed: 'contributor-form__status contributor-form__status--error',
});

/** UI-L. The parties list's one-off ballot-paper labels (?labels=1). */
export const BALLOT_LABELS = defineToggle('browse ballot labels', ['hidden', 'shown']);

/**
 * UI-L. The inline contributor editor under a record (#contributorEditor, hidden in the markup):
 * shown by showInlineEditor, hidden by closeInlineEditor; its `hidden` attribute follows this.
 */
export const CONTRIBUTOR_EDITOR = defineToggle('browse inline contributor editor', ['hidden', 'shown']);

/** UI-L. Party labels as printed on historical ballot papers (kept in localStorage when it can be). */
export const PRINTED_LABELS = defineToggle('browse printed labels', ['hidden', 'shown']);

/**
 * Move a run to `next` unless it is there already: a toggle set from a value (an address, a
 * checkbox) rather than flipped.
 * @template {string} S
 * @param {import('../assets/ui/state/machine.js').Run<S>} run
 * @param {S} next
 * @returns {S}
 */
export function settle(run, next) {
  return run.state() === next ? next : run.to(next);
}
