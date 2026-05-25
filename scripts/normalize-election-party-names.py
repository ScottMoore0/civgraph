import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path("election-viewer-package/data/elections")
PARTY_KEYS = {
    "Party_Name",
    "Party",
    "party",
    "key",
    "Wikipedia Party Name",
    "Deduplicated Party Name",
}


DIRECT_REPLACEMENTS = {
    "Fianna Fail": "Fianna Fáil",
    "Fianna FÃ¡il": "Fianna Fáil",
    "Sinn Fein": "Sinn Féin",
    "Sinn FÃ©in": "Sinn Féin",
    "S.F.": "Sinn FÃ©in",
    "Non party/Independent": "Independent",
    "Non-Party": "Independent",
    "Labour": "Irish Labour",
    "Labour Lozenge": "Irish Labour",
    "NI Labour Party": "NI Labour",
    "Ulster Unionist Party": "UUP",
    "S.D.L.P": "SDLP",
    "S.D.L.P.": "SDLP",
    "SDLP (Social Democratic and Labour Party)": "SDLP",
    "SDLP (Social Democratic and Labour Party": "SDLP",
    "SDLP-Social Democratic and Labour Party": "SDLP",
    "Social Democratic and Labour Party (SDLP)": "SDLP",
    "Democratic Unionist Party": "DUP",
    "Democratic Unionist -": "DUP",
    "Democratic Unionist - DUP": "DUP",
    "D.U.P.": "DUP",
    "D.U U.U.U.C": "DUP",
    "DUP - Leader Ian Paisley": "DUP",
    "Loy. D.U.": "DUP",
    "U.D.U.P.": "DUP",
    "Ulster DUP": "DUP",
    "People Before Profit Alliance": "PBP",
    "People Before Profit": "PBP",
    "Alliance Party of Northern Ireland": "Alliance",
    "Alliance Party": "Alliance",
    "Green/Comhaontas Glas": "Green",
    "Green/Comhaontas Glas Lozenge": "Green",
    "Green Party": "Green",
    "The Green Party": "Green",
    "Conservatives": "Conservative",
    "Irish Conservative": "Conservative",
    "Conservative and Unionist": "Conservative",
    "Workers' Party (Ireland)": "Workers' Party",
    "The Workers' Party": "Workers' Party",
    "The  Workers' Party": "Workers' Party",
    "Workers Party": "Workers' Party",
    "Workers'": "Workers' Party",
    "Workers' Lozenge": "Workers' Party",
    "Workers' Party R.C.": "Workers' Party",
    "Workers' Party Rep. C": "Workers' Party",
    "Workers' Party Rep. C.": "Workers' Party",
    "Workers Party R.C.": "Workers' Party",
    "Workers Party Rep. C": "Workers' Party",
    "Workers Party Rep. C.": "Workers' Party",
    "Rep. Clubs": "Republican Clubs",
    "Nationalist": "Nationalist Party",
    "British National Party": "BNP",
    "Socialist Party (Ireland)": "Socialist Party",
    "N.I.L.P": "NI Labour",
    "N.I.L.P.": "NI Labour",
    "Northern Ireland Labour Party": "NI Labour",
    "Newtownabbey Labour Party": "Newtownabbey Labour",
    "Republican Labour Party": "Republican Labour",
    "Irish Independence Party": "IIP",
    "I.I.P.": "IIP",
    "I.I.P. Nationalist": "IIP",
    "Northern Ireland Unionist Party": "NI Unionist Party",
    "U.P.U.P.": "Ulster Popular Unionist Party",
    "U.P.N.I.": "Unionist Party of Northern Ireland",
    "Democratic Left / New Agenda": "Democratic Left",
    "AP": "Alliance",
    "A.P.": "Alliance",
    "A.P": "Alliance Party",
    "A.P..": "Alliance",
    "A.": "Alliance",
    "A": "Alliance",
    "Alliance.": "Alliance",
    "N I Women's Coalition": "NI Women's Coalition",
    "N.I. Women's Coalition": "NI Women's Coalition",
    "N.I. Womens Coalition": "NI Women's Coalition",
    "N.Ireland Women's Coalition": "NI Women's Coalition",
    "N.Ireland Women's Coalition (NIWC)": "NI Women's Coalition",
    "NI Women's Coalition": "NI Women's Coalition",
    "Northern  Ireland Women's Coalition": "NI Women's Coalition",
    "Northern Ireland Women's Coalition": "NI Women's Coalition",
    "Northern Ireland Women's Coalition - NIWC": "NI Women's Coalition",
    "Northern Ireland Womens Coalition": "NI Women's Coalition",
    "NR. Ireland Women's Coalition": "NI Women's Coalition",
    "Womens Coalition": "NI Women's Coalition",
    "O.U.": "UUP",
    "UU": "UUP",
    "UUP U.U.U.C": "UUP",
    "UUP U.U.U.C.": "UUP",
    "Ulster Unionist U.U.P": "UUP",
    "Ulster Unionist U.U.P.": "UUP",
    "O Un": "UUP",
    "O Un.": "UUP",
    "O. Un.": "UUP",
    "O. Un": "UUP",
    "O.Un.": "UUP",
    "O.Un": "UUP",
    "Of. Un.": "UUP",
    "Of.Un.": "UUP",
    "O. Ul. Un.": "UUP",
    "Off. Un": "UUP",
    "Off. Un.": "UUP",
    "Official Unionist": "UUP",
    "Indp.": "Independent",
    "IND": "Independent",
    "INDP": "Independent",
    "Independent Lozenge": "Independent",
    "Independant": "Independent",
    "Ind. Unionist": "Independent Unionist",
    "Independent Un.": "Independent Unionist",
    "Ind. Nationalist": "Independent Nationalist",
    "Irish Unionist": "Irish Unionist Alliance",
    "Irish Unionist Alliance Alliance": "Irish Unionist Alliance",
    "Non Party": "Independent",
    "Non. Party": "Independent",
    "Un": "Unionist",
    "Un.": "Unionist",
    "Comhar Criostai/Christian Solidarity": "Comhar Criostai / Christian Solidarity",
    "United UUP": "UUUP",
    "Indp": "Independent",
    "DU UUUC": "DUP",
    "Renua Ireland": "Renua",
    "Solidarity PBP": "Solidarity-PBP",
    "Solidarity PBP Lozenge": "Solidarity-PBP",
    "Progressive Unionist Party": "PUP",
    "PUP PUP": "PUP",
    "PUP - PUP": "PUP",
    "PUP (PUP)": "PUP",
    "PUP P.U.P.": "PUP",
    "PUP of Northern Ireland": "PUP",
    "PUP of Northen Ireland": "PUP",
    "Alliancep": "Alliance",
    "Independent Alliance": "Independent Alliance",
    "Independent Alliance (Non party)": "Independent Alliance",
    "Ulster Liberal Party": "Ulster Liberal",
    "Lib": "Ulster Liberal",
    "Van. Un.": "Vanguard Unionist Progressive Party",
}

