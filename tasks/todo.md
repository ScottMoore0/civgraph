Election party aliases and party IDs
- [x] Correct PUP aliasing to Progressive Unionist Party in the audit logic
- [x] Normalise Workers Party / Republican Clubs by date, DUP, PBP, and Alliance labels
- [x] Define stable Party IDs grouping aliases such as Ecology/Green and Republican Clubs/Workers Party
- [x] Rerun audit and provide the next 10 party/ticket names
  - What I changed:
    - Added an Ireland/NI audit alias so `PUP` resolves to `Progressive Unionist Party`, not the unrelated global abbreviation match.
    - Extended `scripts/normalize-election-party-names.py` for `DUP`, `PBP`, `Alliance`, and date-sensitive `Workers Party`/`Republican Clubs` labels.
    - The date rule treats exact-1977 `Workers Party / Republican Clubs` labels as `Republican Clubs`; post-1977 rows are `Workers Party`.
    - Added `scripts/build-election-party-ids.py` and generated `election-viewer-package/data/party-ids.json` plus `tasks/ireland_election_party_ids.csv`.
    - Updated bundle/aggregate composite keys so stale names are not left in generated election data.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\audit-ireland-election-party-colours.py scripts\build-election-party-ids.py`
    - `python scripts\normalize-election-party-names.py`
    - `python scripts\build-election-party-ids.py` wrote `850` party IDs and `1089` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1173` audit rows: `71` match, `142` colour mismatch, `910` no election colour, `50` no Wikipedia match.
    - `rg` found no remaining `Workers Party / Republican Clubs`, `Democratic Unionist Party`, `People Before Profit Alliance`, `People Before Profit`, `Alliance Party of Northern Ireland`, `Alliance Party`, or `Green / Ecology` strings under `election-viewer-package/data/elections`.
    - Parsed `7344` election JSON files successfully.

Election party aliases follow-up: DUP punctuation and Conservative plural
- [x] Normalise `D.U.P.` to `DUP`
- [x] Normalise `Democratic Unionist - DUP` to `DUP`
- [x] Normalise `Conservatives` to `Conservative`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for exact `D.U.P.`, `Democratic Unionist - DUP`, and `Conservatives` labels.
    - Added cleanup for generated DUP duplicates such as `DUP DUP`, `DUP-DUP`, `DUP - DUP`, and `DUP (DUP)`.
    - Preserved distinct `U.D.U.P.` labels instead of folding them into `DUP`.
    - Added `Conservatives` as an alias of `party:conservative` in the Party ID registry.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `827` party IDs and `1042` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1124` audit rows after duplicate labels collapsed.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `D.U.P.`, `Democratic Unionist - DUP`, or `Conservatives`.

Election party aliases follow-up: Workers, Nationalist, and A.P.
- [x] Normalise `Workers' Party (Ireland)`, `Workers Party`, and `Workers'` to `Workers' Party`
- [x] Resolve `Nationalist Party` to `Nationalist Party (Northern Ireland)` in the colour audit
- [x] Normalise `A.P.` to `Alliance`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `Workers' Party (Ireland)`, `Workers Party`, `Workers'`, and related `Workers Party Rep. C` variants.
    - Normalised `A.P.` and `A.P..` to `Alliance`.
    - Added an audit alias so `Nationalist Party` resolves to `Nationalist Party (Northern Ireland)`.
    - Updated Party ID aliases so Workers and Alliance aliases remain grouped under stable IDs.
  - Verification:
    - `python scripts\normalize-election-party-names.py` completed the final pass with the related Workers variants collapsed.
    - `python scripts\build-election-party-ids.py` wrote `821` party IDs and `1037` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1117` audit rows: `71` match, `141` colour mismatch, `855` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `Workers' Party (Ireland)`, `Workers Party`, `Workers'`, or `A.P.`.
    - `Nationalist Party` now matches `Nationalist Party (Northern Ireland)` with `#32CD32`, producing a colour match.

Election party aliases follow-up: NI Women's Coalition
- [x] Normalise all Northern Ireland Women's Coalition variants to `NI Women's Coalition`
- [x] Resolve `NI Women's Coalition` to the Wikipedia Northern Ireland Women's Coalition colour entry
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Normalised `Northern Ireland Women's Coalition`, `N.I. Women's Coalition`, `N.I. Womens Coalition`, `N I Women's Coalition`, `N.Ireland Women's Coalition`, `Northern Ireland Women's Coalition - NIWC`, `Northern Ireland Womens Coalition`, `NR. Ireland Women's Coalition`, and `Womens Coalition` to `NI Women's Coalition`.
    - Added `NI Women's Coalition` to the runtime fallback colour map with `#00FFFF`.
    - Added Party ID aliases for the old variants under `party:ni-womens-coalition`.
    - Added audit aliases so `NI Women's Coalition` resolves to Wikipedia's `Northern Ireland Women's Coalition` entry.
  - Verification:
    - `python scripts\normalize-election-party-names.py`
    - `python scripts\build-election-party-ids.py` wrote `812` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1107` audit rows: `71` match, `141` colour mismatch, `845` no election colour, `50` no Wikipedia match.
    - `node --check election-viewer-package\js\stages2.js`
    - A targeted scan found no old Women's Coalition variant values and `156` `NI Women's Coalition` values.
    - Audit rows for `NI Women's Coalition`: `109` explicit `#00FFFF` matches, `21` runtime fallback `#00FFFF` matches, and `26` no-colour source rows that still resolve to the correct Wikipedia party.

Election party aliases follow-up: Official Unionist and Independent abbreviations
- [x] Normalise `O. Un.` to `UUP`
- [x] Normalise `Off. Un.` to `UUP`
- [x] Normalise `Indp.` to `Independent`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `O. Un.`, `Off. Un.`, and `Indp.`.
    - Added Party ID aliases so the old labels remain grouped under `party:uup` and `party:independent`.
    - The substring pass also expanded `Indp.` inside longer labels to `Independent ...` without assigning those longer descriptors to a new party.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `810` party IDs and `1037` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1103` audit rows: `71` match, `141` colour mismatch, `841` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `O. Un.`, `Off. Un.`, or `Indp.`.

Election party aliases follow-up: O.Un., Irish Unionist, Non Party, and Comhar
- [x] Normalise `O.Un.` to `UUP`
- [x] Normalise `Irish Unionist` to `Irish Unionist Alliance`
- [x] Normalise `Non Party` to `Independent`
- [x] Normalise `Comhar Criostai/Christian Solidarity` to `Comhar Criostai / Christian Solidarity`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `O.Un.`, `Irish Unionist`, `Non Party`, and `Comhar Criostai/Christian Solidarity`.
    - Added Party ID aliases for the old labels under `party:uup`, `party:irish-unionist-alliance`, `party:independent`, and `party:comhar-criostai-christian-solidarity`.
    - Fixed the Irish Unionist rule to be idempotent after verification caught `Irish Unionist Alliance Alliance` on rerun.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `811` party IDs and `1039` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1101` audit rows: `71` match, `141` colour mismatch, `839` no election colour, `50` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `O.Un.`, `Irish Unionist`, `Irish Unionist Alliance Alliance`, `Non Party`, or `Comhar Criostai/Christian Solidarity`.

