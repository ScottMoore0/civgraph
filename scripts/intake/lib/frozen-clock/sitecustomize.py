"""Put on PYTHONPATH by `intake parity` only: every Python step of both runs (the old command line
and the plugin) sees the same wall clock, so a generated-at stamp cannot make two otherwise
identical outputs differ. time.monotonic and time.perf_counter (durations, rate limits) and date.today are untouched."""
import datetime as _dt
import os as _os
import time as _time

_FIXED = _dt.datetime.fromisoformat(_os.environ.get('INTAKE_FROZEN_CLOCK', '2026-01-01T00:00:00+00:00').replace('Z', '+00:00'))
_EPOCH = _FIXED.timestamp()


class _FrozenDateTime(_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromtimestamp(_EPOCH, tz)

    @classmethod
    def utcnow(cls):
        return cls.fromtimestamp(_EPOCH, _dt.timezone.utc).replace(tzinfo=None)

    @classmethod
    def today(cls):
        return cls.fromtimestamp(_EPOCH)


_dt.datetime = _FrozenDateTime
_time.time = lambda: _EPOCH
_time.time_ns = lambda: int(_EPOCH * 1e9)
