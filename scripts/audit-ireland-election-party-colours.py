import csv
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd


ROOT = Path("election-viewer-package/data/elections")
WIKI_CSV = Path("tasks/wikipedia_political_party_colours.csv")
STAGES_JS = Path("election-viewer-package/js/stages2.js")
ELECTION_CONTROLLER_JS = Path("js/election-controller.js")
OUT_CSV = Path("tasks/ireland_election_party_colour_wikipedia_audit.csv")
HIGH_CONFIDENCE_CSV = Path("tasks/ireland_election_party_colour_wikipedia_high_confidence_mismatches.csv")
OUT_MD = Path("tasks/ireland_election_party_colour_wikipedia_audit.md")

CSS_COLOURS = {
    "aqua": "#00FFFF",
    "black": "#000000",
    "blue": "#0000FF",
    "brown": "#A52A2A",
    "cyan": "#00FFFF",
    "darkblue": "#00008B",
    "darkorange": "#FF8C00",
    "darkgreen": "#006400",
    "darkgrey": "#A9A9A9",
    "darkgray": "#A9A9A9",
    "gold": "#FFD700",
    "green": "#008000",
    "grey": "#808080",
    "gray": "#808080",
    "lightblue": "#ADD8E6",
    "lightgreen": "#90EE90",
    "magenta": "#FF00FF",
    "orange": "#FFA500",
    "pink": "#FFC0CB",
    "purple": "#800080",
    "red": "#FF0000",
    "silver": "#C0C0C0",
    "white": "#FFFFFF",
    "yellow": "#FFFF00",
    "yellowgreen": "#9ACD32",
    "khaki": "#F0E68C",
}