Election party aliases follow-up: United UUP, A.P, Indp, DU UUUC, and Renua Ireland
- [x] Normalise `United UUP` to `UUUP`
- [x] Normalise `A.P` to `Alliance Party`
- [x] Normalise `Indp` to `Independent`
- [x] Normalise `DU UUUC` to `DUP`
- [x] Normalise `Renua Ireland` to `Renua`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for `United UUP`, `A.P`, `Indp`, `DU UUUC`, and `Renua Ireland`.
    - Kept `A.P` literal as `Alliance Party` by removing the previous `Alliance Party` to `Alliance` normalizer pass.
    - Added Party ID aliases for `UUUP`, `Alliance Party`, and `Renua`.
    - Added an audit alias so `UUUP` resolves to `United Ulster Unionist Party`.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `808` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1098` audit rows: `71` match, `142` colour mismatch, `836` no election colour, `49` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `United UUP`, `A.P`, `Indp`, `DU UUUC`, or `Renua Ireland`.

Election party aliases follow-up: A. and Progressive Unionist Party
- [x] Normalise `A.` to `Alliance`
- [x] Normalise `Progressive Unionist Party` to `PUP`
- [x] Refresh Party IDs and colour audit after the follow-up pass
  - What I changed:
    - Added repeatable normalizer rules for exact `A.` and `Progressive Unionist Party`.
    - Tightened the rules after the first pass exposed over-broad replacements such as `Alliancep` and `PUP PUP`.
    - Collapsed related PUP variants such as `Progressive Unionist Party of Northern Ireland`, `Progressive Unionist Party (PUP)`, and malformed `Progressive Unionist Party of Northen Ireland` to `PUP`.
  - Verification:
    - `python scripts\normalize-election-party-names.py` ended with `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `802` party IDs and `1029` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` produced `1087` audit rows: `71` match, `142` colour mismatch, `825` no election colour, `49` no Wikipedia match.
    - Parsed `7344` election JSON files successfully.
    - A targeted scan found no exact party/key values for `A.`, `Progressive Unionist Party`, `PUP PUP`, `PUP - PUP`, or `Alliancep`.

Election party-name normalisation batch
- [x] Locate all party/ticket name fields in election JSON entries
- [x] Apply requested normalisations for Fianna Fail, Sinn Fein, Non party/Independent, Labour, Ulster Unionist Party, Green / Ecology, and S.D.L.P variants
- [x] Rerun the colour audit after normalisation
- [x] Report the next 10 most frequent party/ticket names after the requested changes
  - What I did:
    - added `scripts/normalize-election-party-names.py`
    - normalised party-like JSON fields: `Party_Name`, `Party`, `party`, `Wikipedia Party Name`, and `Deduplicated Party Name`
    - changed `Fianna Fail`/embedded `Fianna Fail` to `Fianna Fáil`
    - changed `Sinn Fein` and misspelled/accent variants such as `Sinn Fèin`, `Sinn Fién`, and `Sinn Feinn` to `Sinn Féin`
    - changed exact and embedded `Non party/Independent` to `Independent`
    - changed exact `Labour` to `Irish Labour`
    - changed exact and embedded `Ulster Unionist Party` to `UUP`
    - changed `Green / Ecology` to `Ecology` for 1982-1984 and `Green` for 1987 onward; no exact 1985 cases existed
    - changed exact and embedded `S.D.L.P` / `S.D.L.P.` to `SDLP`
  - Verification:
    - `python scripts/normalize-election-party-names.py`
    - JSON parse scan over all election files
    - verified no requested exact/substrings remain except `Labour` inside longer names such as `Northern Ireland Labour Party`, which was intentionally not globally rewritten
    - verified `Ecology` appears only in 1982-1984 occurrences and `Green` appears only in 1987 onward occurrences for the old `Green / Ecology` label
    - `python scripts/audit-ireland-election-party-colours.py`
    - `python -m py_compile scripts/normalize-election-party-names.py scripts/audit-ireland-election-party-colours.py scripts/extract-wikipedia-party-colours.py`

Ireland election party colour audit against Wikipedia
- [x] Locate election entry colour definitions for island-of-Ireland parties and tickets
- [x] Match election party/ticket names to the Wikipedia political-party colour extraction
- [x] Identify exact matches, likely alias matches, missing Wikipedia matches, and colour mismatches
- [x] Produce a review report with recommended fixes
  - What I did:
    - added `scripts/audit-ireland-election-party-colours.py`
    - scanned 7,254 election JSON files under `election-viewer-package/data/elections`
    - compared explicit `Party_Name`/`Party_Colour`, lower-case `party` entries, and runtime fallback colours against the Wikipedia colour extraction
    - matched Wikipedia by party name, abbreviation, shortname, and Ireland/NI-specific aliases for common forms such as `DUP`, `UUP`, `SDLP`, `TUV`, `Fianna Fail`, `Sinn Fein`, `Green/Comhaontas Glas`, and `People Before Profit Alliance`
    - wrote the full audit to `tasks/ireland_election_party_colour_wikipedia_audit.csv`
    - wrote high-confidence mismatches to `tasks/ireland_election_party_colour_wikipedia_high_confidence_mismatches.csv`
    - wrote the markdown review to `tasks/ireland_election_party_colour_wikipedia_audit.md`
  - Findings:
    - 1,184 unique election party/ticket colour observations
    - 72 observations correspond to Wikipedia colours
    - 139 observations have a Wikipedia match but a different colour
    - 71 of those mismatches are high-confidence exact-name or Ireland/NI-alias matches
    - 921 observations have no explicit election colour in the source and therefore use default/fallback behaviour
    - 52 coloured observations have no Wikipedia match
  - Verification:
    - `python scripts/audit-ireland-election-party-colours.py`
    - `python -m py_compile scripts/audit-ireland-election-party-colours.py scripts/extract-wikipedia-party-colours.py`

Wikipedia political party colour extraction
- [x] Inspect the Wikipedia module page/raw format for `Module:Political_party/1` and `A`-`Z`
- [x] Fetch all requested pages and extract party name, color, abbrev, shortname, validity, and contrast details
- [x] Write the extracted data to a structured local file
- [x] Verify parse coverage, row counts, and malformed values
  - What I did:
    - scraped the rendered "Color values" tables from all 27 requested English Wikipedia module pages using `scripts/extract-wikipedia-party-colours.py`
    - wrote `tasks/wikipedia_political_party_colours.csv` with source URL/module plus the requested fields
    - wrote `tasks/wikipedia_political_party_colours_requested_columns.csv` with exactly the eight requested fields
    - wrote `tasks/wikipedia_political_party_colours.xlsx` and `tasks/wikipedia_political_party_colours_metadata.json`
  - Verification:
    - fetched all 27 pages: `/1` and `/A` through `/Z`
    - extracted 14,871 rows
    - verified the requested-columns CSV has exactly: `Political party name`, `color`, `abbrev`, `shortname`, `Is color valid?`, `Contrast normal text`, `Contrast unvisited link`, `Contrast visited link`
    - verified the XLSX also has 14,871 rows
    - found 7 rows where Wikipedia marks `Is color valid?` as `False`
    - found 2 source rows with blank party names on `/N`, preserved as source data

Boundary update recovery from session ses_20bb
- [x] Restore unrelated tracked changes from the stalled session
- [x] Re-audit the collaborator's Drive boundary files against current `maps.json` and local/R2 asset state
- [x] Prepare and upload only verified `.fgb`, `.fgb.gz`, and LOD assets needed by changed metadata
- [x] Update `data/database/maps.json` only for verified live assets
- [x] Verify JSON syntax, asset URLs, and targeted map metadata/load paths
  - What I did:
    - restored unrelated tracked changes from the stalled session before making scoped metadata edits
    - verified source/R2 state for the collaborator boundary files, including the available Ulster 1921 file in place of the referenced but absent 1919 file
    - uploaded verified raw and gzip FGB assets for Counties 1957, ROI Local Authorities 1965/1966/1977/1980/1985/1986/1994, and the Connacht 1986, Munster 1980, and Ulster 1921 ED files
    - generated and uploaded LOD0/LOD1 assets for Counties 1957 and the ROI Local Authority files that use LOD loading
    - updated `data/database/maps.json` for only the verified live assets
  - Verification:
    - `node -e "JSON.parse(...)"` parsed `data/database/maps.json`
    - raw public URLs for 27 uploaded `.fgb` assets returned 200 and matched local MD5 via ETag
    - direct `.fgb.gz` public URLs for the same 27 assets returned 200 with non-zero content length
    - metadata checks confirmed target IDs, label properties, and derived LOD URLs
    - FlatGeobuf reads confirmed configured label properties exist in the first feature of each changed dataset

Repo instruction change: remove ZIP intake check requirement
- [x] Amend `AGENTS.md` to suspend the ZIP intake check requirement
  - [x] Remove the mandatory ZIP intake check instructions
  - [x] Verify the updated `AGENTS.md` content
  - What I did:
    - removed the entire `## Mandatory ZIP Intake Check` section from `AGENTS.md`
  - Verification:
    - confirmed `AGENTS.md` no longer contains `Mandatory ZIP Intake Check`, `zip-intake-check`, or `maps-to-be-added`

Bugs in demo bullet list extraction
- [x] Review the original transcript and extract the latest revised demo list without conditional styling
  - [x] Re-open the original transcript and locate the latest revised `KEEP as standalone beats` list
  - [x] Remove `Conditional Styling` from that list
  - [x] Provide the revised list inline in chat
  - Verification:
    - extracted from `2026-04-14-181430-image-1-in-dark-mode-when-i-hover-my-mouse-ov.txt`
    - based on the final `KEEP as standalone beats` section near the end of the transcript

ZIP Intake Check (2026-04-14)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-04-14T18:08:34.6491951Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

Bugs in duplicate feature-detail back history
- [x] Fix duplicate feature-detail history entries from double-click opens
  - [x] Confirm whether the same feature detail can be pushed twice in succession
  - [x] Prevent duplicate consecutive history entries for the same detail view
  - [x] Verify that one Back click returns to the previous page after a double-click open
  - Root cause:
    - the feature-detail open path accepted repeated consecutive pushes for the same `detailId`, so a double-click on the feature name could append identical `feature-detail` history entries and force two Back clicks to reach the actual previous page.
  - What I did:
    - added a duplicate-consecutive-entry guard in `showFeatureDetailInCatalogue(...)`
    - added the same guard in `showElectionEntityDetailInCatalogue(...)` so adjacent entity-detail navigation cannot regress the same way
    - rebuilt the shipped bundle with `node scripts/bundle.mjs`
  - Verification:
    - `node --check js/ui-controller.js`
    - `node scripts/bundle.mjs`
    - Playwright in-browser evaluation confirmed:
      - two consecutive opens of the same feature detail leave history as `['list', 'feature-detail']`
      - one `catalogueGoBack()` returns immediately to the list view and hides the detail view

Bugs in catalogue back navigation from feature detail
- [x] Fix the catalogue back button so feature detail returns to the previous page/state
  - [x] Record the task and confirm ZIP intake timing
  - [x] Inspect catalogue/history navigation and feature-detail entry paths
  - [x] Implement the minimal fix in the shared catalogue detail flow
  - [x] Verify the exact back-navigation behavior and record the outcome
  - Root cause:
    - `showFeatureDetailInCatalogue(...)` pushed a feature-detail history entry but did not refresh the catalogue nav buttons afterward, so opening feature detail directly from the main catalogue could leave the Back button stale/disabled.
    - when feature detail was opened while another top-level pane was active, the previous tab state was not preserved in the catalogue history stack, so Back had no way to return to that prior pane.
  - What I did:
    - added `_getActivePaneTabId()` and `_pushCatalogueTabHistoryIfNeeded(...)` in `js/ui-controller.js`
    - taught `catalogueGoBack()` / `catalogueGoForward()` to restore saved tab entries
    - updated `showFeatureDetailInCatalogue(...)` and `showElectionEntityDetailInCatalogue(...)` to:
      - preserve the current non-catalogue tab in history before opening detail
      - switch explicitly to the catalogue tab for the detail view
      - refresh the catalogue nav button state after rendering
    - rebuilt the shipped bundle with `node scripts/bundle.mjs`
  - Verification:
    - `node --check js/ui-controller.js`
    - `node scripts/bundle.mjs`
    - Playwright in-browser evaluation against `window.uiController` confirmed:
      - `list -> feature detail -> Back` returns to the catalogue list and re-hides the detail view
      - `explore -> feature detail -> Back` returns to the `explore` tab
      - Back is enabled immediately after opening feature detail in both cases

Bugs in NUTS region thumbnails
- [x] Regenerate the NUTS Regions thumbnails
  - [x] Locate the thumbnail generation workflow and the NUTS map ids/assets
  - [x] Regenerate the affected thumbnail files
  - [x] Verify the regenerated thumbnails exist and reflect the updated NUTS geometry
  - What I did:
    - confirmed the affected map ids in `data/database/maps.json` are `nuts-2-all-ireland` and `nuts-2-roi`
    - used `python scripts/regen-thumbnails.py --map-id ...` for each target so the thumbnails were regenerated through the repo's land-context thumbnail pipeline rather than the missing-file-only generator
  - Verification:
    - `python scripts/regen-thumbnails.py --map-id nuts-2-all-ireland`
    - `python scripts/regen-thumbnails.py --map-id nuts-2-roi`
    - regenerated files:
      - `assets/thumbnails/nuts-2-all-ireland.png` (`8000` bytes, updated `2026-04-14 18:30:01`)
      - `assets/thumbnails/nuts-2-roi.png` (`7676` bytes, updated `2026-04-14 18:30:02`)
    - `git status --short` shows both thumbnail files modified, confirming fresh outputs were written

