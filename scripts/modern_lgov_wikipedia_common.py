#!/usr/bin/env python
"""Shared helpers for parsing modern NI local-election Wikipedia STV wikitext."""

from __future__ import annotations

import re
from typing import Any


YEARS = [2014, 2019, 2023]

MODERN_COUNCILS = [
    {"key": "antrim_and_newtownabbey", "variants": ["Antrim and Newtownabbey District Council", "Antrim and Newtownabbey Borough Council"]},
    {"key": "ards_and_north_down", "variants": ["Ards and North Down District Council", "Ards and North Down Borough Council", "North Down and Ards District Council"]},
    {"key": "armagh_banbridge_and_craigavon", "variants": ["Armagh, Banbridge and Craigavon District Council", "Armagh City, Banbridge and Craigavon Borough Council"]},
    {"key": "belfast", "variants": ["Belfast City Council"]},
    {"key": "causeway_coast_and_glens", "variants": ["Causeway Coast and Glens District Council", "Causeway Coast and Glens Borough Council"]},
    {"key": "derry_city_and_strabane", "variants": ["Derry and Strabane District Council", "Derry City and Strabane District Council"]},
    {"key": "fermanagh_and_omagh", "variants": ["Fermanagh and Omagh District Council"]},
    {"key": "lisburn_and_castlereagh", "variants": ["Lisburn and Castlereagh District Council", "Lisburn and Castlereagh City Council"]},
    {"key": "mid_and_east_antrim", "variants": ["Mid and East Antrim District Council"]},
    {"key": "mid_ulster", "variants": ["Mid-Ulster District Council", "Mid Ulster District Council"]},
    {"key": "newry_mourne_and_down", "variants": ["Newry, Mourne and Down District Council"]},
]

COUNCIL_DISPLAY_BY_KEY = {
    "antrim_and_newtownabbey": "Antrim and Newtownabbey",
    "ards_and_north_down": "Ards and North Down",
    "armagh_banbridge_and_craigavon": "Armagh, Banbridge and Craigavon",
    "belfast": "Belfast",
    "causeway_coast_and_glens": "Causeway Coast and Glens",
    "derry_city_and_strabane": "Derry City and Strabane",
    "fermanagh_and_omagh": "Fermanagh and Omagh",
    "lisburn_and_castlereagh": "Lisburn and Castlereagh",
    "mid_and_east_antrim": "Mid and East Antrim",
    "mid_ulster": "Mid Ulster",
    "newry_mourne_and_down": "Newry, Mourne and Down",
}


def normalize_title(title: str) -> str:
    return title.replace("_", " ").strip()


def title_matches_council(title: str, council: dict) -> bool:
    normalized = normalize_title(title).lower()
    return any(variant.lower() in normalized for variant in council["variants"])


def title_candidates(year: int, council: dict) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    for variant in council["variants"]:
        for candidate in (
            f"{year} {variant} election",
            f"{variant} election, {year}",
            f"{variant} election {year}",
        ):
            if candidate not in seen:
                titles.append(candidate)
                seen.add(candidate)
    return titles


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


