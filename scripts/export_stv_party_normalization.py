#!/usr/bin/env python
"""Export raw STV source-party labels to deduplicated canonical party names."""

from __future__ import annotations

import argparse
import csv
import difflib
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_stv_workbook import (
    PersonRegistry,
    build_contest,
    canonical_label,
    normalize_space,
    preferred_stv_files,
    split_name,
    to_display_name,
)


METADATA_LABELS = {
    "",
    "non transferable",
    "totals",
    "total",
    "eligible electorate",
    "eligible electroate",
    "number of electors",
    "no of electors",
    "votes polled",
    "total votes polled",
    "poll",
    "valid votes",
    "total valid votes",
    "vaild votes",
    "invalid votes",
    "number of members to be elected",
    "number of members to be elected ",
    "number to be elected",
    "number ot be elected",
    "no to be elected",
    "quota",
    "electoral quota of",
}

PARTY_KEYWORDS = {
    "party",
    "union",
    "unionist",
    "unionists",
    "alliance",
    "sinn",
    "fein",
    "labour",
    "nilp",
    "democratic",
    "republican",
    "clubs",
    "workers",
    "worker",
    "green",
    "ecology",
    "socialist",
    "natural",
    "law",
    "kingdom",
    "independent",
    "indp",
    "community",
    "coal",
    "coalition",
    "vanguard",
    "progressive",
    "voice",
    "conservative",
    "liberal",
    "communist",
    "partnership",
    "unity",
    "left",
    "nationalist",
    "women",
    "womens",
    "republic",
}

ABBREVIATION_LABELS = {
    "a",
    "a p",
    "ap",
    "aa",
    "dup",
    "d u p",
    "uup",
    "u u p",
    "udp",
    "upni",
    "u p n i",
    "ukup",
    "sf",
    "s f",
    "sdlp",
    "s d l p",
    "nilp",
    "iip",
    "i i p",
    "pup",
    "tuv",
    "bnp",
    "uuuc",
    "u p u p",
    "wp",
    "w p",
    "oup",
    "o u p",
    "oup",
    "ou",
    "ouu",
    "o u",
    "o u u",
    "o u u c",
    "o u u u c",
    "ouuc",
    "ouuuc",
    "o un",
    "off un",
    "of un",
    "off unionist",
    "off union",
    "off ul unionist",
    "o un u u u c",
    "off ulster unionist",
    "u",
    "un",
    "uu",
    "u u",
}

COUNCIL_MAP = {
    "ANT": "Antrim",
    "ARD": "Ards",
    "ARM": "Armagh",
    "BAN": "Banbridge",
    "BMA": "Ballymena",
    "BMY": "Ballymoney",
    "BRG": "Banbridge",
    "BT": "Belfast",
    "CAR": "Carrickfergus",
    "CAS": "Castlereagh",
    "COL": "Coleraine",
    "Col": "Coleraine",
    "COO": "Cookstown",
    "CRA": "Craigavon",
    "DE": "Derry",
    "DOW": "Down",
    "DUN": "Dungannon",
    "FER": "Fermanagh",
    "LAR": "Larne",
    "LIM": "Limavady",
    "Lim": "Limavady",
    "LIS": "Lisburn",
    "MAG": "Magherafelt",
    "MOY": "Moyle",
    "NaM": "Newry and Mourne",
    "NEW": "Newtownabbey",
    "New": "Newry and Mourne",
    "NOD": "North Down",
    "NoD": "North Down",
    "OMA": "Omagh",
    "STR": "Strabane",
}

COUNCIL_KEY_BY_CODE = {
    "ANT": "antrim",
    "ARD": "ards",
    "ARM": "armagh",
    "BMA": "ballymena",
    "BMY": "ballymoney",
    "BRG": "banbridge",
    "BT": "belfast",
    "CAR": "carrickfergus",
    "CAS": "castlereagh",
    "COL": "coleraine",
    "Col": "coleraine",
    "COO": "cookstown",
    "CRA": "craigavon",
    "DE": "derry",
    "DOW": "down",
    "DUN": "dungannon_and_south_tyrone",
    "FER": "fermanagh",
    "LAR": "larne",
    "LIM": "limavady",
    "Lim": "limavady",
    "LIS": "lisburn",
    "MAG": "magherafelt",
    "MOY": "moyle",
    "NaM": "newry_and_mourne",
    "NEW": "newtownabbey",
    "New": "newry_and_mourne",
    "NOD": "north_down",
    "NoD": "north_down",
    "OMA": "omagh",
    "STR": "strabane",
}