SUBSTRING_REPLACEMENTS = {
    "Fianna Fail": "Fianna Fáil",
    "Fianna FÃ¡il": "Fianna Fáil",
    "Sinn Fein": "Sinn Féin",
    "Sinn FÃ©in": "Sinn Féin",
    "Sinn Feín": "Sinn Féin",
    "Sinn Fién": "Sinn Féin",
    "Sinn Fèin": "Sinn Féin",
    "Sinn Feinn": "Sinn Féin",
    "Sinn Féinn": "Sinn Féin",
    "Non party/Independent": "Independent",
    "Ulster Unionist Party": "UUP",
    "S.D.L.P.": "SDLP",
    "S.D.L.P": "SDLP",
    "Democratic Unionist Party": "DUP",
    "Democratic Unionist - DUP": "DUP",
    "People Before Profit Alliance": "PBP",
    "People Before Profit": "PBP",
    "Alliance Party of Northern Ireland": "Alliance",
    "Green/Comhaontas Glas": "Green",
    "Conservatives": "Conservative",
    "Workers' Party (Ireland)": "Workers' Party",
    "Workers Party": "Workers' Party",
    "A.P.": "Alliance",
    "A.P..": "Alliance",
    "Northern Ireland Women's Coalition": "NI Women's Coalition",
    "Northern Ireland Womens Coalition": "NI Women's Coalition",
    "Northern  Ireland Women's Coalition": "NI Women's Coalition",
    "NIWC": "NI Women's Coalition",
    "O. Un.": "UUP",
    "O.Un.": "UUP",
    "Of. Un.": "UUP",
    "Off. Un.": "UUP",
    "Indp.": "Independent",
    "Independent Lozenge": "Independent",
    "Non Party": "Independent",
    "Comhar Criostai/Christian Solidarity": "Comhar Criostai / Christian Solidarity",
    "United UUP": "UUUP",
    "Indp": "Independent",
    "DU UUUC": "DUP",
    "Renua Ireland": "Renua",
    "Solidarity PBP": "Solidarity-PBP",
}


def normalize_dup_label(value: str) -> str:
    repaired = value.replace("U.DUP", "U.D.U.P.")
    repaired = re.sub(r"(?<!U\.)\bD\s*\.?\s*U\s*\.?\s*P\.?\b", "DUP", repaired)
    simple = re.sub(r"\s+", " ", repaired.strip())
    if re.fullmatch(r"DUP(?:\s*(?:-| )\s*DUP|\s*\(DUP\))?", simple, flags=re.I):
        return "DUP"
    if re.fullmatch(
        r"DUP\s+(?:reverend|farmer|auctioneer estate agent|clerical office|construction supervisor)",
        simple,
        flags=re.I,
    ):
        return "DUP"
    if (
        re.match(r"^(?:Democratic|Dermocratic|Remocratic)\s+Uni\S*", simple, flags=re.I)
        and re.search(r"\bDUP\b", simple, flags=re.I)
    ):
        return "DUP"
    return repaired


def election_year(path: Path) -> int | None:
    for part in path.parts:
        match = re.match(r"^((?:18|19|20)\d{2})", part)
        if match:
            return int(match.group(1))
    return None


