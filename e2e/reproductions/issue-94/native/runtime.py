"""Run a single pre-fix coin case against owned native services, without Docker."""

import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from ports import available


SOURCES = {
    "texas": ("texas_holdem_flask", "def3a1291c4ef0add64b46cc302d2ea730425675"),
    "gateway": ("centrifugo_gateway_flask", "e9be071eff77e1c767e63e36288935830b6dc6d3"),
    "room": ("room_sanic", "ff4aec30f80c7f21916be7618e24e7c20f5f81b2"),
    "buyin": ("buy_in_flask", "2e47cc9e0df18b66bb140071c13439ed8a0eea40"),
    "matching": ("hall_matching_flask", "e0e0b760976fc98bf8958b2d7cfd1cd26789606d"),
}
PROJECTORS = [
    ["end_ready_phase_later_projector"],
    ["begin_play_later_projector"],
    ["next_game_later_projector"],
    ["operate_later_projector", "A"],
    ["operate_later_projector", "B"],
]
HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]


def harness_fingerprints():
    """Capture the exact files loaded by this native implementation."""
    return {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
            for file in HERE.iterdir() if file.is_file()}


class NativeStack:
    """Own all processes, Redis data, private configuration and detached source trees."""

    def __init__(self, evidence):
        """Allocate a private runtime directory; keep only sanitized evidence externally."""
        self.root = Path(tempfile.mkdtemp(prefix="clrn-issue94-native-"))
        self.root.chmod(0o700)
        self.evidence = Path(evidence).resolve()
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.children, self.handles, self.worktrees = [], [], []
        self.environment = {**os.environ, "ISSUE94_NATIVE_ROOT": str(self.root)}
        private_inputs = {"GITHUB_TOKEN", "TESTING_API_TOKEN", "E2E_TEST_USERNAME", "E2E_TEST_PASSWORD",
                          "ISSUE94_PEER_USERNAME", "ISSUE94_PEER_PASSWORD"}
        self.service_environment = {key: value for key, value in self.environment.items() if key not in private_inputs}
        self.state = None
        self.provenance = {"services": {}, "tools": {}, "harness": harness_fingerprints()}

    def check(self, arguments, cwd=None, name="prepare"):
        """Run setup without exposing configuration or authenticated command output."""
        with (self.root / "logs" / (name + ".log")).open("ab") as output:
            subprocess.run(arguments, cwd=cwd, env=self.environment, check=True,
                           stdout=output, stderr=subprocess.STDOUT)

    def launch(self, name, arguments):
        """Start an owned process group and keep its private diagnostic output."""
        output = (self.root / "logs" / (name + "-process.log")).open("wb")
        self.handles.append(output)
        child = subprocess.Popen(arguments, env=self.service_environment, stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(child)
        return child

    def wait_port(self, port, child):
        """Require a live owned process and a listening loopback endpoint."""
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError("Native service exited before readiness")
            with socket.socket() as client:
                if client.connect_ex(("127.0.0.1", port)) == 0:
                    return
            time.sleep(0.1)
        raise RuntimeError("Native service readiness timed out")

    def bind_tool(self, name, variable, relative, version):
        """Verify an explicitly supplied native binary, then link it inside this run."""
        supplied = os.environ.get(variable)
        if not supplied:
            raise RuntimeError(f"Missing required native tool input {variable}")
        source = Path(supplied).resolve(strict=True)
        banner = subprocess.check_output([str(source), "version" if name == "centrifugo" else "--version"], text=True,
                                         stderr=subprocess.STDOUT)
        if version not in banner:
            raise RuntimeError(f"Unexpected {name} version")
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source)
        self.provenance["tools"][name] = {
            "version": version, "binarySha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        }

    def prepare(self):
        """Install locked dependencies and prepare exact detached, unmodified sources."""
        (self.root / "logs").mkdir()
        (self.root / "sources").mkdir()
        if not available(8000):
            raise RuntimeError("Native Texas workers require an unused localhost port8000")
        self.bind_tool("redis", "ISSUE94_REDIS_SERVER", "sources/redis-7.2.5/src/redis-server", "7.2.5")
        self.bind_tool("redis-cli", "ISSUE94_REDIS_CLI", "sources/redis-7.2.5/src/redis-cli", "7.2.5")
        self.bind_tool("centrifugo", "ISSUE94_CENTRIFUGO", "tools/centrifugo/centrifugo", "2.5.1")
        repositories = Path(os.environ.get("ISSUE94_SOURCE_ROOT", str(Path.home() / "github/kevinanew")))
        for role, (repository, commit) in SOURCES.items():
            parent = repositories / repository
            destination = self.root / "sources" / role
            self.check(["git", "worktree", "add", "--detach", str(destination), commit], cwd=parent, name="worktree-"+role)
            self.worktrees.append((parent, destination))
            actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=destination, text=True).strip()
            assert actual == commit
            assert not subprocess.check_output(["git", "diff", "HEAD", "--", "src", "pyproject.toml", "uv.lock"], cwd=destination)
            self.check(["uv", "sync", "--frozen", "--no-install-project"], cwd=destination, name="dependencies-"+role)
            self.provenance["services"][role] = {"repository": "kevinanew/"+repository,
                "commit": actual, "trackedSourceMatchesCommit": True,
                "uvLockSha256": hashlib.sha256((destination / "uv.lock").read_bytes()).hexdigest()}
        self.check(["uv", "venv", "--python", "3.12", str(self.root / "proxy-venv")], name="proxy-environment")
        self.check(["uv", "pip", "install", "--python", str(self.root / "proxy-venv/bin/python"),
                    "-r", str(REPOSITORY / "e2e/mitmproxy/requirements.txt"), "websockets==15.0.1"], name="proxy-dependencies")
        assert harness_fingerprints() == self.provenance["harness"], "Native harness changed during preparation"
        self.provenance.update(platform=platform.platform(), python=sys.version.split()[0],
                               stagingBackendVersions="not verified; coin operations use the pinned native services")
        config = {"token_hmac_secret_key": secrets.token_hex(32), "api_key": secrets.token_hex(32), "v3_use_offset": True}
        (self.root / "centrifugo-config.json").write_text(json.dumps(config))
        (self.root / "centrifugo-config.json").chmod(0o600)

    def start(self):
        """Start Redis Cluster, Centrifugo, real Flask factories and original delay projectors."""
        infrastructure = self.launch("infrastructure", [sys.executable, str(HERE / "infrastructure.py")])
        state_path = self.root / "infrastructure.json"
        deadline = time.monotonic() + 60
        while not state_path.exists():
            if infrastructure.poll() is not None or time.monotonic() >= deadline:
                error_file = self.root / "infrastructure-error.json"
                error = json.loads(error_file.read_text()) if error_file.exists() else {"reason": "readiness timeout"}
                (self.evidence / "native-startup-failure.json").write_text(json.dumps(error, indent=2))
                raise RuntimeError("Native infrastructure failed to initialize: " + error["reason"])
            time.sleep(0.1)
        self.state = json.loads(state_path.read_text())
        for role, entry in [("router", "isolated_router.py"), ("wallet", "native_wallet.py")]:
            child = self.launch(role, [sys.executable, str(HERE / entry)])
            self.wait_port(self.state[role+"Port"], child)
        for role in SOURCES:
            child = self.launch(role, [str(self.root / "sources" / role / ".venv/bin/python"), str(HERE / "run_flask.py"), role])
            self.wait_port(self.state[role+"Port"], child)
        for arguments in PROJECTORS:
            self.launch("-".join(arguments), [str(self.root / "sources/texas/.venv/bin/python"), str(HERE / "run_flask.py"), "texas", *arguments])
        hall = json.loads((HERE / "hall.json").read_text())
        request = urllib.request.Request(f"http://127.0.0.1:{self.state['matchingPort']}/service/v1/hall_matching/hall",
            data=json.dumps(hall).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=15) as response:
            assert response.status == 200 and json.load(response)["ok"] is True
        self.provenance["isolatedHall"] = hall
        (self.evidence / "native-provenance.json").write_text(json.dumps(self.provenance, indent=2))

    def request_stop(self, child):
        """Signal a known owned group, accepting a concurrent normal process exit."""
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def stop(self):
        """Stop only owned process groups, remove their worktrees and private runtime data."""
        for child in reversed(self.children):
            self.request_stop(child)
        for child in reversed(self.children):
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        for output in self.handles:
            output.close()
        errors = []
        if harness_fingerprints() != self.provenance["harness"]:
            errors.append("Native harness changed during reproduction")
        for parent, destination in reversed(self.worktrees):
            try:
                if subprocess.check_output(["git", "diff", "HEAD", "--", "src", "pyproject.toml", "uv.lock"], cwd=destination):
                    errors.append("Native service source changed during reproduction")
                self.check(["git", "worktree", "remove", "--force", str(destination)], cwd=parent, name="cleanup-worktrees")
            except subprocess.CalledProcessError:
                errors.append("Detached native worktree cleanup failed")
        shutil.rmtree(self.root)
        (self.evidence / "native-cleanup.json").write_text(json.dumps({
            "ownedProcessGroups": len(self.children),
            "allOwnedProcessesExited": all(child.poll() is not None for child in self.children),
            "ownedWorktreesRemoved": all(not destination.exists() for _, destination in self.worktrees),
            "privateRuntimeDirectoryRemoved": not self.root.exists(),
            "errors": errors,
        }, indent=2))
        if errors:
            raise RuntimeError(errors[0])


