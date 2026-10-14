"""只在专用模拟器的代理边界复用 Web 响应，不改变 APK 或绕过应用初始化。"""

import json
import os
import sys
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from mitmproxy import http
from presentation import AccountPresentation


class AndroidVisualProxy:
    def __init__(self):
        self.presentation = AccountPresentation()
        self.records = None
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
        try:
            body = flow.response.json()
        except ValueError:
            return
        if self.presentation.normalize(urlsplit(flow.request.path).path, flow.request.method, body):
            flow.response.content = json.dumps(body).encode()
            for header in ('ETag', 'Content-MD5', 'Digest'):
                flow.response.headers.pop(header, None)
        if self.records:
            if self.presentation.user_id:
                self.records.user_id = self.presentation.user_id
            self.records.response(flow)

    async def request(self, flow):
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
