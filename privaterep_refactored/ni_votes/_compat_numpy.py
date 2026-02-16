"""Compatibility helpers for NumPy version differences."""

from __future__ import annotations

import importlib
import sys
import types
from typing import Iterable, Optional, Tuple, Type


def _import_first(*candidates: str):
    """Return the first successfully imported module from *candidates*."""

    for name in candidates:
        try:
            return importlib.import_module(name)
        except Exception:  # pragma: no cover - module not present
            continue
    raise ImportError(candidates[0])


def _locate_mt19937_class() -> Optional[Type[object]]:
    """Return the ``MT19937`` class from any available NumPy module."""

    candidates = (
        "numpy.random._mt19937",
        "numpy.random._bit_generator",
        "numpy.random.bit_generator",
        "numpy.random._generator",
        "numpy.random",
    )
    for name in candidates:
        try:
            module = importlib.import_module(name)
        except Exception:  # pragma: no cover - structure changed
            continue
        cls = getattr(module, "MT19937", None)
        if isinstance(cls, type):
            return cls
    return None


def ensure_numpy_mt19937_compat() -> bool:
    """Expose the legacy ``numpy.random._mt19937`` module path if possible.

    The shim recreates the private module (or re-exports the public class) so
    deserialisers that expect ``numpy.random._mt19937.MT19937`` can still import
    the bit generator when running on NumPy 2.x.  It also seeds the alias
    tables that NumPy and Joblib consult during unpickling.  The helper is
    intentionally limited to import/module aliasing – it does **not** attempt to
    validate or coerce RNG state payloads.  Callers must still normalise legacy
    ``RandomState`` data themselves (see :mod:`ni_votes.models` loader) when
    NumPy raises ``ValueError: state is not a legacy MT19937 state``.
    """

    module_name = "numpy.random._mt19937"

    existing = sys.modules.get(module_name)
    mt19937_cls = getattr(existing, "MT19937", None) if existing is not None else None

    if not isinstance(mt19937_cls, type):
        mt19937_cls = _locate_mt19937_class()
        if mt19937_cls is None:
            return False

    shim = sys.modules.get(module_name)
    if shim is None or not isinstance(getattr(shim, "MT19937", None), type):
        shim = types.ModuleType(module_name)
        sys.modules[module_name] = shim
    shim.MT19937 = mt19937_cls

    origin_module = getattr(mt19937_cls, "__module__", module_name) or module_name

    alias_candidates: Tuple[str, ...] = (
        module_name,
        f"{module_name}.MT19937",
        origin_module,
        f"{origin_module}.MT19937",
        "MT19937",
        "numpy.random",
        "numpy.random.MT19937",
        "numpy.random._generator",
        "numpy.random._generator.MT19937",
        "numpy.random.generator",
        "numpy.random.generator.MT19937",
        "numpy.random.mtrand",
        "numpy.random.mtrand.MT19937",
        "numpy.random._mtrand",
        "numpy.random._mtrand.MT19937",
        "numpy.random.bit_generator",
        "numpy.random.bit_generator.MT19937",
        "numpy.random._bit_generator",
        "numpy.random._bit_generator.MT19937",
    )

    def _unique_aliases(values: Iterable[str]) -> Tuple[str, ...]:
        seen = set()
        result = []
        for value in values:
            if value and value not in seen:
                seen.add(value)
                result.append(value)
        return tuple(result)

    aliases = _unique_aliases(alias_candidates)
    # Also register the class object directly for NumPy builds that expect
    # ``BitGenerators`` to map class objects rather than dotted names.
    alias_objects: Tuple[object, ...] = tuple({mt19937_cls})

    def _ensure_mutable_mapping(container, attr: str) -> Optional[dict]:
        if container is None:
            return None
        table = getattr(container, attr, None)
        if table is None:
            table = {}
            try:
                setattr(container, attr, table)
            except Exception:  # pragma: no cover - attribute may be read-only
                return None
            return table
        if isinstance(table, dict):
            return table
        # Some NumPy builds expose mappingproxy instances – clone them.
        try:
            cloned = dict(table)
        except Exception:  # pragma: no cover - mapping without items()
            try:
                cloned = dict(getattr(table, "items")())
            except Exception:
                return None
        try:
            setattr(container, attr, cloned)
        except Exception:  # pragma: no cover - attribute may be read-only
            return None
        return cloned

    try:
        _pickle = _import_first("numpy.random._pickle")
    except Exception:  # pragma: no cover - structure changed
        _pickle = None
    if _pickle is not None:
        for table_name in ("BitGenerators", "LEGACY_BIT_GENERATORS"):
            table = _ensure_mutable_mapping(_pickle, table_name)
            if table is None:
                continue
            for alias in aliases:
                table.setdefault(alias, mt19937_cls)
            for alias_obj in alias_objects:
                table.setdefault(alias_obj, mt19937_cls)

    module_alias_targets = (
        "numpy.random",
        "numpy.random._generator",
        "numpy.random.generator",
        "numpy.random.mtrand",
        "numpy.random._mtrand",
        "numpy.random.bit_generator",
        "numpy.random._bit_generator",
    )

    for mod_name in module_alias_targets:
        try:
            target = importlib.import_module(mod_name)
        except Exception:  # pragma: no cover - module may not exist
            continue
        try:
            setattr(target, "MT19937", mt19937_cls)
        except Exception:  # pragma: no cover - attribute may be read-only
            pass

        if mod_name in {"numpy.random.bit_generator", "numpy.random._bit_generator"}:
            bitgen_cls = getattr(target, "BitGenerator", None)
            if isinstance(bitgen_cls, type):
                legacy = _ensure_mutable_mapping(bitgen_cls, "_LEGACY_GENERATORS")
                if legacy is not None:
                    for alias in aliases:
                        legacy.setdefault(alias, mt19937_cls)
                    for alias_obj in alias_objects:
                        legacy.setdefault(alias_obj, mt19937_cls)

    return True


__all__ = ["ensure_numpy_mt19937_compat"]

