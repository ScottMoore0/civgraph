import sys
import types
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest import mock

import numpy as np
import pandas as pd


def _install_sklearn_stub() -> None:
    try:  # pragma: no cover - prefers real implementation when available
        import sklearn  # type: ignore

        if getattr(sklearn, "__dict__", None):
            return
    except Exception:
        pass

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
    sk.dummy = types.ModuleType("sklearn.dummy")
    sk.dummy.DummyClassifier = object
    sk.exceptions = types.ModuleType("sklearn.exceptions")
    sk.exceptions.ConvergenceWarning = RuntimeError
    sys.modules["sklearn"] = sk
    sys.modules["sklearn.decomposition"] = sk.decomposition
    sys.modules["sklearn.linear_model"] = sk.linear_model
    sys.modules["sklearn.preprocessing"] = sk.preprocessing
    sys.modules["sklearn.cluster"] = sk.cluster
    sys.modules["sklearn.neighbors"] = sk.neighbors
    sys.modules["sklearn.dummy"] = sk.dummy
    sys.modules["sklearn.exceptions"] = sk.exceptions


_install_sklearn_stub()

from ni_votes.features.transfers.context import build_feature_context
from ni_votes.features.transfers.encoders import TransferModel
from ni_votes.features.transfers.ml_tables import (
    _build_from_transfer_sheet,
    build_training_from_ml_tables,
)
from ni_votes.features.transfers.party_space import PartySpace
from ni_votes.features.transfers.training import _HierarchicalFallback


class _DummyEncoder:
    def __init__(self):
        self.num_cols = []
        self.cat_cols = []

    def transform(self, df_pairs):
        n = len(df_pairs)
        return np.zeros((n, 1), dtype=np.float32)


class _DummyEstimator:
    def predict(self, X):
        return np.full((X.shape[0],), 0.1, dtype=float)


class _ClassifierStub:
    def __init__(self, matrix, classes):
        self._matrix = np.asarray(matrix, dtype=float)
        self.classes_ = [str(c) for c in classes]

    def predict_proba(self, X):
        n = X.shape[0]
        if self._matrix.shape[0] != n:
            return np.repeat(self._matrix[:1], n, axis=0)
        return self._matrix


class _UUPHeavyEstimator:
    def __init__(self):
        self.classes_ = [
            "Alliance",
            "Sinn Fein",
            "DUP",
            "UUP",
            "NonTransferable",
        ]

    def predict_proba(self, X):
        base = np.array([[0.05, 0.05, 0.05, 0.75, 0.10]], dtype=float)
        return np.repeat(base, X.shape[0], axis=0)