ISLAND_ALIAS_TO_WIKIPEDIA = {
    "alliance": "Alliance Party of Northern Ireland",
    "a": "Alliance Party of Northern Ireland",
    "ap": "Alliance Party of Northern Ireland",
    "alliance party": "Alliance Party of Northern Ireland",
    "alliance party of ni": "Alliance Party of Northern Ireland",
    "apni": "Alliance Party of Northern Ireland",
    "bnp": "British National Party",
    "british national party": "British National Party",
    "dup": "Democratic Unionist Party",
    "d u u u u c": "Democratic Unionist Party",
    "dup leader ian paisley": "Democratic Unionist Party",
    "democratic unionist": "Democratic Unionist Party",
    "loy d u": "Democratic Unionist Party",
    "u d u p": "Democratic Unionist Party",
    "ulster dup": "Democratic Unionist Party",
    "pup": "Progressive Unionist Party",
    "progressive unionist party": "Progressive Unionist Party",
    "uup": "Ulster Unionist Party",
    "uu": "Ulster Unionist Party",
    "o u": "Ulster Unionist Party",
    "o ul un": "Ulster Unionist Party",
    "o un": "Ulster Unionist Party",
    "oun": "Ulster Unionist Party",
    "off un": "Ulster Unionist Party",
    "of un": "Ulster Unionist Party",
    "official unionist": "Ulster Unionist Party",
    "ulster unionist u u p": "Ulster Unionist Party",
    "uup u u u c": "Ulster Unionist Party",
    "uuup": "United Ulster Unionist Party",
    "sdlp": "Social Democratic and Labour Party",
    "sdlp social democratic and labour party": "Social Democratic and Labour Party",
    "social democratic and labour party sdlp": "Social Democratic and Labour Party",
    "tuv": "Traditional Unionist Voice",
    "ukup": "UK Unionist Party",
    "conservative": "Conservative and Unionist Party (UK)",
    "conservative and unionist": "Conservative and Unionist Party (UK)",
    "irish conservative": "Conservative and Unionist Party (UK)",
    "nationalist": "Nationalist Party (Northern Ireland)",
    "nationalist party": "Nationalist Party (Northern Ireland)",
    "ni unionist party": "Northern Ireland Unionist Party",
    "northern ireland unionist party": "Northern Ireland Unionist Party",
    "ni women s coalition": "Northern Ireland Women's Coalition",
    "ni womens coalition": "Northern Ireland Women's Coalition",
    "niwc": "Northern Ireland Women's Coalition",
    "s f": "Sinn FÃ©in",
    "irish labour": "Irish Labour Party",
    "labour": "Irish Labour Party",
    "ni labour party": "Northern Ireland Labour Party",
    "ni labour": "Northern Ireland Labour Party",
    "n i l p": "Northern Ireland Labour Party",
    "northern ireland labour party": "Northern Ireland Labour Party",
    "sinn fein": "Sinn Féin",
    "sinn féin": "Sinn Féin",
    "fianna fail": "Fianna Fáil",
    "fianna fáil": "Fianna Fáil",
    "green ecology": "Green Party Northern Ireland",
    "green": "Green Party (Ireland)",
    "green party": "Green Party (Ireland)",
    "the green party": "Green Party (Ireland)",
    "green party northern ireland": "Green Party Northern Ireland",
    "green comhaontas glas": "Green Party (Ireland)",
    "comhaontas glas": "Green Party (Ireland)",
    "workers party republican clubs": "Workers' Party (Ireland)",
    "rep clubs": "Republican Clubs",
    "workers party": "Workers' Party (Ireland)",
    "workers' party": "Workers' Party (Ireland)",
    "workers": "Workers' Party (Ireland)",
    "workers party of ireland": "Workers' Party (Ireland)",
    "workers' party of ireland": "Workers' Party (Ireland)",
    "republican clubs": "Republican Clubs",
    "independent unionist": "Independent Unionist",
    "iip": "Irish Independence Party",
    "i i p": "Irish Independence Party",
    "i i p nationalist": "Irish Independence Party",
    "irish independence party": "Irish Independence Party",
    "r e n u a ireland": "Renua",
    "renua ireland": "Renua",
    "republican labour": "Republican Labour Party",
    "republican labour party": "Republican Labour Party",
    "u p u p": "Ulster Popular Unionist Party",
    "ulster popular unionist party": "Ulster Popular Unionist Party",
    "democratic left": "Democratic Left (Ireland)",
    "democratic left new agenda": "Democratic Left (Ireland)",
    "pbp": "People Before Profit",
    "people before profit alliance": "People Before Profit",
    "people before profit alliance pbpa": "People Before Profit",
    "people before profit pbpa": "People Before Profit",
    "solidarity pbp": "Solidarity–People Before Profit",
    "solidarity people before profit": "Solidarity–People Before Profit",
    "people before profit solidarity": "Solidarity–People Before Profit",
    "anti treaty sinn fein": "Sinn Féin (Anti-Treaty)",
    "anti treaty sinn féin": "Sinn Féin (Anti-Treaty)",
    "pro treaty sinn fein": "Sinn Féin (Pro-Treaty)",
    "pro treaty sinn féin": "Sinn Féin (Pro-Treaty)",
    "official sinn fein": "Sinn Féin (Official)",
    "official sinn féin": "Sinn Féin (Official)",
    "sinn fein workers": "Sinn Féin The Workers' Party",
    "sinn féin workers": "Sinn Féin The Workers' Party",
    "socialist party": "Socialist Party (Ireland)",
    "socialist party ireland": "Socialist Party (Ireland)",
    "ulster liberal": "Ulster Liberal Party",
    "ulster liberal party": "Ulster Liberal Party",
    "unionist party of northern ireland": "Unionist Party of Northern Ireland",
    "van un": "Vanguard Unionist Progressive Party",
    "vanguard unionist progressive party": "Vanguard Unionist Progressive Party",
    "an rabharta glas green left": "Rabharta",
}


def normalise_text(value: object) -> str:
    text = html.unescape(str(value or "")).replace("\ufeff", "").strip()
    text = re.sub(r"\s*Lozenge\s*$", "", text, flags=re.I).strip()
    text = text.replace("Ã¡", "á").replace("Ã©", "é").replace("Ãº", "ú")
    text = text.replace("Ã\x81", "Á").replace("Ã‰", "É").replace("Ãš", "Ú")
    text = re.sub(r"\s+", " ", text)
    return text


def match_key(value: object) -> str:
    text = normalise_text(value).casefold()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", "and")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalise_colour(value: object) -> str:
    colour = str(value or "").strip()
    if not colour:
        return ""
    if colour.lower() == "default":
        return "default"
    if colour.startswith("#"):
        raw = colour[1:]
        if re.fullmatch(r"[0-9a-fA-F]{3}", raw):
            return "#" + "".join(ch * 2 for ch in raw).upper()
        if re.fullmatch(r"[0-9a-fA-F]{6}", raw):
            return "#" + raw.upper()
        if re.fullmatch(r"[0-9a-fA-F]{8}", raw):
            return "#" + raw[:6].upper()
        return colour.upper()
    return CSS_COLOURS.get(colour.lower(), colour)


