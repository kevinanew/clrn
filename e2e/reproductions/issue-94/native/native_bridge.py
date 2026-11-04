"""Prototype: route owned coin play to real native gateway, preserve staging initialization."""
import os
import asyncio
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import urllib.request

from mitmproxy import ctx, http
from network_faults import NetworkFaults, json_response
from websockets.asyncio.client import connect

ROOT = Path(os.environ['ISSUE94_NATIVE_ROOT'])
STATE = json.loads((ROOT / 'infrastructure.json').read_text())
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def local_request(path, body=None, port=None, headers=None, method=None):
    request = urllib.request.Request(f"http://127.0.0.1:{port or STATE['routerPort']}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})}, method=method)
    with OPENER.open(request, timeout=20) as response:
        return json.load(response)

class NativeConnection:
    def __init__(self, bridge, flow, owner):
        self.bridge, self.flow, self.owner = bridge, flow, owner
        self.pending, self.external, self.subscriptions = {}, set(), set()
        self.sequence = 1000000000
        self.socket, self.reader, self.opening = None, None, None

    async def start(self, token):
        self.socket = await connect(f"ws://127.0.0.1:{STATE['centrifugoPort']}/connection/websocket", proxy=None)
        self.reader = asyncio.create_task(self.receive())
        reply = await self.internal(None, {'token': token})
        if not reply.get('result', {}).get('client'):
            raise ValueError('Genuine native authentication rejected')
        await self.subscribe(f'user#{self.owner}')
        self.bridge.record('native-connected', user=self.owner)

    async def internal(self, method, params):
        self.sequence += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[self.sequence] = future
        command = {'id': self.sequence, 'params': params}
        if method is not None:
            command['method'] = method
        await self.socket.send(json.dumps(command))
        return await asyncio.wait_for(future, 15)

    async def subscribe(self, channel):
        if channel in self.subscriptions:
            return
        reply = await self.internal(1, {'channel': channel})
        if 'error' in reply:
            raise ValueError('Native subscription rejected')
        self.subscriptions.add(channel)

    async def receive(self):
        try:
            async for raw in self.socket:
                for line in raw.splitlines():
                    if not line.strip():
                        continue
                    self.relay_frame(line)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.bridge.record('native-reader-failed', user=self.owner, reason=type(error).__name__)

    def relay_frame(self, line):
        """Pass real native replies/publications, preserving their original payload bytes."""
        frame = json.loads(line)
        ident = frame.get('id')
        if ident in self.pending:
            self.pending.pop(ident).set_result(frame)
            return
        result = frame.get('result', {})
        publication = result.get('data', {})
        for item in publication.get('data', {}).get('queue', []):
            if item.get('event') == 'player_booking_seat' and item.get('player_id') == self.owner:
                self.bridge.rooms.add(item['room_id'])
                self.bridge.record('native-booking', user=self.owner, room=item['room_id'])
        if ident in self.external:
            self.external.remove(ident)
        elif not result.get('channel'):
            return
        self.bridge.record('native-to-browser', user=self.owner, channel=result.get('channel'),
            rpcId=ident, sha256=digest(line), bytes=len(line), publication=publication if result.get('channel') else None,
            reply=frame if ident else None)
        ctx.master.commands.call('inject.websocket', self.flow, True, line.encode(), True)

    async def close(self):
        if self.reader:
            self.reader.cancel()
        if self.socket:
            await self.socket.close()

class NativeBridge(NetworkFaults):
    def __init__(self):
        super().__init__()
        self.owners, self.jwt_owners, self.connections, self.rooms = {}, {}, {}, set()
        self.enabled = False
        self.records = []

    def record(self, event, **data):
        self.records.append({'event': event, **data})

    def control(self, flow):
        path = urlsplit(flow.request.path).path
        if not path.startswith('/native/'):
            return super().control(flow)
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            flow.response = http.Response.make(403, b'Forbidden')
            return
        try:
            if path == '/native/bind' and flow.request.method == 'POST':
                body = json.loads(flow.request.content)
                verified = local_request('/_issue94/bind', {k: body[k] for k in ['userId', 'accountUrl', 'authorization']},
                    headers={'X-Issue94-Control': (ROOT / 'wallet-control-key').read_text()})
                if not verified.get('ok'):
                    raise ValueError('Live session verification failed')
                self.owners[digest(body['authorization'].split()[-1])] = body['userId']
                self.jwt_owners[digest(body['centrifugoToken'])] = body['userId']
            elif path == '/native/enable' and flow.request.method == 'POST':
                if len(self.owners) != 2:
                    raise ValueError('Requires two verified owners')
                self.enabled = True
            elif path != '/native/status':
                flow.response = http.Response.make(404, b'Not found')
                return
            flow.response = json_response(flow, {'enabled': self.enabled,
                'owners': len(self.owners), 'rooms': sorted(self.rooms),
                'connections': [{'user': c.owner, 'subscriptions': sorted(c.subscriptions),
                    'connected': bool(c.socket)} for c in self.connections.values()], 'records': self.records})
        except Exception as error:
            flow.response = json_response(flow, {'ok': False, 'reason': type(error).__name__}, 400)

    def target(self, path):
        if path.startswith('/v1/hall_matching/') or path == '/public/v1/hall_matching/texas_holdem/halls':
            return True
        return any(room in path for room in self.rooms) and any(x in path for x in ['/texas_holdem/', '/room/', '/buy_in/'])

    async def request(self, flow):
        await super().request(flow)
        if flow.response or not self.enabled:
            return
        path = urlsplit(flow.request.path).path
        auth = flow.request.headers.get('Authorization', '')
        owner = self.owners.get(digest(auth.split()[-1])) if auth else None
        if owner and (self.target(path) or path == f'/v10/wallet/{owner}'):
            self.record('native-http', user=owner, path=path, method=flow.request.method)
            flow.request.scheme, flow.request.host, flow.request.port = 'http', '127.0.0.1', STATE['routerPort']

    async def websocket_message(self, flow):
        message = flow.websocket.messages[-1]
        if not self.enabled or message.injected or not message.from_client:
            return
        try:
            commands = [json.loads(x) for x in message.content.decode().splitlines() if x.strip()]
            kept = []
            for command in commands:
                method, params = command.get('method', 0), command.get('params', {})
                self.record('browser-command', method=method, path=params.get('data', {}).get('path') if isinstance(params.get('data'),dict) else None, channel=params.get('channel'))
                if method == 0 and digest(params.get('token', '')) in self.jwt_owners:
                    owner = self.jwt_owners[digest(params['token'])]
                    connection = NativeConnection(self, flow, owner)
                    self.connections[flow.id] = connection
                    # Clone auth before gameplay; staging initialization retains its real reply.
                    await connection.start(params['token'])
                connection = self.connections.get(flow.id)
                if connection and method == 1:
                    channel = params.get('channel', '')
                    if channel == f'user#{connection.owner}' or any(room in channel for room in self.rooms):
                        await connection.subscribe(channel)
                if connection and method == 9 and self.target(params.get('data', {}).get('path', '')):
                    connection.external.add(command['id'])
                    self.record('native-rpc', user=connection.owner, path=params['data']['path'], rpcId=command['id'])
                    await connection.socket.send(json.dumps(command))
                else:
                    kept.append(command)
            if not kept:
                message.drop()
            elif len(kept) != len(commands):
                message.content = '\n'.join(json.dumps(x) for x in kept).encode()
        except Exception as error:
            self.record('native-bridge-failed', reason=type(error).__name__)
            # Never let a targeted write escape to staging after bridge failure.
            message.drop()
            flow.kill()

    async def websocket_end(self, flow):
        connection = self.connections.pop(flow.id, None)
        if connection:
            await connection.close()

addons = [NativeBridge()]
