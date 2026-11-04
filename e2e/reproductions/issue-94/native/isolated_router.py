import os
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import urllib.error
import urllib.request
import time
import hashlib
import uuid

root = Path(os.environ['ISSUE94_NATIVE_ROOT'])
state = json.loads((root / 'infrastructure.json').read_text())
client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
owners = {}

class NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_arguments, **_keywords):
        return None

account_client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoAuthRedirect())

def fingerprint(authorization):
    return hashlib.sha256(authorization.split()[-1].encode()).hexdigest() if authorization else ''

def owner_from_headers(headers):
    entry = owners.get(fingerprint(headers.get('Authorization', '')))
    return entry['userId'] if entry and entry['expires'] > time.time() else None
service_hosts = {'texas-holdem-flask': 'texas', 'room-sanic': 'room',
                 'buy-in-flask': 'buyin', 'hall-matching-flask': 'matching',
                 'user-transaction-flask': 'wallet'}

def service_for(target):
    if target.hostname in service_hosts:
        return service_hosts[target.hostname]
    path = target.path
    if '/texas_holdem/' in path or path.startswith('/public/v1/texas_holdem'):
        return 'texas'
    if '/hall_matching/' in path:
        return 'matching'
    if '/buy_in/' in path:
        return 'buyin'
    if any(x in path for x in ['/room/', '/building/', '/buildings/']):
        return 'room'
    if '/wallet/' in path:
        return 'wallet'
    return None

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_CONNECT(self):
        self.send_error(403, 'Isolated services cannot contact external HTTPS origins')

    def send_json(self, body, status=200):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def bind_owner(self, body):
        if self.headers.get('X-Issue94-Control') != (root / 'wallet-control-key').read_text():
            self.send_json({'ok': False, 'error': 'forbidden'}, 403)
            return
        target = urlsplit(body['accountUrl'])
        user = str(uuid.UUID(body['userId']))
        allowed = target.hostname == 'api.shafayouxi.org' or (target.hostname or '').endswith('.api.staging.laiwan.shafayouxi.com')
        if (target.scheme != 'https' or not allowed or target.path != f'/v11/user/{user}/account'
                or target.query or target.fragment or target.username or target.password or target.port not in [None, 443]):
            self.send_json({'ok': False, 'error': 'invalid_stage_account_endpoint'}, 400)
            return
        request = urllib.request.Request(body['accountUrl'], headers={'Authorization': body['authorization']})
        try:
            with account_client.open(request, timeout=15) as response:
                accepted = response.status == 200 and json.load(response).get('ok') is True
        except (OSError, ValueError, urllib.error.URLError):
            accepted = False
        if not accepted:
            self.send_json({'ok': False, 'error': 'stage_session_not_verified'}, 403)
            return
        owners[fingerprint(body['authorization'])] = {'userId': user, 'expires': time.time() + 1200}
        self.send_json({'ok': True, 'verifiedUserId': user})

    def handle_request(self):
        target = urlsplit(self.path)
        state = json.loads((root / 'infrastructure.json').read_text())
        role = service_for(target)
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if target.path == '/_issue94/bind' and self.command == 'POST':
            self.bind_owner(json.loads(data))
            return
        if self.command == 'OPTIONS':
            self.send_response(204)
            self.cors_headers()
            self.end_headers()
            return
        started = time.monotonic()
        status = 502
        content_type = 'application/json'
        response_body = json.dumps({'ok': False, 'error_type': 'isolated_route_not_configured'}).encode()
        if role:
            path = target.path + ('?' + target.query if target.query else '')
            address = f"http://127.0.0.1:{state[role+'Port']}{path}"
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in ['host', 'connection', 'content-length', 'proxy-connection']}
            if not target.path.startswith(('/service/', '/public/')):
                user = owner_from_headers(self.headers)
                if not user:
                    self.send_json({'ok': False, 'error_type': 'native_authenticated_owner_required'}, 401)
                    return
                headers = {key: value for key, value in headers.items() if key.lower() != 'x-authenticated-userid'}
                headers['x-authenticated-userid'] = user
                if role == 'wallet' and target.path.split('/')[3] != user:
                    self.send_json({'ok': False, 'error_type': 'native_wallet_owner_mismatch'}, 403)
                    return
            request = urllib.request.Request(address, data=data or None, method=self.command, headers=headers)
            try:
                with client.open(request, timeout=30) as response:
                    status = response.status
                    content_type = response.headers.get('Content-Type', 'application/json')
                    response_body = response.read()
            except urllib.error.HTTPError as response:
                status, response_body = response.code, response.read()
                content_type = response.headers.get('Content-Type', 'application/json')
            except (OSError, urllib.error.URLError):
                response_body = json.dumps({'ok': False, 'error_type': 'isolated_dependency_unavailable'}).encode()
        record = {'host': target.hostname, 'method': self.command, 'path': target.path,
                  'destination': role, 'status': status,
                  'elapsedSeconds': round(time.monotonic() - started, 3),
                  'outcome': 'isolated-local-forward' if role else 'blocked-unconfigured-isolated-dependency'}
        with (root / 'logs' / 'isolated-routing.jsonl').open('a') as log:
            log.write(json.dumps(record) + '\n')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(response_body)))
        self.cors_headers()
        self.end_headers()
        try:
            self.wfile.write(response_body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def cors_headers(self):
        origin = self.headers.get('Origin', '')
        if urlsplit(origin).hostname in ['127.0.0.1', 'localhost']:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
            self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers', 'Authorization, Content-Type'))
            self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
            self.send_header('Vary', 'Origin')

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = handle_request

server = ThreadingHTTPServer(('127.0.0.1', state['routerPort']), Handler)
print(json.dumps({'starting': 'isolated-dependency-router', 'port': state['routerPort']}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
