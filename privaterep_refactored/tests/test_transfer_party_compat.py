import os
import sys
import types
import unittest

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


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


_install_sklearn_stub()

from ni_votes.features.transfers.encoders import TransferModel
from ni_votes.features.transfers.party_space import PartySpace


class TransferCompatibilityTest(unittest.TestCase):
    def test_same_bloc_dominates_when_provenance_is_homogeneous(self) -> None:
        tm = TransferModel(enc=types.SimpleNamespace(), est=object())
        tm.bloc_of_party = {"A": 0, "A2": 0, "B": 1, "B1": 1}
        tm.pspace = PartySpace(["A", "B"])

        base_probs = np.asarray([0.5, 0.5], dtype=float)
        adjusted = tm._apply_party_compat(
            "A",
            ["A2", "B1"],
            donor_first_share=0.1,
            donor_transfer_share=0.9,
            stage="late",
            probs=base_probs,
            don_src=np.asarray([0.85, 0.05, 0.10], dtype=float),
        )

        self.assertAlmostEqual(float(adjusted.sum()), 1.0, places=6)
        np.testing.assert_allclose(adjusted, base_probs / base_probs.sum(), atol=1e-8)

    def test_unionist_first_pref_remains_in_bloc_early(self) -> None:
        tm = TransferModel(enc=types.SimpleNamespace(), est=object())
        tm.bloc_of_party = {"U1": 0, "U2": 0, "N1": 1}
        tm.pspace = PartySpace(["U1", "N1"])
        tm.prior_bloc = {0: {0: 0.85, 1: 0.15}}

        base_probs = np.asarray([0.3, 0.7], dtype=float)
        adjusted = tm._apply_party_compat(
            "U1",
            ["U2", "N1"],
            donor_first_share=0.9,
            donor_transfer_share=0.1,
            stage="early",
            probs=base_probs,
            don_src=np.asarray([0.92, 0.03, 0.05], dtype=float),
        )

        self.assertAlmostEqual(float(adjusted.sum()), 1.0, places=6)
        np.testing.assert_allclose(adjusted, base_probs / base_probs.sum(), atol=1e-8)

    def test_expect_proba_fallback_prefers_unionist_bloc(self) -> None:
        class DummyEnc:
            num_cols: list[str] = []
            cat_cols: list[str] = []

            def transform(self, df):
                return np.zeros((len(df), 0), dtype=np.float32)

        class ZeroEstimator:
            def predict(self, X):
                return np.zeros(X.shape[0], dtype=float)

        tm = TransferModel(enc=DummyEnc(), est=ZeroEstimator())
        tm.bloc_of_party = {"U1": 0, "U2": 0, "N1": 1}
        tm.prior_bloc = {0: {0: 0.9, 1: 0.1}}
        tm.pspace = PartySpace(["U1", "N1"])
        tm.stage_thresholds = {("Assembly", "Assembly"): 2}
        tm.dirichlet_alpha = 0.5
        tm.dirichlet_counts_party_stage = {("U1", "early"): {"U2": 30.0, "N1": 10.0}}
        tm.dirichlet_counts_party = {"U1": {"U2": 25.0, "N1": 5.0}}
        tm.dirichlet_counts_global = {"U2": 60.0, "N1": 40.0}

        parties = ["U1", "U2", "N1"]
        ctx = {
            "party": parties,
            "constituency": "Test",
            "body": "Assembly",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.asarray([1200.0, 800.0, 600.0], dtype=float),
            "initial_first": np.asarray([1400.0, 820.0, 610.0], dtype=float),
            "prov": np.asarray(
                [
                    [0.88, 0.07, 0.05],
                    [0.55, 0.25, 0.20],
                    [0.45, 0.35, 0.20],
                ],
                dtype=float,
            ),
            "alive": np.asarray([1, 1, 1], dtype=int),
        }

        surv_idx = np.asarray([1, 2], dtype=int)
        probs = tm.expect_proba(0, surv_idx, ctx)

        self.assertAlmostEqual(float(probs.sum()), 1.0, places=6)
        self.assertGreater(probs[0], 0.85)
        self.assertLess(probs[1], 0.15)

    def test_dirichlet_prior_matches_counts(self) -> None:
        class DummyEnc:
            num_cols: list[str] = []
            cat_cols: list[str] = []

            def transform(self, df):
                return np.zeros((len(df), 0), dtype=np.float32)

        class ZeroEstimator:
            def predict(self, X):
                return np.zeros(X.shape[0], dtype=float)

        tm = TransferModel(enc=DummyEnc(), est=ZeroEstimator())
        tm.pspace = None
        tm.stage_thresholds = {("Assembly", "Assembly"): 3}
        tm.dirichlet_alpha = 0.5
        tm.dirichlet_counts_party_stage = {("U1", "early"): {"U2": 30.0, "N1": 10.0}}

        parties = ["U1", "U2", "N1"]
        ctx = {
            "party": parties,
            "constituency": "Test",
            "body": "Assembly",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.asarray([1000.0, 800.0, 600.0], dtype=float),
            "initial_first": np.asarray([1200.0, 810.0, 590.0], dtype=float),
            "alive": np.asarray([1, 1, 1], dtype=int),
        }

        surv_idx = np.asarray([1, 2], dtype=int)
        probs = tm.expect_proba(0, surv_idx, ctx)

        expected = np.asarray([30.5, 10.5], dtype=float) / 41.0
        np.testing.assert_allclose(probs, expected, rtol=1e-6, atol=1e-6)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
