import math

import pandas as pd

from ni_votes.web.routes import _normalise_json_value


def test_normalise_json_value_replaces_nan_and_preserves_numbers():
    payload = {
        "a": math.nan,
        "b": [1.0, float("inf"), float("-inf"), math.nan],
        "c": pd.NA,
        "d": pd.Timestamp("1996-05-30"),
        "e": "NaN",
        "f": "Infinity",
        "nested": {
            "value": math.nan,
            "list": [pd.NA, 2.5, "-inf"],
        },
    }

    cleaned = _normalise_json_value(payload)

    assert cleaned["a"] is None
    assert cleaned["b"][0] == 1.0
    assert cleaned["b"][1] is None
    assert cleaned["b"][2] is None
    assert cleaned["b"][3] is None
    assert cleaned["c"] is None
    # Timestamp should serialise to ISO string
    assert cleaned["d"].startswith("1996-05-30")
    assert cleaned["nested"]["value"] is None
    assert cleaned["e"] is None
    assert cleaned["f"] is None
    assert cleaned["nested"]["list"][0] is None
    assert cleaned["nested"]["list"][1] == 2.5
    assert cleaned["nested"]["list"][2] is None
