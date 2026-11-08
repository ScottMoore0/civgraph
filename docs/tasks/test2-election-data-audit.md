# Test2 Election Data Audit

Generated: 2026-11-08T18:02:22.956Z

This is a repeatable repository-local audit of the generated /test2 election data, Browse election entries, source/reference records, transfer/count payload availability, and saved Wikipedia party-colour comparison outputs. It intentionally does not fetch live web pages, so CI can run it deterministically.

## Summary

|area|value|
|---|---:|
|parent elections in manifest|2368|
|manifest loadable elections|614|
|manifest placeholders|569|
|Browse parent election entries|2414|
|Browse constituency/DEA sub-entries|21010|
|Browse overall sub-entries|2368|
|source detail records|0|
|result bundles loaded|0|
|result rows audited|0|
|candidate rows audited|0|
|rows with count detail|0|
|rows with animation payload|0|
|rows expected to have transfer/count data|0|
|expected transfer/count rows missing detail|0|
|valid-poll review sidecar records|0|
|candidate-row review sidecar records|0|
|party-colour review sidecar records|10|
|blocking issues|2368|
|warnings|2369|

## Blocking Structural Issues

|severity|category|key|message|
|---|---|---|---|
|blocking|result-file-missing|dail-eireann__2026-05-22|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2026-05-22.json.|
|blocking|result-file-missing|ireland-president__2025-10-24|Result bundle is missing: /render/metadata/elections-test2/ireland-president__2025-10-24.json.|
|blocking|result-file-missing|dail-eireann__2024-11-29|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2024-11-29.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2024-07-04|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2024-07-04.json.|
|blocking|result-file-missing|ireland-european__2024-06-07|Result bundle is missing: /render/metadata/elections-test2/ireland-european__2024-06-07.json.|
|blocking|result-file-missing|ireland-local__2024-06-07|Result bundle is missing: /render/metadata/elections-test2/ireland-local__2024-06-07.json.|
|blocking|result-file-missing|ireland-referendum__2024-03-08-care|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2024-03-08-care.json.|
|blocking|result-file-missing|ireland-referendum__2024-03-08-the-family|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2024-03-08-the-family.json.|
|blocking|result-file-missing|local-government-local-government-districts__2023-05-18|Result bundle is missing: /render/metadata/elections-test2/local-government-local-government-districts__2023-05-18.json.|
|blocking|result-file-missing|northern-ireland-assembly__2022-05-05|Result bundle is missing: /render/metadata/elections-test2/northern-ireland-assembly__2022-05-05.json.|
|blocking|result-file-missing|dail-eireann__2021-07-08|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2021-07-08.json.|
|blocking|result-file-missing|dail-eireann__2020-02-08|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2020-02-08.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2019-12-12|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2019-12-12.json.|
|blocking|result-file-missing|dail-eireann__2019-11-29|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2019-11-29.json.|
|blocking|result-file-missing|ireland-referendum__2019-05-24-regulation-of-divorce|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2019-05-24-regulation-of-divorce.json.|
|blocking|result-file-missing|ireland-european__2019-05-24|Result bundle is missing: /render/metadata/elections-test2/ireland-european__2019-05-24.json.|
|blocking|result-file-missing|ireland-local__2019-05-24|Result bundle is missing: /render/metadata/elections-test2/ireland-local__2019-05-24.json.|
|blocking|result-file-missing|european-parliament__2019-05-23|Result bundle is missing: /render/metadata/elections-test2/european-parliament__2019-05-23.json.|
|blocking|result-file-missing|local-government-local-government-districts__2019-05-02|Result bundle is missing: /render/metadata/elections-test2/local-government-local-government-districts__2019-05-02.json.|
|blocking|result-file-missing|ireland-referendum__2018-10-26-repeal-of-blasphemy-offence|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2018-10-26-repeal-of-blasphemy-offence.json.|
|blocking|result-file-missing|ireland-president__2018-10-26|Result bundle is missing: /render/metadata/elections-test2/ireland-president__2018-10-26.json.|
|blocking|result-file-missing|local-government-mid-and-east-antrim__2018-10-18|Result bundle is missing: /render/metadata/elections-test2/local-government-mid-and-east-antrim__2018-10-18.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2018-08-29|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2018-08-29.json.|
|blocking|result-file-missing|ireland-referendum__2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2018-05-03|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2018-05-03.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2017-06-08|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2017-06-08.json.|
|blocking|result-file-missing|northern-ireland-assembly__2017-03-02|Result bundle is missing: /render/metadata/elections-test2/northern-ireland-assembly__2017-03-02.json.|
|blocking|result-file-missing|northern-ireland-referendum__2016-06-23-eu-membership|Result bundle is missing: /render/metadata/elections-test2/northern-ireland-referendum__2016-06-23-eu-membership.json.|
|blocking|result-file-missing|northern-ireland-assembly__2016-05-05|Result bundle is missing: /render/metadata/elections-test2/northern-ireland-assembly__2016-05-05.json.|
|blocking|result-file-missing|dail-eireann__2016-02-26|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2016-02-26.json.|
|blocking|result-file-missing|ireland-referendum__2015-05-22-age-of-president|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2015-05-22-age-of-president.json.|
|blocking|result-file-missing|ireland-referendum__2015-05-22-equal-marriage|Result bundle is missing: /render/metadata/elections-test2/ireland-referendum__2015-05-22-equal-marriage.json.|
|blocking|result-file-missing|dail-eireann__2015-05-22|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2015-05-22.json.|
|blocking|result-file-missing|house-of-commons-of-the-united-kingdom__2015-05-07|Result bundle is missing: /render/metadata/elections-test2/house-of-commons-of-the-united-kingdom__2015-05-07.json.|
|blocking|result-file-missing|dail-eireann__2014-10-10|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2014-10-10.json.|
|blocking|result-file-missing|dail-eireann__2014-05-23|Result bundle is missing: /render/metadata/elections-test2/dail-eireann__2014-05-23.json.|
|blocking|result-file-missing|ireland-european__2014-05-23|Result bundle is missing: /render/metadata/elections-test2/ireland-european__2014-05-23.json.|
|blocking|result-file-missing|ireland-local__2014-05-23|Result bundle is missing: /render/metadata/elections-test2/ireland-local__2014-05-23.json.|
|blocking|result-file-missing|european-parliament__2014-05-22|Result bundle is missing: /render/metadata/elections-test2/european-parliament__2014-05-22.json.|
|blocking|result-file-missing|local-government-local-government-districts__2014-05-22|Result bundle is missing: /render/metadata/elections-test2/local-government-local-government-districts__2014-05-22.json.|

