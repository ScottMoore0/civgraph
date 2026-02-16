"""Utilities for resolving party colours from Wikipedia's party module."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from typing import Dict, Iterable, Iterator, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


# Wikipedia exposes party metadata via a suite of Lua modules.  The core
# ``Module:Political party`` file delegates to a directory of submodules named
# ``Module:Political party/<suffix>`` where the suffix is usually a digit or the
# first letter of the party name.  The resolver below fetches the raw Lua
# tables, extracts colour declarations and aliases, and exposes a Python mapping
# that can be shared between the Flask API and the offline workbook generator.

MODULE_TITLES: tuple[str, ...] = (
    "Module:Political_party",
    "Module:Political_party/1",
    "Module:Political_party/2",
    "Module:Political_party/3",
    "Module:Political_party/4",
    "Module:Political_party/5",
    "Module:Political_party/6",
    "Module:Political_party/7",
    "Module:Political_party/8",
    "Module:Political_party/9",
) + tuple(f"Module:Political_party/{suffix}" for suffix in "ABCDEFGHIJKLMNOPQRSTUVWXYZ")

WIKIPEDIA_RAW_URL = (
    "https://en.wikipedia.org/w/index.php?title={title}&action=raw&ctype=text/plain"
)


DEFAULT_PARTY_COLOURS: Dict[str, str] = {
    # Legacy palette retained as a fallback when the network is unavailable.
    "Alliance": "#FDD835",
    "Alliance Party": "#FDD835",
    "Democratic Unionist Party": "#FF5722",
    "DUP": "#FF5722",
    "Green Party": "#64DD17",
    "Green Party Northern Ireland": "#64DD17",
    "Independent": "#B0BEC5",
    "Sinn Féin": "#4CAF50",
    "Sinn Fein": "#4CAF50",
    "Social Democratic and Labour Party": "#E53935",
    "SDLP": "#E53935",
    "Traditional Unionist Voice": "#303F9F",
    "TUV": "#303F9F",
    "UK Independence Party": "#9C27B0",
    "UKIP": "#9C27B0",
    "Ulster Unionist Party": "#03A9F4",
    "UUP": "#03A9F4",
    "People Before Profit Alliance": "#E91E63",
    "People Before Profit": "#E91E63",
    "Workers Party": "#FF0000",
    "Progressive Unionist Party": "#880E4F",
    "Traditional Unionist Voice (Northern Ireland)": "#303F9F",
    "NI Conservatives": "#0047AB",
    "Cross-Community Labour Alternative": "#E57373",
}


SPECIFIED_PARTY_COLOURS: Dict[str, str] = {
    "SDLP": "#2AA82C",
    "Social Democratic and Labour Party": "#2AA82C",
    "UUP": "#48A5EE",
    "Alliance": "#F6CB2F",
    "Alliance Party": "#F6CB2F",
    "Alliance Party of Northern Ireland": "#F6CB2F",
    "Vanguard Unionist Progressive Party": "darkorange",
    "DUP": "#D46A4C",
    "Democratic Unionist Party": "#D46A4C",
    "NI Labour": "#DC241F",
    "Independent": "#DCDCDC",
    "Independent Unionist": "#AADFFF",
    "Ulster Constitution Party": "#000000",
    "Sinn Féin": "#326760",
    "Sinn Fein": "#326760",
    "Workers Party / Republican Clubs": "#930C1A",
    "Workers Party": "#930C1A",
    "Ulster Liberal Party": "#DAA520",
    "Communist Party of Ireland": "#E3170D",
    "Republican Labour Party": "#85DE59",
    "Nationalist Party": "#32CD32",
    "National Front": "MidnightBlue",
    "Independent Nationalist": "#CDFFAB",
    "Unionist Party of Northern Ireland": "#FFA07A",
    "Ulster Unionist Party": "#48A5EE",
    "Independent Other": "#DCDCDC",
    "United Labour Party": "#FF0000",
    "United Ulster Unionist Party": "#FF8C00",
    "Ulster Democratic Party": "#000000",
    "People's Democracy": "#FF0000",
    "Green / Ecology": "#8DC63F",
    "PUP": "#2B45A2",
    "Progressive Unionist Party": "#2B45A2",
    "Ulster Popular Unionist Party": "#FFDEAD",
    "Newtownabbey Labour Party": "#FF0000",
    "Conservative": "#0087DC",
    "Labour '87": "#DC241F",
    "Ulster Independence Movement": "#A9A9A9",
    "Ulster Third Way": "#A9A9A9",
    "Natural Law": "#FFE4E1",
    "Independent - Northern Ireland independence": "#D4D4D4",
    "Labour Party of Northern Ireland": "#DC241F",
    "Northern Ireland Women's Coalition": "#00FFFF",
    "UKUP": "#660066",
    "Socialist Party": "#FF3300",
    "Ulster's Independent Voice": "#FF8C00",
    "Vote For Yourself / Rainbow Dream Ticket / Make Politicians History": "#FFC0CB",
    "Socialist Environmental Alliance": "#BB0000",
    "Northern Ireland Unionist Party": "#FF8C00",
    "Procapitalism": "#000000",
    "Republican Sinn Féin": "#008800",
    "People Before Profit Alliance": "#E91D50",
    "UKIP": "#6D3177",
    "UK Independence Party": "#6D3177",
    "TUV": "#0C3A6A",
    "Traditional Unionist Voice": "#0C3A6A",
    "Traditional Unionist Voice (Northern Ireland)": "#0C3A6A",
    "BNP": "#2E3B74",
    "NI21": "#008080",
    "Cross-Community Labour Alternative": "#CD5C5C",
    "Northern Ireland Labour Representation Committee": "#DC241F",
    "Northern Ireland First": "#DCDCDC",
    "South Belfast Unionists": "#DCDCDC",
    "CISTA": "#D2B48C",
    "Democracy First": "#000000",
    "Animal Welfare Party": "#EE3263",
}


CSS_COLOUR_NAMES: Dict[str, str] = {
    # Subset of CSS colour names frequently encountered in the party module.
    "aqua": "#00FFFF",
    "black": "#000000",
    "blue": "#0000FF",
    "darkorange": "#FF8C00",
    "crimson": "#DC143C",
    "cyan": "#00FFFF",
    "fuchsia": "#FF00FF",
    "gold": "#FFD700",
    "gray": "#808080",
    "green": "#008000",
    "grey": "#808080",
    "indigo": "#4B0082",
    "ivory": "#FFFFF0",
    "lavender": "#E6E6FA",
    "lime": "#00FF00",
    "magenta": "#FF00FF",
    "maroon": "#800000",
    "navy": "#000080",
    "olive": "#808000",
    "midnightblue": "#191970",
    "orange": "#FFA500",
    "pink": "#FFC0CB",
    "purple": "#800080",
    "red": "#FF0000",
    "salmon": "#FA8072",
    "silver": "#C0C0C0",
    "teal": "#008080",
    "turquoise": "#40E0D0",
    "violet": "#EE82EE",
    "white": "#FFFFFF",
    "yellow": "#FFFF00",
}


def _normalise_hex(value: str) -> Optional[str]:
    if not value:
        return None
    raw = value.strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if re.fullmatch(r"[0-9a-fA-F]{6}", raw):
        return f"#{raw.upper()}"
    return None


def _colour_from_value(value: str) -> Optional[str]:
    candidate = _normalise_hex(value)
    if candidate:
        return candidate
    lowered = value.strip().lower()
    if lowered in CSS_COLOUR_NAMES:
        return CSS_COLOUR_NAMES[lowered]
    if lowered.startswith("0x") and len(lowered) == 8:
        return _normalise_hex(lowered[2:])
    return None


def _hash_colour(text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
    r = int(digest[0:2], 16)
    g = int(digest[2:4], 16)
    b = int(digest[4:6], 16)
    # Bias the palette slightly brighter to keep labels legible.
    r = (r + 96) % 256
    g = (g + 96) % 256
    b = (b + 96) % 256
    return f"#{r:02X}{g:02X}{b:02X}"


@dataclass
class PartyColourResolver:
    """Resolve colour codes for political parties."""

    fetch_remote: bool = True
    user_agent: str = "ElectionsNI-PartyColours/1.0"

    def __post_init__(self) -> None:
        self._colours: Optional[Dict[str, str]] = None
        self._normalised: Optional[Dict[str, str]] = None

    @property
    def colours(self) -> Dict[str, str]:
        if self._colours is None:
            mapping = dict(DEFAULT_PARTY_COLOURS)
            if self.fetch_remote:
                remote = self._fetch_remote_colours()
                mapping.update(remote)
            mapping.update(SPECIFIED_PARTY_COLOURS)
            # Ensure all entries are normalised hex strings.
            cleaned: Dict[str, str] = {}
            for name, value in mapping.items():
                colour = _colour_from_value(value) or _hash_colour(name)
                cleaned[name] = colour
            self._colours = cleaned
        return self._colours

    def colour_for(self, party_name: str) -> Optional[str]:
        if not party_name:
            return None
        name = party_name.strip()
        if not name:
            return None
        if self._normalised is None:
            self._normalised = {k.lower(): v for k, v in self.colours.items()}
        colour = self.colours.get(name)
        if colour:
            return colour
        lowered = name.lower()
        colour = self._normalised.get(lowered)
        if colour:
            return colour
        if "(" in name:
            base = name.split("(", 1)[0].strip()
            if base and base != name:
                base_colour = self.colour_for(base)
                if base_colour:
                    return base_colour
        if lowered.startswith("independent") and "-" not in name:
            base_colour = self._normalised.get("independent")
            if base_colour:
                return base_colour
        return None

    # ------------------------------------------------------------------
    # Remote loading
    # ------------------------------------------------------------------
    def _fetch_remote_colours(self) -> Dict[str, str]:
        colours: Dict[str, str] = {}
        for title in MODULE_TITLES:
            try:
                content = self._download_module(title)
            except (HTTPError, URLError):
                continue
            colours.update(self._parse_module(content))
        return colours

    def _download_module(self, title: str) -> str:
        url = WIKIPEDIA_RAW_URL.format(title=quote(title, safe="/:"))
        request = Request(url, headers={"User-Agent": self.user_agent})
        with urlopen(request) as response:
            return response.read().decode("utf-8")

    def _parse_module(self, text: str) -> Dict[str, str]:
        entries: Dict[str, str] = {}
        for key, body in self._iter_entries(text):
            colour_value = self._extract_colour(body)
            if not colour_value:
                continue
            colour = _colour_from_value(colour_value)
            if not colour:
                continue
            names = {key}
            names.update(self._extract_aliases(body))
            for name in names:
                if name:
                    entries[name] = colour
        return entries

    def _iter_entries(self, text: str) -> Iterator[tuple[str, str]]:
        pattern = re.compile(r"\[\s*\"([^\"]+)\"\s*\]\s*=\s*\{", re.MULTILINE)
        for match in pattern.finditer(text):
            name = match.group(1)
            body, offset = self._extract_body(text, match.end() - 1)
            if body is None:
                continue
            yield name, body

    def _extract_body(self, text: str, start_index: int) -> tuple[Optional[str], int]:
        depth = 0
        body_chars: list[str] = []
        i = start_index
        in_string: Optional[str] = None
        while i < len(text):
            char = text[i]
            if in_string:
                body_chars.append(char)
                if char == "\\":
                    i += 1
                    if i < len(text):
                        body_chars.append(text[i])
                elif char == in_string:
                    in_string = None
            else:
                if char in {'"', "'"}:
                    in_string = char
                    body_chars.append(char)
                elif char == "{":
                    depth += 1
                    body_chars.append(char)
                elif char == "}":
                    depth -= 1
                    body_chars.append(char)
                    if depth == 0:
                        return "".join(body_chars[:-1]), i
                else:
                    body_chars.append(char)
            i += 1
        return None, i

    def _extract_colour(self, body: str) -> Optional[str]:
        colour_match = re.search(r"colour\s*=\s*([^,\n}]+)", body)
        if not colour_match:
            colour_match = re.search(r"color\s*=\s*([^,\n}]+)", body)
        if not colour_match:
            return None
        raw_value = colour_match.group(1).strip().rstrip(",")
        if raw_value.startswith("{"):
            # Some entries provide multiple colour candidates – use the first.
            first_match = re.search(r"['\"]([^'\"]+)['\"]", raw_value)
            if first_match:
                return first_match.group(1)
            return None
        cleaned = raw_value.strip('"\' ')
        return cleaned

    def _extract_aliases(self, body: str) -> Iterable[str]:
        match = re.search(r"aliases\s*=\s*\{([^}]*)\}", body)
        if not match:
            return []
        aliases_body = match.group(1)
        return [
            alias.strip()
            for alias in re.findall(r"['\"]([^'\"]+)['\"]", aliases_body)
        ]


def export_party_colours(resolver: PartyColourResolver) -> str:
    """Return a JSON string of the resolved party colours."""

    return json.dumps(resolver.colours, indent=2, sort_keys=True)