COUNCIL_KEY_BY_NAME = {
    canonical_label("Antrim District Council"): "antrim",
    canonical_label("Ards District Council"): "ards",
    canonical_label("Armagh City and District Council"): "armagh",
    canonical_label("Ballymena Borough Council"): "ballymena",
    canonical_label("Ballymoney Borough Council"): "ballymoney",
    canonical_label("Banbridge District Council"): "banbridge",
    canonical_label("Belfast City Council"): "belfast",
    canonical_label("Carrickfergus Borough Council"): "carrickfergus",
    canonical_label("Castlereagh Borough Council"): "castlereagh",
    canonical_label("Coleraine Borough Council"): "coleraine",
    canonical_label("Cookstown District Council"): "cookstown",
    canonical_label("Craigavon Borough Council"): "craigavon",
    canonical_label("Derry City Council"): "derry",
    canonical_label("Londonderry City Council"): "derry",
    canonical_label("Down District Council"): "down",
    canonical_label("Dungannon and South Tyrone Borough Council"): "dungannon_and_south_tyrone",
    canonical_label("Dungannon and South Tyrone District Council"): "dungannon_and_south_tyrone",
    canonical_label("Dungannon District Council"): "dungannon_and_south_tyrone",
    canonical_label("Fermanagh District Council"): "fermanagh",
    canonical_label("Larne Borough Council"): "larne",
    canonical_label("Limavady Borough Council"): "limavady",
    canonical_label("Lisburn City Council"): "lisburn",
    canonical_label("Lisburn Borough Council"): "lisburn",
    canonical_label("Magherafelt District Council"): "magherafelt",
    canonical_label("Moyle District Council"): "moyle",
    canonical_label("Newry and Mourne District Council"): "newry_and_mourne",
    canonical_label("Newtownabbey Borough Council"): "newtownabbey",
    canonical_label("North Down Borough Council"): "north_down",
    canonical_label("Omagh District Council"): "omagh",
    canonical_label("Strabane District Council"): "strabane",
}

CONTEXT_FIRST_LABELS = {
    "aa",
    "af",
    "all",
}


def is_metadata_label(raw: str) -> bool:
    canon = canonical_label(raw)
    if canon in METADATA_LABELS:
        return True
    if canon.startswith("district electoral area"):
        return True
    if canon.startswith("district electorial area"):
        return True
    if canon.startswith("district of"):
        return True
    if canon.startswith("constituency of"):
        return True
    return False


def is_probable_party_label(raw: str) -> bool:
    canon = canonical_label(raw)
    if not canon or is_metadata_label(raw):
        return False
    if canon in ABBREVIATION_LABELS:
        return True
    if raw.isupper() and 1 <= len(re.sub(r"[^A-Z]", "", raw)) <= 8:
        return True
    if re.fullmatch(r"[0-9]+(?: [0-9]+)*", canon):
        return False
    if any(keyword in canon.split() for keyword in PARTY_KEYWORDS):
        return True
    if any(keyword in canon for keyword in PARTY_KEYWORDS):
        return True
    return False


