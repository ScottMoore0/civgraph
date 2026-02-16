from typing import Dict, Optional

import pytest

np = pytest.importorskip("numpy")

from ni_votes.simulate.referendum import (
    AreaResult,
    OptionResult,
    _collect_simulation_metadata,
)


def _make_area(constituency, breakdown_meta, **kwargs):
    defaults = dict(
        body="TestBody",
        projected_date="2024-01-01",
        original_date="2024-01-01",
        electorate=1000.0,
        turnout=600.0,
        turnout_pct=60.0,
        valid_votes=580.0,
        spoiled=20.0,
        did_not_vote=400.0,
        options=[
            OptionResult(option="Yes", count=400.0, pct_electorate=None, pct_valid=None),
            OptionResult(option="No", count=180.0, pct_electorate=None, pct_valid=None),
            OptionResult(option="Did not vote", count=400.0, pct_electorate=None, pct_valid=None),
        ],
        table={"rows": [], "summary": {}},
        chart={},
    )
    defaults.update(kwargs)

    breakdown: Dict[str, object] = {}
    if breakdown_meta is not None:
        electorate = float(defaults.get("electorate") or 0.0)
        yes_count = 0.4 * electorate
        no_count = 0.18 * electorate
        spoiled_count = 0.02 * electorate
        dnv_count = max(electorate - yes_count - no_count - spoiled_count, 0.0)
        projected_total = yes_count + no_count + spoiled_count + dnv_count
        valid_total = yes_count + no_count

        def _pct(value: float, denom: float) -> Optional[float]:
            if denom and denom > 0:
                return value / denom
            return None

        option_labels = ["Yes", "No", "Spoiled", "Did not vote"]
        option_counts = {
            "Yes": yes_count,
            "No": no_count,
            "Spoiled": spoiled_count,
            "Did not vote": dnv_count,
        }
        party_options = [
            {
                "option": label,
                "count": option_counts[label],
                "pct_party": _pct(option_counts[label], projected_total),
                "pct_electorate": _pct(option_counts[label], electorate),
            }
            for label in option_labels
        ]
        option_totals = {
            "yes": {"label": "Yes", "count": yes_count, "pct_electorate": _pct(yes_count, electorate)},
            "no": {"label": "No", "count": no_count, "pct_electorate": _pct(no_count, electorate)},
            "spoiled": {"label": "Spoiled", "count": spoiled_count, "pct_electorate": _pct(spoiled_count, electorate)},
            "did_not_vote": {"label": "Did not vote", "count": dnv_count, "pct_electorate": _pct(dnv_count, electorate)},
        }
        breakdown = {
            "parties": [
                {
                    "party": "Alliance",
                    "party_key": "alliance",
                    "baseline_share": 0.5,
                    "baseline_electorate": 0.5 * electorate if electorate else None,
                    "endorsement": "Yes",
                    "counts": option_counts,
                    "totals": {
                        "projected": projected_total,
                        "valid": valid_total,
                        "did_not_vote": dnv_count,
                        "spoiled": spoiled_count,
                    },
                    "options": party_options,
                    "option_totals": option_totals,
                }
            ],
            "metadata": breakdown_meta,
        }

    return AreaResult(
        constituency=constituency,
        party_breakdown=breakdown,
        **defaults,
    )


