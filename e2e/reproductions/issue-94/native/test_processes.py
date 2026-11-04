"""Exercise cleanup after a browser exits without running its proxy finally block."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from runtime import NativeStack


class DetachedCleanupTest(unittest.TestCase):
    """Use real detached processes and private files, keeping an unrelated process alive."""

    def test_abrupt_browser_exit_reaps_owned_proxy_and_private_certificates(self):
        """Stop an escaped root-owned executable while preserving a foreign argv lookalike."""
        with tempfile.TemporaryDirectory() as evidence:
            stack = NativeStack(evidence)
            executable = stack.root / 'proxy-venv/bin/python'
            executable.parent.mkdir(parents=True)
            executable.symlink_to(sys.executable)
            certificate = stack.root / 'browser-temp/test-mitmproxy-owned/owned-cert-marker'
            certificate.parent.mkdir(parents=True)
            certificate.write_text('test-only temporary certificate marker')
            owned = subprocess.Popen([str(executable), '-c', 'import time; time.sleep(30)'], start_new_session=True)
            other = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)', str(stack.root)], start_new_session=True)
            try:
                stack.stop()
                owned.wait(timeout=5)
                self.assertIsNone(other.poll())
                self.assertFalse(stack.root.exists())
                cleanup = json.loads(Path(evidence, 'native-cleanup.json').read_text())
                self.assertIn(owned.pid, cleanup['detachedOwnedExecutablesReaped'])
                self.assertEqual(cleanup['errors'], [])
            finally:
                for child in [owned, other]:
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