def canonical_party_name(raw: str) -> str:
    raw = normalize_space(raw)
    canon = canonical_label(raw)

    if not canon or is_metadata_label(raw):
        return ""
    if canon == "unsure":
        return "Unknown"

    if canon in {"a", "a p", "ap", "a p "} or "alliance" in canon or canon in {"all party", "all party", "aparty"}:
        return "Alliance"
    if canon in {"s d l p", "sdlp", "social democratic and labour party", "social democratic labour party"} or "social democratic and labour party" in canon:
        return "SDLP"
    if canon in {"s f", "sf", "sinn fein", "sinn feinn", "sinn feine"} or "sinn fein" in canon or "sinn fe" in canon:
        return "Sinn Féin"
    if "traditional unionist voice" in canon or canon == "tuv":
        return "TUV"
    if "green party" in canon or "green ecology" in canon or "the green party" in canon:
        return "Green / Ecology"
    if "people before profit alliance" in canon:
        return "People Before Profit Alliance"
    if "ukip" in canon:
        return "UKIP"
    if "bnp" in canon:
        return "BNP"

    if "democratic unionist" in canon or canon in {"d u p", "dup", "d u p ", "d u p d u p"}:
        return "DUP"
    if "ulster democratic unionist party" in canon:
        return "DUP"
    if "du uuuc" in canon or "uuu dup" in canon or "loy d u" in canon:
        return "DUP"

    if canon in {"uup", "u u p", "u u p ", "uu", "u u"}:
        return "UUP"
    if "ulster unionist" in canon or "official ulster unionist" in canon or "official unionist" in canon or "off unionist" in canon:
        return "UUP"
    if canon in {
        "off un",
        "off un ",
        "of un",
        "o un",
        "o un u u u c",
        "o u p",
        "o u",
        "o u n",
        "off un",
        "off u n",
        "off ulster unionist",
        "official ulster",
        "unionist",
        "un",
        "un loy",
        "united un",
        "united unionist",
        "united loy",
        "u",
        "ou",
        "ouu",
        "o ul un",
    }:
        return "UUP"
    if "conservative and unionist" in canon or "conservative unionist" in canon:
        return "Conservative and Unionist"

    if "vanguard" in canon or canon in {"v u p p", "v u loy coal"}:
        return "VUP"
    if "progressive unionist party" in canon or canon == "pup" or canon == "p u p":
        return "PUP"
    if "ulster democratic party" in canon:
        return "UDP"
    if "united kingdom unionist party" in canon or canon == "ukup":
        return "UKUP"
    if "upni" in canon or canon == "u p n i":
        return "UPNI"

    if "workers party republican clubs" in canon or "w p rep clubs" in canon:
        return "Workers Party / Republican Clubs"
    if canon in {"rep clubs", "rep clubs ", "rep c", "rep c ", "republican clubs"}:
        return "Republican Clubs"
    if "workers party" in canon or canon in {"wp", "w p", "worker s party"}:
        return "Workers Party"
    if "communist party of ireland" in canon:
        return "Communist Party of Ireland"

    if "n i l p" in canon or canon == "nilp" or "newtownabbey labour party" in canon:
        return "NILP"
    if canon == "labour" or "labour party" in canon:
        return "Labour"
    if canon == "lib":
        return "Liberal"

    if canon == "independent" or canon in {"ind", "indp", "independant"} or canon == "non party" or canon == "non party cc":
        return "Independent"
    if "independent unionist" in canon or canon in {"indp un", "indp un ", "indp un", "independent unionist"}:
        return "Independent Unionist"
    if "independent nationalist" in canon:
        return "Independent Nationalist"
    if canon in {"i i p", "iip"} or "irish independence party" in canon:
        return "IIP"

    if "northern ireland women s coalition" in canon or "ni women s coalition" in canon:
        return "NIWC"
    if "natural law party" in canon:
        return "Natural Law Party"
    if "unity" == canon:
        return "Unity"
    if "socialist party" in canon:
        return "Socialist Party"
    if "conservative" == canon or "the conservative party" in canon or "conservative party" in canon:
        return "Conservative"
    if "community partnership northern ireland" in canon:
        return "Community Partnership (Northern Ireland)"
    if "community candidate" in canon:
        return "Community Candidate"

    return raw