def clean_wiki_value(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"<ref[^>/]*/>", "", value)
    value = re.sub(r"<ref.*?>.*?</ref>", "", value, flags=re.S)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{nowrap\|([^{}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{small\|([^{}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{abbr\|([^|{}]+)\|[^{}]+\}\}", r"\1", value)
    value = re.sub(r"\{\{steady\}\}", "-", value, flags=re.I)
    value = re.sub(r"\{\{increase\}\}", "up", value, flags=re.I)
    value = re.sub(r"\{\{decrease\}\}", "down", value, flags=re.I)
    previous = None
    while previous != value:
        previous = value
        value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = value.replace("&nbsp;", " ")
    value = value.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", value).strip()


def extract_template_blocks(wikitext: str, template_name: str) -> list[tuple[int, int, str]]:
    blocks: list[tuple[int, int, str]] = []
    needle = "{{" + template_name
    idx = 0
    while True:
        start = wikitext.find(needle, idx)
        if start == -1:
            break
        depth = 0
        pos = start
        while pos < len(wikitext) - 1:
            pair = wikitext[pos : pos + 2]
            if pair == "{{":
                depth += 1
                pos += 2
                continue
            if pair == "}}":
                depth -= 1
                pos += 2
                if depth == 0:
                    blocks.append((start, pos, wikitext[start:pos]))
                    idx = pos
                    break
                continue
            pos += 1
        else:
            break
    return blocks


def split_top_level(text: str, separator: str = "|") -> list[str]:
    pieces: list[str] = []
    buf: list[str] = []
    template_depth = 0
    link_depth = 0
    i = 0
    while i < len(text):
        pair = text[i : i + 2]
        if pair == "{{":
            template_depth += 1
            buf.append(pair)
            i += 2
            continue
        if pair == "}}" and template_depth > 0:
            template_depth -= 1
            buf.append(pair)
            i += 2
            continue
        if pair == "[[":
            link_depth += 1
            buf.append(pair)
            i += 2
            continue
        if pair == "]]" and link_depth > 0:
            link_depth -= 1
            buf.append(pair)
            i += 2
            continue
        if text[i] == separator and template_depth == 0 and link_depth == 0:
            pieces.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(text[i])
        i += 1
    pieces.append("".join(buf))
    return pieces


def parse_template_params(block: str) -> tuple[str, dict[str, str]]:
    inner = block[2:-2]
    pieces = split_top_level(inner)
    template_name = pieces[0].strip()
    params: dict[str, str] = {}
    for piece in pieces[1:]:
        if "=" not in piece:
            continue
        key, value = piece.split("=", 1)
        params[key.strip()] = value.strip()
    return template_name, params


def parse_numeric(value: Any) -> float | None:
    text = clean_wiki_value(str(value or ""))
    if not text or text in {"-", "—"}:
        return None
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not match:
        return None
    return float(match.group(0).replace(",", ""))


def parse_dea_title(title_raw: str) -> tuple[str, int | None]:
    title_text = clean_wiki_value(title_raw)
    # Accept hyphen-minus, en dash, or em dash separators before seat count.
    match = re.match(r"(.+?)\s*[-–—]\s*(\d+)\s+seats?$", title_text, flags=re.I)
    if not match:
        return title_text.strip(), None
    return match.group(1).strip(), int(match.group(2))


def parse_candidate_name(candidate_raw: str) -> tuple[str, str | None]:
    cleaned = clean_wiki_value(candidate_raw)
    outcome = "Elected" if "†" in cleaned else None
    cleaned = cleaned.replace("*", "").replace("†", "").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned, outcome


def parse_count_tables(title: str, wikitext: str) -> dict:
    begin_blocks = extract_template_blocks(wikitext, "STV Election box begin2")
    candidate_blocks = extract_template_blocks(wikitext, "STV Election box candidate2")
    end_blocks = extract_template_blocks(wikitext, "STV Election box end2")

    districts: list[dict] = []
    for idx, (begin_start, begin_end, begin_block) in enumerate(begin_blocks):
        next_begin_start = begin_blocks[idx + 1][0] if idx + 1 < len(begin_blocks) else len(wikitext)
        region = wikitext[begin_start:next_begin_start]
        _, begin_params = parse_template_params(begin_block)
        dea_name, seats = parse_dea_title(begin_params.get("title", ""))
        numcounts = int(parse_numeric(begin_params.get("numcounts", "")) or 0)

        district_candidate_blocks = [block for _, _, block in extract_template_blocks(region, "STV Election box candidate2")]
        district_end_blocks = [block for _, _, block in extract_template_blocks(region, "STV Election box end2")]
        end_params = parse_template_params(district_end_blocks[0])[1] if district_end_blocks else {}

        parsed_candidates = []
        non_blank_count_columns: set[int] = set()
        for block in district_candidate_blocks:
            _, cparams = parse_template_params(block)
            display_name, outcome = parse_candidate_name(cparams.get("candidate", ""))
            counts: list[float | None] = []
            for count_idx in range(1, numcounts + 1):
                value = parse_numeric(cparams.get(f"count{count_idx}", ""))
                counts.append(value)
                if value is not None:
                    non_blank_count_columns.add(count_idx)
            parsed_candidates.append(
                {
                    "party": clean_wiki_value(cparams.get("party", "")),
                    "candidate_raw": cparams.get("candidate", ""),
                    "candidate": display_name,
                    "outcome": outcome,
                    "percentage": parse_numeric(cparams.get("percentage", "")),
                    "counts": counts,
                }
            )

        districts.append(
            {
                "dea_name": dea_name,
                "seats": seats,
                "numcounts": numcounts,
                "candidate_count": len(parsed_candidates),
                "non_blank_count_columns": sorted(non_blank_count_columns),
                "electorate": parse_numeric(end_params.get("electorate", "")),
                "valid": parse_numeric(end_params.get("valid", "")),
                "spoilt": parse_numeric(end_params.get("spoilt", "")),
                "quota": parse_numeric(end_params.get("quota", "")),
                "turnout": parse_numeric(end_params.get("turnout", "")),
                "sample_candidates": parsed_candidates[:3],
                "candidates": parsed_candidates,
            }
        )

    return {
        "title": title,
        "district_count": len(districts),
        "all_use_begin2": bool(begin_blocks),
        "all_use_candidate2": bool(candidate_blocks),
        "all_use_end2": bool(end_blocks),
        "districts": districts,
    }
