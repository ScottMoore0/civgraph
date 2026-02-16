"""Utilities for loading the bundled transfer model without binary blobs."""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Optional

import joblib

from ..features.transfers.encoders import TransferModel

_B64_FILENAME = "NI-transfer-model.joblib.b64"
_B64_PATH = Path(__file__).with_name(_B64_FILENAME)
_CACHE: Optional[TransferModel] = None


def _load_joblib_bytes() -> bytes:
    text = _B64_PATH.read_text(encoding="ascii")
    payload = "".join(line.strip() for line in text.splitlines())
    return base64.b64decode(payload.encode("ascii"))


def load_transfer_model(*, cache: bool = True) -> TransferModel:
    """Return the bundled :class:`TransferModel` from the base64 artefact."""
    global _CACHE
    if cache and _CACHE is not None:
        return _CACHE
    model = joblib.load(io.BytesIO(_load_joblib_bytes()))
    if cache:
        _CACHE = model
    return model


def materialise_joblib(path: Optional[Path] = None) -> Path:
    """Write the joblib artefact to ``path`` and return it.

    If ``path`` is omitted the function will emit the decoded artefact alongside
    the encoded payload using the historical ``.joblib`` name.  The decoded file
    is overwritten if it already exists to ensure downstream tooling receives an
    up to date copy.
    """
    if path is None:
        path = Path(__file__).with_name("NI-transfer-model.joblib")
    path.write_bytes(_load_joblib_bytes())
    return path