class TransferModelFallbackTest(unittest.TestCase):
    def _base_context(self):
        parties = np.array(["Donor", "A", "B"], dtype=object)
        ctx = {
            "party": parties,
            "constituency": "Test",
            "body": "BodyX",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([100.0, 60.0, 40.0], dtype=float),
            "initial_first": np.array([80.0, 15.0, 5.0], dtype=float),
            "alive": np.array([True, True, True]),
        }
        return ctx

    def _build_model(self):
        enc = _DummyEncoder()
        est = _DummyEstimator()
        model = TransferModel(enc, est)
        model.classes_ = ["A", "B"]
        model.class_index = {"A": 0, "B": 1}
        return model

    def test_donor_model_priority(self):
        model = self._build_model()
        ctx = self._base_context()

        donor_model = _ClassifierStub([[0.7, 0.3], [0.2, 0.8]], ["A", "B"])
        model.donor_models["Donor"] = donor_model
        model.donor_classes["Donor"] = ["A", "B"]

        fallback = _ClassifierStub([[0.4, 0.6], [0.5, 0.5]], ["A", "B"])
        model.body_models["BodyX"] = fallback
        model.body_classes["BodyX"] = ["A", "B"]

        probs = model.expect_proba(0, np.array([1, 2]), ctx)
        self.assertEqual(model._last_model_source, "donor_model")
        np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-6)
        np.testing.assert_allclose(probs, np.array([0.7, 0.8]) / 1.5, atol=1e-6)

    def test_donor_body_fallback(self):
        model = self._build_model()
        ctx = self._base_context()

        donor_body = _ClassifierStub([[0.3, 0.7], [0.9, 0.1]], ["A", "B"])
        model.donor_body_models[("BodyX", "Donor")] = donor_body
        model.donor_body_classes[("BodyX", "Donor")] = ["A", "B"]

        probs = model.expect_proba(0, np.array([1, 2]), ctx)
        self.assertEqual(model._last_model_source, "donor_body_model")
        np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-6)

    def test_body_then_global_fallback(self):
        model = self._build_model()
        ctx = self._base_context()

        body_model = _ClassifierStub([[0.2, 0.8], [0.6, 0.4]], ["A", "B"])
        model.body_models["BodyX"] = body_model
        model.body_classes["BodyX"] = ["A", "B"]

        probs = model.expect_proba(0, np.array([1, 2]), ctx)
        self.assertEqual(model._last_model_source, "body_model")
        np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-6)


    def test_hierarchical_fallback_respects_body(self):
        parties = np.array(["BlocDonor", "BlocA", "BlocB"], dtype=object)

        def _context_with_body(body_name: str) -> Dict[str, Any]:
            return {
                "party": parties,
                "constituency": "Test",
                "body": body_name,
                "election_type": "Assembly",
                "count": 1,
                "is_elimination": 1,
                "is_surplus": 0,
                "tallies": np.array([100.0, 60.0, 40.0], dtype=float),
                "initial_first": np.array([80.0, 25.0, 15.0], dtype=float),
                "alive": np.array([True, True, True]),
            }

        base_counts = {"BlocA": 100.0, "BlocB": 100.0}
        contexts = {
            "type_body_donor": {
                ("Assembly", "BodyX", "BlocDonor"): ({"BlocA": 90.0, "BlocB": 10.0}, 100.0),
                ("Assembly", "BodyY", "BlocDonor"): ({"BlocA": 20.0, "BlocB": 80.0}, 100.0),
            },
            "body_donor": {},
            "type_donor": {},
            "donor": {},
            "body": {},
        }
        fallback = _HierarchicalFallback(base_counts, contexts, alpha_mass=5.0)
        enc = _DummyEncoder()
        model = TransferModel(enc, fallback)
        survivors = np.array([1, 2])

        ctx_x = _context_with_body("BodyX")
        probs_x = model.expect_proba(0, survivors, ctx_x)
        expected_x = np.array([(90.0 + 2.5) / 105.0, (10.0 + 2.5) / 105.0])
        np.testing.assert_allclose(probs_x, expected_x, atol=1e-6)
        self.assertGreater(model.fallback_confidence, 0.9)
        self.assertEqual(model.fallback_context, "type_body_donor")
        self.assertEqual(model._last_debug.get("prior"), "type_body_donor")
        self.assertAlmostEqual(model._last_debug.get("fallback_confidence"), model.fallback_confidence)

        ctx_y = _context_with_body("BodyY")
        probs_y = model.expect_proba(0, survivors, ctx_y)
        expected_y = np.array([(20.0 + 2.5) / 105.0, (80.0 + 2.5) / 105.0])
        np.testing.assert_allclose(probs_y, expected_y, atol=1e-6)
        self.assertEqual(model.fallback_context, "type_body_donor")
        self.assertGreater(probs_y[1], probs_x[1])

        ctx_z = _context_with_body("BodyZ")
        probs_z = model.expect_proba(0, survivors, ctx_z)
        np.testing.assert_allclose(probs_z, np.array([0.5, 0.5]), atol=1e-6)
        self.assertAlmostEqual(model.fallback_confidence or 0.0, 0.0)
        self.assertEqual(model.fallback_context, "global")
        self.assertEqual(model._last_debug.get("prior"), "global")

    def test_global_model_used_last(self):
        model = self._build_model()
        ctx = self._base_context()

        global_model = _ClassifierStub([[0.1, 0.9], [0.8, 0.2]], ["A", "B"])
        model.est = global_model
        model.classes_ = ["A", "B"]
        model.class_index = {"A": 0, "B": 1}

        probs = model.expect_proba(0, np.array([1, 2]), ctx)
        self.assertEqual(model._last_model_source, "global_model")
        np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-6)


