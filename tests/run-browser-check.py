"""Run the browser integration fixture and clean up its Node process on Windows too."""
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

root = Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', str(root / 'tests/browser-server.mjs')], cwd=root)
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError('Integration server exited. Check that ports 18096 and 18097 are free.')
        try:
            with urllib.request.urlopen('http://127.0.0.1:18096/api/health', timeout=1):
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Integration server did not become ready.')
    result = subprocess.run([sys.executable, '-u', str(root / 'tests/browser-check.py')], cwd=root)
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
sys.exit(result.returncode)
