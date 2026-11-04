"""Reap detached executables from this run's private root after abrupt browser exit."""
import os
import signal
import subprocess
import time


def owned_executables(root):
    """Match the executable's exact private-root prefix, never arbitrary command arguments."""
    found = []
    for line in subprocess.check_output(['ps', '-axo', 'pid=,stat=,command='], text=True).splitlines():
        fields = line.strip().split(maxsplit=2)
        if len(fields) == 3 and not fields[1].startswith('Z') and fields[2].startswith(str(root) + '/'):
            found.append(int(fields[0]))
    return found


def signal_owned(root, signum):
    """Recheck executable ownership immediately before signaling each surviving process."""
    found = owned_executables(root)
    for pid in found:
        try:
            os.kill(pid, signum)
        except ProcessLookupError:
            pass
    return found


def await_exit(root):
    """Bound cleanup even when a detached proxy ignores its first signal."""
    deadline = time.monotonic() + 1
    while owned_executables(root) and time.monotonic() < deadline:
        time.sleep(0.05)


def stop_detached(root):
    """Return owned detached PIDs reaped without touching other runs or executables."""
    found = signal_owned(root, signal.SIGTERM)
    await_exit(root)
    signal_owned(root, signal.SIGKILL)
    await_exit(root)
    if owned_executables(root):
        raise RuntimeError('Detached owned native executable cleanup failed')
    return found
