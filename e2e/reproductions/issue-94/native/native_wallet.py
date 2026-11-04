"""Isolated normal ledger for native stack bring-up; fault scope is added separately."""
import os
import json
import secrets
import threading
import time
import re
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

root = Path(os.environ['ISSUE94_NATIVE_ROOT'])
state_path = root / 'infrastructure.json'
state = json.loads(state_path.read_text())
control_path = root / 'wallet-control-key'
control_path.write_text(secrets.token_hex(32))
control_path.chmod(0o600)
control_key = control_path.read_text()
lock = threading.RLock()
balances, transactions, hits = {}, {}, []
fault = {'mode': 'normal', 'players': [], 'roomId': None}

def verify_exclusive_room(body):
    """Check actual dedicated Redis state before arming a room-scoped wallet fault."""
    current = json.loads(state_path.read_text())
    cli = str(root / 'sources/redis-7.2.5/src/redis-cli')
    keys = set()
    for port in current['redisPorts']:
        pid = subprocess.check_output(['lsof', '-t', '-iTCP:'+str(port), '-sTCP:LISTEN'], text=True).strip()
        command = subprocess.check_output(['ps', '-p', pid, '-o', 'command='], text=True).strip()
        assert command.startswith(str(root / 'sources/redis-7.2.5/src/redis-server')+' ')
        if subprocess.check_output([cli, '-p', str(port), 'ROLE'], text=True).splitlines()[0] == 'master':
            keys.update(subprocess.check_output([cli, '-p', str(port), '--scan', '--pattern', 'texas_holdem:v1:room_id:*'], text=True).splitlines())
    key = 'texas_holdem:v1:room_id:'+body['roomId']
    assert keys == {key}, 'Wallet fault requires exactly one isolated native room'
    config = json.loads(subprocess.check_output([cli, '-c', '-p', str(current['redisPorts'][0]), 'GET', key], text=True))
    assert set(config['player_pool']['players']) == set(body['players'])
    assert len(body['players']) == 2 and all(player in balances for player in body['players'])
    return {'singleRoomVerified': True, 'roomId': body['roomId'], 'players': body['players']}

def success(result):
    return {'ok': True, 'result': result}

def failure(kind):
    return {'ok': False, 'error_type': kind, 'error_message': kind.replace('_', ' ')}

def currency(player, name):
    return {'wallet_id': player, 'currency_name': name, 'code': name,
            'balance': str(balances[player].get(name, 0)), 'frozen_amount': '0'}

