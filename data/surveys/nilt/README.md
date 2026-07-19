# NILT microdata (Northern Ireland Life and Times survey)

Raw SPSS `.sav` waves as published by ARK (https://www.ark.ac.uk/nilt/),
1998–2025, one file per survey year (`<year>_<original>.sav`). Public
teaching datasets; no access restrictions.

Persisted here for durability — the border-poll projection's learned model
(`analysis/border-poll-dry-run/v8/`) trains on the harmonised extract derived
from these files. Source of truth for provenance `survey-microdata (NILT)`.

Key harmonised variables (names vary by wave; see v8 extractor):
- constitutional preference: NIRELND2 / NIRELAND / nireland (1998–2025)
- direct border-poll VI: REFUNIFY / BORDPOLL (2006, 2017, 2019–2025)
- community background: FAMRCODE / RELIGCAT / RELIGION
- age: RAGECAT / RAGEGRP / RAGE; sex: RSEX; weight: WTFACTOR
