import os
import sys

import pandas as pd

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "electionsni-master"))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from app_data import (
    _candidate_id_from_value,
    _event_count_from_candidate_state,
    _event_count_from_transfer_subjects,
    _event_count_from_votes,
)


def test_event_count_from_transfer_subjects_identifies_candidate():
    row = pd.Series({
        "TransferSubject1": "111",
        "TransferSubject2": "222,333",
        "TransferSubject3": "444",
    })

    assert _event_count_from_transfer_subjects(row, "333") == 2
    assert _event_count_from_transfer_subjects(row, "444") == 3
    assert _event_count_from_transfer_subjects(row, "999") is None


def test_event_count_from_votes_handles_exclusion():
    row = pd.Series({
        "Votes1": 100.0,
        "Votes2": 50.0,
        "Votes3": 0.0,
        "Transfers1": -50.0,
        "Transfers2": -50.0,
    })
    state_totals = {}

    assert _event_count_from_votes(row, "Excluded", state_totals) == 2


def test_event_count_from_votes_handles_election():
    row = pd.Series({
        "Votes1": 200.0,
        "Votes2": 200.0,
        "Votes3": 150.0,
        "Transfers1": 0.0,
        "Transfers2": -50.0,
    })

    assert _event_count_from_votes(row, "Elected", {}) == 2


def test_event_count_from_candidate_state_exclusion_fallback():
    state_totals = {1: 40.0, 2: 0.0, 3: 0.0}

    assert _event_count_from_candidate_state(state_totals, "Excluded") == 1


def test_event_count_from_candidate_state_election_drop():
    state_totals = {1: 60.0, 2: 60.0, 3: 45.0, 4: 45.0}

    assert _event_count_from_candidate_state(state_totals, "Elected") == 2


def test_candidate_id_from_value_handles_strings_and_numbers():
    assert _candidate_id_from_value("12345") == "12345"
    assert _candidate_id_from_value("12345.0") == "12345"
    assert _candidate_id_from_value(67890.0) == "67890"
    assert _candidate_id_from_value(None) is None