class TransferModelEuropeanPriorTest(unittest.TestCase):
    def test_sdlp_european_priors_dominate(self):
        enc = _DummyEncoder()
        est = _UUPHeavyEstimator()
        model = TransferModel(enc, est)

        counts = {
            "Alliance": 570.0,
            "Sinn Fein": 290.0,
            "DUP": 30.0,
            "UUP": 10.0,
            "__NT__": 100.0,
        }
        context_key = ("RegionalElection", "RegionalBody")
        model.counts_type_body = {context_key: {"SDLP": counts}}
        model.priors_by_type_body = model.counts_type_body
        model.counts_party = {"SDLP": counts}
        model.counts_global = counts
        model.donor_strength = {"SDLP": float(sum(counts.values()))}
        model.model_strength = 50.0
        total_counts = float(sum(counts.values()))
        share = total_counts - counts["__NT__"]
        model.party_prior = {
            "SDLP": {k: v / share for k, v in counts.items() if k != "__NT__"}
        }
        nt_rate = counts["__NT__"] / total_counts
        model.nt_rate_by_party = {"SDLP": nt_rate}
        model.nt_rate_global = nt_rate

        parties = np.array([
            "SDLP",
            "Alliance",
            "Sinn Fein",
            "DUP",
            "UUP",
        ], dtype=object)
        ctx = {
            "party": parties,
            "constituency": "Northern Ireland",
            "body": "RegionalBody",
            "election_type": "RegionalElection",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([120.0, 80.0, 70.0, 40.0, 30.0], dtype=float),
            "initial_first": np.array([100.0, 60.0, 50.0, 30.0, 20.0], dtype=float),
            "alive": np.array([False, True, True, True, True]),
        }

        survivors = np.array([1, 2, 3, 4])
        probs = np.asarray(model.expect_proba(0, survivors, ctx), dtype=float)

        expected = np.array([
            counts["Alliance"],
            counts["Sinn Fein"],
            counts["DUP"],
            counts["UUP"],
        ])
        expected = expected / float(expected.sum())

        np.testing.assert_allclose(probs, expected, atol=0.05)
        self.assertLess(probs[-1], 0.06)
        self.assertGreater(probs[0], probs[-1])
        self.assertGreater(probs[1], probs[-1])

        lam = float(model._last_debug.get("lambda", 0.0))
        self.assertGreaterEqual(lam, 0.9)
        self.assertGreaterEqual(float(model._last_debug.get("lambda_floor", 0.0)), 0.9)
        self.assertGreater(lam, float(model._last_debug.get("lambda_base", 0.0)))

    def test_sinn_fein_aliases_preserved(self):
        transfers_df = pd.DataFrame(
            [
                {
                    "DateStr": "2019-05-23",
                    "Event": "EuropeanElection",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different Party",
                    "Party": "Sinn Féin",
                    "Transfers": 290.0,
                    "Count": 1,
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                    "RemainingCandidatePartiesInIDOrder": "Sinn Féin,Alliance Party of Northern Ireland,DUP,UUP",
                },
                {
                    "DateStr": "2019-05-23",
                    "Event": "EuropeanElection",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different Party",
                    "Party": "Alliance Party of Northern Ireland",
                    "Transfers": 570.0,
                    "Count": 1,
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                    "RemainingCandidatePartiesInIDOrder": "Sinn Féin,Alliance Party of Northern Ireland,DUP,UUP",
                },
                {
                    "DateStr": "2019-05-23",
                    "Event": "EuropeanElection",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different Party",
                    "Party": "DUP",
                    "Transfers": 30.0,
                    "Count": 1,
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                    "RemainingCandidatePartiesInIDOrder": "Sinn Féin,Alliance Party of Northern Ireland,DUP,UUP",
                },
                {
                    "DateStr": "2019-05-23",
                    "Event": "EuropeanElection",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different Party",
                    "Party": "UUP",
                    "Transfers": 10.0,
                    "Count": 1,
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                    "RemainingCandidatePartiesInIDOrder": "Sinn Féin,Alliance Party of Northern Ireland,DUP,UUP",
                },
                {
                    "DateStr": "2019-05-23",
                    "Event": "EuropeanElection",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Nontransferable",
                    "Party": "",
                    "Transfers": 100.0,
                    "Count": 1,
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                    "RemainingCandidatePartiesInIDOrder": "Sinn Féin,Alliance Party of Northern Ireland,DUP,UUP",
                },
            ]
        )

        records_df = _build_from_transfer_sheet(pd.DataFrame(), transfers_df)
        self.assertFalse(records_df.empty)
        dest_parties = set(records_df["DestParty"].astype(str))
        self.assertIn("Sinn Fein", dest_parties)
        self.assertIn("Alliance", dest_parties)
        self.assertIn("__NT__", dest_parties)

        fallback_info = records_df.attrs.get("fallback_info", {})
        sdlp_counts = fallback_info.get("counts_party", {}).get("SDLP", {})
        self.assertIn("Sinn Fein", sdlp_counts)
        self.assertIn("Alliance", sdlp_counts)

        enc = _DummyEncoder()
        est = _UUPHeavyEstimator()
        model = TransferModel(enc, est)
        model.stage_thresholds = fallback_info.get("stage_thresholds", {})
        model.priors_by_type_body_stage = fallback_info.get("counts_type_body_stage", {})
        model.counts_type_body_stage = fallback_info.get("counts_type_body_stage", {})
        model.priors_by_type_body = fallback_info.get("counts_type_body", {})
        model.counts_type_body = fallback_info.get("counts_type_body", {})
        model.counts_type = fallback_info.get("counts_type", {})
        model.counts_stage = fallback_info.get("counts_stage", {})
        model.counts_party = fallback_info.get("counts_party", {})
        model.counts_global = fallback_info.get("counts_global", {})
        model.party_prior = fallback_info.get("party_prior", {})
        model.donor_strength = fallback_info.get("donor_strength", {})
        model.model_strength = float(fallback_info.get("model_strength", 0.0))
        model.nt_rate_by_party = fallback_info.get("nt_rate_by_party", {})
        model.nt_rate_global = float(fallback_info.get("nt_rate_global", 0.0))
        model.pspace = PartySpace(["Alliance", "Sinn Fein", "DUP", "UUP"])

        scenario = {
            "parties": ["SDLP", "Alliance", "Sinn Fein", "DUP", "UUP"],
            "elected_body": "European Parliament",
            "election_type": "EuropeanElection",
            "first_prefs": [120.0, 80.0, 70.0, 40.0, 30.0],
        }
        ctx = build_feature_context(pd.DataFrame(), pd.DataFrame(), scenario)
        self.assertEqual(ctx.get("election_type"), "RegionalElection")
        self.assertEqual(ctx.get("body"), "RegionalBody")
        ctx.update(
            {
                "tallies": np.array([120.0, 80.0, 70.0, 40.0, 30.0], dtype=float),
                "alive": np.array([False, True, True, True, True]),
                "count": 1,
                "is_elimination": 1,
                "is_surplus": 0,
            }
        )

        survivors = np.array([1, 2, 3, 4])
        probs = np.asarray(model.expect_proba(0, survivors, ctx), dtype=float)

        self.assertGreater(probs[0], probs[2])
        self.assertGreater(probs[1], probs[3])
        self.assertGreater(probs[0], 0.3)
        self.assertGreater(probs[1], 0.3)
        self.assertLess(probs[2], 0.15)
        self.assertLess(probs[3], 0.15)

    def test_sparse_stage_counts_fall_back_to_type_body(self):
        enc = _DummyEncoder()
        est = _UUPHeavyEstimator()
        model = TransferModel(enc, est)

        etype = "Assembly"
        body = "Northern Ireland Assembly"
        stage = "early"
        donor = "SDLP"

        stage_key = (etype, body, stage)
        model.counts_type_body_stage = {
            stage_key: {
                donor: {
                    "Alliance": 60.0,
                    "Green": 30.0,
                    "__NT__": 10.0,
                }
            }
        }
        type_body_key = (etype, body)
        rich_counts = {
            "Alliance": 600.0,
            "Sinn Fein": 300.0,
            "__NT__": 100.0,
        }
        model.counts_type_body = {type_body_key: {donor: rich_counts}}
        model.counts_type = {etype: {donor: rich_counts}}
        model.counts_party = {donor: rich_counts}
        model.counts_global = rich_counts
        model.stage_thresholds = {(etype, body): 1.0}

        parties = np.array(["SDLP", "Alliance", "Sinn Fein", "Green"], dtype=object)
        ctx = {
            "party": parties,
            "constituency": "Northern Ireland",
            "body": body,
            "election_type": etype,
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([120.0, 80.0, 70.0, 20.0], dtype=float),
            "initial_first": np.array([100.0, 40.0, 35.0, 5.0], dtype=float),
            "alive": np.array([False, True, True, False]),
        }

        survivors = np.array([1, 2])
        probs = np.asarray(model.expect_proba(0, survivors, ctx), dtype=float)

        expected = np.array([rich_counts["Alliance"], rich_counts["Sinn Fein"]], dtype=float)
        expected = expected / float(expected.sum())

        np.testing.assert_allclose(probs, expected, atol=1e-6)

        debug = model._last_debug
        self.assertEqual(debug.get("counts_context"), "type_body")
        skipped = debug.get("counts_sparse_skipped")
        self.assertIsInstance(skipped, list)
        self.assertTrue(any(item.get("context") == "type_body_stage" for item in skipped))
        self.assertAlmostEqual(debug.get("counts_coverage"), 0.9, places=6)

    def test_dense_stage_counts_still_fall_back_when_reference_richer(self):
        enc = _DummyEncoder()
        est = _UUPHeavyEstimator()
        model = TransferModel(enc, est)

        etype = "EuropeanElection"
        body = "European Parliament"
        stage = "late"
        donor = "SDLP"

        stage_key = (etype, body, stage)
        stage_counts = {
            "Alliance": 45.0,
            "UUP": 35.0,
            "DUP": 15.0,
            "__NT__": 5.0,
        }
        model.counts_type_body_stage = {stage_key: {donor: stage_counts}}

        type_body_key = (etype, body)
        rich_counts = {
            "Alliance": 450.0,
            "Sinn Fein": 350.0,
            "UUP": 200.0,
            "__NT__": 50.0,
        }
        model.counts_type_body = {type_body_key: {donor: rich_counts}}
        model.counts_type = {etype: {donor: rich_counts}}
        model.counts_party = {donor: rich_counts}
        model.counts_global = rich_counts
        model.stage_thresholds = {(etype, body): 0.0}

        parties = np.array(["SDLP", "Alliance", "Sinn Fein", "UUP", "DUP"], dtype=object)
        ctx = {
            "party": parties,
            "constituency": "Northern Ireland",
            "body": body,
            "election_type": etype,
            "count": 5,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([120.0, 80.0, 90.0, 70.0, 30.0], dtype=float),
            "initial_first": np.array([100.0, 40.0, 35.0, 25.0, 10.0], dtype=float),
            "alive": np.array([False, True, True, True, False]),
        }

        survivors = np.array([1, 2, 3])
        probs = np.asarray(model.expect_proba(0, survivors, ctx), dtype=float)

        expected = np.array([
            rich_counts["Alliance"],
            rich_counts["Sinn Fein"],
            rich_counts["UUP"],
        ], dtype=float)
        expected = expected / float(expected.sum())

        np.testing.assert_allclose(probs, expected, atol=5e-4)

        debug = model._last_debug
        self.assertEqual(debug.get("counts_context"), "type_body")
        skipped = debug.get("counts_sparse_reference")
        self.assertIsInstance(skipped, list)
        self.assertTrue(any(item.get("context") == "type_body_stage" for item in skipped))
        ratios = [item.get("reference_ratio") for item in skipped if item.get("context") == "type_body_stage"]
        self.assertTrue(any(r is not None and r < 0.7 for r in ratios))

