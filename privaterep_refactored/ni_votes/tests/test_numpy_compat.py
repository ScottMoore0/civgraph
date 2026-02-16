from __future__ import annotations

import sys

import pytest


def test_mt19937_shim(monkeypatch):
    pytest.importorskip("numpy", reason="NumPy not installed")
    import numpy.random._pickle as _pickle

    legacy_name = "numpy.random._mt19937"
    monkeypatch.delitem(sys.modules, legacy_name, raising=False)
    alias = f"{legacy_name}.MT19937"

    monkeypatch.delitem(_pickle.BitGenerators, alias, raising=False)
    legacy_dict = getattr(_pickle, "LEGACY_BIT_GENERATORS", None)
    if isinstance(legacy_dict, dict):
        monkeypatch.delitem(legacy_dict, alias, raising=False)

    from ni_votes._compat_numpy import ensure_numpy_mt19937_compat

    assert ensure_numpy_mt19937_compat() is True

    import numpy.random._mt19937 as legacy

    assert _pickle.BitGenerators[alias] is legacy.MT19937
    assert _pickle.BitGenerators["MT19937"] is legacy.MT19937
    legacy_dict = getattr(_pickle, "LEGACY_BIT_GENERATORS", None)
    if isinstance(legacy_dict, dict):
        assert legacy_dict[alias] is legacy.MT19937
        assert legacy_dict["MT19937"] is legacy.MT19937

    import numpy.random.bit_generator as bit_generator

    legacy_allow = getattr(bit_generator.BitGenerator, "_LEGACY_GENERATORS", None)
    if isinstance(legacy_allow, dict):
        assert legacy_allow[alias] is legacy.MT19937
        assert legacy_allow["MT19937"] is legacy.MT19937


def test_referendum_loader_retries_on_mt19937(monkeypatch):
    pytest.importorskip("numpy", reason="NumPy not installed")
    # Reload the loader module to ensure a clean state for the test.
    import importlib

    loader = importlib.import_module("ni_votes.models._referendum_model_loader")
    importlib.reload(loader)

    sentinel = object()
    calls = {"count": 0}

    def fake_load(*args, **kwargs):  # type: ignore[override]
        calls["count"] += 1
        if calls["count"] == 1:
            raise TypeError("<class 'numpy.random._mt19937.MT19937'> is not a known BitGenerator module")
        return sentinel

    monkeypatch.setattr(loader, "joblib", type("JL", (), {"load": staticmethod(fake_load)})())
    monkeypatch.setattr(loader, "_MODEL_CACHE", None, raising=False)
    monkeypatch.setattr(loader, "_load_joblib_bytes", lambda: b"placeholder")

    result = loader.load_referendum_model(cache=False)

    assert result is sentinel
    assert calls["count"] == 2

