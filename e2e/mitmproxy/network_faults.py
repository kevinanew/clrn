"""仅在明确指定的场景中注入 staging 网络故障。"""

import asyncio
import json
import os
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http
from response_overrides import is_staging as is_staging_api

CONTROL_HOST = "test-mitmproxy.invalid"
FAULT_PATHS = {
    "hall-timeout": "/public/v1/hall_matching/available.json",
    "login-failure": "/public/v10/user/login/username/password",
    "club-failure": "/v10/club",
}
SCENARIOS = (None, *FAULT_PATHS, "visual-stable", "club-search-result")
CLUB_SEARCH_KEYWORD = "VisualClubSearch"
CLUB_SEARCH_ID = "12f2cb6e-9045-4910-b58a-7d3903f56a39"
CLUB_SEARCH_RESULT = {
    "id": CLUB_SEARCH_ID,
    "club_no": "12345678",
    "name": "搜索测试俱乐部",
    "area": "测试地区",
    "member_count": 7,
    "description": "用于验证搜索结果的固定俱乐部",
    "owner_id": "visual-club-owner",
    "admin_ids": [],
}


def json_response(flow, payload, status=200):
    return http.Response.make(
        status,
        json.dumps(payload).encode(),
        {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": flow.request.headers.get("Origin", "*"),
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        },
    )


class NetworkFaults:
    def __init__(self):
        self.token = os.environ["MITMPROXY_CONTROL_TOKEN"]
        self.scenario = None
        self.intercepted_requests = 0
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.club_search_requests = 0
        self.club_details_requests = 0

    def control(self, flow):
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method == "POST" and path == "/scenario":
            try:
                scenario = json.loads(flow.request.content)["scenario"]
                if scenario not in SCENARIOS:
                    raise ValueError("Unknown scenario")
            except (ValueError, KeyError, TypeError):
                flow.response = http.Response.make(400, b"Invalid scenario")
                return
            self.scenario = scenario
            if scenario is not None:
                self.intercepted_requests = 0
                self.club_search_requests = 0
                self.club_details_requests = 0
        elif flow.request.method != "GET" or path != "/status":
            flow.response = http.Response.make(404, b"Not found")
            return
        flow.response = json_response(flow, {
            "scenario": self.scenario,
            "interceptedRequests": self.intercepted_requests,
            "proxiedRequests": self.proxied_requests,
            "stabilizedRequests": self.stabilized_requests,
            "clubSearchRequests": self.club_search_requests,
            "clubDetailsRequests": self.club_details_requests,
        })

    def mock_existing_username(self, flow, path):
        if self.scenario != "login-failure" or path != "/public/v10/user/username/is_existed":
            return False
        # 保留用户名已存在的分支，避免测试账号缺失时自动注册。
        flow.response = json_response(flow, {"ok": True, "result": {"is_existed": True}})
        return True

    def matches_fault(self, url):
        if url.path != FAULT_PATHS.get(self.scenario):
            return False
        if self.scenario == "club-failure":
            return "user_id" in parse_qs(url.query, keep_blank_values=True)
        return True

    def mock_club_search_result(self, flow, url):
        """只替换本例只读搜索和指定俱乐部资料，其他业务流量继续透传。"""
        if self.scenario != "club-search-result":
            return False
        search_path = url.path == "/v10/club/search"
        details_path = url.path == "/v10/clubs"
        if not search_path and not details_path:
            return False
        if flow.request.method == "OPTIONS":
            flow.response = http.Response.make(204, b"", {
                "Access-Control-Allow-Origin": flow.request.headers.get("Origin", "*"),
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
                "Access-Control-Allow-Headers": flow.request.headers.get(
                    "Access-Control-Request-Headers", ""),
                "Vary": "Origin",
            })
            return True
        if search_path:
            keyword = parse_qs(url.query, keep_blank_values=True).get("keyword")
            if flow.request.method != "GET" or keyword != [CLUB_SEARCH_KEYWORD]:
                flow.response = json_response(flow, {"ok": False}, 400)
                return True
            self.club_search_requests += 1
            flow.response = json_response(flow, {"ok": True, "result": [CLUB_SEARCH_ID]})
            return True
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            body = None
        if flow.request.method != "PUT" or body != {"club_ids": [CLUB_SEARCH_ID]}:
            return False
        self.club_details_requests += 1
        flow.response = json_response(flow, {"ok": True, "result": [CLUB_SEARCH_RESULT]})
        return True

    async def request(self, flow: http.HTTPFlow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        url = urlsplit(flow.request.path)
        # 故障注入放行 CORS 预检和非 staging 流量。
        if not is_staging_api(flow.request.host):
            return
        if self.mock_club_search_result(flow, url):
            return
        if flow.request.method == "OPTIONS":
            return
        if self.mock_existing_username(flow, url.path) or not self.matches_fault(url):
            return
        self.intercepted_requests += 1
        if self.scenario == "hall-timeout" and self.intercepted_requests == 1:
            # 异步延迟保证其他请求和控制接口仍可响应。
            await asyncio.sleep(12)
        if flow.killable:
            flow.kill()


addons = [NetworkFaults()]
