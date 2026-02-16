
from time import perf_counter
from typing import Optional
class Progress:
    def __init__(self, name: str, total: Optional[int] = None, min_interval_sec: float = 1.0):
        self.name=name; self.total=total; self.done=0
        self.start_t=perf_counter(); self.last_t=self.start_t; self.min_interval=min_interval_sec
    def tick(self, inc: int=1, extra: str=""):
        from time import perf_counter as _pc
        self.done += inc; now=_pc()
        if now - self.last_t >= self.min_interval:
            self.last_t=now; pct=(100.0*self.done/self.total) if self.total else None; elapsed=now-self.start_t
            msg=f"[{self.name}] {self.done}/{self.total if self.total else '?'}"
            if pct is not None: msg += f" ({pct:5.1f}%)"
            msg += f" elapsed {elapsed:6.1f}s"; 
            if extra: msg += f" | {extra}"
            print(msg, flush=True)
    def end(self, note: str=""):
        from time import perf_counter as _pc
        total_t=_pc()-self.start_t; msg=f"[{self.name}] done in {total_t:0.1f}s"
        if note: msg += f" | {note}"
        print(msg, flush=True)