Bugs in demo review note and local dev server restart
- [x] Review `2026-04-14-181430-image-1-in-dark-mode-when-i-hover-my-mouse-ov.txt`
  - [x] Read the transcript/review note and extract the concrete findings or status
  - [x] Present the review findings in code-review style
- [x] Restart the local dev server
  - [x] Identify the current local dev server process/command
  - [x] Restart it cleanly
  - [x] Verify the server is listening and serving the site
  - Review findings:
    - The transcript shows repeated CSS edits against `assets/css/main.css` while the running site was still serving `build/main.css`; the fix was only made effective after several failed rounds and a later rebuild, so verification was too weak and happened too late.
    - The NUTS2 repair was done as an ad hoc manual data replacement from a temp extraction path, with no reproducible repo-local script or post-change validation captured beyond extent inspection; that is risky for future regeneration or audit.
    - The answer that identified `scripts/demo/guide-overlay.js` as the human-readable recording script was incomplete at best: it is an overlay generator, not a plain text instructions file, and the actual human-readable text had to be derived afterward.
  - What I did:
    - reviewed the transcript and extracted the main process/quality issues with line-referenced evidence for the final response
    - confirmed the local dev server was not previously verifiable on the expected port, then preserved the newly started background instance after the aborted command
  - Verification:
    - server stdout log shows `Dev server running at http://localhost:3000`
    - `netstat -ano` shows PID `18112` listening on `0.0.0.0:3000` and `[::]:3000`
    - `Invoke-WebRequest http://localhost:3000` returned HTTP `200`

Bugs in flat catalogue header height
- [x] Reduce the height of flat catalogue card headers without breaking sticky alignment
  - [x] Identify which flat-view-specific header sizing rules are making the headers too tall
  - [x] Tighten only the flat-view header padding/type sizing
  - [x] Rebuild and verify the flatter header height in-browser
  - What I did:
    - reduced flat-view header vertical padding from `12px` to `8px`
    - reduced flat-view title size to `16px` and subtitle size to `11px`
    - tightened the flat-view placeholder toggle vertical padding to match the shorter header
  - Verification:
    - rebuilt successfully with `node scripts/bundle.mjs`
    - browser checks on `1990s` and `1980s` showed header height reduced from `64.57px` to `49.5px`
    - sticky offset remained `24px`, so the flush-under-shell behavior was preserved

Bugs in flat catalogue sticky header seam
- [x] Remove the transparent seam between the catalogue sticky shell and sticky flat-card headers while scrolling
  - [x] Identify which sticky/layout rules leave the pane visible between the shell and card header
  - [x] Apply the smallest CSS fix that preserves existing sticky behavior
  - [x] Verify in-browser that the seam is no longer visible
  - Root cause:
    - the catalogue pane itself was transparent, and the flat-card sticky header stopped short of the search shell by roughly `16px`, so that overlap zone showed the pane through during scroll.
  - What I did:
    - set the catalogue pane background explicitly to `var(--color-surface)`
    - added a flat-view-only `::before` strip on `.c1-card__header` that extends the header gradient upward by `var(--space-4)` to cover local overlap
    - reverted the shell `::after` cover strip after the user requested the original shell behavior back
    - changed `#catalogueFlatView .c1-card__header` sticky offset from `54px` to `24px` so the active card header sits flush against the bottom of the search shell inside the padded catalogue pane
    - rebuilt assets and bumped cache-busters in `index.html`
  - Verification:
    - rebuilt successfully with `node scripts/bundle.mjs`
    - browser check confirmed `getComputedStyle(header).top === "24px"` for the `1990s` card and `getComputedStyle(shell, '::after').content === "none"`
    - geometry check on the `1990s` card showed the sticky header top stays within `0.49px` of the shell bottom across multiple scroll positions, effectively flush
    - viewport screenshot after scrolling the `1990s` election card into the reported state showed the header directly against the search shell with no shell overlay

Bugs in flat catalogue placeholder toggles
- [x] Restore `Show/Hide to be added` buttons on flat catalogue cards with placeholder maps
  - [x] Verify whether flat cards like `District Electoral Divisions` and `Administrative Areas` compute non-zero placeholder counts
  - [x] Fix the render/visibility path that suppresses the header toggle on those flat cards
  - [x] Rebuild and verify the affected cards render the toggle and still hide placeholder entries by default
  - Root cause:
    - `js/ui-controller.js` already had the flat-card toggle logic, but `build/app.bundle.js` still contained the older render path without it, so the live app never emitted the button HTML for flat cards.
  - What I did:
    - Rebuilt the shipped assets with `node scripts/bundle.mjs` so the flat-card header now includes the placeholder toggle branch.
    - Bumped `index.html` asset versions to `build/main.css?v=16` and `build/app.bundle.js?v=20` to force browsers onto the rebuilt files.
    - Recorded the required ZIP-intake check result in `.zip-intake-check.json` after confirming `maps-to-be-added` only contains `.gitkeep`.
  - Verification:
    - Browser DOM check after rebuild showed:
      - `District Electoral Divisions` -> `Show 53 to be added`
      - `County Electoral Divisions` -> `Show 54 to be added`
      - `Administrative Areas` -> `Show 53 to be added`
    - Browser interaction check on `Administrative Areas` confirmed:
      - `53` placeholder entries hidden by default
      - toggle label changes to `Hide 53 to be added`
      - all `53` placeholder entries become visible, then hide again when toggled off

Local-election bundled loads and precomputed aggregates
- [x] Add reversible support for optional local-election `_bundle.json` artifacts in the runtime loader.
  - [x] Prefer per-date local bundles for `local-government` only when the bundle validates and contains requested constituencies.
  - [x] Fall back automatically to the existing per-constituency JSON path for any missing or invalid bundle data.
- [x] Add reversible support for optional local-election `_aggregates.json` artifacts in the runtime loader.
  - [x] Prefer precomputed current/previous council aggregates only when the aggregate artifact validates.
  - [x] Fall back automatically to the existing runtime aggregate builder for any missing or invalid aggregate data.
- [x] Extend the local-election build script to emit additive `_bundle.json` and `_aggregates.json` files without removing existing constituency JSON outputs.
- [x] Regenerate local-election artifacts and verify:
  - [x] runtime syntax checks
  - [x] build-script syntax
  - [x] expected additive files exist
  - [x] existing local-election views still have fallback-safe inputs
- [x] Record the overdue ZIP-intake check result in `.zip-intake-check.json`.
  - Runtime now checks for `_bundle.json` and `_aggregates.json` only for `local-government`, caches them separately, validates shape, and falls back automatically to the existing constituency JSON and aggregate builder when anything is missing or invalid.
  - The builder now writes additive per-date `_bundle.json` and `_aggregates.json` files alongside the existing constituency JSON outputs. Existing constituency files were preserved and regenerated in place.
  - Verification:
    - `node --check js/election-controller.js`
    - Python AST parse of `privaterep_refactored/electionsni-master/scripts/build_lgov_from_workbook.py`
    - Builder rerun completed successfully and wrote `249` JSON files
    - Sample verification confirmed `election-viewer-package/data/elections/local-government/2023-05-18/_bundle.json` and `_aggregates.json` exist alongside `airport.json`
  - Rollback:
    - runtime rollback is metadata-free; simply remove or ignore `_bundle.json` / `_aggregates.json` and the loader falls back automatically
    - data rollback is additive-only; constituency JSON primitives remain the authoritative fallback path

Catalogue books and TOC top links
- [x] Add legislation-book thumbnails and top-level TOC links; review 2023 local-election load bottlenecks
  - [x] Add visible thumbnail fallback treatment for legislation books so they render like other book cards
  - [x] Add clickable top-level TOC links for Elections, Maps, and Books
  - [x] Verify UI changes with syntax checks
  - [x] Report ranked 2023 local-election load bottlenecks and safest speed improvements
  - Added a generated thumbnail fallback for books without `assets/thumbnails/book-<id>.png`, which gives legislation entries visible thumbnail cards instead of blank spaces while preserving existing boundary-report thumbnails.
  - Added top-of-TOC quick links for `Elections`, `Maps`, and `Books`, and inserted matching anchors into the flat catalogue sections so they scroll correctly.
  - Verification: `node --check js/ui-controller.js`; `node --check js/election-controller.js`.

Phase 0 - Map load optimization rollout
- [x] Add observability/timing instrumentation for vector full-load, LOD selection, chunk index load, chunk fetch/decode/render, and viewport updates.
  - Added structured load metrics in `js/map-controller.js` for full-file vector loads, LOD source selection, chunk index load, chunk file fetch/decode/render, and viewport reload paths.
- [x] Add browser-safe baseline tests for one LOD candidate (`eds-ulster-1911`) and one chunk candidate (`oa-2001`).
  - Added/validated `tests/browser/map-loading-pilots.spec.js` and reran it successfully in Playwright.
- [x] Record first pilot candidates and rationale.
  - Chosen pilots:
    - `eds-ulster-1911` for isolated LOD verification
    - `oa-2001` for chunking + bounded concurrency + zoom-variant verification

Phase 1 - LOD framework hardening
- [x] Add runtime guards/fallback logging when `useLOD` is enabled but derived assets are missing.
  - Added LOD selection/fallback metric logging in `js/map-controller.js`.
- [x] Ensure source selection is observable and reversible by metadata only.
  - Verified `useLOD` remains metadata-driven and logs the selected derived/full source at runtime.

Phase 2 - One-map LOD pilot
- [x] Enable/verify `eds-ulster-1911` as the first isolated LOD pilot.
  - Verified via Playwright that low-zoom loads select a derived `lod0/lod1` source for `eds-ulster-1911`.
- [x] Compare baseline vs after timings and validate visual correctness.
  - Browser verification passed for low-zoom derived-source selection without load failure.

Phase 3 - Chunk framework hardening and pilot
- [x] Harden chunk manifest/runtime validation.
  - Added `_validateChunkIndex(...)` and runtime metric logging for missing/invalid chunk manifests.
- [x] Enable/verify `oa-2001` as the first isolated chunking pilot.
  - Verified `oa-2001` chunk index load, visible chunk loading, and chunk zoom-file selection in Playwright.