class TransferModelHoldoutTest(unittest.TestCase):
    @unittest.skipUnless("sklearn" in sys.modules and hasattr(sys.modules["sklearn"], "__version__"), "scikit-learn required")
    def test_probabilistic_model_beats_ridge(self):
        from sklearn.linear_model import LogisticRegression, Ridge
        from sklearn.preprocessing import OneHotEncoder

        rng = np.random.default_rng(42)
        donors = ["D0", "D1", "D2"]
        recipients = ["R0", "R1", "R2"]
        bodies = ["BodyA", "BodyB"]

        rows = []
        event_ids = []
        donors_per_event = []
        for event in range(120):
            donor = rng.choice(donors)
            body = rng.choice(bodies)
            donors_per_event.append(donor)
            for rec in recipients:
                rows.append([donor, rec, body])
                event_ids.append(event)
        features = np.array(rows, dtype=object)

        # Target probabilities for each event/recipient pair
        shares = []
        labels = []
        sample_weight = []
        size = len(recipients)
        for event in range(120):
            base = rng.dirichlet(np.ones(size) + 0.5)
            donor = donors_per_event[event]
            boost = np.zeros(size, dtype=float)
            for idx, rec in enumerate(recipients):
                if donor == "D0" and rec == "R0":
                    boost[idx] += 0.3
            adj = base + boost
            adj = adj / adj.sum()
            for idx, rec in enumerate(recipients):
                shares.append(float(adj[idx]))
                labels.append(rec)
                sample_weight.append(float(10.0 * adj[idx] + 1.0))

        shares = np.array(shares)
        labels = np.array(labels)
        sample_weight = np.array(sample_weight)
        enc = OneHotEncoder(handle_unknown="ignore")
        X = enc.fit_transform(features).toarray()

        event_ids = np.array(event_ids)
        train_mask = event_ids % 5 != 0
        test_mask = ~train_mask

        clf = LogisticRegression(max_iter=500, multi_class="multinomial")
        clf.fit(X[train_mask], labels[train_mask], sample_weight=sample_weight[train_mask])

        reg = Ridge(alpha=1.0, positive=True)
        reg.fit(X[train_mask], shares[train_mask], sample_weight=sample_weight[train_mask])

        class_index = {c: i for i, c in enumerate(clf.classes_)}
        proba = clf.predict_proba(X[test_mask])
        ridge_raw = np.clip(reg.predict(X[test_mask]), 0.0, None)

        events_test = event_ids[test_mask]
        labels_test = labels[test_mask]
        weights_test = sample_weight[test_mask]

        ridge_probs = np.zeros_like(ridge_raw)
        start = 0
        for event in np.unique(events_test):
            mask = events_test == event
            vals = ridge_raw[mask]
            total = float(vals.sum())
            if not np.isfinite(total) or total <= 0:
                ridge_probs[mask] = 1.0 / float(mask.sum())
            else:
                ridge_probs[mask] = vals / total

        def _weighted_log_loss(probs: np.ndarray) -> float:
            clipped = np.clip(probs, 1e-9, 1.0)
            return float(-(weights_test * np.log(clipped)).sum() / weights_test.sum())

        logistic_true = np.array([
            proba[i, class_index.get(lbl, -1)] if class_index.get(lbl, -1) >= 0 else 1.0 / proba.shape[1]
            for i, lbl in enumerate(labels_test)
        ])

        ridge_true = ridge_probs

        self.assertLess(_weighted_log_loss(logistic_true), _weighted_log_loss(ridge_true))


