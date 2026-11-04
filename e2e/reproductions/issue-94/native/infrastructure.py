import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from ports import available, unused

root = Path(os.environ['ISSUE94_NATIVE_ROOT'])
logs = root / 'logs'
logs.mkdir(exist_ok=True)
processes = []
handles = []
stop = threading.Event()

def launch(name, arguments):
    handle = (logs / (name + '.log')).open('wb')
    handles.append(handle)
    child = subprocess.Popen(arguments, stdout=handle, stderr=subprocess.STDOUT)
    processes.append(child)
    return child

def wait_port(port, child):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError('Owned service exited before readiness')
        with socket.socket() as client:
            if client.connect_ex(('127.0.0.1', port)) == 0:
                return
        time.sleep(.1)
    raise RuntimeError('Owned service readiness timed out')

signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())

try:
    while True:
        base = 18000 + secrets.randbelow(1500)
        ports = list(range(base, base + 6))
        if all(available(port) and available(port + 10000) for port in ports):
            break
    for port in ports:
        directory = root / 'redis' / str(port)
        directory.mkdir(parents=True)
        config = directory / 'redis.conf'
        config.write_text('\n'.join([
            'bind 127.0.0.1', f'port {port}', 'protected-mode yes',
            'cluster-enabled yes', 'cluster-config-file nodes.conf',
            'cluster-node-timeout 5000', 'cluster-announce-ip 127.0.0.1',
            f'cluster-announce-port {port}', f'cluster-announce-bus-port {port + 10000}',
            f'dir {directory}', 'save ""', 'appendonly yes',
        ]) + '\n')
        child = launch('redis-' + str(port), [str(root / 'sources/redis-7.2.5/src/redis-server'), str(config)])
        wait_port(port, child)
    result = subprocess.run([
        str(root / 'sources/redis-7.2.5/src/redis-cli'), '--cluster', 'create',
        *[f'127.0.0.1:{port}' for port in ports], '--cluster-replicas', '1', '--cluster-yes',
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    (logs / 'redis-cluster-create.log').write_bytes(result.stdout)
    if result.returncode:
        raise RuntimeError('Owned cluster creation failed')
    centrifugo_port, gateway_port, router_port, wallet_port, room_port, buyin_port, matching_port = [unused() for _ in range(7)]
    if not available(8000):
        raise RuntimeError('Native Texas workers require an unused localhost port8000')
    texas_port = 8000
    config_path = root / 'centrifugo-config.json'
    config = json.loads(config_path.read_text())
    config.update(address='127.0.0.1', port=str(centrifugo_port), health=True,
                  proxy_rpc_endpoint=f'http://127.0.0.1:{gateway_port}/v1/centrifugo_gateway/',
                  proxy_rpc_timeout='10s', allowed_origins=['*'])
    config_path.write_text(json.dumps(config))
    config_path.chmod(0o600)
    child = launch('centrifugo', [str(root / 'tools/centrifugo/centrifugo'), '-c', str(config_path)])
    wait_port(centrifugo_port, child)
    with urllib.request.urlopen(f'http://127.0.0.1:{centrifugo_port}/health', timeout=3) as response:
        assert response.status == 200
    state = dict(supervisorPid=os.getpid(), redisPorts=ports, centrifugoPort=centrifugo_port,
                 texasPort=texas_port, gatewayPort=gateway_port, routerPort=router_port, walletPort=wallet_port,
                 roomPort=room_port, buyinPort=buyin_port, matchingPort=matching_port,
                 redisVersion='7.2.5', centrifugoVersion='2.5.1', initializedAt=time.time())
    (root / 'infrastructure.json').write_text(json.dumps(state, indent=2))
    print(json.dumps({'ready': True, **state}), flush=True)
    while not stop.wait(1):
        if any(child.poll() is not None for child in processes):
            raise RuntimeError('Owned service exited during isolated run')
except Exception as error:
    reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    (root / 'infrastructure-error.json').write_text(json.dumps({'reason': reason}))
    raise
finally:
    for child in reversed(processes):
        if child.poll() is None:
            child.terminate()
    for child in reversed(processes):
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
    for handle in handles:
        handle.close()
    print('Isolated native infrastructure stopped', flush=True)
