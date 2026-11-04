"""Probe loopback listener availability with the same reuse semantics as Flask."""
import socket


def available(port):
    """Reject live listeners while allowing a completed connection's TIME_WAIT socket."""
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            server.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def unused():
    """Request an ephemeral loopback port without leaving a listener behind."""
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        return server.getsockname()[1]
