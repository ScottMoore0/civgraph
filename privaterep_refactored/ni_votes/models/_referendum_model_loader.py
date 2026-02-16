from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Mapping

import contextlib
import joblib
from .._compat_numpy import ensure_numpy_mt19937_compat


_RETRY_TOKENS = (
    "numpy.random._mt19937.MT19937",
    "is not a known BitGenerator",
    "state is not a legacy MT19937 state",
)


def _normalize_legacy_mt19937_state(state):
    """Return *state* rewritten with public MT19937 aliases where possible."""

    try:
        from collections.abc import Mapping
    except ImportError:  # pragma: no cover - Python < 3.10 support
        Mapping = dict  # type: ignore[assignment]

    if isinstance(state, tuple) and state:
        head, *rest = state
        if isinstance(head, str) and "MT19937" in head and head != "MT19937":
            return ("MT19937", *rest)
        return state

    if isinstance(state, Mapping):
        bitgen = state.get("bit_generator")
        if isinstance(bitgen, str) and "MT19937" in bitgen and bitgen != "MT19937":
            rewritten = dict(state)
            rewritten["bit_generator"] = "MT19937"
            inner_state = rewritten.get("state")
            if isinstance(inner_state, Mapping):
                inner_state = dict(inner_state)
                if isinstance(inner_state.get("bit_generator"), str) and inner_state["bit_generator"] != "MT19937":
                    inner_state["bit_generator"] = "MT19937"
                rewritten["state"] = inner_state
            return rewritten

    return state


def _joblib_load_with_compat(source) -> object:
    """Load *source* via :mod:`joblib` after ensuring NumPy MT19937 compat."""

    ensure_numpy_mt19937_compat()

    data_or_path = source
    if isinstance(source, (bytes, bytearray)):
        # ``joblib.load`` consumes file-like objects. Keep a pristine copy so
        # fallback attempts can recreate a fresh ``BytesIO`` wrapper.
        data_or_path = bytes(source)

    def _joblib_load(obj):
        if isinstance(obj, (bytes, bytearray)):
            return joblib.load(io.BytesIO(obj))
        return joblib.load(obj)

    try:
        return _joblib_load(data_or_path)
    except (TypeError, ValueError) as exc:
        message = str(exc)
        if not any(token in message for token in _RETRY_TOKENS):
            raise

        # Some NumPy builds keep legacy BitGenerator aliases in private tables
        # that cannot be reassigned directly (e.g. mappingproxy instances or
        # missing setters on C-backed classes). Retry the load with an
        # aggressive shim that rewrites the unpickler's class resolver.
        ensure_numpy_mt19937_compat()

        try:
            from joblib import numpy_pickle as _np_pickle
        except Exception:  # pragma: no cover - unexpected joblib layout
            raise

        original_find_class = _np_pickle.NumpyUnpickler.find_class

        def _patched_find_class(self, module, name):
            if module == "numpy.random._mt19937" and name == "MT19937":
                import numpy.random as _np_random

                return _np_random.MT19937
            return original_find_class(self, module, name)

        with contextlib.ExitStack() as stack:
            stack.callback(setattr, _np_pickle.NumpyUnpickler, "find_class", original_find_class)
            _np_pickle.NumpyUnpickler.find_class = _patched_find_class

            try:
                import numpy.random.mtrand as _np_mtrand
            except Exception:  # pragma: no cover - module unavailable
                _np_mtrand = None

            random_state_cls = getattr(_np_mtrand, "RandomState", None) if _np_mtrand is not None else None
            if isinstance(random_state_cls, type):
                original_setstate = getattr(random_state_cls, "__setstate__", None)
                if callable(original_setstate):

                    def _patched_setstate(self, state, *args, **kwargs):
                        normalized = _normalize_legacy_mt19937_state(state)
                        return original_setstate(self, normalized, *args, **kwargs)

                    stack.callback(setattr, random_state_cls, "__setstate__", original_setstate)
                    random_state_cls.__setstate__ = _patched_setstate
            return _joblib_load(data_or_path)

