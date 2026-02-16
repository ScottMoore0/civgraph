"""Helpers for constructing stable composite donor identifiers."""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .base import canonical_party

__all__ = [
    "bundle_signature_from_meta",
    "make_bundle_key",
    "make_bundle_key_from_meta",
    "make_bundle_party_label",
]


BundleMember = Tuple[Optional[int], str]


def _normalise_member(member: Tuple[Optional[int], Optional[str]]) -> BundleMember:
    pid, party = member
    try:
        pid_val: Optional[int]
        if pid is None:
            pid_val = None
        else:
            pid_val = int(pid)
    except Exception:
        pid_val = None
    party_clean = canonical_party(str(party or ""))
    return pid_val, party_clean


def bundle_signature_from_meta(
    donor_ids: Iterable[int], donor_meta: Dict[int, Dict[str, Optional[str]]]
) -> Tuple[BundleMember, ...]:
    """Return a sorted bundle signature from donor IDs and their metadata."""
    members: List[BundleMember] = []
    for pid in donor_ids:
        meta = donor_meta.get(int(pid), {})
        members.append(
            _normalise_member((int(pid), meta.get("party")))
        )
    return tuple(sorted(members, key=lambda x: (x[0] if x[0] is not None else -1, x[1])))


def make_bundle_key(members: Sequence[Tuple[Optional[int], Optional[str]]]) -> str:
    """Return a stable key for a composite donor bundle."""
    signature = [
        _normalise_member(member)
        for member in members
    ]
    signature.sort(key=lambda x: (x[0] if x[0] is not None else -1, x[1]))
    parts: List[str] = []
    for pid, party in signature:
        pid_txt = "NA" if pid is None else str(pid)
        party_txt = party or "UNKNOWN"
        parts.append(f"{pid_txt}:{party_txt}")
    return "bundle::" + "|".join(parts) if parts else "bundle::"


def make_bundle_key_from_meta(
    donor_ids: Iterable[int], donor_meta: Dict[int, Dict[str, Optional[str]]]
) -> str:
    return make_bundle_key(bundle_signature_from_meta(donor_ids, donor_meta))


def make_bundle_party_label(members: Sequence[Tuple[Optional[int], Optional[str]]]) -> str:
    """Return a pseudo-party label for a composite donor bundle."""
    signature = [
        _normalise_member(member)
        for member in members
    ]
    parties = sorted({party or "UNKNOWN" for _, party in signature})
    label_body = "+".join(parties) if parties else "UNKNOWN"
    return f"bundle::{label_body}"
