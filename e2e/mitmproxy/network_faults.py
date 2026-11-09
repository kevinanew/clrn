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
    """构造带 JSON 类型及跨域响应头的故障场景响应。"""
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
    """在限定接口上注入延迟、登录或俱乐部故障，并提供认证控制入口。"""
    def __init__(self):
        """初始化token、scenario、intercepted_requests、proxied_requests、stabilized_requests等状态。"""
        self.token = os.environ["MITMPROXY_CONTROL_TOKEN"]
        self.scenario = None
        self.intercepted_requests = 0
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.club_search_requests = 0
        self.club_details_requests = 0

    def control(self, flow):
        """验证控制令牌并切换已登记的网络故障场景。"""
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        if self.control_route(flow):
            flow.response = json_response(flow, self.status())

    def mock_existing_username(self, flow, path):
        """登录故障场景中保留用户名已存在分支，避免触发自动注册。"""
        if self.scenario != "login-failure" or path != "/public/v10/user/username/is_existed":
            return False
        # 保留用户名已存在的分支，避免测试账号缺失时自动注册。
        flow.response = json_response(flow, {"ok": True, "result": {"is_existed": True}})
        return True

    def matches_fault(self, url):
        """按场景路径与必要查询参数判断请求是否应注入故障。"""
        if url.path != FAULT_PATHS.get(self.scenario):
            return False
        if self.scenario == "club-failure":
            return "user_id" in parse_qs(url.query, keep_blank_values=True)
        return True

    def mock_club_search_result(self, flow, url):
        """只替换本例只读搜索和指定俱乐部资料，其他业务流量继续透传。"""
        if self.scenario != "club-search-result" or flow.request.method == "OPTIONS":
            return False
        handler = {"/v10/club/search": self.club_search, "/v10/clubs": self.club_details}.get(url.path)
        return self.call_club_handler(handler, flow, url)

    async def request(self, flow: http.HTTPFlow):
        """路由代理控制与业务请求，仅对当前匹配场景执行故障注入。"""
        if flow.response:
            return
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        await self.business_request(flow)


    def status(self):
        """保留控制入口全部观测字段。"""
        return {"scenario": self.scenario, "interceptedRequests": self.intercepted_requests,
                "proxiedRequests": self.proxied_requests, "stabilizedRequests": self.stabilized_requests,
                "clubSearchRequests": self.club_search_requests, "clubDetailsRequests": self.club_details_requests}

    def control_route(self, flow):
        """按精确方法和路径分发，未知命令返回 404。"""
        route = (flow.request.method, urlsplit(flow.request.path).path)
        if route == ("POST", "/scenario"):
            return self.select_scenario(flow)
        if route != ("GET", "/status"):
            flow.response = http.Response.make(404, b"Not found")
            return False
        return True

    def select_scenario(self, flow):
        """损坏或未知场景命令保持原状态。"""
        try:
            scenario = self.read_scenario(flow)
        except (ValueError, KeyError, TypeError):
            flow.response = http.Response.make(400, b"Invalid scenario")
            return False
        self.scenario = scenario
        self.reset_scenario(scenario)
        return True

    def read_scenario(self, flow):
        """只接受登记的故障场景。"""
        scenario = json.loads(flow.request.content)["scenario"]
        if scenario not in SCENARIOS:
            raise ValueError("Unknown scenario")
        return scenario

    def reset_scenario(self, scenario):
        """保留关闭场景时的计数语义。"""
        if scenario is not None:
            self.intercepted_requests = 0
            self.club_search_requests = 0
            self.club_details_requests = 0

    def call_club_handler(self, handler, flow, url):
        """未登记的俱乐部请求原样透传。"""
        return handler(flow, url) if handler else False

    def club_search(self, flow, url):
        """仅精确关键词的 GET 搜索返回固定俱乐部编号。"""
        keyword = parse_qs(url.query, keep_blank_values=True).get("keyword")
        if flow.request.method != "GET" or keyword != [CLUB_SEARCH_KEYWORD]:
            return False
        self.club_search_requests += 1
        flow.response = json_response(flow, {"ok": True, "result": [CLUB_SEARCH_ID]})
        return True

    def club_body(self, flow):
        """请求正文损坏时不命中详情场景。"""
        try:
            return json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None

    def club_details(self, flow, url):
        """只替换确切虚拟俱乐部批次的 PUT 读取。"""
        body = self.club_body(flow)
        if flow.request.method != "PUT" or body != {"club_ids": [CLUB_SEARCH_ID]}:
            return False
        self.club_details_requests += 1
        flow.response = json_response(flow, {"ok": True, "result": [CLUB_SEARCH_RESULT]})
        return True

    async def business_request(self, flow):
        """故障注入放行非配置来源和俱乐部只读夹具。"""
        if not is_staging_api(flow.request.host):
            return
        url = urlsplit(flow.request.path)
        if self.mock_club_search_result(flow, url):
            return
        await self.fault_request(flow, url)

    async def fault_request(self, flow, url):
        """预检和未命中接口透传。"""
        if flow.request.method == "OPTIONS":
            return
        if self.skip_fault(flow, url):
            return
        await self.inject_fault(flow)

    def skip_fault(self, flow, url):
        """保留用户名存在查询，其他请求仅命中当前故障路径。"""
        return self.mock_existing_username(flow, url.path) or not self.matches_fault(url)

    async def inject_fault(self, flow):
        """只延迟首次大厅故障，其他请求和控制入口仍可执行。"""
        self.intercepted_requests += 1
        if all((self.scenario == "hall-timeout", self.intercepted_requests == 1)):
            await asyncio.sleep(12)
        if flow.killable:
            flow.kill()


addons = [NetworkFaults()]