Phase 4 - Bounded parallel chunk loading
- [x] Refactor chunk loading to a bounded concurrency executor with default concurrency `1`.
  - Added `getChunkLoadConcurrency(...)` and `_mapWithConcurrency(...)` in `js/map-controller.js`.
- [x] Enable safe bounded parallelism for the pilot and verify.
  - Enabled `chunkLoadConcurrency: 4` for `oa-2001` in `data/database/maps.json` and verified the pilot stays correct in Playwright.

Phase 5 - Zoom-variant chunk framework
- [x] Harden zoom-variant chunk selection/validation.
  - Verified runtime selection through the existing chunk `zoomFiles` path and added browser assertions for low/high zoom variant use on the pilot.
- [x] Select a first chunked pilot for broader zoom-file support after prior phases pass.
  - `oa-2001` remains the first verified zoom-variant chunk pilot.

Review
- [x] Capture timing results, regression results, rollback points, and next rollout candidates.
  - Regression evidence:
    - `npm run test:browser -- --grep "eds-ulster-1911|oa-2001 uses chunk index" --workers 1`
    - `2 passed`
  - Rollback points:
    - disable `useLOD` per map in `data/database/maps.json`
    - disable `chunked` and/or `chunkLoadConcurrency` per map in `data/database/maps.json`
  - Next safe rollout candidates:
    - more medium/large maps for metadata-only LOD enablement
    - one additional large chunk candidate after asset audit

Book catalogue search fix
- [x] Fix missing legislation/statutory books when searching `book` in the catalogue.
  - Root cause: the catalogue book filter only matched book title/author/keywords, so generic searches like `book` did not match legislation entries whose titles lacked that word.
  - Fix: added `_bookMatchesSearch(...)` in `js/ui-controller.js` and used it in both catalogue book-render paths so search also matches book-category metadata and the generic `book/books/document/documents` labels.
  - Verification: `node --check js/ui-controller.js`
## LOD rollout for existing assets
- [x] Inventory maps that already have `lod0/lod1` assets and no chunked loader
- [x] Enable `useLOD` only for the safe existing-asset set
- [x] Add representative browser verification across map families
- [x] Run full verification and record outcomes

Review:
- Identified `114` maps that already had matching `-lod0.fgb` and `-lod1.fgb` assets on disk and were not using the chunked loader.
- Enabled `useLOD: true` only for that existing-asset safe set in `data/database/maps.json`, with no new runtime dependency on missing files.
- Added representative browser coverage in `tests/browser/map-loading-pilots.spec.js` for:
  - `lgd-2012`
  - `pc-2023`
  - `river-basin-districts`
  - `dail-2023`
- Verified:
  - `maps.json` parses
  - targeted LOD/chunk pilot suite passes
  - full Playwright suite passes (`12 passed`)

ZIP Intake Check (2026-03-17)
- [x] Check maps-to-be-added for qualifying ZIP files
  - No ZIP files found.
- [x] Update .zip-intake-check.json with new check time

NI SPN gap-closure collection run
- [x] Execute the three highest-yield acquisition lanes in parallel:
  - historic non-local election discovery/capture via BNA
  - old-26 council archive recovery for local-election SPNs and election-agent notices
  - focused Lisburn & Castlereagh 2019 SPN discovery
- [x] Validate new artifacts and manifests
- [x] Review and record:
  - newly collected source documents
  - elections/constituencies/DEAs materially improved
  - remaining hard gaps and blockers
  - Actions run:
    - `python scripts/download_council_spns_v4.py`
    - `python scripts/parse_eoni_pdfs.py`
    - `python scripts/convert_old26_to_markdown.py`
    - `python scripts/scrape_26_councils.py` (timed out after ~20 minutes; no new manifest evidence beyond prior old-26 recovery state)
    - `python scripts/scrape_bna.py 1979` (failed immediately; script filtered to zero elections for `1979` and Playwright persistent-context launch then exited)
  - New collection yield from the targeted council downloader:
    - `58` successful downloads, `16` failed
    - major additions landed for `2023_local_ards-north-down`, `2023_local_mid-east-antrim`, `2023_local_belfast`, `2023_local_antrim-newtownabbey`, `2023_local_derry-strabane`, `2023_local_mid-ulster`, `2023_local_armagh-banbridge-craigavon`
    - major additions landed for `2019_local_antrim-newtownabbey`, `2019_local_causeway-coast-glens`, `2019_local_newry-mourne-down`, and `2019_local_mid-east-antrim`
    - election-agent additions landed for `2019_local_newry-mourne-down`
  - Verification outputs:
    - `_tmp_eoni_pdf_analysis.json` regenerated from `540` PDFs
    - `_tmp_gazette_markdown/old26_councils/index.json` regenerated with `146` files processed, `124` extracted, `22` flagged as manual-conversion DOC failures
  - Hard blockers:
    - BNA automation is currently blocked by the Playwright browser launch failure in `scripts/scrape_bna.py`
    - many legacy `.doc` files still require a separate converter/OCR path before text can be mined
    - some recovered PDFs are image-only or otherwise text-extraction-hostile (for example Lisburn & Castlereagh samples returned zero text from both PyPDF2 and PyMuPDF)

NI SPN follow-up: BNA runner hardening and local-year correction
- [x] Fix `scripts/scrape_bna.py` election selection and non-interactive login handling
  - Added explicit `1979`/`1983`/`1938` election entries that were missing from the configured search list.
  - Replaced the year-only assumption with `select_elections(...)`, so `python scripts/scrape_bna.py 1987` now filters correctly to one configured election instead of zero.
  - Added `launch_bna_context(...)` fallback from persistent profile to a fresh browser context with optional saved storage state.
  - Added non-interactive detection via `BNA_NONINTERACTIVE=1` or non-TTY stdin and converted the login prompt into a clean `SystemExit` instead of an `EOFError`.
- [x] Verify the BNA runner behavior after the fix
  - `python -m py_compile scripts\scrape_bna.py scripts\validate_local_spn_years.py`
  - `$env:BNA_NONINTERACTIVE='1'; python scripts\scrape_bna.py 1987`
  - Verified result: the script now reports `Filtering to year 1987: 1 elections`, falls back cleanly when the persistent Chromium profile crashes, and exits with `No reusable BNA login is available in this environment` rather than crashing on `input()`.
  - Remaining blocker: no reusable subscribed BNA session is available in this environment, so no historic article capture was completed.
- [x] Add and run a year-validation pass for mislabeled local SPN files
  - Added `scripts/validate_local_spn_years.py` to inspect `2019_local_*` and `2023_local_*` SPN files, infer poll year from extracted text, and move mismatches into the correct year directory.
  - Ran `python scripts\validate_local_spn_years.py`, which wrote `_tmp_spn_year_validation.json`.
  - Verification/result:
    - `207` files scanned
    - `35` mislabeled files moved
    - detected years: `31` as `2019`, `112` as `2023`
    - confirmed corrections include cross-year duplicates in Belfast, Mid and East Antrim, Mid Ulster, Derry and Strabane, Causeway Coast and Glens, and Armagh Banbridge Craigavon
- [x] Review recurring defects and prevention
  - Symptom: BNA automation failed before scraping because configured year filters returned zero elections and the login fallback crashed on `input()`.
  - Root cause: the election list omitted some targeted years, and the script assumed an interactive terminal even in automated runs.
  - Permanent prevention action: year/name election selection is now centralized in `select_elections(...)`, and non-interactive runs fail fast with an explicit login error path.
  - Verification evidence: the `1987` rerun reached the intended clean blocker message after matching the year correctly.

BNA secure local-session setup
- [ ] Verify local auth artifacts remain untracked and open a manual-login browser session
- [ ] Capture a local reusable authenticated session without storing raw credentials in the repo
- [ ] Verify the saved session can be reused for BNA scraping

Conversation log export
- [x] Write a markdown file with the full details of this conversation, excluding any credentials or session tokens
- [x] Confirm the output path and what was included
  - Wrote `tasks/conversation-log-2026-03-20.md`
  - Included: user requests, repo-review findings, gap analysis, acquisition actions, code changes, commands run, verification outcomes, blockers, and the secure BNA-login workflow
  - Excluded: raw credentials, cookies, tokens, and storage-state contents

Performance improvement handoff package
- [x] Create a repo-local handoff folder with the full implementation and testing plan for performance items `1` through `13`
  - Added `docs/performance-improvement-handoff/README.md`
  - Added `docs/performance-improvement-handoff/00-execution-protocol.md`
  - Added `docs/performance-improvement-handoff/01-metrics-and-thresholds.md`
  - Added per-item execution sheets in `docs/performance-improvement-handoff/items/`
  - Structured the package for one-item-at-a-time delivery with:
    - atomic steps
    - automated non-browser checks first
    - manual user checks second
    - rollback and acceptance gates
  - Notes:
    - the package explicitly assumes no browser automation is required for the first verification layer
    - later agents should extend existing repo mechanisms additively instead of replacing them wholesale
  - Review:
    - the handoff package now gives Claude or another later agent a direct execution path without re-deriving ordering, test scope, or rollback criteria
    - every numbered improvement from `1` to `13` has a dedicated file and atom sequence
- [x] Add supplemental execution aids to make the handoff package more actionable for later agents
  - Added `docs/performance-improvement-handoff/02-repo-hotspots.md`
  - Added `docs/performance-improvement-handoff/03-command-catalog.md`
  - Added `docs/performance-improvement-handoff/04-atom-worksheet-template.md`
  - Added `docs/performance-improvement-handoff/05-decision-log-template.md`
  - Added `docs/performance-improvement-handoff/06-risk-register-template.md`
  - Added `docs/performance-improvement-handoff/07-manual-test-report-template.md`
  - Updated the package `README.md` to point at the new files and explain their purpose
  - Review:
    - later agents now have a repo-specific orientation map, reusable execution templates, and a consistent place to record tradeoff decisions and manual results
- [x] Add final execution-readiness aids to reduce startup ambiguity for later agents
  - Added `docs/performance-improvement-handoff/08-recommended-execution-order.md`
  - Added `docs/performance-improvement-handoff/09-file-touch-matrix.md`
  - Added `docs/performance-improvement-handoff/10-non-browser-test-script-specs.md`
  - Added `docs/performance-improvement-handoff/11-glossary.md`
  - Updated the package `README.md` again so the index is complete
  - Review:
    - later agents now have a recommended sequencing model, likely file-entry points, explicit non-browser script targets, and shared terminology
