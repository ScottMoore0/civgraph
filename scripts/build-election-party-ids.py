import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


ROOT = Path("election-viewer-package/data/elections")
OUT_JSON = Path("election-viewer-package/data/party-ids.json")
OUT_CSV = Path("tasks/ireland_election_party_ids.csv")

PARTY_KEYS = {
    "Party_Name",
    "Party",
    "party",
    "Wikipedia Party Name",
    "Deduplicated Party Name",
}

KNOWN_GROUPS = [
    ("party:fianna-fail", "Fianna Fáil", ["Fianna Fail", "Fianna Fáil"]),
    ("party:sinn-fein", "Sinn Féin", ["Sinn Fein", "Sinn Féin"]),
    (
        "party:independent",
        "Independent",
        ["Independent", "Independent Lozenge", "IND", "INDP", "Independant", "Indp.", "Non Party", "Non-Party", "Non. Party", "Non party/Independent"],
    ),
    ("party:irish-labour", "Irish Labour", ["Irish Labour", "Labour", "Labour Lozenge"]),
    ("party:ni-labour", "NI Labour", ["N.I.L.P", "N.I.L.P.", "NI Labour", "NI Labour Party", "Northern Ireland Labour Party"]),
    (
        "party:uup",
        "UUP",
        [
            "UUP",
            "O Un",
            "O Un.",
            "O. Un",
            "O. Un.",
            "O.U.",
            "O. Ul. Un.",
            "O.Un",
            "O.Un.",
            "Of. Un.",
            "Of.Un.",
            "Off. Un",
            "Off. Un.",
            "Official Unionist",
            "UU",
            "Ulster Unionist Party",
            "Ulster Unionist U.U.P",
            "Ulster Unionist U.U.P.",
            "UUP U.U.U.C",
            "UUP U.U.U.C.",
        ],
    ),
    (
        "party:sdlp",
        "SDLP",
        [
            "SDLP",
            "S.D.L.P",
            "S.D.L.P.",
            "SDLP (Social Democratic and Labour Party)",
            "SDLP (Social Democratic and Labour Party",
            "SDLP-Social Democratic and Labour Party",
            "Social Democratic and Labour Party (SDLP)",
        ],
    ),
    ("party:green", "Green", ["Ecology", "Green", "Green Party", "Green / Ecology", "Green/Comhaontas Glas", "Green/Comhaontas Glas Lozenge", "The Green Party"]),
    (
        "party:workers-party",
        "Workers' Party",
        [
            "Workers' Party",
            "Workers' Party (Ireland)",
            "Workers Party",
            "Workers'",
            "Workers' Lozenge",
            "Rep Clubs",
            "Rep. Clubs",
            "Republican Clubs",
            "Workers Party / Republican Clubs",
        ],
    ),
    ("party:conservative", "Conservative", ["Conservative", "Conservative and Unionist", "Conservatives", "Irish Conservative"]),
    ("party:bnp", "BNP", ["BNP", "British National Party"]),
    ("party:socialist-party", "Socialist Party", ["Socialist Party", "Socialist Party (Ireland)"]),
    ("party:nationalist-party", "Nationalist Party", ["Nationalist", "Nationalist Party"]),
    ("party:unionist", "Unionist", ["Un", "Un.", "Unionist"]),
    (
        "party:dup",
        "DUP",
        [
            "DUP",
            "D.U U.U.U.C",
            "D.U.P.",
            "DUP - Leader Ian Paisley",
            "Democratic Unionist -",
            "Democratic Unionist - DUP",
            "Democratic Unionist Party",
            "Loy. D.U.",
            "U.D.U.P.",
            "Ulster DUP",
        ],
    ),
    ("party:pbp", "PBP", ["PBP", "People Before Profit", "People Before Profit Alliance"]),
    ("party:alliance", "Alliance", ["Alliance", "A", "A.", "AP", "A.P", "A.P.", "Alliance Party", "Alliance Party of Northern Ireland"]),
    ("party:solidarity-pbp", "Solidarity-PBP", ["Solidarity-PBP", "Solidarity PBP", "Solidarity PBP Lozenge"]),
    ("party:pup", "PUP", ["PUP", "Progressive Unionist Party"]),
    ("party:uuup", "UUUP", ["UUUP", "United UUP", "United Ulster Unionist Party"]),
    ("party:iip", "IIP", ["I.I.P.", "I.I.P. Nationalist", "IIP", "Irish Independence Party"]),
    ("party:renua", "Renua", ["Renua", "Renua Ireland"]),
    ("party:independent-nationalist", "Independent Nationalist", ["Ind. Nationalist", "Independent Nationalist"]),
    ("party:independent-unionist", "Independent Unionist", ["Ind. Unionist", "Independent Un.", "Independent Unionist"]),
    ("party:ulster-liberal", "Ulster Liberal", ["Lib", "Ulster Liberal", "Ulster Liberal Party"]),
    ("party:republican-labour", "Republican Labour", ["Republican Labour", "Republican Labour Party"]),
    ("party:newtownabbey-labour", "Newtownabbey Labour", ["Newtownabbey Labour", "Newtownabbey Labour Party"]),
    ("party:ulster-popular-unionist-party", "Ulster Popular Unionist Party", ["U.P.U.P.", "Ulster Popular Unionist Party"]),
    ("party:vanguard-unionist-progressive-party", "Vanguard Unionist Progressive Party", ["Van. Un.", "Vanguard Unionist Progressive Party"]),
    ("party:unionist-party-of-northern-ireland", "Unionist Party of Northern Ireland", ["U.P.N.I.", "Unionist Party of Northern Ireland"]),
    ("party:ni-unionist-party", "NI Unionist Party", ["NI Unionist Party", "Northern Ireland Unionist Party"]),
    ("party:independent-alliance", "Independent Alliance", ["Independent Alliance", "Independent Alliance (Non party)"]),
    ("party:democratic-left", "Democratic Left", ["Democratic Left", "Democratic Left / New Agenda"]),
    ("party:irish-unionist-alliance", "Irish Unionist Alliance", ["Irish Unionist", "Irish Unionist Alliance"]),
    (
        "party:comhar-criostai-christian-solidarity",
        "Comhar Criostai / Christian Solidarity",
        ["Comhar Criostai/Christian Solidarity", "Comhar Criostai / Christian Solidarity"],
    ),
    (
        "party:ni-womens-coalition",
        "NI Women's Coalition",
        [
            "N I Women's Coalition",
            "N.I. Women's Coalition",
            "N.I. Womens Coalition",
            "N.Ireland Women's Coalition",
            "N.Ireland Women's Coalition (NIWC)",
            "NI Women's Coalition",
            "NIWC",
            "Northern Ireland Women's Coalition",
            "Northern Ireland Women's Coalition - NIWC",
            "Northern Ireland Womens Coalition",
            "NR. Ireland Women's Coalition",
            "Womens Coalition",
        ],
    ),
]