def wikipedia_party_name(raw: str, canonical_name: str) -> str:
    raw = normalize_space(raw)
    canon = canonical_label(raw)
    canonical_norm = normalize_space(canonical_name)
    canonical_canon = canonical_label(canonical_norm)

    if canonical_norm in {
        "Alliance Party of Northern Ireland",
        "Democratic Unionist Party",
        "Ulster Unionist Party",
        "Social Democratic and Labour Party",
        "Sinn F\u00e9in",
        "People Before Profit Alliance",
        "Independent Unionist",
        "Independent Nationalist",
        "Irish Independence Party",
        "Northern Ireland Women's Coalition",
        "Progressive Unionist Party",
        "Ulster Democratic Party",
        "UK Unionist Party",
        "Unionist Party of Northern Ireland",
        "Vanguard Unionist Progressive Party",
        "Republican Clubs",
        "Traditional Unionist Voice",
        "United Loyalist",
        "United Ulster Unionist Party",
        "Ulster Popular Unionist Party",
        "Loyalist Coalition",
        "Independent Republican (Ireland)",
        "Anti H-Block",
        "Newtownabbey Labour",
        "Newtownabbey Ratepayers",
        "Protestant Unionist",
        "Northern Ireland Conservatives",
        "Green Party of Northern Ireland",
        "Natural Law",
        "Independent (politician)",
        "Workers' Party (Ireland)",
    }:
        return canonical_norm

    if canonical_norm in {"Alliance", "ALL"} or "alliance" in canon:
        return "Alliance Party of Northern Ireland"
    if canonical_norm == "DUP":
        return "Democratic Unionist Party"
    if canonical_norm == "UUP":
        return "Ulster Unionist Party"
    if canonical_norm == "SDLP":
        return "Social Democratic and Labour Party"
    if canonical_norm == "Sinn F\u00e9in" or "sinn fein" in canon:
        return "Sinn F\u00e9in"
    if canonical_norm == "Green / Ecology":
        return "Green Party of Northern Ireland"
    if canonical_norm == "TUV":
        return "Traditional Unionist Voice"
    if canonical_norm == "Independent":
        return "Independent (politician)"
    if canonical_norm == "IIP":
        return "Irish Independence Party"
    if canonical_norm == "NIWC":
        return "Northern Ireland Women's Coalition"
    if canonical_norm == "PUP":
        return "Progressive Unionist Party"
    if canonical_norm == "UDP":
        return "Ulster Democratic Party"
    if canonical_norm == "UKUP":
        return "UK Unionist Party"
    if canonical_norm == "UPNI":
        return "Unionist Party of Northern Ireland"
    if canonical_norm == "VUP":
        return "Vanguard Unionist Progressive Party"
    if canonical_norm == "Natural Law Party":
        return "Natural Law"
    if canonical_norm == "Community Candidate":
        return "Independent (politician)"
    if "indp party" in canon:
        return "Independent (politician)"
    if canonical_norm in {"BNP", "British National party"} or "british national" in canon:
        return "British National Party"
    if "anti agreement northern ireland unionist" in canon or "northern ireland unionist party anti agreement" in canon:
        return "Northern Ireland Unionist Party"
    if "antrim labour leag" in canon:
        return "Antrim Labour League"
    if "coleraine unionist" in canon:
        return "Independent Unionist"
    if canon in {"c p", "comm party", "communist p of ire", "communist p of ir", "communist party of ire"} or "communist" in canon:
        return "Communist Party of Ireland"
    if "community and enviromental conservation campaign" in canon or "community and environmental conservation campaign" in canon:
        return "Community and Environmental Conservation Campaign"
    if canonical_norm in {"Community", "Community Independent"} or canon.startswith("community"):
        return "Independent (politician)"
    if "constitutional independent northern ireland" in canon:
        return "Independent (politician)"
    if "conservative" in canon or "con unionist" in canon or "con&unionist" in canon:
        return "Northern Ireland Conservatives"
    if "d u loy coal" in canon or "loy coal" in canon:
        return "Loyalist Coalition"
    if "u u u c" in canon or "uuuc" in canon or "united unionist" in canon or "united ulster unionist" in canon:
        return "United Ulster Unionist Party"
    if "democratic unionist" in canon or canon == "d up" or "(united unionist)" in raw.lower():
        return "Democratic Unionist Party"
    if canonical_norm == "DL":
        return "Democratic Left (Ireland)"
    if canon in {"e p", "ecology party cand"} or "ecology party" in canon:
        return "Green Party of Northern Ireland"
    if "energy 106 party" in canon:
        return "Energy 106"
    if "independent labour" in canon or "indp labour" in canon or "indp lab" in canon:
        return "Independent Labour"
    if "independent unionist" in canon or "ind unionist" in canon or "ind union" in canon or "indp loy" in canon:
        return "Independent Unionist"
    if "independent nationalist" in canon or "indp nat" in canon or "nationalist independent" in canon:
        return "Independent Nationalist"
    if "indp rep" in canon or "indp repl" in canon or "indp publiean" in canon:
        return "Independent Republican (Ireland)"
    if "women coalition" in canon:
        return "Northern Ireland Women's Coalition"
    if canon in {"n i c p", "nicp"}:
        return "N.I.C.P."
    if canon in {"n i lp", "n l i p", "l p n i"} or "labour for representative government" in canon:
        return "Northern Ireland Labour Party"
    if canon in {"nat party", "nationalist"} or "nationalist party" in canon:
        return "Nationalist Party (Northern Ireland)"
    if "nationalist independent" in canon:
        return "Independent Nationalist"
    if canon.startswith("non party") or canon in {"i", "i."} or "teacher" in canon or "businessman" in canon or "vintner" in canon or "worker" in canon or "surgeon" in canon or "consult" in canon:
        return "Independent (politician)"
    if canon == "oup" or canon == "o u u p":
        return "Ulster Unionist Party"
    if "peace coalition" in canon:
        return "Peace Coalition"
    if "progressive unionist" in canon or "progressive u p" in canon or "progressive u party" in canon or "unionist progressive party" in canon:
        return "Progressive Unionist Party"
    if "rep clubs" in canon or "workers party" in canon or "w p r clubs" in canon:
        return "Workers' Party (Ireland)"
    if "socialist party" in canon:
        return "Socialist Party"
    if "spni" in canon:
        return "Socialist Party (Northern Ireland)"
    if canon == "unity" or canon.startswith("unity "):
        return "Unity (Northern Ireland)"
    if "uk independence party" in canon or canonical_norm == "UKIP":
        return "United Kingdom Independence Party"
    if "united loyalist coalition" in canon:
        return "United Loyalist Coalition"
    if "unionist unity" in canon or "un unity" in canon:
        return "Unionist Unity"
    if "voice of the people independent" in canon or "the peoples independent" in canon:
        return "Independent (politician)"

    if canonical_norm == "Workers Party / Republican Clubs":
        if "rep clubs" in canon or "republican clubs" in canon:
            return "Republican Clubs"
        if "workers party" in canon or "workers' party" in raw.lower():
            return "Workers' Party (Ireland)"

    if "independent republican" in canon:
        return "Independent Republican (Ireland)"
    if "anti h block" in canon:
        return "Anti H-Block"
    if "newtownabbey labour" in canon:
        return "Newtownabbey Labour"
    if "newtownabbey ratepayer" in canon:
        return "Newtownabbey Ratepayers"
    if "protestant unionist" in canon:
        return "Protestant Unionist"
    if "ulster popular unionist" in canon or "upup" in canon:
        return "Ulster Popular Unionist Party"
    if "united loyalist" in canon:
        return "United Loyalist"
    if "loyalist coalition" in canon or "loy col" in canon:
        return "Loyalist Coalition"
    if "uuuc" in canon or "united unionist coalition" in canon or "united ulster unionist" in canon:
        return "United Ulster Unionist Party"
    if "conservative" in canon:
        return "Northern Ireland Conservatives"
    if "northern ireland women" in canon or "ni women" in canon:
        return "Northern Ireland Women's Coalition"
    if "n i l p" in canon or canonical_norm == "Labour":
        return "Northern Ireland Labour Party"
    if "kilfedder unionist" in canon:
        return "Ulster Popular Unionist Party"
    if "coleraine unionist" in canon:
        return "Independent Unionist"
    if "d t u c" in canon:
        return "Independent (politician)"
    if "alliance" in canon or canonical_norm == "ALL":
        return "Alliance Party of Northern Ireland"
    if canon in {"party", "all", "aa", "af"}:
        return "Independent (politician)"
    return "Independent (politician)"


