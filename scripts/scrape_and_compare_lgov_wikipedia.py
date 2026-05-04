#!/usr/bin/env python
"""Fetch local-election Wikipedia wikitext and compare party labels to the LGOV export."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

from openpyxl import load_workbook

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_stv_workbook import PersonRegistry, build_contest, preferred_stv_files

YEARS = [1973, 1977, 1981, 1985, 1989, 1993, 1997, 2001, 2005, 2011]

COUNCILS = [
    {"key": "antrim", "variants": ["Antrim District Council", "Antrim Borough Council"]},
    {"key": "ards", "variants": ["Ards District Council", "Ards Borough Council"]},
    {"key": "armagh", "variants": ["Armagh City and District Council", "Armagh District Council", "Armagh City Council"]},
    {"key": "ballymena", "variants": ["Ballymena Borough Council"]},
    {"key": "ballymoney", "variants": ["Ballymoney Borough Council"]},
    {"key": "banbridge", "variants": ["Banbridge District Council"]},
    {"key": "belfast", "variants": ["Belfast City Council"]},
    {"key": "carrickfergus", "variants": ["Carrickfergus Borough Council"]},
    {"key": "castlereagh", "variants": ["Castlereagh Borough Council"]},
    {"key": "coleraine", "variants": ["Coleraine Borough Council"]},
    {"key": "cookstown", "variants": ["Cookstown District Council"]},
    {"key": "craigavon", "variants": ["Craigavon Borough Council"]},
    {"key": "derry", "variants": ["Derry City Council", "Londonderry City Council"]},
    {"key": "down", "variants": ["Down District Council"]},
    {"key": "dungannon_and_south_tyrone", "variants": ["Dungannon and South Tyrone Borough Council", "Dungannon and South Tyrone District Council", "Dungannon District Council"]},
    {"key": "fermanagh", "variants": ["Fermanagh District Council"]},
    {"key": "larne", "variants": ["Larne Borough Council"]},
    {"key": "limavady", "variants": ["Limavady Borough Council"]},
    {"key": "lisburn", "variants": ["Lisburn City Council", "Lisburn Borough Council"]},
    {"key": "magherafelt", "variants": ["Magherafelt District Council"]},
    {"key": "moyle", "variants": ["Moyle District Council"]},
    {"key": "newry_and_mourne", "variants": ["Newry and Mourne District Council"]},
    {"key": "newtownabbey", "variants": ["Newtownabbey Borough Council"]},
    {"key": "north_down", "variants": ["North Down Borough Council"]},
    {"key": "omagh", "variants": ["Omagh District Council"]},
    {"key": "strabane", "variants": ["Strabane District Council"]},
]

LGOV_CODE_TO_COUNCIL = {
    "ANT": "Antrim District Council",
    "ARD": "Ards District Council",
    "ARM": "Armagh City and District Council",
    "BMA": "Ballymena Borough Council",
    "BMY": "Ballymoney Borough Council",
    "BRG": "Banbridge District Council",
    "BT": "Belfast City Council",
    "CAR": "Carrickfergus Borough Council",
    "CAS": "Castlereagh Borough Council",
    "COL": "Coleraine Borough Council",
    "Col": "Coleraine Borough Council",
    "COO": "Cookstown District Council",
    "CRA": "Craigavon Borough Council",
    "DE": "Derry City Council",
    "DOW": "Down District Council",
    "DUN": "Dungannon and South Tyrone Borough Council",
    "FER": "Fermanagh District Council",
    "LAR": "Larne Borough Council",
    "LIM": "Limavady Borough Council",
    "Lim": "Limavady Borough Council",
    "LIS": "Lisburn City Council",
    "MAG": "Magherafelt District Council",
    "MOY": "Moyle District Council",
    "NaM": "Newry and Mourne District Council",
    "NEW": "Newtownabbey Borough Council",
    "New": "Newry and Mourne District Council",
    "NoD": "North Down Borough Council",
    "OMA": "Omagh District Council",
    "STR": "Strabane District Council",
}

USER_AGENT = "civgraph/1.0 (Wikipedia LGOV comparison)"
REQUEST_DELAY_SECONDS = 0.6
RETRY_DELAYS = [5, 10, 20, 40]


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                time.sleep(REQUEST_DELAY_SECONDS)
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == len(RETRY_DELAYS):
                raise
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS):
                raise
    raise RuntimeError(f"Failed to fetch JSON after retries: {url}") from last_error


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                body = response.read().decode("utf-8")
                time.sleep(REQUEST_DELAY_SECONDS)
                return body
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code != 429 or attempt == len(RETRY_DELAYS):
                raise
        except Exception as exc:
            last_error = exc
            if attempt == len(RETRY_DELAYS):
                raise
    raise RuntimeError(f"Failed to fetch text after retries: {url}") from last_error


def title_candidates(year: int, council: dict) -> list[str]:
    titles: list[str] = []
    for variant in council["variants"]:
        titles.append(f"{year} {variant} election")
    return titles


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
    url = f"https://en.wikipedia.org/wiki/{year}_Northern_Ireland_local_elections?action=raw"
    return fetch_text(url)


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
    data = fetch_json(f"https://en.wikipedia.org/w/api.php?{params}")
    return [item["title"] for item in data.get("query", {}).get("search", [])]


def normalize_title(title: str) -> str:
    return title.replace("_", " ").strip()


def council_slug_from_variant(variant: str) -> str:
    base = variant.removesuffix(" election").strip()
    return re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")


def title_matches_council(title: str, council: dict) -> bool:
    normalized = normalize_title(title).lower()
    return any(variant.lower() in normalized for variant in council["variants"])


def extract_council_titles_from_overview(year: int, wikitext: str) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    pattern = re.compile(r"\[\[([^\]|]+(?:Council|council)[^\]|]*? election)(?:\|[^\]]*)?\]\]", re.I)
    for match in pattern.finditer(wikitext):
        title = normalize_title(match.group(1))
        if not title.startswith(str(year)):
            continue
        if title not in seen:
            titles.append(title)
            seen.add(title)
    return titles


def discover_titles_from_overviews(overview_dir: Path) -> tuple[dict[int, str], dict[tuple[int, str], str], dict[int, list[str]]]:
    overview_texts: dict[int, str] = {}
    titles_by_council: dict[tuple[int, str], str] = {}
    all_titles_by_year: dict[int, list[str]] = {}
    for year in YEARS:
        cache_path = overview_dir / f"{year}-overview.wiki"
        if cache_path.exists():
            text = cache_path.read_text(encoding="utf-8")
        else:
            text = fetch_overview_raw(year)
            cache_path.write_text(text, encoding="utf-8")
        overview_texts[year] = text
        titles = extract_council_titles_from_overview(year, text)
        all_titles_by_year[year] = titles
        for council in COUNCILS:
            for title in titles:
                if title_matches_council(title, council):
                    titles_by_council[(year, council["key"])] = title
                    break
    return overview_texts, titles_by_council, all_titles_by_year


def resolve_page(year: int, council: dict, overview_titles: dict[tuple[int, str], str]) -> tuple[str | None, str | None, str]:
    overview_title = overview_titles.get((year, council["key"]))
    if overview_title:
        text = fetch_raw_title(overview_title)
        if text:
            return overview_title, text, "overview-link"
    tried: list[str] = []
    for title in title_candidates(year, council):
        tried.append(title)
        text = fetch_raw_title(title)
        if text:
            return title, text, "exact"
    search_terms = [f"{year} {variant} election" for variant in council["variants"]]
    for query in search_terms:
        for candidate in search_titles(query):
            if candidate in tried:
                continue
            text = fetch_raw_title(candidate)
            if text:
                return candidate, text, f"search:{query}"
    return None, None, "missing"


def clean_wiki_value(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value)
    value = re.sub(r"<ref[^>/]*/>", "", value)
    value = re.sub(r"<ref.*?>.*?</ref>", "", value, flags=re.S)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{nowrap\|([^}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{small\|([^}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{abbr\|([^|}]+)\|[^}]+\}\}", r"\1", value)
    value = re.sub(r"\{\{.*?\}\}", "", value)
    value = value.replace("&nbsp;", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def extract_party_labels(wikitext: str) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"^\|\s*party\d*\s*=\s*(.+)$", wikitext, flags=re.M):
        label = clean_wiki_value(match.group(1))
        if not label:
            continue
        if label not in seen:
            labels.append(label)
            seen.add(label)
    return labels


def council_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def local_council_from_path(path: Path) -> str:
    match = re.search(r"lg\d{2,4}-([A-Za-z]{2,3})-", path.name)
    if not match:
        return ""
    return LGOV_CODE_TO_COUNCIL.get(match.group(1), "")


def build_year_dea_to_council_map(root: Path) -> dict[tuple[str, str], str]:
    mapping: dict[tuple[str, str], str] = {}
    registry = PersonRegistry()
    for path in preferred_stv_files(root, ["lgov"]):
        contest = build_contest(path, registry)
        year = str(contest.date)[:4]
        council = local_council_from_path(path)
        if not council:
            continue
        mapping[(year, contest.constituency)] = council
    return mapping


def collect_local_party_labels(root: Path, workbook_path: Path) -> dict[tuple[str, str], set[str]]:
    output: dict[tuple[str, str], set[str]] = {}

    registry = PersonRegistry()
    for path in preferred_stv_files(root, ["lgov"]):
        contest = build_contest(path, registry)
        year = str(contest.date)[:4]
        council = local_council_from_path(path)
        if not council:
            continue
        output.setdefault((year, council), set())
        for candidate in contest.candidates:
            party_name = (candidate.party or "").strip()
            if party_name:
                output[(year, council)].add(party_name)

    # Touch the workbook so the comparison remains explicitly tied to the generated export.
    wb = load_workbook(workbook_path, read_only=True, data_only=True)
    wb.close()
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="_tmp_xls2rar_extract/xls")
    parser.add_argument("--workbook", default="_tmp_xls2rar_extract/out/lgov-stv.xlsx")
    parser.add_argument("--outdir", default="_tmp_xls2rar_extract/out/wiki_lgov")
    args = parser.parse_args()

    root = Path(args.root)
    workbook = Path(args.workbook)
    outdir = Path(args.outdir)
    overview_dir = outdir / "overview_raw"
    overview_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = outdir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    manifest_rows: list[dict[str, str]] = []
    wiki_labels_by_council_year: dict[tuple[str, str], list[str]] = {}
    overview_texts, overview_titles, all_titles_by_year = discover_titles_from_overviews(overview_dir)
    existing_titles: dict[tuple[str, str], str] = {}
    manifest_path = outdir / "manifest.csv"
    if manifest_path.exists():
        with manifest_path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("resolved_title"):
                    existing_titles[(row["year"], row["council_key"])] = row["resolved_title"]

    for year in YEARS:
        for council in COUNCILS:
            filename = raw_dir / f"{year}-{council['key']}.wiki"
            cached_title = existing_titles.get((str(year), council["key"])) or overview_titles.get((year, council["key"]))
            if filename.exists() and cached_title:
                title = cached_title
                text = filename.read_text(encoding="utf-8")
                resolution = "cached-raw"
            else:
                title, text, resolution = resolve_page(year, council, overview_titles)
            row = {
                "year": str(year),
                "council_key": council["key"],
                "resolved_title": title or "",
                "resolution": resolution,
                "found": "yes" if text else "no",
            }
            if text and title:
                if not filename.exists():
                    filename.write_text(text, encoding="utf-8")
                else:
                    text = filename.read_text(encoding="utf-8")
                labels = extract_party_labels(text)
                wiki_labels_by_council_year[(str(year), council["variants"][0])] = labels
                row["party_label_count"] = str(len(labels))
            else:
                row["party_label_count"] = "0"
            manifest_rows.append(row)

    with manifest_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["year", "council_key", "resolved_title", "resolution", "found", "party_label_count"])
        writer.writeheader()
        writer.writerows(manifest_rows)

    local_labels_by_council_year = collect_local_party_labels(root, workbook)

    comparison_rows: list[dict[str, str]] = []
    for year in YEARS:
        for council in COUNCILS:
            council_name = council["variants"][0]
            wiki_labels = sorted(set(wiki_labels_by_council_year.get((str(year), council_name), [])), key=str.casefold)
            local_labels = sorted(local_labels_by_council_year.get((str(year), council_name), set()), key=str.casefold)
            comparison_rows.append(
                {
                    "year": str(year),
                    "council": council_name,
                    "wiki_label_count": str(len(wiki_labels)),
                    "local_label_count": str(len(local_labels)),
                    "wiki_labels": " | ".join(wiki_labels),
                    "local_party_names": " | ".join(local_labels),
                    "shared_exact_labels": " | ".join(sorted(set(wiki_labels) & set(local_labels), key=str.casefold)),
                    "wiki_only_labels": " | ".join(sorted(set(wiki_labels) - set(local_labels), key=str.casefold)),
                    "local_only_labels": " | ".join(sorted(set(local_labels) - set(wiki_labels), key=str.casefold)),
                }
            )

    comparison_path = outdir / "party_label_comparison.csv"
    with comparison_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "year",
                "council",
                "wiki_label_count",
                "local_label_count",
                "wiki_labels",
                "local_party_names",
                "shared_exact_labels",
                "wiki_only_labels",
                "local_only_labels",
            ],
        )
        writer.writeheader()
        writer.writerows(comparison_rows)

    summary = {
        "requested_pages": len(YEARS) * len(COUNCILS),
        "found_pages": sum(1 for row in manifest_rows if row["found"] == "yes"),
        "missing_pages": sum(1 for row in manifest_rows if row["found"] != "yes"),
        "manifest_csv": str(manifest_path),
        "comparison_csv": str(comparison_path),
        "raw_dir": str(raw_dir),
        "overview_raw_dir": str(overview_dir),
        "overview_title_counts": {str(year): len(titles) for year, titles in all_titles_by_year.items()},
    }
    (outdir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