def clean_label(value: object) -> str:
    text = str(value or "").replace("\ufeff", "").strip()
    text = text.replace("ÃƒÂ¡", "á").replace("ÃƒÂ©", "é").replace("ÃƒÂº", "ú")
    text = text.replace("Ã¡", "á").replace("Ã©", "é").replace("Ãº", "ú")
    text = re.sub(r"\s*Lozenge\s*$", "", text, flags=re.I).strip()
    return re.sub(r"\s+", " ", text)


def key_for(value: object) -> str:
    text = unicodedata.normalize("NFKD", clean_label(value).casefold())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", "and")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slug_for(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", key_for(value)).strip("-") or "unknown"


def iter_party_values(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in PARTY_KEYS and isinstance(value, str):
                label = clean_label(value)
                if label:
                    yield label
            yield from iter_party_values(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from iter_party_values(item)


def main() -> None:
    known_by_key = {}
    metadata = {}
    for party_id, canonical_name, aliases in KNOWN_GROUPS:
        metadata[party_id] = {
            "party_id": party_id,
            "canonical_name": canonical_name,
            "known_aliases": sorted(set(aliases), key=str.casefold),
        }
        for alias in aliases:
            known_by_key[key_for(alias)] = party_id

    counts = Counter()
    files_by_label = defaultdict(set)
    for path in sorted(ROOT.rglob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for label in iter_party_values(data):
            counts[label] += 1
            files_by_label[label].add(str(path).replace("\\", "/"))

    party_labels = defaultdict(Counter)
    party_files = defaultdict(set)
    for label, count in counts.items():
        party_id = known_by_key.get(key_for(label), f"party:{slug_for(label)}")
        party_labels[party_id][label] += count
        party_files[party_id].update(files_by_label[label])

    entries = []
    alias_lookup = {}
    for party_id, labels in party_labels.items():
        known = metadata.get(party_id, {})
        canonical_name = known.get("canonical_name") or labels.most_common(1)[0][0]
        observed_names = [label for label, _ in sorted(labels.items(), key=lambda item: (-item[1], item[0].casefold()))]
        known_aliases = sorted(set(known.get("known_aliases", []) + observed_names), key=str.casefold)
        occurrence_count = sum(labels.values())
        file_count = len(party_files[party_id])
        entry = {
            "party_id": party_id,
            "canonical_name": canonical_name,
            "observed_names": observed_names,
            "known_aliases": known_aliases,
            "occurrence_count": occurrence_count,
            "file_count": file_count,
        }
        entries.append(entry)
        for alias in known_aliases:
            alias_lookup[alias] = party_id

    entries.sort(key=lambda item: (-item["occurrence_count"], item["canonical_name"].casefold()))
    output = {
        "generated_at": date.today().isoformat(),
        "description": "Stable party/ticket IDs for party-like labels observed in election JSON data.",
        "party_ids": entries,
        "aliases": dict(sorted(alias_lookup.items(), key=lambda item: item[0].casefold())),
    }

    OUT_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "party_id",
                "canonical_name",
                "observed_names",
                "known_aliases",
                "occurrence_count",
                "file_count",
            ],
        )
        writer.writeheader()
        for entry in entries:
            writer.writerow(
                {
                    **entry,
                    "observed_names": "; ".join(entry["observed_names"]),
                    "known_aliases": "; ".join(entry["known_aliases"]),
                }
            )

    print(f"party_ids={len(entries)}")
    print(f"aliases={len(alias_lookup)}")
    print(f"wrote={OUT_JSON}")
    print(f"wrote={OUT_CSV}")


if __name__ == "__main__":
    main()