def normalize_value(value: object, year: int | None, workers_party_context: bool = False) -> object:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if stripped == "Rep Clubs":
        return "Workers' Party" if workers_party_context else "Republican Clubs"
    if stripped != value and stripped in DIRECT_REPLACEMENTS:
        return DIRECT_REPLACEMENTS[stripped]
    if "Green / Ecology" in value:
        if year is not None and year < 1985:
            return value.replace("Green / Ecology", "Ecology")
        if year is not None and year > 1985:
            return value.replace("Green / Ecology", "Green")
        return value
    if "Workers Party / Republican Clubs" in value:
        if year is not None and year <= 1977:
            return value.replace("Workers Party / Republican Clubs", "Republican Clubs")
        if year is not None and year > 1977:
            return value.replace("Workers Party / Republican Clubs", "Workers Party")
        return value
    if value in DIRECT_REPLACEMENTS:
        return DIRECT_REPLACEMENTS[value]
    if value.startswith("Irish Unionist Alliance Alliance"):
        return value.replace("Irish Unionist Alliance Alliance", "Irish Unionist Alliance", 1)
    if value == "Irish Unionist" or value.startswith("Irish Unionist::"):
        return value.replace("Irish Unionist", "Irish Unionist Alliance", 1)
    if value == "A." or value.startswith("A.::"):
        return value.replace("A.", "Alliance", 1)
    if value in {"PUP PUP", "PUP - PUP", "PUP (PUP)", "PUP P.U.P.", "PUP of Northern Ireland", "PUP of Northen Ireland"}:
        return "PUP"
    if value.startswith("PUP PUP::") or value.startswith("PUP - PUP::"):
        return value.replace("PUP PUP", "PUP", 1).replace("PUP - PUP", "PUP", 1)
    if value.startswith("Progressive Unionist Party"):
        tail = value[len("Progressive Unionist Party"):]
        if tail in {"", " PUP", " P.U.P.", " (PUP)", " - PUP"}:
            return "PUP"
        if tail in {" of Northern Ireland", " of Northen Ireland"}:
            return "PUP"
        if tail.startswith("::"):
            return "PUP" + tail
    dup_normalized = normalize_dup_label(value)
    if dup_normalized != value:
        return dup_normalized
    if value in DIRECT_REPLACEMENTS:
        return DIRECT_REPLACEMENTS[value]
    normalized = value
    for source, target in SUBSTRING_REPLACEMENTS.items():
        normalized = normalized.replace(source, target)
    return normalized


def normalize_obj(obj, year: int | None, counts: Counter, workers_party_context: bool = False) -> bool:
    changed = False
    if isinstance(obj, dict):
        for key, value in list(obj.items()):
            if key in PARTY_KEYS:
                normalized = normalize_value(value, year, workers_party_context)
                if normalized != value:
                    counts[f"{value} -> {normalized}"] += 1
                    obj[key] = normalized
                    changed = True
            if normalize_obj(obj[key], year, counts, workers_party_context):
                changed = True
    elif isinstance(obj, list):
        for item in obj:
            if normalize_obj(item, year, counts, workers_party_context):
                changed = True
    return changed


FIELD_RE = re.compile(
    r'(?P<prefix>"(?:Party_Name|Party|party|key|Wikipedia Party Name|Deduplicated Party Name)"\s*:\s*)"(?P<value>(?:\\.|[^"\\])*)"'
)


def normalize_file_text(text: str, year: int | None, counts: Counter, workers_party_context: bool = False) -> tuple[str, bool]:
    changed = False

    def repl(match: re.Match) -> str:
        nonlocal changed
        value = match.group("value")
        normalized = normalize_value(value, year, workers_party_context)
        if normalized == value:
            return match.group(0)
        counts[f"{value} -> {normalized}"] += 1
        changed = True
        return f'{match.group("prefix")}"{normalized}"'

    return FIELD_RE.sub(repl, text), changed


def election_has_workers_party(paths: list[Path]) -> set[Path]:
    contexts: set[Path] = set()
    worker_pattern = re.compile(
        r'"(?:Party_Name|Party|party|key|Wikipedia Party Name|Deduplicated Party Name)"\s*:\s*"Workers\' Party"'
    )
    for path in paths:
        if worker_pattern.search(path.read_text(encoding="utf-8")):
            contexts.add(path.parent)
    return contexts


def main() -> None:
    counts = Counter()
    changed_files = 0
    paths = sorted(ROOT.rglob("*.json"))
    workers_party_contexts = election_has_workers_party(paths)
    for path in paths:
        text = path.read_text(encoding="utf-8")
        updated, changed = normalize_file_text(
            text,
            election_year(path),
            counts,
            path.parent in workers_party_contexts,
        )
        if changed:
            json.loads(updated)
            path.write_text(updated, encoding="utf-8")
            changed_files += 1

    print(f"changed_files={changed_files}")
    for label, count in counts.most_common():
        print(f"{count}\t{label}")


if __name__ == "__main__":
    main()
