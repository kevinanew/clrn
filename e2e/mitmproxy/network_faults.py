"""Test-controlled HTTP faults, applied only to staging API requests."""

import asyncio
import json
import os
from urllib.parse import urlsplit, parse_qs

from mitmproxy import http


class NetworkFaults:
    def __init__(self):
        self.token = os.environ["E2E_MITMPROXY_CONTROL_TOKEN"]
        self.scenario = None
        self.intercepted_requests = 0

    def control(self, flow: http.HTTPFlow):
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method == "POST" and path == "/scenario":
            try:
                scenario = json.loads(flow.request.content)["scenario"]
                if scenario not in (None, "hall-timeout", "login-failure", "club-failure"):
                    raise ValueError("Unknown scenario")
            except (ValueError, KeyError, TypeError):
                flow.response = http.Response.make(400, b"Invalid scenario")
                return
            self.scenario = scenario
            if scenario is not None:
                self.intercepted_requests = 0
        elif flow.request.method != "GET" or path != "/status":
            flow.response = http.Response.make(404, b"Not found")
            return
        flow.response = http.Response.make(
            200,
            json.dumps({
                "scenario": self.scenario,
                "interceptedRequests": self.intercepted_requests,
            }).encode(),
            {"Content-Type": "application/json"},
        )

    async def request(self, flow: http.HTTPFlow):
        if flow.request.host == "e2e-mitmproxy.invalid":
            self.control(flow)
            return
        # OPTIONS must reach the server so CORS preflight can succeed.
        if flow.request.method == "OPTIONS":
            return
        host = flow.request.host
        if host != "api.shafayouxi.org" and not host.endswith(
            ".api.staging.laiwan.shafayouxi.com"
        ):
            return
        url = urlsplit(flow.request.path)
        scenario = self.scenario
        if (
            scenario == "login-failure"
            and url.path == "/public/v10/user/username/is_existed"
        ):
            # Preserve the original test's existing-user branch. A real existence
            # lookup could make the form register a missing/mistyped test account.
            flow.response = http.Response.make(
                200,
                json.dumps({"ok": True, "result": {"is_existed": True}}).encode(),
                {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": flow.request.headers.get("Origin", "*"),
                    "Access-Control-Allow-Credentials": "true",
                    "Vary": "Origin",
                },
            )
            return
        matches = (
            scenario == "hall-timeout"
            and url.path == "/public/v1/hall_matching/available.json"
        ) or (
            scenario == "login-failure"
            and url.path == "/public/v10/user/login/username/password"
        ) or (
            scenario == "club-failure"
            and url.path == "/v10/club"
            and "user_id" in parse_qs(url.query, keep_blank_values=True)
        )
        if not matches:
            return
        self.intercepted_requests += 1
        if scenario == "hall-timeout" and self.intercepted_requests == 1:
            # Async delay keeps unrelated traffic and control requests flowing.
            await asyncio.sleep(12)
        if flow.killable:
            flow.kill()


addons = [NetworkFaults()]