def test_collect_simulation_metadata_merges_breakdowns():
    breakdown_a = {
        "option_labels": ("Yes", "No", "Did not vote"),
        "event_type": "Referendum",
        "elected_body": "Northern Ireland",
        "families": ("Devolved",),
        "elections": [
            {"event": "Assembly 2017", "date": "2017-03-02", "family": "Devolved"},
        ],
        "basis_electorate": 850.0,
        "non_participant_share": 0.2,
        "non_participant_label": "Non-voters (baseline)",
        "baseline_turnout_share": 0.8,
        "spoiled_share": 0.01,
        "spoiled_label": "Spoiled ballots (baseline)",
    }
    breakdown_b = {
        "option_labels": ("Yes", "No", "Did not vote"),
        "event_type": "Referendum",
        "elected_body": "Northern Ireland",
        "families": ("Westminster",),
        "elections": [
            {"event": "Assembly 2017", "date": "2017-03-02", "family": "Devolved"},
            {"event": "Westminster 2019", "date": "2019-12-12", "family": "Westminster"},
        ],
        "basis_electorate": 900.0,
        "non_participant_share": 0.3,
        "non_participant_label": "Non-voters (baseline)",
        "baseline_turnout_share": 0.7,
        "spoiled_share": 0.015,
        "spoiled_label": "Spoiled ballots (baseline)",
    }
    breakdown_national = {
        "option_labels": ("Yes", "No", "Did not vote"),
        "event_type": "Referendum",
        "elected_body": "Northern Ireland",
        "families": ("Devolved", "Westminster"),
        "basis_electorate": 1750.0,
        "non_participant_share": 0.25,
        "non_participant_label": "Non-voters (baseline)",
        "baseline_turnout_share": 0.75,
        "spoiled_share": 0.012,
        "spoiled_label": "Spoiled ballots (baseline)",
    }

    areas = [
        _make_area("Belfast East", breakdown_a, electorate=850.0),
        _make_area("Belfast West", breakdown_b, electorate=900.0),
        _make_area("Northern Ireland", breakdown_national, electorate=1750.0),
    ]

    metadata = _collect_simulation_metadata(areas, model_summary={"bundle_version": 2})

    assert metadata["option_labels"] == ("Yes", "No", "Did not vote")
    assert metadata["constituencies"] == ["Belfast East", "Belfast West"]
    assert metadata["constituency_count"] == 2
    assert metadata["bodies"] == "TestBody"
    assert metadata["event_type"] == "Referendum"
    assert metadata["elected_body"] == "Northern Ireland"
    assert metadata["families"] == ("Devolved", "Westminster")
    assert metadata["basis_electorate"] == pytest.approx(1750.0)
    assert metadata["constituency_electorate"] == pytest.approx(1750.0)
    assert metadata["non_participant_label"] == "Non-voters (baseline)"
    expected_np = (0.2 * 850 + 0.3 * 900 + 0.25 * 1750) / (850 + 900 + 1750)
    assert pytest.approx(metadata["non_participant_share"], rel=1e-6) == pytest.approx(expected_np)
    assert pytest.approx(metadata["baseline_turnout_share"], rel=1e-6) == pytest.approx(1.0 - expected_np)
    expected_spoiled = (0.01 * 850 + 0.015 * 900 + 0.012 * 1750) / (850 + 900 + 1750)
    assert pytest.approx(metadata["spoiled_share"], rel=1e-6) == pytest.approx(expected_spoiled)
    assert metadata["spoiled_label"] == "Spoiled ballots (baseline)"
    assert metadata["includes_northern_ireland_view"] is True
    assert metadata["area_count"] == 3

    elections = metadata.get("elections")
    assert isinstance(elections, list)
    assert len(elections) == 2
    families = {entry.get("family") for entry in elections}
    assert families == {"Devolved", "Westminster"}
    assert metadata["model"]["bundle_version"] == 2

    first_party = areas[0].party_breakdown["parties"][0]
    option_totals = first_party.get("option_totals")
    assert option_totals is not None
    assert set(option_totals.keys()) >= {"yes", "no", "did_not_vote", "spoiled"}
    electorate = areas[0].electorate or 0.0
    assert pytest.approx(option_totals["yes"]["count"], rel=1e-6) == pytest.approx(0.4 * electorate)
    assert pytest.approx(option_totals["did_not_vote"]["pct_electorate"], rel=1e-6) == pytest.approx(0.4)


def test_collect_simulation_metadata_handles_missing_breakdowns():
    areas = [
        _make_area("Belfast East", None, electorate=800.0),
        _make_area("Northern Ireland", None, electorate=1600.0),
    ]

    metadata = _collect_simulation_metadata(areas)

    assert metadata["constituencies"] == ["Belfast East"]
    assert metadata["constituency_count"] == 1
    assert metadata["includes_northern_ireland_view"] is True
    assert metadata["area_count"] == 2
    assert "option_labels" not in metadata
    assert "event_type" not in metadata
    assert metadata["constituency_electorate"] == pytest.approx(800.0)
