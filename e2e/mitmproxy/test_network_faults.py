import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from mitmproxy import connection, http

with patch.dict(os.environ, {"E2E_MITMPROXY_CONTROL_TOKEN": "test-token"}):
    from network_faults import NetworkFaults


def flow(url, method="GET", body=b"", token=None):
    result = http.HTTPFlow(
        connection.Client(peername=("127.0.0.1", 12345), sockname=("127.0.0.1", 8080)),
        connection.Server(address=("api.shafayouxi.org", 443)),
        live=True,
    )
    result.request = http.Request.make(method, url, body)
    if token is not None:
        result.request.headers["X-E2E-Control-Token"] = token
    return result


class NetworkFaultTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        with patch.dict(os.environ, {"E2E_MITMPROXY_CONTROL_TOKEN": "test-token"}):
            self.addon = NetworkFaults()

    async def configure(self, scenario, token="test-token"):
        request = flow(
            "http://e2e-mitmproxy.invalid/scenario", "POST",
            json.dumps({"scenario": scenario}).encode(), token,
        )
        await self.addon.request(request)
        return request

    async def test_control_requires_token_and_valid_scenario(self):
        self.assertEqual((await self.configure("hall-timeout", "wrong")).response.status_code, 403)
        self.assertIsNone(self.addon.scenario)
        self.assertEqual((await self.configure("unknown")).response.status_code, 400)
        self.assertIsNone(self.addon.scenario)
        malformed = flow("http://e2e-mitmproxy.invalid/scenario", "POST", b"[]", "test-token")
        await self.addon.request(malformed)
        self.assertEqual(malformed.response.status_code, 400)

    async def test_hall_delays_only_first_request_and_clear_restores_forwarding(self):
        await self.configure("hall-timeout")
        url = "https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/public/v1/hall_matching/available.json"
        with patch("network_faults.asyncio.sleep", new_callable=AsyncMock) as delay:
            for _ in range(2):
                request = flow(url)
                await self.addon.request(request)
                self.assertIsNotNone(request.error)
            delay.assert_awaited_once_with(12)
        self.assertEqual(self.addon.intercepted_requests, 2)
        await self.configure(None)
        recovered = flow(url)
        await self.addon.request(recovered)
        self.assertIsNone(recovered.error)
        self.assertEqual(self.addon.intercepted_requests, 2)

    async def test_delay_does_not_block_control_or_unrelated_requests(self):
        await self.configure("hall-timeout")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def delay(_seconds):
            entered.set()
            await release.wait()

        with patch("network_faults.asyncio.sleep", delay):
            pending = asyncio.create_task(self.addon.request(flow(
                "https://api.shafayouxi.org/public/v1/hall_matching/available.json"
            )))
            try:
                await asyncio.wait_for(entered.wait(), 1)
                await asyncio.wait_for(self.configure(None), 1)
                unrelated = flow("https://api.shafayouxi.org/health")
                await asyncio.wait_for(self.addon.request(unrelated), 1)
                self.assertIsNone(unrelated.error)
            finally:
                release.set()
                await pending

    async def test_login_and_club_are_scoped_to_staging_and_matching_paths(self):
        for scenario, api_path in (
            ("login-failure", "/public/v10/user/login/username/password"),
            ("club-failure", "/v10/club?user_id=42"),
        ):
            await self.configure(scenario)
            for url, method in (
                (f"https://api.example.com{api_path}", "POST"),
                (f"https://api.shafayouxi.org{api_path}", "OPTIONS"),
                ("https://api.shafayouxi.org/v10/club?other=42", "GET"),
                ("https://api.shafayouxi.org/health", "GET"),
            ):
                request = flow(url, method)
                await self.addon.request(request)
                self.assertIsNone(request.error)
            request = flow(f"https://api.shafayouxi.org{api_path}", "POST")
            await self.addon.request(request)
            self.assertIsNotNone(request.error)
            self.assertEqual(self.addon.intercepted_requests, 1)

    async def test_login_keeps_existing_user_branch_without_counting_it_as_a_fault(self):
        url = "https://api.shafayouxi.org/public/v10/user/username/is_existed"
        unrelated = flow(url)
        await self.addon.request(unrelated)
        self.assertIsNone(unrelated.response)
        await self.configure("login-failure")
        request = flow(url, "POST", b'{"username":"weaknetwork"}')
        request.request.headers["Origin"] = "https://h5.page.shafayouxi.org"
        await self.addon.request(request)
        self.assertTrue(json.loads(request.response.content)["result"]["is_existed"])
        self.assertEqual(request.response.headers["Access-Control-Allow-Origin"],
                         "https://h5.page.shafayouxi.org")
        self.assertEqual(self.addon.intercepted_requests, 0)
        preflight = flow(url, "OPTIONS")
        await self.addon.request(preflight)
        self.assertIsNone(preflight.response)


if __name__ == "__main__":
    unittest.main()