_2328 more not shown; see JSON report._

## Warning Issues

|severity|category|key|message|
|---|---|---|---|
|warning|browse-parent-count|data/browse/elections.json|Browse has 2414 parent elections, manifest has 2368.|
|warning|source-record-missing|dail-eireann__2026-05-22|No election source detail record found at data/browse/details/elections/dail-eireann-2026-05-22.json or data/browse/details/sources/election-source-dail-eireann-2026-05-22.json.|
|warning|source-record-missing|ireland-president__2025-10-24|No election source detail record found at data/browse/details/elections/ireland-president-2025-10-24.json or data/browse/details/sources/election-source-ireland-president-2025-10-24.json.|
|warning|source-record-missing|dail-eireann__2024-11-29|No election source detail record found at data/browse/details/elections/dail-eireann-2024-11-29.json or data/browse/details/sources/election-source-dail-eireann-2024-11-29.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2024-07-04|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2024-07-04.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2024-07-04.json.|
|warning|source-record-missing|ireland-european__2024-06-07|No election source detail record found at data/browse/details/elections/ireland-european-2024-06-07.json or data/browse/details/sources/election-source-ireland-european-2024-06-07.json.|
|warning|source-record-missing|ireland-local__2024-06-07|No election source detail record found at data/browse/details/elections/ireland-local-2024-06-07.json or data/browse/details/sources/election-source-ireland-local-2024-06-07.json.|
|warning|source-record-missing|ireland-referendum__2024-03-08-care|No election source detail record found at data/browse/details/elections/ireland-referendum-2024-03-08-care.json or data/browse/details/sources/election-source-ireland-referendum-2024-03-08-care.json.|
|warning|source-record-missing|ireland-referendum__2024-03-08-the-family|No election source detail record found at data/browse/details/elections/ireland-referendum-2024-03-08-the-family.json or data/browse/details/sources/election-source-ireland-referendum-2024-03-08-the-family.json.|
|warning|source-record-missing|local-government-local-government-districts__2023-05-18|No election source detail record found at data/browse/details/elections/local-government-local-government-districts-2023-05-18.json or data/browse/details/sources/election-source-local-government-local-government-districts-2023-05-18.json or data/browse/details/elections/local-government-2023-05-18.json or data/browse/details/sources/election-source-local-government-2023-05-18.json.|
|warning|source-record-missing|northern-ireland-assembly__2022-05-05|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2022-05-05.json or data/browse/details/sources/election-source-northern-ireland-assembly-2022-05-05.json.|
|warning|source-record-missing|dail-eireann__2021-07-08|No election source detail record found at data/browse/details/elections/dail-eireann-2021-07-08.json or data/browse/details/sources/election-source-dail-eireann-2021-07-08.json.|
|warning|source-record-missing|dail-eireann__2020-02-08|No election source detail record found at data/browse/details/elections/dail-eireann-2020-02-08.json or data/browse/details/sources/election-source-dail-eireann-2020-02-08.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2019-12-12|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2019-12-12.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2019-12-12.json.|
|warning|source-record-missing|dail-eireann__2019-11-29|No election source detail record found at data/browse/details/elections/dail-eireann-2019-11-29.json or data/browse/details/sources/election-source-dail-eireann-2019-11-29.json.|
|warning|source-record-missing|ireland-referendum__2019-05-24-regulation-of-divorce|No election source detail record found at data/browse/details/elections/ireland-referendum-2019-05-24-regulation-of-divorce.json or data/browse/details/sources/election-source-ireland-referendum-2019-05-24-regulation-of-divorce.json.|
|warning|source-record-missing|ireland-european__2019-05-24|No election source detail record found at data/browse/details/elections/ireland-european-2019-05-24.json or data/browse/details/sources/election-source-ireland-european-2019-05-24.json.|
|warning|source-record-missing|ireland-local__2019-05-24|No election source detail record found at data/browse/details/elections/ireland-local-2019-05-24.json or data/browse/details/sources/election-source-ireland-local-2019-05-24.json.|
|warning|source-record-missing|european-parliament__2019-05-23|No election source detail record found at data/browse/details/elections/european-parliament-2019-05-23.json or data/browse/details/sources/election-source-european-parliament-2019-05-23.json.|
|warning|source-record-missing|local-government-local-government-districts__2019-05-02|No election source detail record found at data/browse/details/elections/local-government-local-government-districts-2019-05-02.json or data/browse/details/sources/election-source-local-government-local-government-districts-2019-05-02.json or data/browse/details/elections/local-government-2019-05-02.json or data/browse/details/sources/election-source-local-government-2019-05-02.json.|
|warning|source-record-missing|ireland-referendum__2018-10-26-repeal-of-blasphemy-offence|No election source detail record found at data/browse/details/elections/ireland-referendum-2018-10-26-repeal-of-blasphemy-offence.json or data/browse/details/sources/election-source-ireland-referendum-2018-10-26-repeal-of-blasphemy-offence.json.|
|warning|source-record-missing|ireland-president__2018-10-26|No election source detail record found at data/browse/details/elections/ireland-president-2018-10-26.json or data/browse/details/sources/election-source-ireland-president-2018-10-26.json.|
|warning|source-record-missing|local-government-mid-and-east-antrim__2018-10-18|No election source detail record found at data/browse/details/elections/local-government-mid-and-east-antrim-2018-10-18.json or data/browse/details/sources/election-source-local-government-mid-and-east-antrim-2018-10-18.json or data/browse/details/elections/local-government-2018-10-18.json or data/browse/details/sources/election-source-local-government-2018-10-18.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2018-08-29|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2018-08-29.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2018-08-29.json.|
|warning|source-record-missing|ireland-referendum__2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment|No election source detail record found at data/browse/details/elections/ireland-referendum-2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment.json or data/browse/details/sources/election-source-ireland-referendum-2018-05-25-regulation-of-termination-of-pregnancy-repeal-of-8th-amendment.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2018-05-03|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2018-05-03.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2018-05-03.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2017-06-08|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2017-06-08.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2017-06-08.json.|
|warning|source-record-missing|northern-ireland-assembly__2017-03-02|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2017-03-02.json or data/browse/details/sources/election-source-northern-ireland-assembly-2017-03-02.json.|
|warning|source-record-missing|northern-ireland-referendum__2016-06-23-eu-membership|No election source detail record found at data/browse/details/elections/northern-ireland-referendum-2016-06-23-eu-membership.json or data/browse/details/sources/election-source-northern-ireland-referendum-2016-06-23-eu-membership.json.|
|warning|source-record-missing|northern-ireland-assembly__2016-05-05|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2016-05-05.json or data/browse/details/sources/election-source-northern-ireland-assembly-2016-05-05.json.|
|warning|source-record-missing|dail-eireann__2016-02-26|No election source detail record found at data/browse/details/elections/dail-eireann-2016-02-26.json or data/browse/details/sources/election-source-dail-eireann-2016-02-26.json.|
|warning|source-record-missing|ireland-referendum__2015-05-22-age-of-president|No election source detail record found at data/browse/details/elections/ireland-referendum-2015-05-22-age-of-president.json or data/browse/details/sources/election-source-ireland-referendum-2015-05-22-age-of-president.json.|
|warning|source-record-missing|ireland-referendum__2015-05-22-equal-marriage|No election source detail record found at data/browse/details/elections/ireland-referendum-2015-05-22-equal-marriage.json or data/browse/details/sources/election-source-ireland-referendum-2015-05-22-equal-marriage.json.|
|warning|source-record-missing|dail-eireann__2015-05-22|No election source detail record found at data/browse/details/elections/dail-eireann-2015-05-22.json or data/browse/details/sources/election-source-dail-eireann-2015-05-22.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2015-05-07|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2015-05-07.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2015-05-07.json.|
|warning|source-record-missing|dail-eireann__2014-10-10|No election source detail record found at data/browse/details/elections/dail-eireann-2014-10-10.json or data/browse/details/sources/election-source-dail-eireann-2014-10-10.json.|
|warning|source-record-missing|dail-eireann__2014-05-23|No election source detail record found at data/browse/details/elections/dail-eireann-2014-05-23.json or data/browse/details/sources/election-source-dail-eireann-2014-05-23.json.|
|warning|source-record-missing|ireland-european__2014-05-23|No election source detail record found at data/browse/details/elections/ireland-european-2014-05-23.json or data/browse/details/sources/election-source-ireland-european-2014-05-23.json.|
|warning|source-record-missing|ireland-local__2014-05-23|No election source detail record found at data/browse/details/elections/ireland-local-2014-05-23.json or data/browse/details/sources/election-source-ireland-local-2014-05-23.json.|
|warning|source-record-missing|european-parliament__2014-05-22|No election source detail record found at data/browse/details/elections/european-parliament-2014-05-22.json or data/browse/details/sources/election-source-european-parliament-2014-05-22.json.|
|warning|source-record-missing|local-government-local-government-districts__2014-05-22|No election source detail record found at data/browse/details/elections/local-government-local-government-districts-2014-05-22.json or data/browse/details/sources/election-source-local-government-local-government-districts-2014-05-22.json or data/browse/details/elections/local-government-2014-05-22.json or data/browse/details/sources/election-source-local-government-2014-05-22.json.|
|warning|source-record-missing|ireland-referendum__2013-10-04-court-of-appeal|No election source detail record found at data/browse/details/elections/ireland-referendum-2013-10-04-court-of-appeal.json or data/browse/details/sources/election-source-ireland-referendum-2013-10-04-court-of-appeal.json.|
|warning|source-record-missing|ireland-referendum__2013-10-04-abolition-of-the-seanad|No election source detail record found at data/browse/details/elections/ireland-referendum-2013-10-04-abolition-of-the-seanad.json or data/browse/details/sources/election-source-ireland-referendum-2013-10-04-abolition-of-the-seanad.json.|
|warning|source-record-missing|dail-eireann__2013-03-27|No election source detail record found at data/browse/details/elections/dail-eireann-2013-03-27.json or data/browse/details/sources/election-source-dail-eireann-2013-03-27.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2013-03-07|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2013-03-07.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2013-03-07.json.|
|warning|source-record-missing|ireland-referendum__2012-11-10-children|No election source detail record found at data/browse/details/elections/ireland-referendum-2012-11-10-children.json or data/browse/details/sources/election-source-ireland-referendum-2012-11-10-children.json.|
|warning|source-record-missing|ireland-referendum__2012-05-31-fiscal-treaty|No election source detail record found at data/browse/details/elections/ireland-referendum-2012-05-31-fiscal-treaty.json or data/browse/details/sources/election-source-ireland-referendum-2012-05-31-fiscal-treaty.json.|
|warning|source-record-missing|ireland-referendum__2011-10-27-houses-of-the-oireachtas-inquiries|No election source detail record found at data/browse/details/elections/ireland-referendum-2011-10-27-houses-of-the-oireachtas-inquiries.json or data/browse/details/sources/election-source-ireland-referendum-2011-10-27-houses-of-the-oireachtas-inquiries.json.|
|warning|source-record-missing|ireland-referendum__2011-10-27-judges-remuneration|No election source detail record found at data/browse/details/elections/ireland-referendum-2011-10-27-judges-remuneration.json or data/browse/details/sources/election-source-ireland-referendum-2011-10-27-judges-remuneration.json.|
|warning|source-record-missing|dail-eireann__2011-10-27|No election source detail record found at data/browse/details/elections/dail-eireann-2011-10-27.json or data/browse/details/sources/election-source-dail-eireann-2011-10-27.json.|
|warning|source-record-missing|ireland-president__2011-10-27|No election source detail record found at data/browse/details/elections/ireland-president-2011-10-27.json or data/browse/details/sources/election-source-ireland-president-2011-10-27.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2011-06-09|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2011-06-09.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2011-06-09.json.|
|warning|source-record-missing|northern-ireland-referendum__2011-05-05-alternative-vote|No election source detail record found at data/browse/details/elections/northern-ireland-referendum-2011-05-05-alternative-vote.json or data/browse/details/sources/election-source-northern-ireland-referendum-2011-05-05-alternative-vote.json.|
|warning|source-record-missing|local-government-local-government-districts__2011-05-05|No election source detail record found at data/browse/details/elections/local-government-local-government-districts-2011-05-05.json or data/browse/details/sources/election-source-local-government-local-government-districts-2011-05-05.json or data/browse/details/elections/local-government-2011-05-05.json or data/browse/details/sources/election-source-local-government-2011-05-05.json.|
|warning|source-record-missing|northern-ireland-assembly__2011-05-05|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2011-05-05.json or data/browse/details/sources/election-source-northern-ireland-assembly-2011-05-05.json.|
|warning|source-record-missing|dail-eireann__2011-02-25|No election source detail record found at data/browse/details/elections/dail-eireann-2011-02-25.json or data/browse/details/sources/election-source-dail-eireann-2011-02-25.json.|
|warning|source-record-missing|dail-eireann__2010-11-25|No election source detail record found at data/browse/details/elections/dail-eireann-2010-11-25.json or data/browse/details/sources/election-source-dail-eireann-2010-11-25.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2010-05-06|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2010-05-06.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2010-05-06.json.|
|warning|source-record-missing|local-government-craigavon__2010-01-13|No election source detail record found at data/browse/details/elections/local-government-craigavon-2010-01-13.json or data/browse/details/sources/election-source-local-government-craigavon-2010-01-13.json or data/browse/details/elections/local-government-2010-01-13.json or data/browse/details/sources/election-source-local-government-2010-01-13.json.|
|warning|source-record-missing|ireland-referendum__2009-10-02-treaty-of-lisbon-ii|No election source detail record found at data/browse/details/elections/ireland-referendum-2009-10-02-treaty-of-lisbon-ii.json or data/browse/details/sources/election-source-ireland-referendum-2009-10-02-treaty-of-lisbon-ii.json.|
|warning|source-record-missing|dail-eireann__2009-06-05|No election source detail record found at data/browse/details/elections/dail-eireann-2009-06-05.json or data/browse/details/sources/election-source-dail-eireann-2009-06-05.json.|
|warning|source-record-missing|ireland-european__2009-06-05|No election source detail record found at data/browse/details/elections/ireland-european-2009-06-05.json or data/browse/details/sources/election-source-ireland-european-2009-06-05.json.|
|warning|source-record-missing|ireland-local__2009-06-05|No election source detail record found at data/browse/details/elections/ireland-local-2009-06-05.json or data/browse/details/sources/election-source-ireland-local-2009-06-05.json.|
|warning|source-record-missing|european-parliament__2009-06-04|No election source detail record found at data/browse/details/elections/european-parliament-2009-06-04.json or data/browse/details/sources/election-source-european-parliament-2009-06-04.json.|
|warning|source-record-missing|ireland-referendum__2008-06-12-treaty-of-lisbon-i|No election source detail record found at data/browse/details/elections/ireland-referendum-2008-06-12-treaty-of-lisbon-i.json or data/browse/details/sources/election-source-ireland-referendum-2008-06-12-treaty-of-lisbon-i.json.|
|warning|source-record-missing|dail-eireann__2007-05-24|No election source detail record found at data/browse/details/elections/dail-eireann-2007-05-24.json or data/browse/details/sources/election-source-dail-eireann-2007-05-24.json.|
|warning|source-record-missing|northern-ireland-assembly__2007-03-07|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2007-03-07.json or data/browse/details/sources/election-source-northern-ireland-assembly-2007-03-07.json.|
|warning|source-record-missing|local-government-newry-and-mourne__2006-08-02|No election source detail record found at data/browse/details/elections/local-government-newry-and-mourne-2006-08-02.json or data/browse/details/sources/election-source-local-government-newry-and-mourne-2006-08-02.json or data/browse/details/elections/local-government-2006-08-02.json or data/browse/details/sources/election-source-local-government-2006-08-02.json.|
|warning|source-record-missing|house-of-commons-of-the-united-kingdom__2005-05-05|No election source detail record found at data/browse/details/elections/house-of-commons-of-the-united-kingdom-2005-05-05.json or data/browse/details/sources/election-source-house-of-commons-of-the-united-kingdom-2005-05-05.json.|
|warning|source-record-missing|local-government-local-government-districts__2005-05-05|No election source detail record found at data/browse/details/elections/local-government-local-government-districts-2005-05-05.json or data/browse/details/sources/election-source-local-government-local-government-districts-2005-05-05.json or data/browse/details/elections/local-government-2005-05-05.json or data/browse/details/sources/election-source-local-government-2005-05-05.json.|
|warning|source-record-missing|dail-eireann__2005-03-11|No election source detail record found at data/browse/details/elections/dail-eireann-2005-03-11.json or data/browse/details/sources/election-source-dail-eireann-2005-03-11.json.|
|warning|source-record-missing|ireland-president__2004-10-01|No election source detail record found at data/browse/details/elections/ireland-president-2004-10-01.json or data/browse/details/sources/election-source-ireland-president-2004-10-01.json.|
|warning|source-record-missing|ireland-referendum__2004-06-11-irish-citizenship|No election source detail record found at data/browse/details/elections/ireland-referendum-2004-06-11-irish-citizenship.json or data/browse/details/sources/election-source-ireland-referendum-2004-06-11-irish-citizenship.json.|
|warning|source-record-missing|ireland-european__2004-06-11|No election source detail record found at data/browse/details/elections/ireland-european-2004-06-11.json or data/browse/details/sources/election-source-ireland-european-2004-06-11.json.|
|warning|source-record-missing|ireland-local__2004-06-11|No election source detail record found at data/browse/details/elections/ireland-local-2004-06-11.json or data/browse/details/sources/election-source-ireland-local-2004-06-11.json.|
|warning|source-record-missing|european-parliament__2004-06-10|No election source detail record found at data/browse/details/elections/european-parliament-2004-06-10.json or data/browse/details/sources/election-source-european-parliament-2004-06-10.json.|
|warning|source-record-missing|northern-ireland-assembly__2003-11-26|No election source detail record found at data/browse/details/elections/northern-ireland-assembly-2003-11-26.json or data/browse/details/sources/election-source-northern-ireland-assembly-2003-11-26.json.|
|warning|source-record-missing|local-government-newry-and-mourne__2003-06-18|No election source detail record found at data/browse/details/elections/local-government-newry-and-mourne-2003-06-18.json or data/browse/details/sources/election-source-local-government-newry-and-mourne-2003-06-18.json or data/browse/details/elections/local-government-2003-06-18.json or data/browse/details/sources/election-source-local-government-2003-06-18.json.|
|warning|source-record-missing|ireland-referendum__2002-10-19-treaty-of-nice-ii|No election source detail record found at data/browse/details/elections/ireland-referendum-2002-10-19-treaty-of-nice-ii.json or data/browse/details/sources/election-source-ireland-referendum-2002-10-19-treaty-of-nice-ii.json.|
|warning|source-record-missing|dail-eireann__2002-05-17|No election source detail record found at data/browse/details/elections/dail-eireann-2002-05-17.json or data/browse/details/sources/election-source-dail-eireann-2002-05-17.json.|

