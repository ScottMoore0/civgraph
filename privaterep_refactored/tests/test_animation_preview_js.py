import subprocess
from pathlib import Path

def test_animation_preview_js():
    script = Path(__file__).parent / "js" / "animation_preview_lifecycle.test.js"
    result = subprocess.run(["node", str(script)], capture_output=True, text=True)
    assert result.returncode == 0, f"Node test failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
