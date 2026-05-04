#!/usr/bin/env python
"""Fetch 2014/2019/2023 NI local-election raw wikitext and audit STV count-table structure."""

from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from modern_lgov_wikipedia_common import (
    MODERN_COUNCILS,
    YEARS,
    extract_council_titles_from_overview,
    parse_count_tables,
    title_candidates,
    title_matches_council,
)


USER_AGENT = "civgraph/1.0 (modern lgov Wikipedia audit)"
REQUEST_DELAY_SECONDS = 0.6
RETRY_DELAYS = [5, 10, 20, 40]


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                text = response.read().decode("utf-8")
                time.sleep(REQUEST_DELAY_SECONDS)
                return text
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == len(RETRY_DELAYS):
                raise
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS):
                raise
    raise RuntimeError(f"Failed to fetch text after retries: {url}") from last_error


def fetch_raw_title(title: str) -> str | None:
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe=":_()'")
    url = f"https://en.wikipedia.org/wiki/{encoded}?action=raw"
    try:
        return fetch_text(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_overview_raw(year: int) -> str:
    return fetch_text(f"https://en.wikipedia.org/wiki/{year}_Northern_Ireland_local_elections?action=raw")


def search_titles(query: str) -> list[str]:
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "list": "search",
            "srsearch": query,
            "srlimit": 10,
        }
    )
    url = f"https://en.wikipedia.org/w/api.php?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
                time.sleep(REQUEST_DELAY_SECONDS)
                return [item["title"] for item in data.get("query", {}).get("search", [])]
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == len(RETRY_DELAYS):
                raise
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS):
                raise
    raise RuntimeError(f"Failed to search titles after retries: {query}") from last_error


def resolve_page(year: int, council: dict, overview_titles: dict[tuple[int, str], str]) -> tuple[str | None, str | None, str]:
    overview_title = overview_titles.get((year, council["key"]))
    if overview_title:
        text = fetch_raw_title(overview_title)
        if text:
            return overview_title, text, "overview-link"
    tried: set[str] = set()
    for title in title_candidates(year, council):
        tried.add(title)
        text = fetch_raw_title(title)
        if text:
            return title, text, "exact"
    for variant in council["variants"]:
        for query in (f"{year} {variant} election", f"{variant} election {year}"):
            for candidate in search_titles(query):
                if candidate in tried:
                    continue
                if not title_matches_council(candidate, council):
                    continue
                text = fetch_raw_title(candidate)
                if text:
                    return candidate, text, f"search:{query}"
    return None, None, "missing"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outdir", default="_tmp_xls2rar_extract/out/wiki_lgov_modern")
    args = parser.parse_args()

    outdir = Path(args.outdir)
    overview_dir = outdir / "overview_raw"
    raw_dir = outdir / "raw"
    audit_dir = outdir / "audit"
    overview_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    audit_dir.mkdir(parents=True, exist_ok=True)

    manifest_rows: list[dict[str, str]] = []
    audit_summary: list[dict[str, str]] = []

    for year in YEARS:
        overview_text = fetch_overview_raw(year)
        (overview_dir / f"{year}-overview.wiki").write_text(overview_text, encoding="utf-8")
        titles = extract_council_titles_from_overview(year, overview_text)
        overview_titles = {}
        for title in titles:
            for council in MODERN_COUNCILS:
                if title_matches_council(title, council):
                    overview_titles[(year, council["key"])] = title
                    break
        for council in MODERN_COUNCILS:
            title, text, resolution = resolve_page(year, council, overview_titles)
            key = council["key"]
            filename = raw_dir / f"{year}-{key}.wiki"
            if text is None or title is None:
                manifest_rows.append(
                    {
                        "year": str(year),
                        "council_key": key,
                        "resolved_title": title or "",
                        "resolution": resolution,
                        "found": "no",
                        "district_count": "0",
                    }
                )
                continue
            filename.write_text(text, encoding="utf-8")
            audit = parse_count_tables(title, text)
            (audit_dir / f"{year}-{key}.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
            manifest_rows.append(
                {
                    "year": str(year),
                    "council_key": key,
                    "resolved_title": title,
                    "resolution": resolution,
                    "found": "yes",
                    "district_count": str(audit["district_count"]),
                }
            )
            all_numcounts = sorted({district["numcounts"] for district in audit["districts"]})
            audit_summary.append(
                {
                    "year": str(year),
                    "council_key": key,
                    "resolved_title": title,
                    "district_count": str(audit["district_count"]),
                    "all_use_begin2": "yes" if audit["all_use_begin2"] else "no",
                    "all_use_candidate2": "yes" if audit["all_use_candidate2"] else "no",
                    "numcounts_values": ", ".join(str(v) for v in all_numcounts),
                }
            )

    manifest_path = outdir / "manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["year", "council_key", "resolved_title", "resolution", "found", "district_count"])
        writer.writeheader()
        writer.writerows(manifest_rows)

    audit_summary_path = outdir / "count_table_audit.csv"
    with audit_summary_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["year", "council_key", "resolved_title", "district_count", "all_use_begin2", "all_use_candidate2", "numcounts_values"],
        )
        writer.writeheader()
        writer.writerows(audit_summary)

    summary = {
        "requested_pages": len(YEARS) * len(MODERN_COUNCILS),
        "found_pages": sum(1 for row in manifest_rows if row["found"] == "yes"),
        "manifest_csv": str(manifest_path),
        "audit_csv": str(audit_summary_path),
        "raw_dir": str(raw_dir),
        "overview_raw_dir": str(overview_dir),
        "audit_dir": str(audit_dir),
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
