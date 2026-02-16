import os
import sys
import types
import unittest
from unittest import mock

import pandas as pd


def _install_sklearn_stub() -> None:
    if "sklearn" in sys.modules:
        return
    sk = types.ModuleType("sklearn")
    sk.decomposition = types.ModuleType("sklearn.decomposition")
    sk.decomposition.TruncatedSVD = object
    sk.linear_model = types.ModuleType("sklearn.linear_model")
    sk.linear_model.Ridge = object
    sk.linear_model.LogisticRegression = object
    sk.preprocessing = types.ModuleType("sklearn.preprocessing")
    sk.preprocessing.OneHotEncoder = object
    sk.cluster = types.ModuleType("sklearn.cluster")
    sk.cluster.SpectralClustering = object
    sk.neighbors = types.ModuleType("sklearn.neighbors")
    sk.neighbors.NearestNeighbors = object
    sys.modules["sklearn"] = sk
    sys.modules["sklearn.decomposition"] = sk.decomposition
    sys.modules["sklearn.linear_model"] = sk.linear_model
    sys.modules["sklearn.preprocessing"] = sk.preprocessing
    sys.modules["sklearn.cluster"] = sk.cluster
    sys.modules["sklearn.neighbors"] = sk.neighbors


class DummyModel:
    def expect_proba_with_nt(self, elim, surv_idx, feat_ctx):
        import numpy as np

        if len(surv_idx) == 0:
            return np.asarray([]), 0.0
        probs = np.ones(len(surv_idx), dtype=float) / max(len(surv_idx), 1)
        return probs, 0.0

    def exhaust_rate(self, elim, feat_ctx):
        return 0.0