class TransferModelBlendConfidenceTest(unittest.TestCase):
    def setUp(self):
        parties = np.array(["Donor", "BlocA", "BlocB"], dtype=object)
        self.ctx = {
            "party": parties,
            "constituency": "Test",
            "body": "BodyX",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([100.0, 60.0, 40.0], dtype=float),
            "initial_first": np.array([80.0, 15.0, 5.0], dtype=float),
            "alive": np.array([True, True, True]),
        }
        self.survivors = np.array([1, 2])

    def _model_with_matrix(self, matrix):
        enc = _DummyEncoder()
        est = _ClassifierStub(matrix, ["BlocA", "BlocB"])
        model = TransferModel(enc, est)
        model.classes_ = ["BlocA", "BlocB"]
        model.class_index = {"BlocA": 0, "BlocB": 1}
        key = ("Assembly", "BodyX")
        model.priors_by_type_body = {key: {"Donor": {"BlocA": 0.6, "BlocB": 0.4}}}
        model.counts_type_body = {key: {"Donor": {"BlocA": 30.0, "BlocB": 70.0}}}
        model.counts_mass_type_body = {key: {"Donor": 100.0}}
        model.counts_confidence_type_body = {key: {"Donor": 0.5}}
        model.counts_confidence_party = {"Donor": 0.5}
        model.counts_confidence_global = 0.0
        model.donor_strength = {"Donor": 0.0}
        model.model_strength = 0.0
        model.blend_confidence_threshold = 0.5
        model.blend_entropy_threshold = 0.85
        model.min_counts_weight = 0.0
        return model

    def test_confident_donor_keeps_model_split(self):
        model = self._model_with_matrix([[0.97, 0.03], [0.97, 0.03]])
        probs = model.expect_proba(0, self.survivors, self.ctx)
        np.testing.assert_allclose(probs, np.array([0.97, 0.03]), atol=1e-6)
        self.assertTrue(model._last_debug.get("counts_blend_skipped"))
        self.assertAlmostEqual(model._last_debug.get("counts_total"), 100.0)
        self.assertFalse(model._last_debug.get("counts_entropy_skip", False))

    def test_sparse_donor_shrinks_to_counts(self):
        model = self._model_with_matrix([[0.51, 0.49], [0.51, 0.49]])
        probs = model.expect_proba(0, self.survivors, self.ctx)
        expected = np.array([0.405, 0.595])
        np.testing.assert_allclose(probs, expected, atol=1e-6)
        self.assertFalse(model._last_debug.get("counts_blend_skipped", False))
        self.assertAlmostEqual(model._last_debug.get("lambda"), 0.5, places=6)

    def test_high_entropy_required_for_counts(self):
        model = self._model_with_matrix([[0.8, 0.2], [0.8, 0.2]])
        model.blend_confidence_threshold = 0.99  # force should_blend True
        model.blend_entropy_threshold = 0.9
        probs = model.expect_proba(0, self.survivors, self.ctx)
        np.testing.assert_allclose(probs, np.array([0.8, 0.2]), atol=1e-6)
        self.assertTrue(model._last_debug.get("counts_entropy_skip"))


