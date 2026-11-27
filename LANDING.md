# w24-browser-tests: the 7 failing browser tests (owner request, 27 Nov 2026)

Branch `w24-browser-tests`, from main 9d5d924e9e. Tests and baselines only: no site code,
data or package change.

| # | Test | Cause | Fix |
|---|------|-------|-----|
| 1-4 | visual-regression `gallery {375,1280}px {light,dark}`: map-timeline-changes specimen | Stale baselines (13 Nov). The specimen changed on purpose in e7ea962800 (20 Nov, owner-approved timeline panel): heading names only the later edition ("Changes, 1985", was "Changes, 1973 to 1985"), the summary reads "3 changes (1 rename), 120 ha in all." (was "3 areas changed"), the key gains a "renamed" swatch, the zoom button is the Lucide "maximize" frame instead of the magnifier. At 375px the longer summary wraps, so the rows below move. Nothing else differs. | The four `gallery-map-timeline-changes-*-win32.png` baselines regenerated (`--update-snapshots=changed`; no other specimen rewritten). |
| 5 | app.spec `MapLibre controls handle opacity, labels, feature details, and active layers` | Stale test. Since the OT22 styling (7ad0d6fbf4, 23 Nov; shown to every reader 24 Nov) a DOM map label carries the Irish name as a second line (`.map-label__ga`), so the marker's whole `textContent` is "KilnamanaghCill na Manach"; the details pane leads with the English name "Kilnamanagh", as designed. | The test reads the label's English line (its first div) and asserts it is not empty before comparing. |
| 6 | approximate-segments `an edition with approximate stretches draws them dotted and names them in the legend` | Stale test. Stormont 1969 lost its approximateSegments when it became a partial edition (9fcd06eb07, 16 Nov: only lines taken whole from the sources). The only edition that still has them is lgd-1991-provisional. | The test picks whichever edition's metadata carries `approximateSegments` (now lgd-1991-provisional), and fails clearly if none does. The fixture answers the segment request as before. |
| 7 | elections-app `data limits: a contest without its losers says so...` | Data legitimately changed. Newcastle UD 1967 was completed on 19 Nov (94646fc35e, BNA batch 307): the Belfast Telegraph names the two defeated candidates, so 11 candidates for 9 seats and no "losers" note, which is correct. | The test now uses Newcastle UD 1946 (9 elected of 21 candidates, only the elected printed; one contest in its election, so "in 1 contest," still holds). |

Leftover data flag for the owner (not changed): 16 of the 23 contest files with `losersNotPrinted: true`
now hold more candidates than seats, i.e. losers have since been found (Newcastle 1961/1967,
Ballymoney 1946/58/61, Banbridge 1961 West, Holywood 1952/64, Lisburn 1961 Central/North/South,
Newtownards 1958 Glen, Portrush 1949/52/64, Warrenpoint 1967 West). The flag only changes the
wording of a note that is shown when losers are missing, so nothing on the site is wrong.

## Architecture rules
- Rules touched: none (test files and visual baselines only).
- Exceptions added: none; baseline entries added: none.
- check:architecture: new findings 0; baseline unchanged.
- R2 no copies: yes
- R3 real seams, no new dependencies: yes (no package.json change)
- R4 one data door: yes (n/a)
- R8 cleanup beyond listeners (maps, workers, timers): yes (n/a)
- R10 text keyed: yes (n/a, no interface text)
- R12 logic pure and tested: yes (n/a)
- Prototype deferrals (R14): none