def clean_wiki_value(value: str) -> str:
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"<ref[^>/]*/>", "", value)
    value = re.sub(r"<ref.*?>.*?</ref>", "", value, flags=re.S)
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{nowrap\|([^}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{small\|([^}]+)\}\}", r"\1", value)
    value = re.sub(r"\{\{abbr\|([^|}]+)\|[^}]+\}\}", r"\1", value)
    value = re.sub(r"\{\{.*?\}\}", "", value, flags=re.S)
    value = value.replace("&nbsp;", " ")
    return normalize_space(value)


def local_dea_from_path(path: Path) -> str:
    stem = path.stem.replace("-corrected", "")
    stem = re.sub(r"^lg\d{2,4}-[A-Za-z]{2,3}-", "", stem, flags=re.I)
    return normalize_space(stem.replace("-", " "))


def local_council_key_from_path(path: Path) -> str:
    match = re.search(r"lg\d{2,4}-([A-Za-z]{2,3})-", path.name)
    if not match:
        return ""
    code = match.group(1)
    return COUNCIL_KEY_BY_CODE.get(code, "")


def normalize_dea_name(value: str) -> str:
    text = clean_wiki_value(value)
    text = re.sub(r"\s*-\s*\d+\s+seats?.*$", "", text, flags=re.I)
    text = re.sub(r"\s*\(district electoral area\)\s*", "", text, flags=re.I)
    text = re.sub(r"^district electoral area:\s*", "", text, flags=re.I)
    return normalize_space(text)