class MlTablesEuropeanScenarioTest(unittest.TestCase):
    def test_minimal_european_transfer_prefers_nationalist_alliance(self) -> None:
        transfers_df = pd.DataFrame(
            [
                {
                    "Event": "European Election",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "Sinn Féin",
                    "Transfers": 60.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Féin,Alliance,DUP,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4,5",
                },
                {
                    "Event": "European Election",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "Alliance",
                    "Transfers": 30.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Féin,Alliance,DUP,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4,5",
                },
                {
                    "Event": "European Election",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "DUP",
                    "Transfers": 5.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Féin,Alliance,DUP,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4,5",
                },
                {
                    "Event": "European Election",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "UUP",
                    "Transfers": 5.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Féin,Alliance,DUP,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4,5",
                },
            ]
        )

        scenario = {
            "event": "European Parliament election",
            "elected_body": "European Parliament",
        }

        training_df = build_training_from_ml_tables(
            pd.DataFrame(), {"Transfers": transfers_df}, scenario_dict=scenario
        )

        self.assertFalse(training_df.empty)

        info = training_df.attrs.get("fallback_info", {})
        counts_type_body = info.get("counts_type_body", {})
        self.assertIn(("RegionalElection", "RegionalBody"), counts_type_body)

        counts_party = info.get("counts_party", {})
        self.assertIn("SDLP", counts_party)

        sdlp_counts = counts_party["SDLP"]

        def weight(*labels: str) -> float:
            return sum(float(sdlp_counts.get(label, 0.0)) for label in labels)

        nationalist_alliance = weight("Sinn Féin", "Sinn Fein") + weight("Alliance")
        unionist = weight("DUP") + weight("UUP")

        self.assertGreater(nationalist_alliance, unionist)

    def test_european_sdlp_priors_prefer_nationalist_alliance(self) -> None:
        workbook = Path(__file__).resolve().parents[2] / "Transfers_with_SourcePersonID.xlsx"
        transfers_df = pd.read_excel(workbook, sheet_name="Transfers")
        scenario = {"event": "European Parliament election", "elected_body": "European Parliament"}

        training_df = build_training_from_ml_tables(pd.DataFrame(), {"Transfers": transfers_df}, scenario_dict=scenario)
        self.assertFalse(training_df.empty)

        info = training_df.attrs.get("fallback_info", {})
        party_prior = info.get("party_prior", {})
        self.assertIn("SDLP", party_prior)
        sdlp_prior = party_prior["SDLP"]

        def weight(*labels: str) -> float:
            for label in labels:
                if label in sdlp_prior:
                    return float(sdlp_prior[label])
            return 0.0

        sinn_fein = weight("Sinn Féin", "Sinn Fein")
        alliance = weight("Alliance")
        dup = weight("DUP")
        uup = weight("UUP")

        self.assertGreater(sinn_fein, 0.0)
        self.assertGreater(alliance, 0.0)
        self.assertGreater(sinn_fein, dup)
        self.assertGreater(sinn_fein, uup)
        self.assertGreater(alliance, dup)
        self.assertGreater(alliance, uup)

    def test_european_sdlp_priors_handle_label_noise(self) -> None:
        workbook = Path(__file__).resolve().parents[2] / "Transfers_with_SourcePersonID.xlsx"
        transfers_df = pd.read_excel(workbook, sheet_name="Transfers")
        scenario = {"event": "  European election!!!  ", "elected_body": "European Parliament"}

        training_df = build_training_from_ml_tables(
            pd.DataFrame(),
            {"Transfers": transfers_df},
            scenario_dict=scenario,
        )
        self.assertFalse(training_df.empty)

        info = training_df.attrs.get("fallback_info", {})
        party_prior = info.get("party_prior", {})
        self.assertIn("SDLP", party_prior)
        sdlp_prior = party_prior["SDLP"]

        def weight(*labels: str) -> float:
            for label in labels:
                if label in sdlp_prior:
                    return float(sdlp_prior[label])
            return 0.0

        nationalist_alliance = weight("Sinn Féin", "Sinn Fein") + weight("Alliance")
        unionist = weight("DUP") + weight("UUP")

        self.assertGreater(nationalist_alliance, 0.0)
        self.assertGreater(unionist, 0.0)
        self.assertGreater(nationalist_alliance, unionist)

    def test_single_seat_european_scenario_uses_pooled_stv_rows(self) -> None:
        workbook = Path(__file__).resolve().parents[2] / "Transfers_with_SourcePersonID.xlsx"
        transfers_df = pd.read_excel(workbook, sheet_name="Transfers")
        scenario = {
            "event": "EuropeanElection",
            "election_type": "EuropeanElection",
            "elected_body": "European Parliament",
            "seats": 1,
        }

        training_df = build_training_from_ml_tables(
            pd.DataFrame(), {"Transfers": transfers_df}, scenario_dict=scenario
        )

        self.assertFalse(training_df.empty)
        self.assertIn("pooled_source", training_df.columns)
        pooled_mask = training_df["pooled_source"].astype(str) == "pooled_stv"
        self.assertTrue(
            bool(pooled_mask.any()),
            "expected pooled STV rows to supplement European-only filters",
        )

        info = training_df.attrs.get("fallback_info", {})
        pooled_sources = info.get("pooled_sources", {})
        self.assertIn("SDLP", pooled_sources)
        self.assertGreater(float(pooled_sources["SDLP"].get("weight_added", 0.0)), 0.0)
        filters_meta = pooled_sources.get("__filters__", {})
        allowed_events = [str(ev) for ev in filters_meta.get("allowed_events", [])]
        self.assertTrue(any(ev.casefold() == "regionalelection" for ev in allowed_events))
        allowed_bodies = [str(body) for body in filters_meta.get("allowed_bodies", [])]
        self.assertTrue(any(body.casefold() == "regionalbody" for body in allowed_bodies))

        counts_party = info.get("counts_party", {})
        self.assertIn("SDLP", counts_party)
        sdlp_counts = counts_party["SDLP"]

        def pooled_weight(*labels: str) -> float:
            return sum(float(sdlp_counts.get(label, 0.0)) for label in labels)

        nationalist_alliance = pooled_weight("Sinn Féin", "Sinn Fein") + pooled_weight("Alliance")
        unionist = pooled_weight("DUP") + pooled_weight("UUP")

        self.assertGreater(nationalist_alliance, 0.0)
        self.assertGreater(nationalist_alliance, unionist)