- [x] Add first-wave execution and acceptance aids so later agents can start immediately
  - Added `docs/performance-improvement-handoff/12-first-wave-starter-pack.md`
  - Added `docs/performance-improvement-handoff/13-acceptance-criteria-matrix.md`
  - Added `docs/performance-improvement-handoff/14-known-constraints-and-non-goals.md`
  - Added `docs/performance-improvement-handoff/15-script-backlog-checklist.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index the new files
  - Review:
    - later agents now have a clear first wave, a fast accept/reject matrix, explicit boundaries, and a concrete script backlog to begin the non-browser automation layer
- [x] Add runnable handoff-local scripts for the first non-browser verification wave
  - Added `docs/performance-improvement-handoff/scripts/README.md`
  - Added shared helpers in `docs/performance-improvement-handoff/scripts/_shared.mjs`
  - Added runnable report scripts:
    - `report-bundle-sizes.mjs`
    - `report-startup-imports.mjs`
    - `report-first-load-assets.mjs`
    - `report-font-usage.mjs`
    - `report-map-performance-metadata.mjs`
    - `report-dependency-usage.mjs`
  - Updated the handoff `README.md` to index the scripts
  - Review:
    - later agents can now run the first reporting wave directly from the handoff package instead of creating the scripts from scratch
  - Verification:
    - `node docs\performance-improvement-handoff\scripts\report-bundle-sizes.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-startup-imports.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-first-load-assets.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-font-usage.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-map-performance-metadata.mjs`
    - `node docs\performance-improvement-handoff\scripts\report-dependency-usage.mjs`
    - All six scripts executed successfully and produced repo-specific reports
- [x] Add current baseline report artifacts to the handoff package
  - Added `docs/performance-improvement-handoff/reports/current-state-summary.md`
  - Added current text outputs for:
    - bundle sizes
    - startup imports
    - first-load assets
    - font usage
    - map performance metadata
    - dependency usage
  - Updated the handoff `README.md` to index the `reports/` folder
  - Review:
    - later agents now have immediate repo-specific baseline evidence inside the handoff folder, even before rerunning the scripts
- [x] Add a single start-here entrypoint for later agents
  - Added `docs/performance-improvement-handoff/START-HERE.md`
  - Updated `docs/performance-improvement-handoff/README.md` to index it
  - Review:
    - later agents now have one short file that tells them what to read first, what to run first, and which atom to start with
- [x] Add machine-readable handoff artifacts for later agents
  - Added `docs/performance-improvement-handoff/manifest.json`
  - Added `docs/performance-improvement-handoff/state/current-status.json`
  - Added `docs/performance-improvement-handoff/items/index.json`
  - Added JSON versions of the current baseline reports under `docs/performance-improvement-handoff/reports/`
  - Updated the handoff `README.md` to index the machine-readable files
  - Review:
    - later agents can now consume the handoff package programmatically instead of parsing only prose and plain-text reports
- [x] Add final execution helpers beyond documentation
  - Added `docs/performance-improvement-handoff/state/next-actions.json`
  - Added `docs/performance-improvement-handoff/scripts/run-first-wave.mjs`
  - Added starter templates:
    - `docs/performance-improvement-handoff/scripts/templates/benchmark-template.mjs`
    - `docs/performance-improvement-handoff/scripts/templates/validator-template.mjs`
  - Updated `manifest.json`, `state/current-status.json`, and the handoff `README.md` to reference the new helpers
  - Review:
    - later agents can now refresh the first-wave reports with one command, consume an ordered next-action queue, and start benchmark or validator work from working templates

ZIP Intake Check (2026-03-24)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-03-24T15:46:29Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

ZIP Intake Check (2026-04-12)
- [x] Check maps-to-be-added for qualifying ZIP files
  - Checked at `2026-04-12T17:06:43.7627163Z`
  - No ZIP files found; only `maps-to-be-added/.gitkeep` was present
- [x] Update `.zip-intake-check.json` with the new check time

Civgraph social profile PNG exports
- [ ] Create high-quality PNG versions of the Civgraph logo for Facebook and Twitter/X profile pictures
  - [ ] Confirm the correct source artwork and export approach
  - [ ] Render square PNG outputs with profile-safe padding
  - [ ] Verify dimensions and visual quality
  - [ ] Record output paths and review notes
  - Review note: temporary HTML export scaffold was removed on user request before PNG outputs were finalized

Representative LOD-only map verification
- [x] Pick a high-risk LOD-only map based on metadata and asset sizes
- [x] Run a browser-level test that proves the selected map loads from an LOD source at low zoom
- [x] Record fetch/source evidence and final result
  - Picked `roi-garda-sub-districts` because it is the largest local non-chunked `useLOD` map with complete LOD assets found in the inventory:
    - raw: `data/maps/local-government/ROI_Garda_Sub_Districts.fgb`, about `44.7 MB`
    - `lod0`: about `0.4 MB`
    - `lod1`: about `1.7 MB`
  - What I did:
    - added a focused browser regression for `roi-garda-sub-districts`
    - asserted that the live bundled app loads an `ROI_Garda_Sub_Districts-lod0/lod1.fgb` source at low zoom
    - asserted that the raw `ROI_Garda_Sub_Districts.fgb` file is not requested
    - updated the map-loading pilot harness to use the bundled runtime globals instead of dynamically importing a second source app instance
    - kept the chunk zoom-variant pilot controlled through `mapController.loadLayer(...)` so app-level auto-fit does not mask the zoom-band transition
  - Verification:
    - `npm run test:browser -- --grep "largest local LOD-only" --workers 1` passed
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js --workers 1` passed with `4 passed`

Mobile map-load lag review
- [x] Review the live mobile map-load path and identify likely lag sources
- [x] Run a mobile-shaped browser measurement for representative map loading
- [x] Explain whether the lag is network/geometry load, catalogue/UI rerender, or another main-thread bottleneck
- [x] Record evidence and recommendations
  - What I reviewed:
    - `uiController.onMapLoad(...)` calls `App.loadMap(...)`, then `updateMapList()` and `updateActiveLayers()`.
    - `App.loadMap(...)` calls `mapController.loadLayer(...)`, then auto-fits the map and updates the URL.
    - `uiController.renderMapList(...)` invalidates and rerenders the flat catalogue through `renderFlatView(...)`.
  - Measurement:
    - Ran a temporary mobile-shaped Playwright measurement against `roi-garda-sub-districts`, with default layers suppressed via `#layers=__none`.
    - Direct map-layer load selected `ROI_Garda_Sub_Districts-lod0.fgb`, loaded `563` features, and completed in about `39 ms`; the FGB request was about `426 KB`, and the raw `44.7 MB` file was not requested.
    - Full `uiController.onMapLoad(...)` path completed in about `484 ms` on desktop Chromium/mobile viewport, with the map layer itself only about `25 ms`.
    - A standalone flat-catalogue rerender took about `131 ms` and left about `36,486` flat-catalogue DOM descendants.
    - The browser recorded multiple long tasks between about `130 ms` and `287 ms`, and the initial flat catalogue issued many thumbnail requests, including repeated 404s for missing thumbnail paths.
  - Conclusion:
    - For this representative LOD map, the remaining perceived lag is not the raw FGB; it is mainly app/UI work around the layer load, especially full catalogue rerendering, thumbnail churn, missing-thumbnail retries, and long main-thread tasks.
    - On real mobile CPU/network, those desktop-subsecond tasks can plausibly stretch into multi-second stalls, especially on first load or while default layers/catalogue thumbnails are still settling.

Collaborator map metadata review: Counties and Provinces 1955
- [x] Inspect current Counties/Provinces 1955 map metadata and catalogue grouping
- [x] Determine why the counties map is missing and why monolingual Provinces 1955 remains separate
- [x] Determine whether OSI/Tailte credit is preserved
- [x] Apply a safe metadata fix if supported by existing assets
- [x] Verify metadata parses and affected catalogue entries behave as intended
  - Findings:
    - `counties-ireland-1955` existed and the local/R2 asset path was configured, but the flat Counties card only listed the parent `counties-ireland` entry, so the 1955 counties map was buried as a variant rather than directly visible.
    - The monolingual `provinces` entry pointed at the 2019 OSI/Tailte source but was dated `1955`, which made it appear as a separate 1955 provinces map beside the bilingual `provinces-1955` entry.
    - Both 1955 contributor-derived entries credited only `Phelim Birch`, dropping OSI credit.
  - What I changed:
    - added `counties-ireland-1955` directly to the flat Counties card map list
    - changed `provinces` to `Provinces of Ireland 2019` with date `2019`
    - added `OSI` provider credit to `provinces-1955` and `counties-ireland-1955`
    - bumped the app bundle cache-buster in `index.html` to `v=110`
    - added a browser regression covering the affected catalogue rows
    - recorded the source-agency-credit lesson in `tasks/lessons.md`
  - Verification:
    - `npm run build` succeeded
    - `node --check js/ui-controller.js`
    - `node -e "JSON.parse(...)"` confirmed `provinces`, `provinces-1955`, and `counties-ireland-1955` metadata
    - `npm run test:browser -- tests/browser/catalogue-metadata.spec.js --workers 1` passed
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js --workers 1` passed with `5 passed`

Mobile catalogue render and thumbnail churn fix
- [x] Stop map load/unload/toggle actions from forcing full flat-catalogue rerenders
- [x] Add targeted catalogue state patching for loaded/visible button state
- [x] Add a build-generated thumbnail manifest and suppress missing-thumbnail `<img>` output
- [x] Lazy-hydrate present thumbnails so catalogue rendering does not start every image request at once
- [x] Progressively render the flat catalogue on mobile to break up long main-thread work
- [x] Keep map geometry loading on the LOD/chunk path and avoid adding new synchronous map-load work
- [x] Add browser regressions for rerender avoidance, missing-thumbnail request churn, and representative map loading
- [x] Build, test, and record evidence
  - Plan:
    - Replace state-only `updateMapList()` calls after layer load/unload/visibility changes with a small `syncMapCatalogueState(...)` path.
    - Keep full catalogue rerenders only for real catalogue content changes such as search/filter/category changes.
    - Generate `assets/thumbnails/manifest.json` from the real thumbnail directory during `npm run build`.
    - Render thumbnail `<img>` tags only when the manifest confirms an asset exists; otherwise render a local CSS fallback with no network request.
    - Use `data-thumbnail-src` plus `IntersectionObserver` so available thumbnails load as they enter view, and load large TOC zoom thumbnails only on hover.
    - Add a mobile/progressive render yield during flat catalogue construction so first interaction is not blocked by a single large DOM task.
  - Recurring issue prevention:
    - Symptom: loading a map on mobile can feel blocked by catalogue rebuilding and waves of missing thumbnail requests.
    - Root cause: state-only layer changes reused the full `updateMapList()`/`renderFlatView()` path, and thumbnail markup assumed every map/book/election thumbnail existed.
    - Permanent prevention action: `uiController.syncMapCatalogueState(...)` now patches loaded/visible row state in place, while build-generated `assets/thumbnails/manifest.json` gates every catalogue thumbnail render.
    - Verification evidence: new browser tests assert that representative map load causes `0` `renderFlatView()` calls, missing thumbnail IDs emit no request, and mobile-shaped catalogue rendering hydrates thumbnails lazily.
  - What I changed:
    - Added `syncMapCatalogueState(...)` in `js/ui-controller.js` and routed map load/unload/toggle/default-layer state updates through `App.syncCatalogueMapState()` instead of full catalogue rerenders.
    - Added manifest-backed thumbnail helpers in `js/ui-controller.js` for book, TOC, class member, grid, map-card, and variant thumbnails.
    - Added `IntersectionObserver` hydration for present thumbnails and hover-only loading for large TOC/variant previews.
    - Added render cancellation/yielding so mobile flat-catalogue construction is progressive rather than one uninterrupted task.
    - Added a short mobile idle delay before loading default layers when there is no URL state.
    - Updated `scripts/bundle.mjs` to regenerate `assets/thumbnails/manifest.json` during `npm run build`.
    - Bumped the app bundle cache-buster in `index.html` to `v=111`.
    - Added `tests/browser/mobile-catalogue-performance.spec.js`.
  - Verification:
    - `node --check js/ui-controller.js`
    - `node --check js/app.js`
    - `node --check scripts/bundle.mjs`
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.
    - `npm run test:browser -- tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `3 passed` after rerunning outside the sandbox because Chromium process spawning hit `EPERM`.
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `8 passed`.
    - `git diff --check` reported only existing line-ending warnings and no whitespace errors.
    - In-app browser smoke check loaded `http://127.0.0.1:5050/#layers=__none` at a mobile viewport. Console output showed only expected local static-server POST `501` errors for debug/RUM endpoints, a deprecated Apple mobile meta warning, and existing unused preload warnings.