def parse_js_colour_map(path: Path, var_name: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(rf"var\s+{re.escape(var_name)}\s*=\s*\{{(?P<body>.*?)\n\}};", text, re.S)
    if not match:
        return {}
    body = re.sub(r"//.*", "", match.group("body"))
    pairs = re.findall(r"(['\"])(?P<key>(?:\\.|(?!\1).)*?)\1\s*:\s*(['\"])(?P<value>(?:\\.|(?!\3).)*?)\3", body)
    out = {}
    for _, key, _, value in pairs:
        key = bytes(key, "utf-8").decode("unicode_escape")
        value = bytes(value, "utf-8").decode("unicode_escape")
        out[normalise_text(key)] = normalise_colour(value)
    return out


def parse_roi_colour_map() -> dict[str, str]:
    text = ELECTION_CONTROLLER_JS.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"_roiPartyColour\(party\)\s*\{.*?const map\s*=\s*\{(?P<body>.*?)\n\s*\};", text, re.S)
    if not match:
        return {}
    body = re.sub(r"//.*", "", match.group("body"))
    pairs = re.findall(r"(['\"])(?P<key>(?:\\.|(?!\1).)*?)\1\s*:\s*(['\"])(?P<value>(?:\\.|(?!\3).)*?)\3", body)
    out = {}
    for _, key, _, value in pairs:
        key = bytes(key, "utf-8").decode("unicode_escape")
        value = bytes(value, "utf-8").decode("unicode_escape")
        out[normalise_text(key)] = normalise_colour(value)
    return out


def load_wikipedia_lookup():
    wiki = pd.read_csv(WIKI_CSV).fillna("")
    lookup = defaultdict(list)
    for _, row in wiki.iterrows():
        name = normalise_text(row["Political party name"])
        colour = normalise_colour(row["color"])
        if not name:
            continue
        entry = {
            "name": name,
            "colour": colour,
            "abbrev": normalise_text(row.get("abbrev", "")),
            "shortname": normalise_text(row.get("shortname", "")),
            "module": normalise_text(row.get("module", "")),
        }
        keys = [(name, "name")]
        if entry["abbrev"]:
            keys.append((entry["abbrev"], "abbrev"))
        if entry["shortname"]:
            keys.append((entry["shortname"], "shortname"))
        for value, basis in keys:
            key = match_key(value)
            if key:
                lookup[key].append({**entry, "basis": basis})
    return lookup


def choose_wiki_match(party: str, lookup: dict[str, list[dict]]) -> tuple[dict | None, str]:
    key = match_key(party)
    alias_target = ISLAND_ALIAS_TO_WIKIPEDIA.get(key)
    if alias_target:
        alias_candidates = [
            candidate for candidate in lookup.get(match_key(alias_target), [])
            if match_key(candidate["name"]) == match_key(alias_target)
        ]
        if alias_candidates:
            return {**alias_candidates[0], "basis": "manual_alias"}, "matched"
    candidates = lookup.get(key, [])
    if not candidates:
        return None, "no_match"

    exact_name = [c for c in candidates if match_key(c["name"]) == key]
    if exact_name:
        candidates = exact_name
    else:
        irelandish = [
            c for c in candidates
            if any(token in match_key(c["name"]).split() for token in ["ireland", "irish", "northern", "ulster"])
        ]
        if irelandish:
            candidates = irelandish

    colours = {c["colour"] for c in candidates}
    if len(colours) == 1:
        return candidates[0], "matched"
    return candidates[0], f"ambiguous:{len(candidates)}"


