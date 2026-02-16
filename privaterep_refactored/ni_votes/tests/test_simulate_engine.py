import os
import sys
import types
import unittest
from unittest import mock

try:
    import pandas as pd
except Exception:  # pragma: no cover - optional dependency in CI image
    pd = None  # type: ignore


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


@unittest.skipIf(pd is None, "pandas not available")
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

            viewer_payload = result.get("viewer_payload")
            self.assertIsInstance(viewer_payload, dict)
            candidates = viewer_payload.get("candidates") or []
            self.assertEqual(len(candidates), len(scenario["names"]))
            party_totals = viewer_payload.get("party_totals") or {}
            rows = party_totals.get("rows") if isinstance(party_totals, dict) else None
            self.assertTrue(rows, "party_totals rows should not be empty")
            transfer_events = viewer_payload.get("transfer_events") or []
            self.assertTrue(transfer_events, "transfer events should be populated for animation")
            auth_events = viewer_payload.get("authoritative_transfer_events") or []
            self.assertTrue(auth_events, "authoritative transfer events should be present")
            first_bucket = auth_events[0]
            self.assertIn("events", first_bucket)
            self.assertTrue(first_bucket["events"])
            first_event = first_bucket["events"][0]
            self.assertIn("source", first_event)
            self.assertIn("destinations", first_event)
            self.assertIsInstance(first_event["destinations"], list)
            for destination in first_event["destinations"]:
                if destination is None:
                    continue
                self.assertIn("type", destination)
                self.assertIn("votes", destination)
            source = first_event.get("source") or {}
            self.assertIn("components", source)
            self.assertTrue(source["components"])
            classifications = {event.get("event_type") for event in first_bucket["events"]}
            self.assertTrue(any(cls in {"elimination", "surplus"} for cls in classifications))

@unittest.skipIf(pd is None, "pandas not available")
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
            flask.send_from_directory = lambda *args, **kwargs: None
            sys.modules["flask"] = flask
            self._stub_flask = True
        else:
            self._stub_flask = False

        self._orig_joblib = sys.modules.get("joblib")
        if self._orig_joblib is None:
            joblib = types.ModuleType("joblib")
            joblib.load = lambda *args, **kwargs: None
            joblib.dump = lambda *args, **kwargs: None
            sys.modules["joblib"] = joblib
            self._stub_joblib = True
        else:
            self._stub_joblib = False

    def tearDown(self) -> None:
        import sys
        if getattr(self, "_stub_flask", False):
            sys.modules.pop("flask", None)
        if getattr(self, "_stub_joblib", False):
            sys.modules.pop("joblib", None)

    def test_rendered_html_contains_transfer_counts(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["P", "Q", "R", "S"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario
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

            self.assertIn("window.VIEWER_META", html)
            self.assertIn("renderElectionCard(payload", html)

    def test_rendered_html_includes_viewer_placeholder(self) -> None:
        with mock.patch("ni_votes.features.transfers.get_transfer_model", return_value=DummyModel()), \
             mock.patch("ni_votes.features.transfers.build_feature_context", return_value={"party": ["P", "Q", "R", "S"], "prov": None}):
            from ni_votes.simulate.engine import run_scenario
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

            self.assertIn("id='scenario-viewer-results'", html)
            self.assertIn("renderElectionCard", html)
            # Payload should contain candidate and party metadata so the viewer
            # can render the standard tables.
            self.assertIn('"name": "A"', html)
            self.assertIn('"party": "P"', html)
            self.assertIn('"party_totals"', html)

if __name__ == "__main__":  # pragma: no cover
    unittest.main()