Mobile browser crash recurrence: remove startup catalogue pressure
- [x] Reproduce/measure mobile startup and map-load pressure after the first performance fix
- [x] Prevent mobile startup from building the full flat catalogue while the map pane is active
- [x] Render a lightweight mobile catalogue shell first, then hydrate bounded batches only when catalogue is opened
- [x] Add tests proving mobile map startup/map load does not create the full catalogue DOM
- [x] Build and run browser regressions
- [x] Update lessons and record verification evidence
  - Recurrence:
    - Symptom: user still reports severe mobile lag and mobile browser crashes after commit `6636800`.
    - Root cause: the previous fix stopped state-only rerenders, but initial mobile startup could still render the full catalogue DOM from the flat-list setup path while the map pane was active. That hidden render could create enough card/table structure and thumbnail observation work to exceed real phone CPU/memory limits.
    - Permanent prevention action: mobile must be map-first. No full catalogue DOM should be built until the user opens the catalogue, and even then the first render must be bounded.
  - What I did:
    - added a mobile-only deferred catalogue shell so `#catalogueFlatView` is empty while the app is in map-first mobile state
    - hydrate the mobile catalogue only when the catalogue tab/pane is actually opened
    - limited the first mobile catalogue render to the first 24 map cards and skipped election/book catalogue cards until the user taps `Show more`
    - kept full catalogue access available through explicit expansion or TOC navigation to a deferred section
    - bumped the app bundle cachebuster to `v=112`
    - added Lesson 108 covering this recurring mobile performance failure mode
  - Verification:
    - `node --check js/ui-controller.js`
    - `node --check js/app.js`
    - `node --check scripts/bundle.mjs`
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.
    - `npm run test:browser -- tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `6 passed` after rerunning outside the sandbox because Chromium process spawning hit `EPERM`.
    - `npm run test:browser -- tests/browser/map-loading-pilots.spec.js tests/browser/catalogue-metadata.spec.js tests/browser/mobile-catalogue-performance.spec.js --workers 1` passed with `11 passed`.
    - New mobile assertions prove startup leaves the app in `map-full`, `#catalogueFlatView.dataset.rendered === 'deferred'`, and `0` catalogue descendants.
    - New mobile map-load assertion proves loading `roi-garda-sub-districts` does not call `renderFlatView`, keeps the hidden catalogue deferred, and leaves `0` catalogue descendants.
    - New mobile first-open assertion proves only a bounded catalogue subset renders: `<= 24` map cards, `0` election rows, `0` book cards, and a `Show more` control.
    - In-app browser smoke at `390x844` loaded `http://127.0.0.1:5051/#layers=__none`: `data-split-state="map-full"`, `data-rendered="deferred"`, `data-mobile-deferred="true"`, `0` catalogue descendants, map visible, and no console error logs.
    - `git diff --check` reported only line-ending warnings and no whitespace errors.

Election entry polygon, colour, and party-label audit
- [ ] Inventory all website election entries and the polygons/geographies they require
- [ ] Identify missing polygon links or missing polygon assets for those entries
- [ ] Inventory party labels and independent descriptors across election result files
- [ ] Compare configured party colours to Wikipedia-style party colours where a reliable party identity exists
- [ ] Report duplicate/inconsistent party labels and recommended normalisations
  - Scope:
    - Read the local website election data as source of truth for what appears on the site.
    - Use external references only for party colour comparison, not for rewriting the data in this task.

Election party aliases and party IDs
- [ ] Correct PUP aliasing to Progressive Unionist Party in the audit logic
- [ ] Normalise Workers Party / Republican Clubs by date, DUP, PBP, and Alliance labels
- [ ] Define stable Party IDs grouping aliases such as Ecology/Green and Republican Clubs/Workers Party
- [ ] Rerun audit and provide the next 10 party/ticket names

Election party aliases follow-up: Green, Alliance, independents, Solidarity-PBP, UUP
- [x] Normalise `Green/Comhaontas Glas` to `Green`
- [x] Normalise exact `A` to `Alliance`
- [x] Normalise `Independent Lozenge` to `Independent`
- [x] Normalise `Solidarity PBP` to `Solidarity-PBP`
- [x] Normalise `Of. Un.` to `UUP`
- [x] Rebuild party IDs/audit outputs and provide the top 100 party/ticket labels inline
  - What I changed:
    - Added the requested labels to `scripts/normalize-election-party-names.py`, including leading-space European-election `Lozenge` forms for Green, Independent, and Solidarity-PBP.
    - Added the same aliases to `scripts/build-election-party-ids.py` so generated Party IDs keep those historical labels grouped with their canonical party.
    - Added audit aliases for exact `A`, `Of. Un.`, and `Green`.
    - Added a lesson to prevent repeated ranked-table variant cleanup misses.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `886` election files on the first run and `0` on the second run.
    - Normalisation counts included `695` `Green/Comhaontas Glas -> Green`, `212` `A -> Alliance`, `140` leading-space `Independent Lozenge -> Independent`, `129` `Solidarity PBP -> Solidarity-PBP`, `115` `Of. Un. -> UUP`, `24` leading-space `Green/Comhaontas Glas Lozenge -> Green`, and `7` leading-space `Solidarity PBP Lozenge -> Solidarity-PBP`.
    - Structured party-field scan found no remaining stripped values of `Green/Comhaontas Glas`, `Green/Comhaontas Glas Lozenge`, `A`, `Independent Lozenge`, `Solidarity PBP`, `Solidarity PBP Lozenge`, or `Of. Un.`.
    - `python scripts\build-election-party-ids.py` wrote `800` party IDs and `1033` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1084` audit rows with counts `{no_election_colour: 823, colour_mismatch: 141, match: 71, no_wikipedia_match: 49}`.

Election party aliases follow-up: top-100 residual variants
- [x] Normalise `Rep. Clubs` to `Republican Clubs`
- [x] Normalise listed Conservative, BNP, Socialist Party, Nationalist, Alliance, Labour, IIP, Sinn Féin, UUP, Green, Independent, and Ulster Liberal variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact source normalisations for the requested residual labels in `scripts/normalize-election-party-names.py`.
    - Added `Labour Lozenge -> Irish Labour` after a stripped/Lozenge scan showed this was the remaining source of the ranked `Labour` label.
    - Updated `scripts/build-election-party-ids.py` with the matching alias groups for Republican Clubs, Conservative, BNP, Socialist Party, Nationalist Party, Alliance, Irish Labour, NI Labour Party, IIP, Sinn Féin, UUP, Green, Independent, Independent Nationalist, and Ulster Liberal.
    - Updated `scripts/audit-ireland-election-party-colours.py` with corresponding Wikipedia colour aliases where reliable rows exist.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `554` election files on the main pass and `53` more after adding `Labour Lozenge`; a final run reported `changed_files=0`.
    - Main-pass counts included `163` `Northern Ireland Labour Party -> NI Labour Party`, `143` `Socialist Party (Ireland) -> Socialist Party`, `139` `British National Party -> BNP`, `92` `Rep. Clubs -> Republican Clubs`, `85` `Irish Conservative -> Conservative`, `61` `Nationalist -> Nationalist Party`, `55` `Alliance Party -> Alliance`, `42` `N.I.L.P. -> NI Labour Party`, `39` `I.I.P. -> IIP`, `38` `S.F. -> Sinn Féin`, `37` `Off. Un -> UUP`, `35` `Ind. Nationalist -> Independent Nationalist`, `35` `Green Party -> Green`, `34` `Ulster Liberal Party -> Ulster Liberal`, `32` `O. Un -> UUP`, `27` `Non-Party -> Independent`, `27` `O.Un -> UUP`, `19` `N.I.L.P -> NI Labour Party`, and `6` `Irish Independence Party -> IIP`.
    - Follow-up counts included `45` leading-space `Labour Lozenge -> Irish Labour` and `38` remaining `Sinn FÃ©in -> Sinn Féin` repairs.
    - Structured party-field scan found no remaining stripped values for the requested old labels, including Lozenge-normalized `Labour`.
    - `python scripts\build-election-party-ids.py` wrote `789` party IDs and `1035` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1070` audit rows with counts `{no_election_colour: 812, colour_mismatch: 135, match: 74, no_wikipedia_match: 49}`.

