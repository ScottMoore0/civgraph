"""Put on PYTHONPATH by `intake parity` only, so the Python steps of both runs (the old command line
and the plugin) read the same time.time(). datetime.now() is left alone: replacing the datetime
class breaks pandas' C extension (it crashes on import), so a Python step that stamps a datetime
declares the stamp's JSON keys as `volatile` in its plugin instead."""
import os as _os
import time as _time
from datetime import datetime as _datetime

_EPOCH = _datetime.fromisoformat(_os.environ.get('INTAKE_FROZEN_CLOCK', '2026-01-01T00:00:00+00:00').replace('Z', '+00:00')).timestamp()
_time.time = lambda: _EPOCH
_time.time_ns = lambda: int(_EPOCH * 1e9)
