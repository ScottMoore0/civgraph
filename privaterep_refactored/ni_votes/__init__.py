"""Public package interface for the ``ni_votes`` toolkit."""

from ._compat_numpy import ensure_numpy_mt19937_compat as _ensure_numpy_mt19937_compat

# Ensure legacy NumPy pickles can be deserialized as soon as the package loads.
_ensure_numpy_mt19937_compat()

__all__ = ()
