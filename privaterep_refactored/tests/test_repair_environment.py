"""Integration checks for the ``repair_environment`` helper script."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.slow
def test_repair_environment_workflow_succeeds(tmp_path):
    """The repair workflow should complete successfully on supported setups."""

    # Skip the check if the optional heavy dependencies are unavailable. The
    # script needs them to deserialize the bundled referendum model during the
    # verification step.
    pytest.importorskip("numpy")
    pytest.importorskip("joblib")
    pytest.importorskip("pandas")
    pytest.importorskip("sklearn")

    log_path = tmp_path / "repair.log"

    cmd = [
        sys.executable,
        "-m",
        "repair_environment",
        "--skip-install",
        "--skip-clear-cache",
        "--log-file",
        str(log_path),
    ]

    completed = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )

    assert (
        completed.returncode == 0
    ), f"repair_environment failed: {completed.stdout}\n{completed.stderr}"
    assert log_path.exists(), "repair_environment did not write the expected log file"
