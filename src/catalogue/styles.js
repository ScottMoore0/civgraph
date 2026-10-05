/**
 * Styles for the rebuilt catalogue, injected once by src/catalogue/index.js.
 *
 * Built on the site's own tokens (assets/css/main.css) so both themes follow the site, and on two
 * of the current pane's classes, reused as they are: the section bar (.catalogue-flat__sections,
 * with its green gradient) and the thumbnails with their hover preview (.catalogue-flat__toc-thumb*).
 *
 * Colour carries meaning only: a map's chip and stripe are the colour that map is drawn in, and fill
 * with it while the map is on; each shelf has its own icon colour; amber marks maps still to be
 * added. Jurisdictions are deliberately colourless.
 */
export const CATALOGUE_CSS = `
.cn { --cn-surface: var(--color-surface, #fff); --cn-raised: var(--color-surface-elevated, #f7fafc);
  --cn-text: var(--color-text, #1a202c); --cn-muted: var(--color-text-muted, #5f6b7a); --cn-line: var(--color-border, #e2e8f0);
  --cn-hover: color-mix(in srgb, var(--cn-text) 7%, transparent); --cn-press: color-mix(in srgb, var(--cn-text) 12%, transparent);
  --cn-link: #0b7a55; --cn-focus: var(--color-accent, #2563eb); --cn-grad: linear-gradient(135deg, #12a35f 0%, #0b8a6a 55%, #0a6f79 100%);
  --cn-amber-bg: #fdf1dc; --cn-amber-ink: #8a5a12; --cn-hit: #f5c84c;
  --cn-sticky: calc(var(--catalogue-sticky-shell-height, 110px) - var(--space-5, 20px));
  container-type: inline-size; font-family: var(--font-sans, system-ui, sans-serif); color: var(--cn-text);
  font-size: 14px; line-height: 1.45; padding: 0 2px 84px; }
[data-theme="dark"] .cn { --cn-link: #6ee7b7; --cn-amber-bg: rgba(234, 170, 60, .16); --cn-amber-ink: #f0c36c; --cn-hit: #c9a227; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .cn { --cn-link: #6ee7b7; --cn-amber-bg: rgba(234, 170, 60, .16); --cn-amber-ink: #f0c36c; --cn-hit: #c9a227; } }
.cn *, .cn *::before, .cn *::after { box-sizing: border-box; }
/* Zero specificity, so the current pane's own buttons reused here (book cards, search actions) keep their styles. */
:where(.cn) button { font: inherit; color: inherit; }
.cn [hidden] { display: none !important; }
.cn :focus-visible { outline: 2px solid var(--cn-focus); outline-offset: 2px; }
.cn-icon { width: 16px; height: 16px; flex: none; }
.cn-muted { color: var(--cn-muted); }
.cn-count { color: var(--cn-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.cn-label { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--cn-muted); }
.cn-link { background: none; border: 0; padding: 0; color: var(--cn-link); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.cn-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 0 7px; font-size: 11px; font-weight: 700; line-height: 18px;
  background: var(--cn-hover); color: var(--cn-muted); white-space: nowrap; }
.cn-badge--todo { background: var(--cn-amber-bg); color: var(--cn-amber-ink); }
.cn-badge--warn { background: var(--cn-amber-bg); color: var(--cn-amber-ink); }
.cn-empty { padding: 18px 8px; color: var(--cn-muted); }

/* Section bar: the current pane's, reused (.catalogue-flat__sections); counts and Tables added. */
.cn-tabs.catalogue-flat__sections { margin: 8px 0 6px; }
.cn-tab .cn-tab__count { font-weight: 500; opacity: .75; font-variant-numeric: tabular-nums; }
@container (max-width: 430px) { .cn-tab .cn-tab__count { display: none; } }

/* Filters */
.cn-toolbar { display: grid; gap: 8px; margin: 4px 0 10px; padding: 10px 12px; border: 1px solid var(--cn-line); border-radius: 12px; background: var(--cn-raised); }
.cn-filters { display: grid; gap: 9px; }
.cn-frow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; }
.cn-fgroup { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cn-frow > .cn-label { min-width: 52px; }
.cn-fgroup > .cn-label { margin-right: 2px; }
.cn-fchip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 3px 11px; border-radius: 999px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap; }
.cn-fchip:hover { background: var(--cn-hover); }
.cn-fchip[aria-pressed="true"] { background: var(--cn-grad); border-color: transparent; color: #fff; }
.cn-fchip[aria-pressed="true"] .cn-count { color: rgba(255,255,255,.85); }
.cn-filters-toggle { display: none; align-items: center; gap: 6px; justify-self: start; min-height: 30px; padding: 3px 12px; border-radius: 999px;
  border: 1px solid var(--cn-line); background: var(--cn-surface); cursor: pointer; font-weight: 600; }
.cn-filters-toggle .cn-badge { background: var(--cn-grad); color: #fff; }
/* Only a really narrow pane (a phone, a small laptop) folds the filters behind a button: at the
   desktop widths of 400-560px they stay in view. */
@container (max-width: 380px) {
  .cn-filters-toggle { display: inline-flex; }
  .cn-toolbar:not([data-open]) .cn-filters { display: none; }
  .cn-frow > .cn-label { min-width: 0; width: 100%; }
}

/* Years: two handles on one track */
.cn-years { display: grid; gap: 2px; }
.cn-years__head { display: flex; align-items: baseline; gap: 10px; }
.cn-years__out { font-weight: 600; font-variant-numeric: tabular-nums; }
.cn-years__head .cn-link { margin-left: auto; font-size: 12px; }
.cn-range { position: relative; height: 22px; }
.cn-range::before { content: ""; position: absolute; left: 9px; right: 9px; top: 10px; height: 3px; border-radius: 2px; background: var(--cn-line); }
.cn-range input { position: absolute; inset: 0; width: 100%; margin: 0; background: none; pointer-events: none; -webkit-appearance: none; appearance: none; height: 22px; }
.cn-range input::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%;
  background: var(--cn-surface); border: 2px solid #0b8a6a; box-shadow: 0 1px 3px rgba(0,0,0,.25); cursor: grab; }
.cn-range input::-moz-range-thumb { pointer-events: auto; width: 14px; height: 14px; border-radius: 50%; background: var(--cn-surface); border: 2px solid #0b8a6a; cursor: grab; }
.cn-range input::-webkit-slider-runnable-track { background: none; height: 22px; }
.cn-range input::-moz-range-track { background: none; }
.cn-range input:focus-visible { outline: none; }
.cn-range input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--cn-focus) 45%, transparent); }
.cn-range input:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--cn-focus) 45%, transparent); }

.cn-summary { margin: 0 4px 6px; color: var(--cn-muted); font-size: 13px; }

/* Shelves and subjects */
.cn-shelf { margin: 0 0 14px; scroll-margin-top: calc(var(--cn-sticky) + 62px); }
.cn-shelf__head { margin: 0; }
.cn-shelf__toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 6px 8px; border: 0; border-bottom: 2px solid var(--shelf, var(--cn-line));
  background: none; cursor: pointer; text-align: left; font-family: var(--font-display, inherit); font-size: 16px; font-weight: 800; }
.cn-shelf__icon { display: inline-flex; width: 30px; height: 30px; border-radius: 8px; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--shelf, #888) 16%, transparent); color: var(--shelf, currentColor); }
.cn-shelf__icon .cn-icon { width: 18px; height: 18px; }
.cn-shelf__name { flex: 1; }
.cn-shelf__toggle .cn-count { font-size: 13px; }
.cn-shelf__chev { transition: transform .15s ease; color: var(--cn-muted); }
.cn-shelf__toggle[aria-expanded="false"] .cn-shelf__chev { transform: rotate(-90deg); }
.cn-shelf__blurb { margin: 6px 6px 2px; color: var(--cn-muted); font-size: 13px; }
.cn-subject { scroll-margin-top: calc(var(--cn-sticky) + 62px); }
.cn-subject__head { display: flex; align-items: baseline; gap: 8px; margin: 12px 6px 4px; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--cn-muted); }
.cn-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--cn-line); border-radius: 10px; overflow: hidden; background: var(--cn-surface); }

/* A series: stripe, thumbnail, name and facts, one-click editions, actions */
.cn-row { display: grid; grid-template-columns: 4px 40px minmax(0, 1fr) auto; column-gap: 10px; align-items: start; padding: 8px 8px 8px 0;
  border-top: 1px solid var(--cn-line); scroll-margin-top: calc(var(--cn-sticky) + 66px); }
.cn-row:first-child { border-top: 0; }
.cn-row__stripe { grid-row: 1 / span 3; align-self: stretch; background: var(--c, #7a8699); opacity: .85; margin: -8px 0; }
.cn-row--on .cn-row__stripe { opacity: 1; box-shadow: 2px 0 0 var(--c, #7a8699); }
.cn-row__thumb { grid-column: 2; grid-row: 1 / span 2; }
.cn .cn-row__thumb .catalogue-flat__toc-thumbwrap, .cn .cn-erow__thumb .catalogue-flat__toc-thumbwrap { width: 40px; height: 40px; border-radius: 7px; }
.cn .cn-row__thumb .catalogue-flat__toc-thumb, .cn .cn-erow__thumb .catalogue-flat__toc-thumb { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; }
.cn .cn-row__thumb .catalogue-flat__toc-thumb--fallback, .cn .cn-erow__thumb .catalogue-flat__toc-thumb--fallback { display: block; width: 40px; height: 40px; border-radius: 7px; }
.cn-thumb-none { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 7px;
  color: var(--c, var(--cn-muted)); background: color-mix(in srgb, var(--c, #888) 14%, var(--cn-surface)); border: 1px solid var(--cn-line); }
.cn-thumb-none .cn-icon { width: 20px; height: 20px; }
.cn-row__title { grid-column: 3; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; align-items: center; text-align: left;
  border: 0; background: none; padding: 2px 4px; margin: -2px -4px; border-radius: 6px; cursor: pointer; min-height: 40px; }
.cn-row__title:hover { background: var(--cn-hover); }
.cn-row__text { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; }
.cn-row__name { font-weight: 700; font-size: 14px; line-height: 1.3; }
.cn-row__meta { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; color: var(--cn-muted); font-size: 12.5px; line-height: 1.3; }
.cn-row__dot { color: var(--cn-muted); }
.cn-row__chev { color: var(--cn-muted); transition: transform .15s ease; }
.cn-row__title--static { cursor: default; }
.cn-row__title--static:hover { background: none; }
.cn-row__title[aria-expanded="true"] .cn-row__chev { transform: rotate(180deg); }
.cn-row__end { grid-column: 4; display: flex; align-items: center; gap: 6px; }
.cn-row > .cn-chips { grid-column: 3 / span 2; margin-top: 6px; }
.cn-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); cursor: pointer; color: var(--cn-muted); }
.cn-iconbtn:hover, .cn-iconbtn[aria-expanded="true"] { background: var(--cn-hover); color: var(--cn-text); }

/* Edition chips: each adds its map; filled with the map's own colour while it is on */
.cn-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.cn-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 10px 2px 8px; border-radius: 999px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); cursor: pointer; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; max-width: 100%; }
.cn-chip:hover { border-color: var(--c, var(--cn-muted)); background: color-mix(in srgb, var(--c, #888) 10%, var(--cn-surface)); }
.cn-chip__label { overflow: hidden; text-overflow: ellipsis; }
.cn-chip__dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--c, #7a8699); box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); }
.cn-chip .cn-chip__check { display: none; width: 14px; height: 14px; }
.cn-chip[aria-pressed="true"] { background: var(--c, #2d3748); border-color: var(--c, #2d3748); color: var(--on, #fff); }
.cn-chip[aria-pressed="true"] .cn-chip__dot { display: none; }
.cn-chip[aria-pressed="true"] .cn-chip__check { display: block; }
.cn-chip__more { font-size: 11px; font-weight: 700; opacity: .75; }
.cn-chip--hit { box-shadow: 0 0 0 2px var(--cn-hit); }
.cn-chip--out:not([aria-pressed="true"]) { opacity: .45; }
.cn-chip--more { padding: 2px 10px; color: var(--cn-muted); border-style: dashed; }
.cn-chip--todo { cursor: default; border-style: dashed; color: var(--cn-amber-ink); background: var(--cn-amber-bg); border-color: transparent; }
.cn-chip--todo .cn-chip__dot { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
.cn-chip--todo:hover { background: var(--cn-amber-bg); border-color: transparent; }
.cn-chip--todo-toggle { color: var(--cn-amber-ink); border-style: dashed; border-color: color-mix(in srgb, var(--cn-amber-ink) 55%, transparent); background: none; }
.cn-chip--todo-toggle:hover { background: var(--cn-amber-bg); border-color: var(--cn-amber-ink); }
.cn-chip--todo-toggle .cn-icon { width: 14px; height: 14px; }
.cn-chip--todo-toggle[aria-pressed="true"] { background: var(--cn-amber-bg); color: var(--cn-amber-ink); border-color: transparent; }
.cn-chips[role="group"] .cn-chip[aria-busy="true"] { opacity: .6; }

/* One-click add for a single map */
.cn-add { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 3px 12px 3px 9px; border-radius: 999px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); cursor: pointer; font-weight: 700; font-size: 13px; white-space: nowrap; }
.cn-add:hover { border-color: var(--c, var(--cn-muted)); background: color-mix(in srgb, var(--c, #888) 10%, var(--cn-surface)); }
.cn-add .cn-when-on, .cn-btn .cn-when-on { display: none; }
.cn-add[aria-pressed="true"], .cn-btn--primary[aria-pressed="true"] { background: var(--c, #2d3748); border-color: var(--c, #2d3748); color: var(--on, #fff); }
.cn-add[aria-pressed="true"] .cn-when-off, .cn-btn[aria-pressed="true"] .cn-when-off { display: none; }
.cn-add[aria-pressed="true"] .cn-when-on, .cn-btn[aria-pressed="true"] .cn-when-on { display: inline-flex; }

/* The opened row */
.cn-panel { grid-column: 2 / span 3; margin-top: 10px; padding: 12px; border: 1px solid var(--cn-line); border-radius: 10px; background: var(--cn-raised); display: grid; gap: 12px; }
.cn-ed { display: grid; gap: 8px; }
.cn-ed__title { margin: 0; font-size: 15px; font-weight: 800; }
.cn-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 12px; margin: 0; font-size: 13px; }
.cn-facts dt { color: var(--cn-muted); }
.cn-facts dd { margin: 0; overflow-wrap: anywhere; }
.cn-desc { margin: 0; font-size: 13px; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.cn-desc[data-open] { display: block; }
.cn-sub { display: grid; gap: 6px; }
.cn-ed > .cn-link { justify-self: start; }
.cn-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.cn-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 11px; border-radius: 8px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); cursor: pointer; font-weight: 600; font-size: 13px; white-space: nowrap; }
.cn-btn:hover, .cn-btn[aria-expanded="true"] { background: var(--cn-hover); }
.cn-btn--primary { background: var(--cn-grad); border-color: transparent; color: #fff; }
.cn-btn--primary:hover { filter: brightness(1.06); background: var(--cn-grad); }
.cn-mlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.cn-mlist__item { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 4px; border-radius: 6px; }
.cn-mlist__item--version { padding-left: 22px; }
.cn-mlist__name { flex: 1; min-width: 0; text-align: left; border: 0; background: none; cursor: pointer; padding: 4px 6px; border-radius: 6px; overflow-wrap: anywhere; }
.cn-mlist__name:hover { background: var(--cn-hover); }
.cn-mlist__name[aria-current="true"] { font-weight: 800; box-shadow: inset 3px 0 0 var(--c, var(--cn-text)); }

/* Timeline of editions, spaced by date */
.cn-tl { overflow-x: auto; padding: 4px 2px 0; }
.cn-tl__track { position: relative; height: 46px; margin: 0 14px; }
.cn-tl__axis { position: absolute; left: -8px; right: -8px; top: 13px; height: 2px; background: var(--cn-line); }
.cn .cn-tick { position: absolute; top: 4px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: none; padding: 0 2px; cursor: pointer; }
.cn-tick__dot { width: 16px; height: 16px; border-radius: 50%; background: var(--cn-surface); border: 3px solid var(--c, #7a8699); }
.cn-tick--on .cn-tick__dot { background: var(--c, #7a8699); }
.cn-tick[aria-pressed="true"] .cn-tick__dot { box-shadow: 0 0 0 3px var(--cn-surface), 0 0 0 5px var(--cn-text); }
.cn-tick__label { font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--cn-muted); white-space: nowrap; }
.cn-tick[aria-pressed="true"] .cn-tick__label { color: var(--cn-text); font-weight: 800; }
.cn-tl__ends { display: flex; justify-content: space-between; font-size: 11px; color: var(--cn-muted); margin: 0 6px; }

/* Things still to be added under a subject */
.cn-todo { margin: 6px 6px 0; font-size: 13px; }
.cn-todo summary { cursor: pointer; color: var(--cn-amber-ink); font-weight: 600; width: fit-content; }
.cn-todo ul { margin: 6px 0 0; padding: 0 0 0 4px; list-style: none; display: grid; gap: 4px; }

/* Search: places and people above the maps */
.cn-block { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--cn-line); border-radius: 12px; background: var(--cn-surface); }
.cn-block__head { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 14px; font-weight: 800; }
.cn-block__head .cn-icon { color: #0b8a6a; }
.cn-places, .cn-people, .cn-place__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.cn-place summary { display: flex; align-items: center; gap: 10px; min-height: 40px; cursor: pointer; list-style: none; padding: 2px 4px; border-radius: 8px; }
.cn-place summary::-webkit-details-marker { display: none; }
.cn-place summary:hover { background: var(--cn-hover); }
.cn-place__name { font-weight: 700; }
.cn-place__chev { margin-left: auto; color: var(--cn-muted); transition: transform .15s ease; }
.cn-place details[open] .cn-place__chev { transform: rotate(180deg); }
.cn-place__thumb { display: inline-flex; width: 34px; height: 34px; flex: none; border-radius: 6px; overflow: hidden; background: #eef2f6; align-items: center; justify-content: center; }
.cn-place__thumb img, .cn-place__thumb svg { width: 100%; height: 100%; object-fit: contain; }
.cn-place__list { padding: 4px 0 6px 12px; }
.cn-place__item { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.cn-place__map { flex: 1; min-width: 0; text-align: left; overflow-wrap: anywhere; }
.cn-place__item .catalogue-search__action-strip { display: flex; gap: 4px; flex: none; }
.cn-person { display: flex; align-items: center; gap: 8px; min-height: 32px; flex-wrap: wrap; }
.cn-person .cn-icon { color: var(--cn-muted); }
.cn-person__name { font-weight: 700; }
.cn-person--row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 4px 0; flex-wrap: nowrap; }
.cn-person__main { display: flex; flex-direction: column; min-width: 0; }
.cn-person__main .cn-muted { font-size: 12.5px; }
.cn-btn--small { min-height: 28px; padding: 2px 9px; font-size: 12.5px; gap: 5px; }
.cn-btn--small .cn-icon { width: 14px; height: 14px; }
.cn-person-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0 0 10px; padding: 10px 12px; border-radius: 12px;
  border: 1px solid var(--cn-line); background: color-mix(in srgb, #0b8a6a 10%, var(--cn-surface)); }
.cn-person-banner > .cn-icon { color: #0b8a6a; }
.cn-person-banner > span { flex: 1; min-width: 12em; }
.cn-person-banner a { color: var(--cn-link); }
.cn-person-note { color: var(--cn-text); }

/* Elections */
.cn-decade { margin: 0 0 12px; scroll-margin-top: calc(var(--cn-sticky) + 62px); }
.cn-decade__head { display: flex; align-items: baseline; gap: 8px; margin: 8px 6px 6px; font-family: var(--font-display, inherit); font-size: 16px; font-weight: 800; }
.cn-erow { display: grid; grid-template-columns: 40px 92px minmax(0, 1fr) auto; column-gap: 10px; align-items: center; padding: 7px 8px; border-top: 1px solid var(--cn-line); }
.cn-erow:first-child { border-top: 0; }
.cn-erow--on { box-shadow: inset 4px 0 0 #0b8a6a; }
.cn-erow__date { font-size: 12.5px; color: var(--cn-muted); font-variant-numeric: tabular-nums; }
.cn-erow__title { font-weight: 700; line-height: 1.3; }
.cn-erow__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 2px; color: var(--cn-muted); font-size: 12.5px; }
.cn-erow .cn-add[aria-pressed="true"] { background: var(--cn-grad); border-color: transparent; color: #fff; }
.cn-erow__end { display: flex; align-items: center; gap: 6px; }
a.cn-iconbtn { text-decoration: none; }
@container (max-width: 470px) {
  .cn-erow { grid-template-columns: 40px minmax(0, 1fr) auto; }
  .cn-erow__date { grid-column: 2; grid-row: 1; }
  .cn-erow__main { grid-column: 2; grid-row: 2; }
  .cn-erow__thumb { grid-row: 1 / span 2; }
  .cn-erow > .cn-erow__end { grid-column: 3; grid-row: 1 / span 2; }
}

/* Books: the current pane's book cards, under icon headings */
.cn-bookcat { margin: 0 0 16px; scroll-margin-top: calc(var(--cn-sticky) + 62px); }
.cn-bookcat .category-section__header { padding: 4px 6px; }
.cn-bookcat .category-section__header .cn-count { margin-left: auto; }
.cn .book-card .btn { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 11px; border-radius: 8px; border: 1px solid var(--cn-line);
  background: var(--cn-surface); color: var(--cn-text); font: 600 13px/1.2 var(--font-sans, system-ui, sans-serif); text-decoration: none; cursor: pointer; }
.cn .book-card .btn:hover { background: var(--cn-hover); }
.cn .book-card .btn--primary { background: var(--cn-grad); border-color: transparent; color: #fff; }
.cn .book-card .btn--primary:hover { filter: brightness(1.06); background: var(--cn-grad); }
.cn .book-card .btn svg { width: 14px; height: 14px; }
.cn .book-card__meta, .cn .book-card__author, .cn .book-card__date { color: var(--cn-muted); }
.cn .book-card__actions { display: flex; flex-wrap: wrap; gap: 6px; }

/* What's here, picking, compare */
.cn-pick { position: sticky; top: calc(var(--cn-sticky) + 52px); z-index: 7; display: flex; align-items: center; gap: 10px; margin: 0 0 8px;
  padding: 8px 12px; border-radius: 10px; background: var(--cn-grad); color: #fff; font-weight: 600; }
.cn-pick .cn-btn { margin-left: auto; color: var(--cn-text); }
.cn-here__head { display: flex; align-items: center; gap: 8px; margin: 4px 4px 8px; }
.cn-here__head h3 { margin: 0; font-size: 16px; font-weight: 800; flex: 1; }
.cn-compare { position: sticky; bottom: 8px; z-index: 7; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 10px; align-items: center;
  margin-top: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--cn-line); background: var(--cn-surface); box-shadow: 0 6px 22px rgba(0,0,0,.18); }
.cn-compare__labels { display: flex; justify-content: space-between; font-size: 12px; color: var(--cn-muted); gap: 8px; }
.cn-compare input[type="range"] { width: 100%; accent-color: #0b8a6a; }

/* Narrow panes */
@container (max-width: 520px) {
  .cn-row { grid-template-columns: 4px 36px minmax(0, 1fr) auto; column-gap: 8px; }
  .cn .cn-row__thumb .catalogue-flat__toc-thumbwrap { width: 36px; height: 36px; }
  .cn-row > .cn-chips { grid-column: 2 / span 3; }
  .cn-panel { grid-column: 1 / span 4; margin-left: 4px; }
}
/* Larger targets for fingers, whatever the width. */
@media (pointer: coarse) {
  .cn-chip, .cn-add, .cn-btn, .cn-fchip { min-height: 36px; }
  .cn-iconbtn { width: 38px; height: 38px; }
}

/* The menu lives on <body>, outside .cn, so it names the site's tokens directly. */
.cn-menu { min-width: 220px; max-width: min(360px, calc(100vw - 16px)); padding: 6px; border-radius: 10px; border: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff); color: var(--color-text, #1a202c); box-shadow: 0 12px 32px rgba(0,0,0,.22); z-index: 10000;
  font-family: var(--font-sans, system-ui, sans-serif); font-size: 13.5px; }
.cn-menu__item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 6px 10px; border: 0; border-radius: 7px; background: none;
  color: inherit; text-align: left; text-decoration: none; cursor: pointer; font: inherit; }
.cn-menu__item:hover, .cn-menu__item:focus-visible { background: color-mix(in srgb, var(--color-text, #1a202c) 8%, transparent); outline: none; }
.cn-menu__icon { width: 16px; height: 16px; flex: none; color: var(--color-text-muted, #5f6b7a); }
.cn-menu__heading { padding: 8px 10px 4px; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-muted, #5f6b7a); }
.cn-menu__sep { height: 1px; margin: 5px 4px; background: var(--color-border, #e2e8f0); }

/* Contents: a button left of the search box (the row gains a column for it) and a panel from the
   right of the pane, over a dimmed pane. Outside .cn, so it names the site's tokens directly. */
.catalogue-sticky-shell.cn-shell--contents { grid-template-columns: auto minmax(0, 1fr) auto; }
.catalogue-sticky-shell .cn-contents-nav { justify-self: start; }
.cn-drawer { position: fixed; z-index: 9000; overflow: hidden; font-family: var(--font-sans, system-ui, sans-serif); color: var(--color-text, #1a202c); }
.cn-drawer__scrim { position: absolute; inset: 0; background: rgba(10, 14, 20, .5); opacity: 0; transition: opacity .2s ease; }
.cn-drawer__panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(340px, 86%); display: flex; flex-direction: column;
  background: var(--color-surface, #fff); border-left: 1px solid var(--color-border, #e2e8f0); box-shadow: -12px 0 32px rgba(0, 0, 0, .25);
  transform: translateX(100%); transition: transform .2s ease; }
.cn-drawer--open .cn-drawer__scrim { opacity: 1; }
.cn-drawer--open .cn-drawer__panel { transform: none; }
@media (prefers-reduced-motion: reduce) { .cn-drawer__scrim, .cn-drawer__panel { transition: none; } }
.cn-drawer__head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px 16px; border-bottom: 1px solid var(--color-border, #e2e8f0); }
.cn-drawer__title { flex: 1; margin: 0; font-family: var(--font-display, inherit); font-size: 16px; font-weight: 800; }
.cn-drawer .cn-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px;
  border: 1px solid var(--color-border, #e2e8f0); background: var(--color-surface, #fff); color: inherit; cursor: pointer; }
.cn-drawer .cn-iconbtn .cn-icon { width: 16px; height: 16px; }
.cn-toc { list-style: none; margin: 0; padding: 8px; overflow-y: auto; flex: 1; }
.cn-toc__item--l1:not(:first-child) { margin-top: 6px; }
.cn-toc__link { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 5px 10px; border: 0; border-radius: 8px;
  background: none; color: inherit; text-align: left; cursor: pointer; font: inherit; font-size: 13.5px; }
.cn-toc__item--l1 > .cn-toc__link { font-weight: 800; font-size: 14px; }
.cn-toc__item--l2 > .cn-toc__link { padding-left: 44px; }
.cn-toc__link:hover, .cn-toc__link:focus-visible { background: color-mix(in srgb, var(--color-text, #1a202c) 8%, transparent); outline: none; }
.cn-toc__link[aria-current="true"] { box-shadow: inset 3px 0 0 #0b8a6a; background: color-mix(in srgb, #0b8a6a 12%, transparent); }
.cn-toc__icon { display: inline-flex; width: 26px; height: 26px; border-radius: 7px; align-items: center; justify-content: center; flex: none;
  color: var(--shelf, currentColor); background: color-mix(in srgb, var(--shelf, #888) 16%, transparent); }
.cn-toc__icon .cn-icon { width: 16px; height: 16px; }
.cn-toc__label { flex: 1; min-width: 0; }
.cn-toc .cn-count { color: var(--color-text-muted, #5f6b7a); font-weight: 500; font-variant-numeric: tabular-nums; }
`;