Election party aliases follow-up: top-100 tail variants
- [x] Normalise Republican Labour, Newtownabbey Labour, UPUP, NI Unionist, Independent Alliance, SDLP long-form, and Democratic Left variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact source normalisations for `Republican Labour Party -> Republican Labour`, `Newtownabbey Labour Party -> Newtownabbey Labour`, `U.P.U.P. -> Ulster Popular Unionist Party`, `Northern Ireland Unionist Party -> NI Unionist Party`, `Independent Alliance (Non party) -> Independent Alliance`, `SDLP (Social Democratic and Labour Party) -> SDLP`, and `Democratic Left / New Agenda -> Democratic Left`.
    - Updated Party ID aliases for the same labels.
    - Added reliable Wikipedia colour-audit aliases for Republican Labour, UPUP, NI Unionist, SDLP long-form, and Democratic Left.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `94` election files, then a final run reported `changed_files=0`.
    - Counts were `25` `SDLP (Social Democratic and Labour Party) -> SDLP`, `21` `Independent Alliance (Non party) -> Independent Alliance`, `21` `Democratic Left / New Agenda -> Democratic Left`, `21` `Northern Ireland Unionist Party -> NI Unionist Party`, `21` `U.P.U.P. -> Ulster Popular Unionist Party`, `20` `Newtownabbey Labour Party -> Newtownabbey Labour`, and `18` `Republican Labour Party -> Republican Labour`.
    - Structured party-field scan found no remaining stripped values for the old labels.
    - `python scripts\build-election-party-ids.py` wrote `785` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1066` audit rows with counts `{no_election_colour: 809, colour_mismatch: 136, match: 74, no_wikipedia_match: 47}`.

Election party aliases follow-up: top-120 residual variants
- [x] Normalise UUP, Alliance, Independent, UPNI, Republican Clubs/Workers' Party, Ulster Liberal, Conservative, and Official Unionist variants from the top-120 table
- [x] Handle `Rep Clubs` conditionally as `Workers' Party` when Workers' Party candidates stood in the same election, otherwise `Republican Clubs`
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact normalisations for `O.U.`, `UU`, `AP`, `Of.Un.`, `O Un`, `O Un.`, `Independent Un.`, `IND`, `U.P.N.I.`, `INDP`, `Ind. Unionist`, `Lib`, `Conservative and Unionist`, `Official Unionist`, and `Non. Party`.
    - Added an election-context normalisation path for `Rep Clubs`; it becomes `Workers' Party` only when the same election directory already contains `Workers' Party`, otherwise `Republican Clubs`.
    - Updated Party ID aliases and colour-audit aliases for the same canonical labels.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `147` election files, then a final run reported `changed_files=0`.
    - Counts included `17` `Non. Party -> Independent`, `17` `O Un. -> UUP`, `16` `Lib -> Ulster Liberal`, `16` `Official Unionist -> UUP`, `16` `Conservative and Unionist -> Conservative`, `15` `Ind. Unionist -> Independent Unionist`, `15` `INDP -> Independent`, `15` `Rep Clubs -> Republican Clubs`, `15` `U.P.N.I. -> Unionist Party of Northern Ireland`, `14` `Independent Un. -> Independent Unionist`, `14` `O Un -> UUP`, `14` `Of.Un. -> UUP`, `14` `IND -> Independent`, `14` `UU -> UUP`, `13` `AP -> Alliance`, and `13` `O.U. -> UUP`.
    - No `Rep Clubs` files were in an election directory containing `Workers' Party`, so the conditional branch correctly produced `Republican Clubs` for all current `Rep Clubs` instances.
    - Structured party-field scan found no remaining stripped values for the requested old labels.
    - `python scripts\build-election-party-ids.py` wrote `775` party IDs and `1038` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1052` audit rows with counts `{no_election_colour: 795, colour_mismatch: 136, match: 74, no_wikipedia_match: 47}`.

Election party aliases follow-up: top-150 residual variants
- [x] Normalise NI Labour, Unionist, IIP, DUP, SDLP, UUP, Vanguard, Green, Independent, Workers' Party, and related residual variants
- [x] Update party-ID and colour-audit alias helpers for the same canonical labels
- [x] Rebuild party IDs/audit outputs and verify old labels are absent from party fields
  - What I changed:
    - Added exact normalisations for `NI Labour Party -> NI Labour`, `Un.`/`Un -> Unionist`, `I.I.P. Nationalist -> IIP`, `D.U U.U.U.C -> DUP`, `U.D.U.P. -> DUP`, SDLP long-form variants, `O. Ul. Un. -> UUP`, `DUP - Leader Ian Paisley -> DUP`, `Van. Un. -> Vanguard Unionist Progressive Party`, `Ulster Unionist U.U.P` variants to `UUP`, `The Green Party -> Green`, `Loy. D.U. -> DUP`, `Independant -> Independent`, `Ulster DUP -> DUP`, `Democratic Unionist - -> DUP`, bare `Workers'`/`Workers' Lozenge -> Workers' Party`, and `UUP U.U.U.C` variants to `UUP`.
    - Updated Party ID and colour-audit aliases for the same canonical labels.
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\build-election-party-ids.py scripts\audit-ireland-election-party-colours.py`
    - `python scripts\normalize-election-party-names.py` changed `330` election files on the first pass and `7` files on the follow-up `Ulster Unionist U.U.P` pass; a final run reported `changed_files=0`.
    - First-pass counts included `224` `NI Labour Party -> NI Labour`, `112` `Un. -> Unionist`, `32` `Un -> Unionist`, `13` leading-space `Workers' Lozenge -> Workers' Party`, `13` `UUP U.U.U.C. -> UUP`, `12` `SDLP-Social Democratic and Labour Party -> SDLP`, `11` `Ulster DUP -> DUP`, `10` `Van. Un. -> Vanguard Unionist Progressive Party`, `10` `Loy. D.U. -> DUP`, `10` `Democratic Unionist - -> DUP`, `10` `Independant -> Independent`, `10` `The Green Party -> Green`, `10` `Social Democratic and Labour Party (SDLP) -> SDLP`, `8` `O. Ul. Un. -> UUP`, `8` `U.D.U.P. -> DUP`, `8` `DUP - Leader Ian Paisley -> DUP`, `8` malformed `SDLP (Social Democratic and Labour Party -> SDLP`, `7` `D.U U.U.U.C -> DUP`, and `7` `I.I.P. Nationalist -> IIP`.
    - Follow-up counts included `10` `Ulster Unionist U.U.P. -> UUP` and `7` `Ulster Unionist U.U.P -> UUP`.
    - Structured party-field scan found no remaining stripped values for the requested old labels or the obvious SDLP/UUP/Workers variants handled in this batch.
    - `python scripts\build-election-party-ids.py` wrote `759` party IDs and `1040` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1032` audit rows with counts `{no_election_colour: 777, colour_mismatch: 135, match: 73, no_wikipedia_match: 47}`.

Review IDB zip: counties and local-authority maps
- [x] Extract relevant FGBs to a repo-local temp folder
- [x] Confirm the 1922/1927 counties files and the 1930/1931/1941/1942/1944/1950 local-authority files are present and readable
- [x] Compare them against current site map entries and existing local data files
- [x] Explain feasibility of adding/replacing them on the site
  - What I checked:
    - Extracted the eight relevant files from `C:\Users\scomo\Downloads\Irish Digitised Boundaries-20260525T185841Z-3-001.zip` into `tasks\idb-review-temp`.
    - Confirmed `1922 Counties.fgb`, `1927 Counties.fgb`, and local-authority `1930`, `1931`, `1941`, `1942`, `1944`, `1950` FGBs are present and readable with GDAL.
    - Confirmed `1927 Counties.fgb` has the same SHA256 as the current `data\maps\baronies-parishes\Counties_Ireland_1922.fgb`, so the old on-site 1922 counties asset is exactly the proposed 1927 counties asset.
    - Confirmed new `1922 Counties.fgb` is a distinct file and should replace the current 1922 counties asset if implemented.
    - Confirmed all six new ROI local-authority FGBs use the same schema as current ROI local-authority files: `ENGLISH`, `GAEILGE`, `COUNTYNAME`.
    - Confirmed the current ROI local-authority catalogue stops at 1953, so `1930`, `1931`, `1941`, `1942`, `1944`, and `1950` are feasible new entries.
  - Verification evidence:
    - Counties: 32 features, WGS84, fields `CONTAE`, `COUNTY`, `PROVINCE`.
    - Local authorities: 31 features each, WGS84, fields `ENGLISH`, `GAEILGE`, `COUNTYNAME`.
    - `1927 Counties.fgb` SHA256: `BB8DE5CEB19EF709ADC334B64A83AA29EA332297D95C137DB2C76E9FC54839D1`.
    - Current `Counties_Ireland_1922.fgb` SHA256: `BB8DE5CEB19EF709ADC334B64A83AA29EA332297D95C137DB2C76E9FC54839D1`.
    - New `1922 Counties.fgb` SHA256: `58A87E20977F0D97DB058A2E514C9613C14B15371B3903A186661B57C35248BF`.

Investigate production map-file deployment path
- [x] Determine whether production serves map FGBs from Pages static files or R2/data.civgraph.net
- [x] Determine what this means for adding the new IDB county and local-authority maps
- [x] Record the required deployment steps
  - What I found:
    - `.cfignore` excludes `data/maps/**/*.fgb`, `data/maps/**/*.fgb.gz`, and map chunk JSON files from the Cloudflare Pages artifact.
    - `functions/data/maps/[[path]].js` serves `/data/maps/*` from the `MAPS_BUCKET` R2 binding when that binding exists.
    - `data/database/maps.json` overwhelmingly points FGB files at `https://data.civgraph.net/data/maps/...`: 602 of 621 FGB references use that external data host; 19 legacy/relative references remain.
    - The relevant county/local-authority catalogue patterns already use `https://data.civgraph.net/...`.
    - `https://data.civgraph.net/data/maps/local-government/ROI_Local_Authorities_1953.fgb` returns `200 OK`, `application/octet-stream`, and byte length `2903744`, confirming the data host is live for production map bytes.
    - A small GET against `https://civgraph.net/data/maps/local-government/ROI_Local_Authorities_1953.fgb` also returns `application/octet-stream` via the Pages Function/R2 path; a HEAD request to that same-origin path is misleading because only GET is implemented by the function.
    - `https://civgraph.net/data/database/maps.json` returns `Cache-Control: public, max-age=0, must-revalidate`, so catalogue metadata deploys through the site origin and revalidates.
  - Required deployment consequence:
    - Adding these maps requires both repo/catalogue changes and R2 object uploads.
    - For each new or replaced FGB key, upload the base `.fgb` and compressed `.fgb.gz`; `.br` is desirable for consistency with the generic R2 tooling, though the current worker explicitly tries `.gz` before raw.
    - Generate and upload `-lod0.fgb` and `-lod1.fgb` plus their compressed variants before setting or keeping `useLOD: true`.

Add 2026-05-25 IDB county and ROI local-authority maps
- [x] Preserve current 1922 counties bytes as the new 1927 counties asset
- [x] Replace 1922 counties with the newly supplied Tirconaill/Donegal-aware file
- [x] Add ROI local-authority FGBs for 1930, 1931, 1941, 1942, 1944, and 1950
- [x] Update `data/database/maps.json` class ordering and map/variant metadata
- [x] Generate `-lod0` and `-lod1` FGBs for all new/replaced assets
- [x] Create compressed `.gz` and `.br` variants for upload consistency
- [x] Upload the base, LOD, and compressed map objects to R2
- [x] Verify public URLs, JSON validity, and representative map metadata
  - What I changed:
    - Copied the previous `Counties_Ireland_1922.fgb` bytes to `Counties_Ireland_1927.fgb`.
    - Replaced `Counties_Ireland_1922.fgb` with the new zip-supplied 1922 counties file.
    - Added local source files for `ROI_Local_Authorities_1930`, `1931`, `1941`, `1942`, `1944`, and `1950`.
    - Added `counties-ireland-1927` as a variant under `counties-ireland` and updated the 1922 label to identify the Tirconaill version.
    - Added the six new ROI local-authority map entries and appended them to the `roi-local-authorities` class after 1953.
    - Added one-off scripts for the structured metadata update and LOD/compression generation.
  - R2 upload:
    - The first Wrangler upload ran against local R2 because `--remote` was omitted; public URL checks caught this immediately.
    - Reran the upload with `--remote`.
    - Uploaded 72 production R2 objects: 8 base maps plus `-lod0`, `-lod1`, `.gz`, and `.br` variants.
    - Retried three transient Wrangler failures successfully: `Counties_Ireland_1922.fgb.br`, `ROI_Local_Authorities_1931-lod1.fgb.br`, and `ROI_Local_Authorities_1941.fgb`.
  - Verification:
    - Public `https://data.civgraph.net/...` HEAD checks verified all 72 objects returned `200` and matched local `Content-Length`.
    - `node --check scripts\add-idb-20260525-maps.mjs`
    - `node --check scripts\build-idb-20260525-lods.mjs`
    - Parsed `data/database/maps.json` and confirmed all expected new IDs are present.
    - `ogrinfo -so` opened representative 1922, 1927, and 1930 FGBs successfully.
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.

Commit election party-normalisation data changes
- [x] Verify the normalization scripts and generated election data are internally consistent
- [x] Stage only election-related files, leaving unrelated dirty worktree files untouched
- [x] Commit the staged election data changes
  - Verification:
    - `python -m py_compile scripts\normalize-election-party-names.py scripts\audit-ireland-election-party-colours.py scripts\build-election-party-ids.py scripts\extract-wikipedia-party-colours.py`
    - `node --check election-viewer-package\js\stages2.js`
    - `python scripts\normalize-election-party-names.py` reported `changed_files=0`.
    - `python scripts\build-election-party-ids.py` wrote `759` party IDs and `1040` aliases.
    - `python scripts\audit-ireland-election-party-colours.py` wrote `1032` audit rows with counts `{no_election_colour: 777, colour_mismatch: 135, match: 73, no_wikipedia_match: 47}`.
    - Parsed `7344` election JSON files successfully.
    - `git diff --check` reported only line-ending warnings for `stages2.js` and `tasks/todo.md`.
    - `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox.

Fix county catalogue entries and reassess mobile civil-parishes performance
- [x] Move the newly added county maps out of the 1977 county variants and into direct County catalogue-card entries
- [x] Verify `maps.json`, catalogue membership, and build output
- [x] Replace Civil Parishes group loading with a single unified all-Ireland civil-parishes layer backed by LOD/chunk assets
- [x] Review the civil-parishes mobile load path and identify remaining high-impact optimisations versus a MapLibre GL migration
  - Recurring issue:
    - Symptom: Mobile browsers lagged for 10+ seconds or crashed when loading Civil Parishes.
    - Root cause: the catalogue entry loaded multiple province-level layers and allowed fallback to a very large full-resolution FGB; early regenerated chunks also duplicated boundary-crossing features across multiple chunk files.
    - Permanent prevention action: use a single all-Ireland Civil Parishes entry backed by LOD overview files, viewport chunks, mobile LOD caps, chunk-only fallback behavior, representative-point chunk assignment, and versioned generated asset names to avoid stale CDN chunk files.
    - Verification evidence: metadata check confirms `civil-parishes-by-province` is no longer a group, points to `Civil_Parishes_Ireland_v2.fgb`, has `chunkOnly: true`, `chunkOverviewMaxZoom: 13`, `mobileMaxLODLevel: 1`, and the generated chunk index has `64` chunks with `2448` feature refs for `2448` source features.
  - Review:
    - County catalogue: `ni-counties` now includes `counties-ireland`, `counties-ireland-1927`, and `counties-ireland-1922` as direct catalogue-card maps.
    - Civil Parishes data: generated unified base FGB, LOD0/LOD1/LOD2 files, and versioned chunk files with `scripts/build-unified-civil-parishes.py`.
    - Data host: uploaded the versioned v2 Civil Parishes assets with `scripts/upload-unified-civil-parishes.mjs`.
    - Public asset verification: range-GET checked `159/159` v2 public objects on `data.civgraph.net` with matching object sizes.
    - Browser-cache hardening: bumped app bundle query string to `v113`, moved dynamic build chunks under `build/chunks/v113/`, and bumped the service-worker cache version to `v3` so existing phones do not reuse stale map-controller chunks.
    - Code checks: `python -m py_compile scripts\build-unified-civil-parishes.py`, `node --check scripts\upload-unified-civil-parishes.mjs`, `node --check js\app.js`, and `node --check js\map-controller.js` all passed.
    - Build: `npm run build` passed after rerunning outside the sandbox because esbuild process spawning hit `EPERM` inside the sandbox; after cache-busting changes, `node --check scripts\bundle.mjs` and `node --check sw.js` also passed.

Fix Civil Parishes initial map fit
- [x] Reproduce/identify why selecting Civil Parishes zooms to a random part of Ireland
- [x] Make chunked-layer fitting prefer configured full-map bounds over currently rendered chunk bounds
- [x] Add explicit all-Ireland bounds to the Civil Parishes metadata
- [x] Verify metadata, build output, and production behaviour
- [x] Commit and push the focused fix
  - Review:
    - Root cause: `fitToLayer()` fitted chunked/spatial layers to the currently rendered Leaflet group before checking configured bounds; for chunked maps that group can be only the current viewport subset.
    - Fix: chunked/spatial layers now prefer configured full-map bounds in `fitToLayer()` and `fitToLayers()`, and Civil Parishes has explicit all-Ireland bounds `[[51.35,-10.75],[55.55,-5.35]]`.
    - Browser-cache prevention: bumped the app entry to `app.bundle.js?v=114`, dynamic chunks to `build/chunks/v114/`, and service worker cache to `v4`.
    - Verification: `node --check js\map-controller.js`, `node --check scripts\bundle.mjs`, `node --check sw.js`, Civil Parishes metadata validation, `npm run build`, and local cache-busting output checks passed. Production poll confirmed `app.bundle.js?v=114`, service worker `v4`, and the new bounds are live. Playwright production smoke from a deliberately high zoom loaded Civil Parishes at zoom `6`, centered around `53.5020,-8.0500`, with configured bounds present and no load error.

Audit maps for chunked-layer random-fit risk
- [x] Define static failure signature for the Civil Parishes random-fit bug
- [x] Scan `data/database/maps.json` for chunked/spatial catalogue maps without configured full-map bounds
- [x] Cross-check chunk indexes and generated data extents where available
- [x] Classify affected maps by severity and provide findings
  - Review:
    - Failure signature: a loadable map entry has `chunked: true` / spatial loading, has a working chunk index, and lacks configured `bounds`, so `fitToLayer()` / `fitToLayers()` can still fit to the currently rendered chunk subset rather than the full geography.
    - CLI audit covered 901 loadable map/variant entries from `maps.json`, including variants resolved the same way as `dataService.getMapById()`.
    - 71 loadable entries are marked chunked; 34 currently have working chunk indexes locally or on production; 33 of those 34 lack full-map bounds and retain the same class of fit risk.
    - Civil Parishes is the only working chunked entry protected by configured bounds.
    - No `isGroup` entry directly loads a risky chunked child, so no additional group-only risk was found.

Implement chunked-map fit bounds fix
- [x] Derive full-map bounds for currently indexed chunked maps
- [x] Add explicit bounds to affected chunked map metadata
- [x] Add a controller fallback that can use loaded chunk-index bounds if metadata bounds are missing
- [x] Verify metadata coverage, syntax, and production build
- [x] Commit and push the fix
  - Review:
    - Added explicit bounds to the 33 indexed chunked entries that previously lacked them, using chunk-index extents from local files or production/R2 indexes.
    - Added a map-controller fallback that stores `_chunkIndexBounds` on loaded chunked layers and lets `fitToLayer()` / `fitToLayers()` use those bounds if future metadata is missing `bounds`.
    - Bumped app cache keys to `app.bundle.js?v=115`, dynamic chunks under `build/chunks/v115/`, and service worker cache `v5`.
    - Verification: maps JSON parses, `node --check js\map-controller.js`, `node --check scripts\bundle.mjs`, `node --check sw.js`, indexed-chunked coverage audit now reports `chunkedWithIndex: 34` and `missingBounds: []`, `npm run build` passes, cache-busting output checks pass, and production now serves `app.bundle.js?v=115`, service worker `v5`, and representative new bounds metadata.