class ScenarioEngineCountsTest(unittest.TestCase):
    def setUp(self) -> None:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
        if repo_root not in sys.path:
            sys.path.insert(0, repo_root)
        _install_sklearn_stub()
        import ni_votes.config as real_cfg

        sys.modules["ni_votes.features.config"] = real_cfg

    def test_run_scenario_returns_counts(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["P", "Q", "R", "S"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario

            er = pd.DataFrame()
            tr_df = pd.DataFrame()
            scenario = {
                "names": ["A", "B", "C", "D"],
                "parties": ["P", "Q", "R", "S"],
                "person_ids": ["1", "2", "3", "4"],
                "first_prefs": [40000, 30000, 20000, 10000],
                "seats": 1,
                "constituency": "Test",
            }

            result = run_scenario(er, tr_df, scenario)

            self.assertGreater(len(result.get("columns", [])), 3)
            self.assertTrue(any(col.startswith("Count 1") for col in result.get("columns", [])))
            counts_meta = result.get("counts_meta", [])
            self.assertTrue(counts_meta, "counts_meta should carry per-round totals")


class ScenarioResultHtmlTest(unittest.TestCase):
    def setUp(self) -> None:
        import sys
        import types

        # Provide a minimal Flask stub if the real package is unavailable.
        self._orig_flask = sys.modules.get("flask")
        if self._orig_flask is None:
            flask = types.ModuleType("flask")
            flask.Flask = type("Flask", (object,), {})
            flask.request = None
            flask.render_template_string = lambda tpl, **ctx: tpl
            flask.jsonify = lambda *args, **kwargs: None
            flask.Response = type("Response", (object,), {})
            sys.modules["flask"] = flask
            self._stub_flask = True
        else:
            self._stub_flask = False

    def tearDown(self) -> None:
        import sys
        if getattr(self, "_stub_flask", False):
            sys.modules.pop("flask", None)

    def test_rendered_html_contains_transfer_counts(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["P", "Q", "R", "S"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario
            import pandas as pd
            import importlib

            scenario = {
                "names": ["A", "B", "C", "D"],
                "parties": ["P", "Q", "R", "S"],
                "person_ids": ["1", "2", "3", "4"],
                "first_prefs": [40000, 30000, 20000, 10000],
                "seats": 1,
                "constituency": "Test",
            }

            result = run_scenario(pd.DataFrame(), pd.DataFrame(), scenario)

            routes = importlib.import_module("ni_votes.web.routes")
            html = routes._render_result_table(result, scenario)

            self.assertIn("Count 1", html)
            self.assertIn("Δ1", html)
            self.assertIn("NonTransferable", html)


class TransferPairAllocationTest(unittest.TestCase):
    def test_composite_donor_party_filtering(self) -> None:
        from ni_votes.features.transfers.pairs import _build_pairs_stateful

        er_df = pd.DataFrame(
            {
                "DateStr": ["2023"] * 4,
                "Constituency": ["Composite"] * 4,
                "ElectedBody": ["Assembly"] * 4,
                "PersonID": [1, 2, 3, 4],
                "Party": ["ALPHA", "BETA", "ALPHA", "BETA"],
                "ResultType": ["Candidate"] * 4,
                "Votes1": [1000, 900, 800, 700],
            }
        )

        tr_df = pd.DataFrame(
            [
                {
                    "DateStr": "2023",
                    "Constituency": "Composite",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 1,
                    "Transfers": -8,
                    "Name": "Alpha Donor",
                    "Party": "ALPHA",
                },
                {
                    "DateStr": "2023",
                    "Constituency": "Composite",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 2,
                    "Transfers": -5,
                    "Name": "Beta Donor",
                    "Party": "BETA",
                },
                {
                    "DateStr": "2023",
                    "Constituency": "Composite",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 3,
                    "Transfers": 8,
                    "TransferSubject": "1,2",
                    "TransferParty": "ALPHA,BETA",
                    "TransferPct": "50,50",
                    "SourcePersonID": 1,
                },
                {
                    "DateStr": "2023",
                    "Constituency": "Composite",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 4,
                    "Transfers": 5,
                    "TransferSubject": "1,2",
                    "TransferParty": "ALPHA,BETA",
                    "TransferPct": "50,50",
                    "SourcePersonID": 2,
                },
            ]
        )

        pairs, _ = _build_pairs_stateful(er_df, tr_df)
        positive_pairs = pairs[pairs["recipient_pid"] > 0]

        donor_one_targets = positive_pairs[positive_pairs["donor_pid"] == 1][
            "recipient_pid"
        ].unique()
        donor_two_targets = positive_pairs[positive_pairs["donor_pid"] == 2][
            "recipient_pid"
        ].unique()

        self.assertEqual(set(donor_one_targets.tolist()), {3})
        self.assertEqual(set(donor_two_targets.tolist()), {4})

        donor_one_weight = positive_pairs[positive_pairs["donor_pid"] == 1][
            "weight"
        ].iloc[0]
        donor_two_weight = positive_pairs[positive_pairs["donor_pid"] == 2][
            "weight"
        ].iloc[0]

        self.assertAlmostEqual(donor_one_weight, 8.0)
        self.assertAlmostEqual(donor_two_weight, 5.0)

    def test_composite_bundle_respects_party_blocks(self) -> None:
        from ni_votes.features.transfers.pairs import _build_pairs_stateful

        er_df = pd.DataFrame(
            {
                "DateStr": ["2024"] * 4,
                "Constituency": ["Shared"] * 4,
                "ElectedBody": ["Assembly"] * 4,
                "PersonID": [1, 2, 3, 4],
                "Party": ["UNION", "NAT", "NAT", "UNION"],
                "ResultType": ["Candidate"] * 4,
                "Votes1": [2000, 1900, 1800, 1700],
            }
        )

        tr_df = pd.DataFrame(
            [
                {
                    "DateStr": "2024",
                    "Constituency": "Shared",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 1,
                    "Transfers": -12,
                    "Name": "Union Donor",
                    "Party": "UNION",
                },
                {
                    "DateStr": "2024",
                    "Constituency": "Shared",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 2,
                    "Transfers": -12,
                    "Name": "Nat Donor",
                    "Party": "NAT",
                },
                {
                    "DateStr": "2024",
                    "Constituency": "Shared",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 3,
                    "Transfers": 12,
                    "TransferSubject": "1,2",
                    "SourcePersonID": 2,
                },
                {
                    "DateStr": "2024",
                    "Constituency": "Shared",
                    "ElectedBody": "Assembly",
                    "Count": 1,
                    "PersonID": 4,
                    "Transfers": 12,
                    "TransferSubject": "1,2",
                    "SourcePersonID": 1,
                },
            ]
        )

        pairs, _ = _build_pairs_stateful(er_df, tr_df)
        positive_pairs = pairs[pairs["recipient_pid"] > 0]

        union_targets = positive_pairs[positive_pairs["donor_pid"] == 1]["recipient_pid"].unique()
        nat_targets = positive_pairs[positive_pairs["donor_pid"] == 2]["recipient_pid"].unique()

        self.assertEqual(set(union_targets.tolist()), {4})
        self.assertEqual(set(nat_targets.tolist()), {3})

if __name__ == "__main__":  # pragma: no cover
    unittest.main()
