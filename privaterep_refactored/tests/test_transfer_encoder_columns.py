from __future__ import annotations

import importlib
import os
import sys

import pytest


@pytest.mark.filterwarnings("ignore::FutureWarning")
def test_rare_categories_retain_onehot_columns():
    pd = pytest.importorskip("pandas")

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    # Ensure any sklearn stubs installed by other tests are cleared so we can
    # import the real encoders, but remember the previous modules so we can
    # restore them afterwards.
    previous_sklearn = {
        name: sys.modules[name]
        for name in list(sys.modules)
        if name.split(".")[0] == "sklearn"
    }
    for name in previous_sklearn:
        sys.modules.pop(name, None)

    try:
        sklearn = importlib.import_module("sklearn")
        preproc = importlib.import_module("sklearn.preprocessing")
        ohe_cls = getattr(preproc, "OneHotEncoder", None)
    except ImportError:
        sys.modules.update(previous_sklearn)
        pytest.skip("scikit-learn not available")
    if ohe_cls is None or not hasattr(ohe_cls, "fit"):
        # Restore stubs before skipping so downstream tests keep their expectations.
        for name in list(sys.modules):
            if name.split(".")[0] == "sklearn":
                sys.modules.pop(name, None)
        sys.modules.update(previous_sklearn)
        pytest.skip("sklearn preprocessing is stubbed")

    try:
        # Reload models_transfers so it is initialised with the real sklearn module.
        sys.modules.pop("ni_votes.models_transfers", None)
        mt = importlib.import_module("ni_votes.models_transfers")
        _fit_coders = getattr(mt, "_fit_coders")

        df = pd.DataFrame(
            {
                "donor_party": ["Alliance"] * 5 + ["Ind"],
                "recipient_party": ["Alliance"] * 5 + ["Green"],
                "constituency": ["North Belfast"] * 5 + ["Newry"],
            }
        )

        enc, svd, encoded = _fit_coders(df)

        feature_names = enc.get_feature_names_out(df.columns)

        assert "donor_party_Ind" in feature_names
        assert "recipient_party_Green" in feature_names
        assert "constituency_Newry" in feature_names
        assert not any(name.endswith("infrequent_sklearn") for name in feature_names)

        infreq = getattr(enc, "infrequent_categories_", None)
        if infreq is not None:
            assert all((cats is None) or len(cats) == 0 for cats in infreq)

        assert encoded.shape[0] == df.shape[0]
    finally:
        # Remove the real sklearn modules and restore whatever was present before.
        for name in list(sys.modules):
            if name.split(".")[0] == "sklearn":
                sys.modules.pop(name, None)
        sys.modules.update(previous_sklearn)
