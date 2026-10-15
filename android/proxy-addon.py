"""只在专用模拟器的代理边界复用 Web 响应，不改变 APK 或绕过应用初始化。"""

import importlib.util
import json
import os
import sys
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from mitmproxy import http
from presentation import AccountPresentation
from game_session import GameSession


class AndroidVisualProxy:
    def __init__(self):
        self.presentation = AccountPresentation()
        self.records = None
        self.game = None
        self.game_session = None
        game_type = os.environ.get('ANDROID_GAME')
        if game_type in ('texas-holdem', 'zhajinhua'):
            directory = Path(__file__).resolve().parents[1] / 'visual/cases' / game_type / 'mitmproxy'
            sys.path.insert(0, str(directory))
            spec = importlib.util.spec_from_file_location('native_game_addon', directory / 'addon.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.game = module.TexasVisualProxy() if game_type == 'texas-holdem' else module.ZhajinhuaVisualProxy()
            self.game.scenario = 'visual-stable'
            self.game_session = GameSession('texas_holdem' if game_type == 'texas-holdem' else 'zhajinhua')
        if os.environ.get('ANDROID_RECORDS') == 'true':
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'visual/cases/game-record/mitmproxy'))
            from addon import GameRecordProxy
            self.records = GameRecordProxy()
            self.records.scenario = 'visual-stable'

    def response(self, flow):
        if (not flow.response or flow.response.status_code != 200
                or (flow.request.host != 'api.shafayouxi.org'
                    and not flow.request.host.endswith('.api.staging.laiwan.shafayouxi.com'))):
            return
        if self.game:
            self.game_session.response(flow)
            self.game.response(flow)
        try:
            body = flow.response.json()
        except ValueError:
            return
        path = urlsplit(flow.request.path).path
        normalized = self.presentation.normalize(path, flow.request.method, body)
        if self.game_session:
            normalized = self.game_session.normalize_room(path, flow.request.method, body) or normalized
        if normalized:
            flow.response.content = json.dumps(body).encode()
            for header in ('ETag', 'Content-MD5', 'Digest'):
                flow.response.headers.pop(header, None)
        if self.records:
            if self.presentation.user_id:
                self.records.user_id = self.presentation.user_id
            self.records.response(flow)

    def websocket_message(self, flow):
        if self.game:
            self.game.websocket_message(flow)

    def websocket_end(self, flow):
        if self.game:
            self.game.websocket_end(flow)

    async def request(self, flow):
        if self.game and flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/android/session':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, json.dumps({
                    'account': self.game_session.account, 'room': self.game_session.room}).encode(),
                    {'Content-Type': 'application/json'})
            return
        if self.game:
            self.game.request(flow)
            if flow.response:
                return
        if self.records:
            await self.records.request(flow)
            if flow.response:
                return
        if flow.request.host == 'test-mitmproxy.invalid':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, b'{"scenario":"visual-stable"}')
            return
        if flow.request.method == 'CONNECT':
            return
        payload = json.dumps({'url': flow.request.pretty_url}).encode()
        request = urllib.request.Request(os.environ['ANDROID_FIXTURE_URL'], data=payload,
            headers={'Content-Type': 'application/json',
                     'Authorization': os.environ['ANDROID_FIXTURE_TOKEN']})
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.load(response)
        if result is None:
            return
        if result.get('aborted'):
            flow.kill()
            return
        flow.response = http.Response.make(result.get('status', 200),
            result.get('body', '').encode(),
            {'Content-Type': result.get('contentType', 'application/json')})


addons = [AndroidVisualProxy()]
