# ni_votes/simulate/__init__.py
from .engine import run_scenario
from .referendum import (
    run_referendum_simulation,
    ReferendumSimulationConfig,
    ReferendumSimulationResult,
    AreaResult,
    OptionResult,
)

__all__ = [
    "run_scenario",
    "run_referendum_simulation",
    "ReferendumSimulationConfig",
    "ReferendumSimulationResult",
    "AreaResult",
    "OptionResult",
]
