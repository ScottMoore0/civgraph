import os
import sys
import types
import unittest
from unittest import mock

import pytest

pd = pytest.importorskip("pandas")


def _install_sklearn_stub() -> None:
    if "sklearn" in sys.modules:
        return
    sk = types.ModuleType("sklearn")
    sk.decomposition = types.ModuleType("sklearn.decomposition")
    sk.decomposition.TruncatedSVD = object
    sk.linear_model = types.ModuleType("sklearn.linear_model")
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
                "names": ["Alice#row1", "Brenda#row2", "Chris#row3", "Dylan#row4"],
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

    def test_valid_vote_mass_conserved(self) -> None:
        class FixedModel(DummyModel):
            def expect_proba_with_nt(self, elim, surv_idx, feat_ctx):
                import numpy as np

                if len(surv_idx) == 0:
                    return np.asarray([]), 0.0
                nt = 0.25
                share = (1.0 - nt) / max(len(surv_idx), 1)
                probs = np.full(len(surv_idx), share, dtype=float)
                return probs, nt

        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=FixedModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["P", "Q", "R"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario

            scenario = {
                "names": ["A", "B", "C"],
                "parties": ["P", "Q", "R"],
                "person_ids": ["1", "2", "3"],
                "first_prefs": [40000, 30000, 20000],
                "seats": 1,
                "constituency": "Test",
            }

            result = run_scenario(pd.DataFrame(), pd.DataFrame(), scenario)

            valid = float(sum(scenario["first_prefs"]))
            counts_meta = result.get("counts_meta", []) or []
            nt_series = result.get("nt_series", []) or []
            cum_nt = 0.0

            for idx, meta in enumerate(counts_meta):
                totals = meta.get("totals", [])
                cum_nt += float(nt_series[idx]) if idx < len(nt_series) else 0.0
                total_sum = float(sum(float(t) for t in totals))
                self.assertAlmostEqual(total_sum + cum_nt, valid, places=6)

    def test_rule_44h_bundles_lowest_candidates(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["A", "B", "C", "D"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario

            scenario = {
                "names": ["Winner", "Runner", "Low", "Lowest"],
                "parties": ["P1", "P2", "P3", "P4"],
                "person_ids": ["1", "2", "3", "4"],
                "first_prefs": [5000, 40, 20, 10],
                "seats": 1,
                "sequential_elimination": False,
            }

            result = run_scenario(pd.DataFrame(), pd.DataFrame(), scenario)

            counts_meta = result.get("counts_meta", []) or []
            self.assertEqual(len(counts_meta), 1, "Bundled elimination should collapse to a single count")
            label = counts_meta[0].get("label", "")
            self.assertIn("Rule 44H", label)
            self.assertIn("Low", label)
            self.assertIn("Lowest", label)

            nt_series = result.get("nt_series", []) or []
            self.assertEqual(len(nt_series), len(counts_meta))

    def test_sequential_toggle_preserves_individual_counts(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["A", "B", "C", "D"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario

            scenario = {
                "names": ["Winner", "Runner", "Low", "Lowest"],
                "parties": ["P1", "P2", "P3", "P4"],
                "person_ids": ["1", "2", "3", "4"],
                "first_prefs": [5000, 40, 20, 10],
                "seats": 1,
                "sequential_elimination": True,
            }

            result = run_scenario(pd.DataFrame(), pd.DataFrame(), scenario)

            counts_meta = result.get("counts_meta", []) or []
            # Lowest is eliminated first, then Low; after that only two remain so the loop stops.
            self.assertEqual(len(counts_meta), 2)
            self.assertNotIn("Rule 44H", counts_meta[0].get("label", ""))
            self.assertNotIn("Rule 44H", counts_meta[1].get("label", ""))


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
                "names": ["Alice#row1", "Brenda#row2", "Chris#row3", "Dylan#row4"],
                "parties": ["P", "Q", "R", "S"],
                "person_ids": ["1", "2", "3", "4"],
                "first_prefs": [40000, 30000, 20000, 10000],
                "seats": 1,
                "constituency": "Test",
            }

            result = run_scenario(pd.DataFrame(), pd.DataFrame(), scenario)

            routes = importlib.import_module("ni_votes.web.routes")
            html = routes._render_result_table(result, scenario)

            # Columns reconstructed from counts metadata
            self.assertIn("Count 1", html)
            self.assertIn("Δ1", html)
            self.assertIn("NonTransferable", html)

            # The renderer should strip any "#row" suffixes that were used when
            # building merge-safe identifiers in the form data.
            self.assertNotIn("#row", html)

            # Winners are bolded across the entire row (not just the name).  The
            # first candidate in this synthetic scenario ultimately wins.
            self.assertIn("<strong>Alice</strong>", html)
            self.assertIn("<strong>40,000</strong>", html)

if __name__ == "__main__":  # pragma: no cover
    unittest.main()