def iter_dicts(obj):
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from iter_dicts(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from iter_dicts(item)


def add_observation(observations, party, colour, path, source_key, resolver):
    party = normalise_text(party)
    if not party:
        return
    observations[(party, normalise_colour(colour), resolver)].append((str(path), source_key))


def extract_observations() -> dict[tuple[str, str, str], list[tuple[str, str]]]:
    stages_base = parse_js_colour_map(STAGES_JS, "PARTY_COLOUR_BASE")
    stages_overrides = parse_js_colour_map(STAGES_JS, "PARTY_COLOUR_OVERRIDES")
    stages_map = {**stages_base, **stages_overrides}
    stages_by_key = {match_key(k): v for k, v in stages_map.items()}
    roi_by_key = {match_key(k): v for k, v in parse_roi_colour_map().items()}

    observations = defaultdict(list)
    for path in ROOT.rglob("*.json"):
        if path.name.startswith("_"):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for item in iter_dicts(payload):
            if "Party_Name" in item:
                add_observation(observations, item.get("Party_Name"), item.get("Party_Colour", ""), path, "Party_Name/Party_Colour", "entry")
            if "party" in item and "Party_Name" not in item:
                party = normalise_text(item.get("party"))
                colour = item.get("colour") or item.get("color") or item.get("party_colour") or item.get("Party_Colour")
                resolver = "entry"
                if not colour:
                    colour = roi_by_key.get(match_key(party)) or stages_by_key.get(match_key(party)) or "#c0c0c0"
                    resolver = "runtime_fallback"
                add_observation(observations, party, colour, path, "party", resolver)
            if "Party" in item and "Party_Name" not in item and "party" not in item:
                add_observation(observations, item.get("Party"), item.get("Party_Colour", ""), path, "Party", "entry")
    return observations


def main() -> None:
    lookup = load_wikipedia_lookup()
    observations = extract_observations()
    rows = []
    for (party, colour, resolver), seen in sorted(observations.items(), key=lambda kv: (match_key(kv[0][0]), kv[0][1], kv[0][2])):
        wiki_match, match_status = choose_wiki_match(party, lookup)
        wiki_colour = wiki_match["colour"] if wiki_match else ""
        colour_match = bool(colour and wiki_colour and colour == wiki_colour)
        if not colour:
            status = "no_election_colour"
        elif not wiki_match:
            status = "no_wikipedia_match"
        elif colour_match:
            status = "match"
        else:
            status = "colour_mismatch"
        files = sorted({p for p, _ in seen})
        rows.append({
            "party_or_ticket": party,
            "election_colour": colour,
            "resolver": resolver,
            "observations": len(seen),
            "files": len(files),
            "first_file": files[0] if files else "",
            "wikipedia_match_name": wiki_match["name"] if wiki_match else "",
            "wikipedia_match_basis": wiki_match["basis"] if wiki_match else "",
            "wikipedia_colour": wiki_colour,
            "wikipedia_module": wiki_match["module"] if wiki_match else "",
            "match_status": match_status,
            "colour_status": status,
        })

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    counts = Counter(row["colour_status"] for row in rows)
    mismatch_rows = [row for row in rows if row["colour_status"] == "colour_mismatch"]
    no_match_rows = [row for row in rows if row["colour_status"] == "no_wikipedia_match"]
    ambiguous_rows = [row for row in rows if row["match_status"].startswith("ambiguous")]
    high_confidence_rows = [
        row for row in mismatch_rows
        if row["match_status"] == "matched"
        and row["wikipedia_match_basis"] in {"name", "manual_alias"}
        and row["election_colour"]
    ]

    with HIGH_CONFIDENCE_CSV.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(high_confidence_rows)

    def md_table(items, limit=60):
        headers = ["party_or_ticket", "election_colour", "wikipedia_match_name", "wikipedia_colour", "wikipedia_match_basis", "observations"]
        lines = ["|" + "|".join(headers) + "|", "|" + "|".join(["---"] * len(headers)) + "|"]
        for row in items[:limit]:
            lines.append("|" + "|".join(str(row[h]).replace("|", "\\|") for h in headers) + "|")
        return "\n".join(lines)

    OUT_MD.write_text(
        "\n".join([
            "# Ireland election party colour audit against Wikipedia",
            "",
            f"Unique election party/ticket colour observations: {len(rows)}",
            f"Colour matches: {counts['match']}",
            f"Colour mismatches where a Wikipedia match was found: {counts['colour_mismatch']}",
            f"Entries with no explicit election colour: {counts['no_election_colour']}",
            f"No Wikipedia match found: {counts['no_wikipedia_match']}",
            f"Ambiguous Wikipedia alias matches: {len(ambiguous_rows)}",
            f"High-confidence mismatches: {len(high_confidence_rows)}",
            "",
            "## High-Confidence Mismatches",
            "These rows matched Wikipedia by exact party name or a domain-specific Ireland/NI alias, but the colour differs.",
            md_table(high_confidence_rows),
            "",
            "## Colour Mismatches",
            md_table(mismatch_rows),
            "",
            "## No Wikipedia Match",
            md_table(no_match_rows),
            "",
            f"Full CSV: `{OUT_CSV}`",
            f"High-confidence mismatch CSV: `{HIGH_CONFIDENCE_CSV}`",
        ]),
        encoding="utf-8",
    )

    print(json.dumps({
        "rows": len(rows),
        "counts": counts,
        "mismatches": len(mismatch_rows),
        "no_match": len(no_match_rows),
        "ambiguous": len(ambiguous_rows),
        "csv": str(OUT_CSV),
        "high_confidence_csv": str(HIGH_CONFIDENCE_CSV),
        "report": str(OUT_MD),
    }, indent=2, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    main()