_2289 more not shown; see JSON report._

## Source And Reference Coverage

|metric|value|
|---|---:|
|parent source records missing|2368|
|source records with no references|0|
|source records with one reference|0|
|source records with multiple references|0|
|Browse sub-entries with no references|0|
|Browse sub-entries with one reference|12117|
|Browse sub-entries with multiple references|11261|

## Party Colour Audit

|metric|value|
|---|---:|
|saved Wikipedia colour audit present|no|
|high-confidence mismatch file present|no|
|review override file present|yes|
|sampled mismatches already reviewed|0|
|unique colour observations|0|
|colour matches|0|
|colour mismatches|0|
|high-confidence mismatches|0|
|entries with no explicit election colour|0|
|entries with no Wikipedia match|0|
|ambiguous Wikipedia matches|0|

### High-Confidence Colour Examples

_None found from the saved audit._

## Next Fix Queue

1. Resolve blocking issues first; these are structural and should fail CI when present.
2. Work through source/reference warnings by adding or normalising parent and sub-entry citations, preferring official/ARK/ElectionsIreland sources with Wikipedia as secondary corroboration.
3. Resolve high-confidence party-colour mismatches by updating the canonical party/label colour map or documenting an intentional Civgraph override.
4. For entries expected to have transfer/count data but missing it, decide whether the source lacks transfer stages or whether the generated bundle failed to carry available count data through to /test2.
5. Promote this audit into the normal /test2 check path so regenerated election data cannot silently change references, colours, or bundle shape.
