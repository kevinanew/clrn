import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from mitmproxy import connection, http

with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
    from network_faults import NetworkFaults


def flow(url, method="GET", body=b"", token=None):
    result = http.HTTPFlow(
        connection.Client(peername=("127.0.0.1", 12345), sockname=("127.0.0.1", 8080)),
        connection.Server(address=("node-0.service.invalid", 443)),
        live=True,
    )
    result.request = http.Request.make(method, url, body)
    if token is not None:
        result.request.headers["X-E2E-Control-Token"] = token
    return result


def source_environment():
    """为离线用例提供确切虚构来源，退出用例时恢复原始环境。"""
    return patch.dict('os.environ', {'MITMPROXY_API_HOSTS': '["node-0.service.invalid", "node-4.service.invalid", "node-7.service.invalid", "node-8.service.invalid", "node-15.service.invalid", "candidate-0.node-18.service.invalid", "candidate-1.node-18.service.invalid", "candidate-2.node-18.service.invalid"]',
            'MITMPROXY_FEEDBACK_ORIGIN': 'https://feedback.invalid'})


class NetworkFaultTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(source_environment())
        with patch.dict(os.environ, {"MITMPROXY_CONTROL_TOKEN": "test-token"}):
            self.addon = NetworkFaults()

    async def configure(self, scenario, token="test-token"):
        request = flow(
            "http://test-mitmproxy.invalid/scenario", "POST",
            json.dumps({"scenario": scenario}).encode(), token,
        )
        await self.addon.request(request)
        return request

    async def test_控制命令必须认证并匹配有效场景(self):
        self.assertEqual((await self.configure("hall-timeout", "wrong")).response.status_code, 403)
        self.assertIsNone(self.addon.scenario)
        self.assertEqual((await self.configure("unknown")).response.status_code, 400)
        self.assertIsNone(self.addon.scenario)
        malformed = flow("http://test-mitmproxy.invalid/scenario", "POST", b"[]", "test-token")
        await self.addon.request(malformed)
        self.assertEqual(malformed.response.status_code, 400)

    async def test_大厅只延迟首次请求且关闭场景后恢复透传(self):
        await self.configure("hall-timeout")
        url = "https://node-4.service.invalid/public/v1/hall_matching/available.json"
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

    async def test_延迟不阻塞控制或无关请求(self):
        await self.configure("hall-timeout")
        entered = asyncio.Event()
        release = asyncio.Event()

        async def delay(_seconds):
            entered.set()
            await release.wait()

        with patch("network_faults.asyncio.sleep", delay):
            pending = asyncio.create_task(self.addon.request(flow(
                "https://node-0.service.invalid/public/v1/hall_matching/available.json"
            )))
            try:
                await asyncio.wait_for(entered.wait(), 1)
                await asyncio.wait_for(self.configure(None), 1)
                unrelated = flow("https://node-0.service.invalid/health")
                await asyncio.wait_for(self.addon.request(unrelated), 1)
                self.assertIsNone(unrelated.error)
            finally:
                release.set()
                await pending

    async def test_登录和俱乐部故障严格限定来源与路径(self):
        for scenario, api_path in (
            ("login-failure", "/public/v10/user/login/username/password"),
            ("club-failure", "/v10/club?user_id=42"),
        ):
            await self.configure(scenario)
            for url, method in (
                (f"https://node-6.service.invalid{api_path}", "POST"),
                (f"https://node-0.service.invalid{api_path}", "OPTIONS"),
                ("https://node-0.service.invalid/v10/club?other=42", "GET"),
                ("https://node-0.service.invalid/health", "GET"),
            ):
                request = flow(url, method)
                await self.addon.request(request)
                self.assertIsNone(request.error)
            request = flow(f"https://node-0.service.invalid{api_path}", "POST")
            await self.addon.request(request)
            self.assertIsNotNone(request.error)
            self.assertEqual(self.addon.intercepted_requests, 1)

    async def test_登录保留既有用户分支且不计为故障(self):
        url = "https://node-0.service.invalid/public/v10/user/username/is_existed"
        unrelated = flow(url)
        await self.addon.request(unrelated)
        self.assertIsNone(unrelated.response)
        await self.configure("login-failure")
        request = flow(url, "POST", b'{"username":"weaknetwork"}')
        request.request.headers["Origin"] = "https://node-5.service.invalid"
        await self.addon.request(request)
        self.assertTrue(json.loads(request.response.content)["result"]["is_existed"])
        self.assertEqual(request.response.headers["Access-Control-Allow-Origin"],
                         "https://node-5.service.invalid")
        self.assertEqual(self.addon.intercepted_requests, 0)
        preflight = flow(url, "OPTIONS")
        await self.addon.request(preflight)
        self.assertIsNone(preflight.response)

    async def test_俱乐部搜索只返回指定的固定俱乐部(self):
        await self.configure("club-search-result")
        origin = "https://node-5.service.invalid"
        search = flow("https://node-0.service.invalid/v10/club/search?keyword=VisualClubSearch")
        search.request.headers["Origin"] = origin
        await self.addon.request(search)
        self.assertEqual(search.response.json()["result"], ["12f2cb6e-9045-4910-b58a-7d3903f56a39"])
        self.assertEqual(search.response.headers["Access-Control-Allow-Origin"], origin)

        preflight = flow("https://node-0.service.invalid/v10/clubs", "OPTIONS")
        preflight.request.headers["Origin"] = origin
        preflight.request.headers["Access-Control-Request-Headers"] = "authorization,content-type"
        await self.addon.request(preflight)
        self.assertIsNone(preflight.response, '预检必须由真实上游处理')

        details = flow("https://node-0.service.invalid/v10/clubs", "PUT",
                       b'{"club_ids":["12f2cb6e-9045-4910-b58a-7d3903f56a39"]}')
        await self.addon.request(details)
        self.assertEqual(details.response.json()["result"][0]["name"], "搜索测试俱乐部")
        self.assertEqual(self.addon.club_search_requests, 1)
        self.assertEqual(self.addon.club_details_requests, 1)

        other_details = flow("https://node-0.service.invalid/v10/clubs", "PUT",
                             b'{"club_ids":["another-club"]}')
        await self.addon.request(other_details)
        self.assertIsNone(other_details.response)
        self.assertEqual(self.addon.club_details_requests, 1)

        unrelated = flow("https://node-0.service.invalid/v10/club?user_id=42")
        await self.addon.request(unrelated)
        self.assertIsNone(unrelated.response)
        wrong_keyword = flow("https://node-0.service.invalid/v10/club/search?keyword=other")
        await self.addon.request(wrong_keyword)
        self.assertIsNone(wrong_keyword.response)
        self.assertEqual(self.addon.club_search_requests, 1)

    async def test_搜索未命中流量及预检均透传(self):
        await self.configure('club-search-result')
        for path in ('/v10/club/search?keyword=other', '/v10/club/search',
                     '/v10/club/search?keyword=',
                     '/v10/club/search?keyword=VisualClubSearch&keyword=other'):
            for method in ('GET', 'POST', 'PUT', 'OPTIONS'):
                with self.subTest(path=path, method=method):
                    request = flow('https://node-0.service.invalid' + path, method)
                    await self.addon.request(request)
                    self.assertIsNone(request.response)
                    self.assertIsNone(request.error)
        for method in ('POST', 'PUT', 'DELETE', 'OPTIONS'):
            request = flow('https://node-0.service.invalid/v10/club/search?keyword=VisualClubSearch', method)
            await self.addon.request(request)
            self.assertIsNone(request.response)
        self.assertEqual(self.addon.club_search_requests, 0)

    async def test_正常视觉模式不拦截任何候选节点或元数据(self):
        await self.configure("visual-stable")
        urls = ["https://node-0.service.invalid/public/v13/metadata/servers",
                "https://node-0.service.invalid/public/v12/metadata/servers"]
        urls.extend(f"https://{host}/node/v1/status" for host in (
            "node-4.service.invalid",
            "node-7.service.invalid",
            "node-8.service.invalid",
            "node-9.service.invalid"))
        for url in urls:
            for method in ('GET', 'POST', 'OPTIONS'):
                with self.subTest(url=url, method=method):
                    request = flow(url, method)
                    await self.addon.request(request)
                    self.assertIsNone(request.response)
                    self.assertIsNone(request.error)
        self.assertEqual(self.addon.stabilized_requests, 0)
        self.assertEqual(self.addon.intercepted_requests, 0)


if __name__ == "__main__":
    unittest.main()
