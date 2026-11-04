"""Real TCP regression for consecutive native runs and foreign listener ownership."""
import socket
import unittest

from ports import available


class NativePortTests(unittest.TestCase):
    """Use real sockets so a timing-state regression cannot be hidden by mocks."""

    def test_rejects_a_live_listener(self):
        """A reuse-capable listener still owns its address exclusively."""
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(('127.0.0.1', 0))
            server.listen()
            self.assertFalse(available(server.getsockname()[1]))

    def test_accepts_time_wait_after_completed_connection(self):
        """A server that actively closed its last connection can be restarted immediately."""
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(('127.0.0.1', 0))
            server.listen()
            address = server.getsockname()
            with socket.create_connection(address, timeout=2) as client:
                accepted, _ = server.accept()
                accepted.close()
                self.assertEqual(client.recv(1), b'')
        with socket.socket() as old_probe:
            with self.assertRaises(OSError):
                old_probe.bind(address)
        self.assertTrue(available(address[1]))
