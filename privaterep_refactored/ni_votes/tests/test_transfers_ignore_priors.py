import sys
import types
import unittest

import numpy as np


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


_install_sklearn_stub()

from ni_votes.features.transfers.base import _share_combo_key
from ni_votes.features.transfers.encoders import TransferModel


class TransferModelIgnorePriorsSmoothingTest(unittest.TestCase):
    def test_ignore_priors_uses_share_prior_smoothing(self) -> None:
        class DummyEnc:
            num_cols: list[str] = []
            cat_cols: list[str] = []

            def transform(self, df):
                return np.zeros((len(df), 0), dtype=np.float32)

        class UniformEstimator:
            classes_ = np.asarray(["BlocA", "BlocB"], dtype=object)

            def predict_proba(self, X):
                return np.full((X.shape[0], 2), 0.5, dtype=float)

        model = TransferModel(DummyEnc(), UniformEstimator())
        model.classes_ = ["BlocA", "BlocB"]
        model.class_index = {"BlocA": 0, "BlocB": 1}
        model.model_strength = 20.0
        model.party_prior = {"Donor": {"BlocA": 0.75, "BlocB": 0.25}}
        model.party_prior_strength = {"Donor": 40.0}
        share_key = _share_combo_key(0.2, 0.8, bins=model.share_bins)
        model.share_prior = {"Donor": {share_key: ({"BlocA": 30.0, "BlocB": 10.0}, 40.0)}}
        model.share_prior_global = {}
        model.counts_party = {"Donor": {"BlocA": 30.0, "BlocB": 10.0}}

        parties = ["Donor", "BlocA", "BlocB"]
        ctx = {
            "party": parties,
            "constituency": "Test",
            "body": "Assembly",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.asarray([50.0, 30.0, 20.0], dtype=float),
            "initial_first": np.asarray([10.0, 18.0, 12.0], dtype=float),
            "alive": np.asarray([1, 1, 1], dtype=int),
            "ignore_priors": True,
        }

        surv_idx = np.asarray([1, 2], dtype=int)
        probs = model.expect_proba(0, surv_idx, ctx)

        self.assertAlmostEqual(float(probs.sum()), 1.0, places=6)
        self.assertNotAlmostEqual(probs[0], probs[1])
        donor_shares = np.asarray([0.75, 0.25], dtype=float)
        self.assertGreaterEqual(probs[0], donor_shares.min() - 1e-6)
        self.assertLessEqual(probs[0], donor_shares.max() + 1e-6)
        self.assertGreaterEqual(probs[1], donor_shares.min() - 1e-6)
        self.assertLessEqual(probs[1], donor_shares.max() + 1e-6)
        self.assertEqual(model._last_debug.get("smoothing"), "share_donor")
        self.assertIn("raw_vector", model._last_debug)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
