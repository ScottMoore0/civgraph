from __future__ import annotations

from typing import Dict

import pytest

pytest.importorskip("numpy")

from ni_votes.project.party_breakdown import build_party_breakdown, merge_party_breakdowns


def _make_party(name: str, share: float, counts: Dict[str, float], electorate: float) -> Dict[str, object]:
    return {
        "party": name,
        "party_key": name.lower(),
        "baseline_share": share,
        "baseline_electorate": electorate,
        "counts": counts,
    }


def test_merge_party_breakdowns_aggregates_metadata_fields():
    parties_a = [
        _make_party("Alliance", 0.6, {"Yes": 60.0, "No": 40.0}, 100.0),
    ]
    parties_b = [
        _make_party("UUP", 0.4, {"Yes": 40.0, "No": 60.0}, 120.0),
    ]

    breakdown_a = {
        "parties": parties_a,
        "metadata": {
            "option_labels": ("Yes", "No"),
            "electorate": 100.0,
            "event_type": "DevolvedElection",
            "elected_body": "Northern Ireland Assembly",
            "families": ("DevolvedElection",),
            "elections": [
                {
                    "family": "DevolvedElection",
                    "event": "Assembly 2019",
                    "date": "2019-05-02",
                    "electorate": 100.0,
                }
            ],
            "basis_electorate": 100.0,
            "non_participant_share": 0.2,
            "non_participant_label": "Non-voters (baseline)",
            "baseline_turnout_share": 0.8,
        },
    }

    breakdown_b = {
        "parties": parties_b,
        "metadata": {
            "option_labels": ("Yes", "No"),
            "electorate": 120.0,
            "event_type": "DevolvedElection",
            "elected_body": "Northern Ireland Assembly",
            "families": ("WestminsterElection",),
            "elections": [
                {
                    "family": "DevolvedElection",
                    "event": "Assembly 2019",
                    "date": "2019-05-02",
                    "electorate": 100.0,
                },
                {
                    "family": "WestminsterElection",
                    "event": "Westminster 2017",
                    "date": "2017-06-08",
                    "electorate": 120.0,
                },
            ],
            "basis_electorate": 120.0,
            "non_participant_share": 0.3,
            "non_participant_label": "Non-voters (baseline)",
            "baseline_turnout_share": 0.7,
        },
    }

    merged = merge_party_breakdowns(
        [breakdown_a, breakdown_b],
        output_labels=("Yes", "No"),
    )

    assert merged
    meta = merged.get("metadata", {})
    assert meta.get("event_type") == "DevolvedElection"
    assert meta.get("elected_body") == "Northern Ireland Assembly"
    assert meta.get("families") == ("DevolvedElection", "WestminsterElection")

    assert meta.get("non_participant_label") == "Non-voters (baseline)"
    assert pytest.approx(meta.get("non_participant_share"), rel=1e-6) == pytest.approx(56 / 220)
    assert pytest.approx(meta.get("baseline_turnout_share"), rel=1e-6) == pytest.approx(1.0 - (56 / 220))

    elections_meta = meta.get("elections")
    assert isinstance(elections_meta, list)
    assert len(elections_meta) == 2
    families = {entry.get("family") for entry in elections_meta}
    assert families == {"DevolvedElection", "WestminsterElection"}

    assert pytest.approx(meta.get("basis_electorate")) == 220.0


def test_build_party_breakdown_includes_non_participants():
    baseline = {"Alliance": 0.6, "DUP": 0.4}
    counts = {"Yes": 100.0, "No": 80.0, "Did not vote": 20.0}
    options = ["Yes", "No", "Did not vote"]

    breakdown = build_party_breakdown(
        baseline_shares=baseline,
        counts=counts,
        output_labels=options,
        electorate=200.0,
        non_participant_share=0.25,
        baseline_turnout_share=0.75,
    )

    parties = {party["party"]: party for party in breakdown.get("parties", [])}
    assert "Election non-voters" in parties
    non_participants = parties["Election non-voters"]
    assert non_participants.get("legend_label") == "Non-voters (baseline)"
    assert non_participants.get("is_pseudo") is True
    totals = non_participants.get("totals", {})
    assert pytest.approx(totals.get("did_not_vote", 0.0), rel=1e-6) >= 0.0

    meta = breakdown.get("metadata", {})
    assert pytest.approx(meta.get("non_participant_share"), rel=1e-6) == 0.25
    assert pytest.approx(meta.get("baseline_turnout_share"), rel=1e-6) == 0.75