def candidate_template_blocks(block_text: str) -> list[str]:
    return re.findall(r"\{\{STV Election box candidate(?:2| without party link)\|(.*?)\}\}", block_text, flags=re.S)


def template_param(template_text: str, name: str) -> str:
    match = re.search(rf"^\s*\|\s*{re.escape(name)}\s*=\s*(.+?)\s*$", template_text, flags=re.M)
    return clean_wiki_value(match.group(1)) if match else ""


def strip_candidate_markup(value: str) -> str:
    text = clean_wiki_value(value)
    text = text.replace("*", "")
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    return normalize_space(text)


def name_aliases(name: str) -> set[str]:
    text = strip_candidate_markup(name)
    aliases: set[str] = set()
    canon = canonical_label(text)
    if canon:
        aliases.add(canon)
    tokens = re.findall(r"[A-Za-zÀ-ÿ]+", text)
    if not tokens:
        return aliases
    lower_tokens = [token.lower() for token in tokens]
    aliases.add(" ".join(lower_tokens))
    if len(lower_tokens) >= 2:
        first_tokens = lower_tokens[:-1]
        last = lower_tokens[-1]
        initials = " ".join(token[0] for token in first_tokens if token)
        if initials:
            aliases.add(normalize_space(f"{initials} {last}").lower())
            aliases.add(normalize_space(f"{last} {initials}").lower())
    if len(lower_tokens) >= 2 and len(lower_tokens[-1]) <= 2:
        surname = lower_tokens[0]
        given_tokens = lower_tokens[1:]
        initials = " ".join(token[0] for token in given_tokens if token)
        if initials:
            aliases.add(normalize_space(f"{surname} {initials}").lower())
            aliases.add(normalize_space(f"{initials} {surname}").lower())
    if len(lower_tokens) >= 2 and len(lower_tokens[0]) <= 2:
        surname = lower_tokens[-1]
        given_tokens = lower_tokens[:-1]
        initials = " ".join(token[0] for token in given_tokens if token)
        if initials:
            aliases.add(normalize_space(f"{surname} {initials}").lower())
            aliases.add(normalize_space(f"{initials} {surname}").lower())
    return {alias for alias in aliases if alias}


