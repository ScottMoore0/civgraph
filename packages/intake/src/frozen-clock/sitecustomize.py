"""Put on PYTHONPATH by `intake parity` (and `intake run --offline`) only.

With INTAKE_FROZEN_CLOCK set (parity, unless --live-clock), the Python steps of both runs (the old
command line and the plugin) read the same time.time(). datetime.now() is left alone: replacing
the datetime class breaks pandas' C extension (it crashes on import), so a Python step that stamps
a datetime declares the stamp's JSON keys as `volatile` in its plugin instead.

With INTAKE_OFFLINE=1 (--offline), every socket connection and name lookup raises, so a network
step replays from what it has cached or fails loudly; nothing reaches a live source. Programs the
step starts that are not Python or Node (curl, PowerShell) are not covered: --offline refuses
bash and PowerShell steps for that reason."""
import os as _os

if 'INTAKE_FROZEN_CLOCK' in _os.environ:
    import time as _time
    from datetime import datetime as _datetime

    _EPOCH = _datetime.fromisoformat(_os.environ['INTAKE_FROZEN_CLOCK'].replace('Z', '+00:00')).timestamp()
    _time.time = lambda: _EPOCH
    _time.time_ns = lambda: int(_EPOCH * 1e9)

if _os.environ.get('INTAKE_OFFLINE') == '1':
    import socket as _socket

    def _refuse(what):
        def refused(*args, **kwargs):
            raise OSError('INTAKE_OFFLINE: %s %r refused (an offline replay: the step must work from its cache)' % (what, args[:2]))
        return refused

    _socket.socket.connect = _refuse('socket.connect')
    _socket.socket.connect_ex = _refuse('socket.connect_ex')
    _socket.create_connection = _refuse('socket.create_connection')
    _socket.getaddrinfo = _refuse('socket.getaddrinfo')
    _socket.gethostbyname = _refuse('socket.gethostbyname')
    _socket.gethostbyname_ex = _refuse('socket.gethostbyname_ex')
