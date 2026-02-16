import subprocess
from pathlib import Path

def test_transfer_slice_alignment_js():
    script = Path(__file__).parent / "js" / "transfer_slice_alignment.test.js"
    result = subprocess.run(["node", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, f"Node test failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