def surname_for_name(name: str) -> str:
    text = strip_candidate_markup(name)
    tokens = re.findall(r"[A-Za-zÀ-ÿ]+", text)
    if not tokens:
        return ""
    if len(tokens) >= 2 and len(tokens[-1]) <= 2:
        return tokens[0].lower()
    return tokens[-1].lower()


def first_initial_for_name(name: str) -> str:
    text = strip_candidate_markup(name)
    tokens = re.findall(r"[A-Za-zÀ-ÿ]+", text)
    if not tokens:
        return ""
    if len(tokens) >= 2 and len(tokens[-1]) <= 2:
        return tokens[-1][0].lower()
    return tokens[0][0].lower()


def parse_wiki_stv_contests(raw_dir: Path) -> dict[tuple[str, str, str], list[dict[str, str]]]:
    contests: dict[tuple[str, str, str], list[dict[str, str]]] = {}
    for path in raw_dir.glob("*.wiki"):
        match = re.match(r"(?P<year>\d{4})-(?P<council_key>.+)\.wiki$", path.name)
        if not match:
            continue
        year = match.group("year")
        council_key = match.group("council_key")
        text = path.read_text(encoding="utf-8")
        blocks = re.findall(r"\{\{STV Election box begin2\|(.*?)\{\{STV Election box end2", text, flags=re.S)
        for block in blocks:
            title = template_param(block, "title")
            dea = normalize_dea_name(title.split(" - ", 1)[0] if title else "")
            if not dea:
                continue
            key = (year, council_key, canonical_label(dea))
            entries = contests.setdefault(key, [])
            for candidate_block in candidate_template_blocks(block):
                party = template_param(candidate_block, "party")
                candidate_name = strip_candidate_markup(template_param(candidate_block, "candidate"))
                if not party or not candidate_name:
                    continue
                entries.append(
                    {
                        "candidate_name": candidate_name,
                        "party": party,
                    }
                )
    return contests


def match_wiki_candidate(local_name: str, wiki_candidates: list[dict[str, str]]) -> str:
    if not wiki_candidates:
        return ""
    local_aliases = name_aliases(local_name)
    local_surname = surname_for_name(local_name)
    local_initial = first_initial_for_name(local_name)

    exact_hits = [candidate for candidate in wiki_candidates if local_aliases & name_aliases(candidate["candidate_name"])]
    if len(exact_hits) == 1:
        return exact_hits[0]["party"]
    if len(exact_hits) > 1:
        return ""

    local_clean = strip_candidate_markup(local_name).lower()
    scored: list[tuple[float, str]] = []
    for candidate in wiki_candidates:
        wiki_name = candidate["candidate_name"]
        wiki_clean = strip_candidate_markup(wiki_name).lower()
        score = difflib.SequenceMatcher(None, local_clean, wiki_clean).ratio()
        if local_surname and local_surname == surname_for_name(wiki_name):
            score += 0.35
        if local_initial and local_initial == first_initial_for_name(wiki_name):
            score += 0.1
        scored.append((score, candidate["party"]))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return ""
    best_score, best_party = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= 0.88 and best_score - second_score >= 0.08:
        return best_party
    return ""


def contextual_wikipedia_party_map(root: Path, wiki_raw_dir: Path) -> dict[str, str]:
    wiki_contests = parse_wiki_stv_contests(wiki_raw_dir)
    registry = PersonRegistry()
    occurrences_by_label: dict[str, list[str]] = {}
    files = preferred_stv_files(root, ["lgov"])
    for path in files:
        contest = build_contest(path, registry)
        year = appearance_year_for_contest_date(contest.date)
        council_key = local_council_key_from_path(path)
        dea = normalize_dea_name(local_dea_from_path(path))
        if not year or not council_key or not dea:
            continue
        wiki_candidates = wiki_contests.get((year, council_key, canonical_label(dea)), [])
        if not wiki_candidates:
            continue
        for candidate in contest.candidates:
            label = normalize_space(candidate.source_party)
            if not label or not is_probable_party_label(label):
                continue
            wiki_party = match_wiki_candidate(to_display_name(candidate.raw_name), wiki_candidates)
            if wiki_party:
                occurrences_by_label.setdefault(label, []).append(wiki_party)

    resolved: dict[str, str] = {}
    for label, wiki_parties in occurrences_by_label.items():
        counts: dict[str, int] = {}
        for wiki_party in wiki_parties:
            counts[wiki_party] = counts.get(wiki_party, 0) + 1
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        best_party, best_count = ranked[0]
        second_count = ranked[1][1] if len(ranked) > 1 else 0
        if len(ranked) == 1 or best_count >= second_count + 2:
            resolved[label] = best_party
    return resolved