def transact(player, operation, body):
    amount = int(body['amount'])
    name = body['currency_name']
    transaction = body['transaction_id']
    if player not in balances:
        if amount == 0:
            balances[player] = {'coin': 0, 'diamond': 0}
        else:
            return failure('wallet_not_found')
    if amount < 0:
        return failure('invalid_amount')
    identity = (player, operation, name, amount)
    previous = transactions.get(transaction)
    if previous:
        if tuple(previous['identity']) != identity:
            return failure('transaction_conflict')
        return success({'statement_id': transaction})
    before = balances[player].get(name, 0)
    if operation == 'withdraw' and before < amount:
        return failure('insufficient_balance')
    after = before + (amount if operation == 'deposit' else -amount)
    balances[player][name] = after
    transactions[transaction] = {'identity': identity, 'player': player, 'event': operation,
                                 'currency': name, 'amount': amount, 'before': before,
                                 'after': after, 'memo': body.get('memo', ''), 'committedAt': time.time()}
    return success({'statement_id': transaction})

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def matching_fault(self, parts, body):
        """Match only the two verified players' automatic rebuy withdrawals."""
        with lock:
            mode = fault['mode'] if (self.command == 'POST' and len(parts) == 6
                and parts[1:4] == ['service', 'v11', 'wallet'] and parts[5] == 'withdraw'
                and parts[4] in fault['players']
                and re.fullmatch(r'\[(all_in|call|fold)\]Auto rebuy in:coin', body.get('memo', ''))) else 'normal'
        return mode

    def inject_fault(self, mode, parts, body):
        """Apply a real HTTP boundary failure without holding the ledger lock during delays."""
        with lock:
            entry = {'player': parts[4], 'operation': 'withdraw', 'mode': mode,
                'transaction': body['transaction_id'], 'amount': int(body['amount']),
                'currency': body['currency_name'], 'at': time.time(), 'roomScope': fault['roomId']}
            hits.append(entry)
        if mode == 'timeout':
            time.sleep(2.3)
            self.close_connection = True
            return
        if mode in ['disconnect', 'committed-response-lost']:
            if mode == 'committed-response-lost':
                with lock:
                    transact(parts[4], 'withdraw', body)
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if mode in ['http-503', 'http-504']:
            self.reply({'upstream': 'unavailable'}, int(mode[-3:]))
        elif mode == 'invalid-json':
            data = b'not-json'
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            payload = {'ok': False} if mode == 'missing-fields' else failure('transaction_conflict')
            entry['errorType'] = payload.get('error_type')
            self.reply(payload)
        return

    def control(self, path, body):
        """Authenticate run controls and validate the dedicated room before arming."""
        if self.headers.get('X-Issue94-Control') != control_key:
            self.reply(failure('forbidden'), 403)
            return
        if path == '/_issue94/seed' and self.command == 'POST':
            if any(item['player'] in body['balances'] for item in transactions.values()):
                self.reply(failure('ledger_already_used'), 409)
                return
            for player, values in body['balances'].items():
                balances[player] = {key: int(value) for key, value in values.items()}
            self.reply(success({'players': len(balances)}))
            return
        if path == '/_issue94/state' and self.command == 'GET':
            self.reply(success({'balances': balances, 'transactions': transactions, 'hits': hits, 'fault': fault}))
            return
        if path == '/_issue94/fault' and self.command == 'POST':
            modes = ['normal', 'conflict', 'timeout', 'disconnect', 'http-503', 'http-504', 'invalid-json', 'missing-fields', 'committed-response-lost']
            if body['mode'] not in modes:
                self.reply(failure('invalid_mode'), 400)
                return
            if body['mode'] == 'normal':
                fault['mode'] = 'normal'
                self.reply(success({'cleared': True}))
                return
            try:
                verified = verify_exclusive_room(body)
            except (AssertionError, KeyError, ValueError):
                self.reply(failure('isolated_scope_rejected'), 400)
                return
            fault.update(mode=body['mode'], players=body['players'], roomId=body['roomId'])
            self.reply(success({**verified, 'mode': fault['mode']}))
            return
        self.reply(failure('unknown_control'), 404)
        return

    def wallet_request(self, path, body):
        """Serve the normal client and internal SDK ledger contracts."""
        parts = path.split('/')
        if path == '/service/v11/wallet/batch_get_wallet' and self.command == 'POST':
            users = body['user_ids']
            if any(player not in balances for player in users):
                self.reply(failure('wallet_not_found'))
                return
            self.reply(success({player: balances[player] for player in users}))
            return
        if len(parts) == 4 and parts[1:3] == ['v10', 'wallet'] and self.command in ['GET', 'PUT']:
            player = parts[3]
            if player not in balances:
                self.reply(failure('wallet_not_found'))
                return
            self.reply(success({'wallet_id': player, 'currencies': [currency(player, name) for name in balances[player]]}))
            return
        if len(parts) < 5 or parts[1:4] != ['service', 'v11', 'wallet']:
            self.reply(failure('unsupported_wallet_path'), 404)
            return
        player = parts[4]
        if self.command == 'GET' and player in balances:
            if len(parts) == 7 and parts[5] == 'currency':
                self.reply(success(currency(player, parts[6])))
                return
            if len(parts) == 5:
                self.reply(success({'wallet_id': player, 'currencies': [currency(player, name) for name in balances[player]]}))
                return
        if self.command == 'POST' and len(parts) == 6 and parts[5] in ['withdraw', 'deposit']:
            payload = transact(player, parts[5], body)
            hits.append({'player': player, 'operation': parts[5], 'transaction': body['transaction_id'],
                         'amount': int(body['amount']), 'currency': body['currency_name'],
                         'errorType': payload.get('error_type'), 'at': time.time()})
            self.reply(payload)
            return
        self.reply(failure('wallet_operation_not_configured'), 404)


    def dispatch(self):
        """Separate authenticated controls, scoped faults and normal wallet operations."""
        path = urlsplit(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        parts = path.split('/')
        mode = self.matching_fault(parts, body)
        if mode != 'normal':
            self.inject_fault(mode, parts, body)
            return
        with lock:
            if path.startswith('/_issue94/'):
                self.control(path, body)
            else:
                self.wallet_request(path, body)

    do_GET = do_POST = do_PUT = dispatch

server = ThreadingHTTPServer(('127.0.0.1', state['walletPort']), Handler)
print(json.dumps({'starting': 'isolated-normal-wallet', 'port': state['walletPort']}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
