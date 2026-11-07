/**
 * Words in parliament's state machines (REFACTOR-PLAN.md section 11; state-machine catalogue
 * UI-L "words tip.hidden"), on the shared helper assets/ui/state/machine.js.
 *
 * Pure tables: words.js starts one run per chart and moves it at the call sites.
 */
import { defineToggle } from '../../assets/ui/state/machine.js';

/** A chart's year tooltip: hidden until a pointer or arrow key picks a year, hidden when the pointer leaves. */
export const TOOLTIP = defineToggle('words chart tooltip', ['hidden', 'shown']);