def appearance_year_for_contest_date(date_value: str) -> str:
    date_value = normalize_space(date_value)
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_value):
        return date_value[:4]
    if re.match(r"^\d{4}$", date_value):
        return date_value
    return ""


def council_from_path(path: Path) -> str:
    match = re.search(r"lg\d{2,4}-([A-Za-z]{2,3})-", path.name)
    if not match:
        return ""
    code = match.group(1)
    return COUNCIL_MAP.get(code, code)


def location_tuple_for_contest(path: Path, contest) -> str:
    if "lgov" in path.parts:
        council = council_from_path(path)
        dea = local_dea_from_path(path)
        return f"{council} | {dea}" if council else dea
    return f"{contest.elected_body} | {contest.constituency}"


def append_unique(items: list[str], seen: set[str], value: str) -> None:
    value = normalize_space(value)
    if not value or value in seen:
        return
    items.append(value)
    seen.add(value)


def collect_source_party_rows(root: Path) -> list[tuple[str, str, str, str, str, str]]:
    registry = PersonRegistry()
    contextual_wiki_names = contextual_wikipedia_party_map(root, root.parent / "out" / "wiki_lgov" / "raw")
    labels: dict[str, dict[str, object]] = {}
    files = preferred_stv_files(root, ["asby", "conv", "euro", "lgov"])
    for path in files:
        contest = build_contest(path, registry)
        year = appearance_year_for_contest_date(contest.date)
        location_tuple = location_tuple_for_contest(path, contest)
        for candidate in contest.candidates:
            label = normalize_space(candidate.source_party)
            if not label:
                continue
            if not is_probable_party_label(label):
                continue
            labels.setdefault(
                label,
                {
                    "years": set(),
                    "candidates": [],
                    "candidate_seen": set(),
                    "locations": [],
                },
            )
            entry = labels[label]
            if year:
                entry["years"].add(year)
            append_unique(entry["candidates"], entry["candidate_seen"], to_display_name(candidate.raw_name))
            entry["locations"].append(location_tuple)

    rows: list[tuple[str, str, str, str, str, str]] = []
    for raw in sorted(labels, key=lambda value: (canonical_party_name(value), value.lower())):
        entry = labels[raw]
        canonical_name = canonical_party_name(raw)
        years = ", ".join(sorted(entry["years"], key=int)) if entry["years"] else ""
        candidates = ", ".join(entry["candidates"])
        locations = ", ".join(entry["locations"])
        canon_raw = canonical_label(raw)
        explicit_wiki_name = wikipedia_party_name(raw, canonical_name)
        if canon_raw in CONTEXT_FIRST_LABELS:
            wiki_name = contextual_wiki_names.get(raw, "") or explicit_wiki_name
        else:
            wiki_name = explicit_wiki_name or contextual_wiki_names.get(raw, "")
        rows.append((raw, canonical_name, wiki_name, years, candidates, locations))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="Root folder containing STV source family directories")
    parser.add_argument("--output", required=True, help="CSV output path")
    args = parser.parse_args()

    rows = collect_source_party_rows(Path(args.root))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "source_party_name",
                "deduplicated_party_name",
                "wikipedia_party_name",
                "appearance_years",
                "candidate_names",
                "council_dea_tuples",
            ]
        )
        for raw, canonical_name, wiki_name, years, candidates, locations in rows:
            writer.writerow([raw, canonical_name, wiki_name, years, candidates, locations])

    print(f"Wrote {len(rows)} rows to {output_path}")


if __name__ == "__main__":
    main()