_B64_FILENAME = "NI-referendum-model.joblib.b64"
_META_FILENAME = "NI-referendum-model.meta.json"
_B64_PATH = Path(__file__).with_name(_B64_FILENAME)
_META_PATH = Path(__file__).with_name(_META_FILENAME)

_MODEL_CACHE = None
_META_CACHE: Optional[Dict[str, Any]] = None


def _load_joblib_bytes() -> bytes:
    text = _B64_PATH.read_text(encoding="ascii")
    payload = "".join(line.strip() for line in text.splitlines())
    return base64.b64decode(payload.encode("ascii"))


def load_referendum_model(*, cache: bool = True):
    """Return the packaged referendum model instance."""
    global _MODEL_CACHE
    if cache and _MODEL_CACHE is not None:
        return _MODEL_CACHE
    payload = _load_joblib_bytes()
    model = _joblib_load_with_compat(payload)
    if cache:
        _MODEL_CACHE = model
    return model


def load_referendum_meta(*, cache: bool = True) -> Dict[str, Any]:
    """Return the packaged referendum metadata dictionary."""
    global _META_CACHE
    if cache and _META_CACHE is not None:
        return _META_CACHE
    meta = json.loads(_META_PATH.read_text(encoding="utf-8"))
    if cache:
        _META_CACHE = meta
    return meta


def load_referendum_model_and_meta(*, cache: bool = True) -> Tuple[Any, Dict[str, Any]]:
    """Convenience wrapper that returns both the model and metadata."""
    model = load_referendum_model(cache=cache)
    meta = load_referendum_meta(cache=cache)
    return model, meta



def is_referendum_meta_compatible(candidate: Mapping[str, Any], reference: Mapping[str, Any]) -> bool:
    """Return True if *candidate* metadata matches the packaged reference."""
    if not isinstance(candidate, Mapping):
        return False
    try:
        if candidate.get("bundle_version") != reference.get("bundle_version"):
            return False
        for key in ("options", "feat_cols", "target_cols"):
            if candidate.get(key) != reference.get(key):
                return False
    except Exception:
        return False
    return True


def resolve_referendum_model_and_meta(
    model_path: Optional[Path] = None,
    meta_path: Optional[Path] = None,
    *,
    cache: bool = True,
) -> Tuple[Any, Dict[str, Any]]:
    """Load a referendum model/metadata pair with packaged fallback."""
    reference_meta = load_referendum_meta(cache=cache)
    model_path_obj: Optional[Path] = None
    if model_path is not None:
        model_path_obj = Path(model_path)
        if not model_path_obj.exists() or not model_path_obj.is_file():
            model_path_obj = None
    meta_path_obj: Optional[Path] = None
    if meta_path is not None:
        meta_path_obj = Path(meta_path)
        if not meta_path_obj.exists() or not meta_path_obj.is_file():
            meta_path_obj = None
    candidate_meta: Optional[Dict[str, Any]] = None
    if meta_path_obj is not None:
        try:
            candidate_meta = json.loads(meta_path_obj.read_text(encoding="utf-8"))
        except Exception:
            candidate_meta = None
    if model_path_obj is not None and candidate_meta is not None:
        if is_referendum_meta_compatible(candidate_meta, reference_meta):
            try:
                model = _joblib_load_with_compat(model_path_obj)
            except Exception:
                pass
            else:
                return model, candidate_meta
    return load_referendum_model_and_meta(cache=cache)


def materialise_referendum_joblib(path: Optional[Path] = None) -> Path:
    """Write the decoded referendum joblib artefact to ``path`` and return it."""
    if path is None:
        path = Path(__file__).with_name("NI-referendum-model.joblib")
    path.write_bytes(_load_joblib_bytes())
    return path