def main():
    """Run the selected child and preserve failure while always cleaning native resources."""
    arguments = sys.argv[1:]
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    if not arguments:
        raise RuntimeError("Expected a browser test command after --")
    output = os.environ["ISSUE94_NATIVE_EVIDENCE_DIRECTORY"]
    started = time.monotonic()
    stack = NativeStack(output)
    code = 1
    browser_started = None
    try:
        stack.prepare()
        stack.start()
        environment = {**stack.environment,
            "MITMDUMP_PATH": str(stack.root / "proxy-venv/bin/mitmdump"),
            "PYTHONPATH": str(REPOSITORY / "e2e/mitmproxy"),
            "ISSUE94_AUTH_SOURCE_ROOT": str(Path(os.environ.get("ISSUE94_SOURCE_ROOT", str(Path.home() / "github/kevinanew"))) / "app_user_flask"),
        }
        child = subprocess.Popen(arguments, cwd=REPOSITORY, env=environment, start_new_session=True)
        stack.children.append(child)
        browser_started = time.monotonic()
        code = child.wait()
    except KeyboardInterrupt:
        code = 130
    finally:
        try:
            stack.stop()
        except Exception:
            print("Native cleanup failed; test cannot pass", file=sys.stderr)
            code = 1
        (stack.evidence / "native-runtime.json").write_text(json.dumps({"exitCode": code,
            "elapsedSecondsIncludingPreparation": round(time.monotonic()-started, 3),
            "elapsedSecondsAfterBrowserStart": round(time.monotonic()-browser_started, 3) if browser_started else None,
            "maximumChildResidentSetSizeBytes": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * (1 if sys.platform == "darwin" else 1024),
            "memoryMeasurement": "largest completed child-process RSS; not aggregate simultaneous RSS"}, indent=2))
    return code


def cancel(_signum, _frame):
    """Ensure external termination follows the same owned-resource cleanup as cancellation."""
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    try:
        sys.exit(main())
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print("Native issue94 startup failed: "+reason, file=sys.stderr)
        sys.exit(1)