def test_build_party_breakdown_uses_endorsement_profiles():
    baseline = {"Alliance": 0.6, "DUP": 0.4}
    counts = {"Yes": 120.0, "No": 80.0, "Did not vote": 0.0}
    options = ["Yes", "No", "Did not vote"]
    endorsement_profiles = {
        "Yes": [0.95, 0.03, 0.02],
        "No": [0.02, 0.95, 0.03],
    }
    neutral_profile = [0.4, 0.4, 0.2]

    breakdown = build_party_breakdown(
        baseline_shares=baseline,
        counts=counts,
        output_labels=options,
        endorsements={"Alliance": "Yes", "DUP": "No"},
        canonical_endorsements={},
        electorate=200.0,
        model_to_output={opt: opt for opt in options},
        model_options=options,
        endorsement_profiles=endorsement_profiles,
        neutral_profile=neutral_profile,
    )

    parties = {party["party"]: party for party in breakdown.get("parties", [])}
    alliance = parties["Alliance"]
    dup = parties["DUP"]

    alliance_profile = alliance.get("profile", {}).get("weights", {})
    dup_profile = dup.get("profile", {}).get("weights", {})

    assert alliance.get("profile", {}).get("source") == "endorsement_profile"
    assert dup.get("profile", {}).get("source") == "endorsement_profile"
    assert pytest.approx(alliance_profile.get("Yes", 0.0), rel=1e-3) == 0.95
    assert pytest.approx(dup_profile.get("No", 0.0), rel=1e-3) == 0.95
    assert alliance["counts"]["Yes"] > dup["counts"]["Yes"] * 10


def test_build_party_breakdown_uses_neutral_profile_when_unendorsed():
    baseline = {"Alliance": 1.0}
    counts = {"Yes": 50.0, "No": 30.0, "Did not vote": 20.0}
    options = ["Yes", "No", "Did not vote"]
    neutral_profile = [0.5, 0.2, 0.3]

    breakdown = build_party_breakdown(
        baseline_shares=baseline,
        counts=counts,
        output_labels=options,
        endorsements={},
        canonical_endorsements={},
        electorate=100.0,
        model_to_output={opt: opt for opt in options},
        model_options=options,
        endorsement_profiles={},
        neutral_profile=neutral_profile,
    )

    party = breakdown.get("parties", [])[0]
    profile = party.get("profile", {})
    weights = profile.get("weights", {})
    assert profile.get("source") == "neutral_profile"
    assert pytest.approx(weights.get("Yes", 0.0), rel=1e-3) == 0.5
    assert pytest.approx(weights.get("No", 0.0), rel=1e-3) == 0.2
    assert pytest.approx(weights.get("Did not vote", 0.0), rel=1e-3) == 0.3


def test_build_party_breakdown_falls_back_when_profiles_missing():
    baseline = {"Alliance": 0.5, "DUP": 0.5}
    counts = {"Yes": 40.0, "No": 60.0, "Did not vote": 0.0}
    options = ["Yes", "No", "Did not vote"]

    breakdown = build_party_breakdown(
        baseline_shares=baseline,
        counts=counts,
        output_labels=options,
        endorsements={"Alliance": "Yes"},
        canonical_endorsements={},
        electorate=100.0,
        model_to_output={opt: opt for opt in options},
        model_options=options,
        endorsement_profiles=None,
        neutral_profile=None,
    )

    parties = {party["party"]: party for party in breakdown.get("parties", [])}
    assert parties["Alliance"].get("profile", {}).get("source") == "fallback"


def test_party_breakdown_preserves_spoil_and_abstain_columns():
    baseline = {"Alliance": 0.7, "DUP": 0.3}
    counts = {"Yes": 70.0, "No": 30.0, "Spoiled": 5.0, "Did not vote": 15.0}
    options = ["Yes", "No", "Spoiled", "Did not vote"]

    breakdown = build_party_breakdown(
        baseline_shares=baseline,
        counts=counts,
        output_labels=options,
        electorate=120.0,
        non_participant_share=0.2,
        baseline_turnout_share=0.8,
        spoiled_share=0.05,
    )

    parties = {party["party"]: party for party in breakdown.get("parties", [])}
    assert "Alliance" in parties and "DUP" in parties
    assert "Election non-voters" in parties
    assert "Election spoiled" in parties

    alliance = parties["Alliance"]
    dup = parties["DUP"]
    non_participants = parties["Election non-voters"]
    assert non_participants.get("legend_label") == "Non-voters (baseline)"
    assert non_participants.get("is_pseudo") is True

    for label in options:
        assert label in alliance["counts"], f"Alliance missing {label} count"
        assert label in dup["counts"], f"DUP missing {label} count"

    non_counts = non_participants.get("counts", {})
    assert pytest.approx(non_counts.get("Did not vote", 0.0), rel=1e-6) >= 0.0
    assert pytest.approx(non_counts.get("Spoiled", 0.0), rel=1e-6) >= 0.0

    spoiled_baseline = parties["Election spoiled"]
    assert spoiled_baseline.get("legend_label") == "Spoiled ballots (baseline)"
    assert spoiled_baseline.get("is_pseudo") is True
    spoiled_counts = spoiled_baseline.get("counts", {})
    assert pytest.approx(spoiled_counts.get("Spoiled", 0.0), rel=1e-6) >= 0.0

    meta = breakdown.get("metadata", {})
    assert pytest.approx(meta.get("spoiled_share"), rel=1e-6) == pytest.approx(0.05)
    assert meta.get("spoiled_label") == "Spoiled ballots (baseline)"