class GetTransferModelEuropeanScenarioTest(unittest.TestCase):
    def test_european_scenario_prefers_nationalist_alliance_end_to_end(self) -> None:
        from ni_votes.features.transfers import training as training_mod

        transfers_df = pd.DataFrame(
            [
                {
                    "DateStr": "2019-05-23",
                    "Event": "European Election",
                    "Constituency": "Northern Ireland",
                    "ElectedBody": "European Parliament",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "UUP",
                    "Transfers": 100.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Fein,Alliance,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                },
                {
                    "DateStr": "2017-03-02",
                    "Event": "Assembly Election",
                    "Constituency": "West Tyrone",
                    "ElectedBody": "Northern Ireland Assembly",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "Sinn Fein",
                    "Transfers": 600.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Fein,Alliance,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                },
                {
                    "DateStr": "2017-03-02",
                    "Event": "Assembly Election",
                    "Constituency": "West Tyrone",
                    "ElectedBody": "Northern Ireland Assembly",
                    "TransferParty": "SDLP",
                    "TransferPartyRelation": "Different party",
                    "Party": "Alliance",
                    "Transfers": 400.0,
                    "Count": 1,
                    "RemainingCandidatePartiesInIDOrder": "SDLP,Sinn Fein,Alliance,UUP",
                    "RemainingCandidateIDsDesc": "1,2,3,4",
                },
            ]
        )

        ml_tables = {"Transfers": transfers_df}

        scenario = {
            "event": "European Parliament election",
            "elected_body": "European Parliament",
            "parties": ["SDLP", "Alliance", "Sinn Fein", "UUP"],
            "first_prefs": [120.0, 80.0, 70.0, 60.0],
        }

        er_df = pd.DataFrame(
            {
                "Party": ["SDLP", "Alliance", "Sinn Fein", "UUP"],
                "Votes": [120.0, 80.0, 70.0, 60.0],
                "ResultType": ["Candidate"] * 4,
            }
        )

        dummy_models = types.ModuleType("ni_votes.features.models_transfers")

        # LightGBM backend removed - using hierarchical statistical models instead
        # The test now uses the default hierarchical approach without ML backends

        training_mod._MODEL_CACHE = None
        training_mod._MODEL_CACHE_KEY = None

        with mock.patch(
            "ni_votes.features.transfers.training.load_ml_tables_any", return_value=ml_tables
        ):
            model = training_mod.get_transfer_model(
                er_df, pd.DataFrame(), scenario_dict=scenario, refit_if_changed=True
            )

        key = ("RegionalElection", "RegionalBody")
        self.assertIn(key, model.counts_type_body)
        sdlp_counts = model.counts_type_body[key].get("SDLP", {})
        self.assertGreater(float(sdlp_counts.get("Sinn Fein", 0.0)), 0.0)
        self.assertGreater(float(sdlp_counts.get("Alliance", 0.0)), 0.0)
        self.assertGreater(
            float(sdlp_counts.get("Sinn Fein", 0.0)) + float(sdlp_counts.get("Alliance", 0.0)),
            float(sdlp_counts.get("UUP", 0.0)),
        )

        ctx = build_feature_context(pd.DataFrame(), pd.DataFrame(), scenario)
        ctx.update(
            {
                "tallies": np.array([120.0, 80.0, 70.0, 60.0], dtype=float),
                "alive": np.array([False, True, True, True]),
                "count": 1,
                "is_elimination": 1,
                "is_surplus": 0,
            }
        )

        survivors = np.array([1, 2, 3])
        probs = np.asarray(model.expect_proba(0, survivors, ctx), dtype=float)

        self.assertEqual(len(probs), 3)
        self.assertGreater(probs[0], probs[2])
        self.assertGreater(probs[1], probs[2])

        debug = getattr(model, "_last_debug", {}) or {}
        self.assertEqual(debug.get("counts_context"), "type_body")
        self.assertEqual(debug.get("prior"), "type_body")


class TransferModelJoblibRegressionTest(unittest.TestCase):
    @unittest.skipUnless(
        "sklearn" in sys.modules and hasattr(sys.modules["sklearn"], "__version__"),
        "scikit-learn required",
    )
    def test_expect_proba_with_nt_returns_positive_nt_share(self) -> None:
        from ni_votes.models import load_transfer_model

        model = load_transfer_model(cache=False)
        ctx = {
            "party": np.array(["Alliance", "SDLP", "DUP"], dtype=object),
            "constituency": "Belfast East",
            "body": "Northern Ireland Assembly",
            "election_type": "Assembly",
            "count": 1,
            "is_elimination": 1,
            "is_surplus": 0,
            "tallies": np.array([1000.0, 800.0, 600.0], dtype=float),
            "initial_first": np.array([900.0, 500.0, 400.0], dtype=float),
            "alive": np.array([1, 1, 1], dtype=int),
            "ignore_priors": True,
        }

        probs, p_nt = model.expect_proba_with_nt(0, np.array([1, 2], dtype=int), ctx)

        self.assertGreater(p_nt, 0.0)
        total = float(probs.sum() + p_nt)
        self.assertGreater(total, 0.0)
        self.assertAlmostEqual(total, 1.0, places=6)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
