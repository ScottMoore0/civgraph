"""Tests for the referendum model loader compatibility shim."""

import importlib
import sys
import types
from pathlib import Path

import pytest

# Ensure the project root is importable even when running the test suite in
# isolation from a different working directory (e.g. CI temp dirs).
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.mark.slow
def test_referendum_model_loads_without_legacy_numpy_module(tmp_path):
    """The packaged referendum model should load without the legacy module."""
    # Skip if NumPy is unavailable in the current environment.
    pytest.importorskip("numpy")
    pytest.importorskip("joblib")
    pytest.importorskip("pandas")
    pytest.importorskip("sklearn")

    # Ensure the legacy private module is absent to mimic NumPy 2.x layouts.
    legacy_module = "numpy.random._mt19937"
    legacy_module_obj = sys.modules.pop(legacy_module, None)
    importlib.invalidate_caches()

    loader = importlib.import_module("ni_votes.models._referendum_model_loader")

    # Clear any cached estimator or metadata so the loader has to touch joblib again.
    loader._MODEL_CACHE = None  # type: ignore[attr-defined]
    loader._META_CACHE = None  # type: ignore[attr-defined]

    try:
        model = loader.load_referendum_model(cache=False)
        meta = loader.load_referendum_meta(cache=False)

        # The compatibility shim should have registered the legacy module path.
        assert legacy_module in sys.modules
        assert hasattr(sys.modules[legacy_module], "MT19937")
        # The public numpy.random namespace should also expose MT19937 for imports.
        import numpy.random as np_random

        assert getattr(np_random, "MT19937", None) is not None
        assert getattr(np_random.mtrand, "MT19937", None) is not None
        import numpy.random._pickle as _pickle

        assert _pickle.BitGenerators["MT19937"] is np_random.MT19937

        # Basic smoke-check: the estimator and metadata contain expected attributes.
        assert hasattr(model, "predict_proba_rows")
        assert meta.get("bundle_version") == 1
    finally:
        # Restore the original legacy module (if any) to avoid cross-test pollution.
        if legacy_module_obj is not None:
            sys.modules[legacy_module] = legacy_module_obj


def test_ensure_numpy_mt19937_compat_falls_back_when_private_module_missing(monkeypatch):
    """The compatibility shim should work even if the private module vanished."""

    numpy = pytest.importorskip("numpy")
    pytest.importorskip("joblib")

    from ni_votes._compat_numpy import ensure_numpy_mt19937_compat

    original_import_module = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "numpy.random._mt19937":
            raise ModuleNotFoundError(name)
        return original_import_module(name, *args, **kwargs)

    monkeypatch.setattr(importlib, "import_module", fake_import)

    legacy_module = "numpy.random._mt19937"
    sys.modules.pop(legacy_module, None)
    importlib.invalidate_caches()

    assert ensure_numpy_mt19937_compat() is True

    shim = sys.modules.get(legacy_module)
    assert shim is not None
    assert getattr(shim, "MT19937", None) is numpy.random.MT19937


def test_ensure_numpy_mt19937_handles_read_only_tables(monkeypatch):
    """Read-only BitGenerator tables should be replaced with mutable copies."""

    numpy = pytest.importorskip("numpy")
    pytest.importorskip("joblib")

    from ni_votes._compat_numpy import ensure_numpy_mt19937_compat

    import numpy.random._pickle as _pickle
    monkeypatch.setattr(_pickle, "BitGenerators", types.MappingProxyType(dict(_pickle.BitGenerators)))
    legacy = getattr(_pickle, "LEGACY_BIT_GENERATORS", {})
    monkeypatch.setattr(
        _pickle,
        "LEGACY_BIT_GENERATORS",
        types.MappingProxyType(dict(legacy)),
        raising=False,
    )

    sys.modules.pop("numpy.random._mt19937", None)
    importlib.invalidate_caches()

    assert ensure_numpy_mt19937_compat() is True

    assert isinstance(_pickle.BitGenerators, dict)
    assert "numpy.random._mt19937.MT19937" in _pickle.BitGenerators
    assert numpy.random.MT19937 in _pickle.BitGenerators

    legacy_table = getattr(_pickle, "LEGACY_BIT_GENERATORS", {})
    assert isinstance(legacy_table, dict)
    assert "numpy.random._mt19937.MT19937" in legacy_table
    assert numpy.random.MT19937 in legacy_table


def test_normalise_legacy_state_tuple():
    pytest.importorskip("joblib")
    module = importlib.import_module("ni_votes.models._referendum_model_loader")
    fixer = getattr(module, "_normalize_legacy_mt19937_state")

    legacy = ("numpy.random._mt19937.MT19937", [1, 2, 3], 0, 0, 0.0)
    rewritten = fixer(legacy)

    assert rewritten[0] == "MT19937"
    assert rewritten[1:] == legacy[1:]


def test_normalise_legacy_state_dict():
    pytest.importorskip("joblib")
    module = importlib.import_module("ni_votes.models._referendum_model_loader")
    fixer = getattr(module, "_normalize_legacy_mt19937_state")

    legacy = {
        "bit_generator": "numpy.random._mt19937.MT19937",
        "state": {"bit_generator": "numpy.random._mt19937.MT19937", "foo": 1},
    }

    rewritten = fixer(legacy)

    assert rewritten["bit_generator"] == "MT19937"
    assert rewritten["state"]["bit_generator"] == "MT19937"


def test_loader_retries_on_legacy_state_message(monkeypatch):
    pytest.importorskip("numpy")
    joblib = pytest.importorskip("joblib")

    module = importlib.import_module("ni_votes.models._referendum_model_loader")

    calls = {"count": 0}

    def fake_load(obj, *args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise ValueError("state is not a legacy MT19937 state")
        return "ok"

    monkeypatch.setattr(joblib, "load", fake_load)

    result = module._joblib_load_with_compat(b"fake")

    assert result == "ok"
    assert calls["count"] == 2


def test_loader_normalises_state_before_retry(monkeypatch):
    pytest.importorskip("numpy")
    joblib = pytest.importorskip("joblib")

    module = importlib.import_module("ni_votes.models._referendum_model_loader")

    # Reload to ensure a clean module state for monkeypatching.
    module = importlib.reload(module)

    legacy_state = ("numpy.random._mt19937.MT19937", [1, 2, 3], 0, 0, 0.0)
    received_states = []

    import numpy.random.mtrand as mtrand

    class DummyRandomState:
        def __setstate__(self, state, *args, **kwargs):
            received_states.append(state)
            return "handled"

    monkeypatch.setattr(mtrand, "RandomState", DummyRandomState, raising=False)

    calls = {"count": 0}

    def fake_load(obj, *args, **kwargs):  # type: ignore[override]
        calls["count"] += 1
        if calls["count"] == 1:
            raise ValueError("state is not a legacy MT19937 state")
        rs = mtrand.RandomState()
        rs.__setstate__(legacy_state)
        return "ok"

    monkeypatch.setattr(joblib, "load", fake_load)

    result = module._joblib_load_with_compat(b"payload")

    assert result == "ok"
    assert calls["count"] == 2
    assert received_states
    assert received_states[0][0] == "MT19937"

